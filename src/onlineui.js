// The Play online window: the name you play under, hosting or joining a game,
// the invite link and reply codes, and the lobby (who's in and on which team,
// and the host's match settings). online.js keeps the sessions.

import { t } from './i18n.js';
import { h } from './ui.js';
import { settings, saveSettings, hasTeams } from './settings.js';
import { HostSession, ClientSession, MAX_PLAYERS, MAX_TEAM, codeFrom, replyUrl } from './online.js';
import { readInvite, relayServers } from './net.js';

// reply links clicked in another tab of this browser arrive on this channel
// (replylink.js sends them)
const CHANNEL = 'retro-strike-online';
const SLOW_HOST_MS = 45000;   // friend: when to explain what a long wait may mean

const TEAM_LABEL = { auto: 'autoSelect', T: 'teamT', CT: 'teamCT', spec: 'spectate' };

export class OnlineScreens {
  // on: { start(session), message(session, msg), ended(why), joinMatch(session) }
  // (main.js starts and joins the matches)
  constructor(ui, on) {
    this.ui = ui;
    this.on = on;
    this.session = null;
    this.view = 'start';     // 'name' | 'start' | 'join' | 'lobby'
    this.after = null;       // where the name prompt leads
    this.tab = 'game';       // the host's settings tab
    this.note = null;        // a message at the top: { text, bad }
    this.invite = null;      // the newest invite: { id, url } (or { making: true })
    this.reply = '';         // the reply code being typed (host)
    this.joinText = '';      // the invite being typed (friend)
    this.myReply = null;     // the friend's own reply code
    this.listEl = null;
    this.copied = '';
    try {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = (e) => this.replyFromTab(e.data);
    } catch {
      this.channel = null;   // (pasting the reply still works)
    }
  }

  isOpen() {
    return this.ui.dialog?.name === 'online';
  }

  open(view) {
    if (view) this.view = view;
    // in a game already: show the lobby; else ask for a name first
    if (!this.session && !settings.playerName && this.view !== 'name') {
      this.after = this.view;
      this.view = 'name';
    }
    this.ui.dialog = { name: 'online', render: () => this.render() };
    this.ui.renderAll();
  }

  // a friend opened an invite link
  openInvite(code) {
    if (this.session) return this.open('lobby');
    this.joinText = code;
    this.view = 'join';
    this.open();
    if (settings.playerName) this.join();
  }

  redraw() {
    if (this.isOpen()) this.ui.renderAll();
  }

  say(key, bad = false, vars) {
    this.note = key ? { text: t(key, vars), bad } : null;
    this.redraw();
  }

  // ---------------------------------------------------------------- sessions

  host() {
    const s = new HostSession(settings.playerName, settings.onlineMatch, settings.relay);
    this.watch(s);
    this.session = s;
    this.view = 'lobby';
    this.invite = null;
    this.reply = '';
    this.note = null;
    this.redraw();
  }

  async join() {
    let code;
    try {
      code = codeFrom(this.joinText);
      readInvite(code);
    } catch (e) {
      this.say(e.message === 'version' ? 'onlEnded_version' : 'onlBadInvite', true);
      return;
    }
    const s = new ClientSession(settings.playerName);
    this.watch(s);
    this.session = s;
    this.myReply = null;
    this.note = null;
    this.view = 'join';
    this.redraw();
    try {
      this.myReply = replyUrl(await s.answer(code));
    } catch {
      this.session = null;
      s.close();
      this.say('onlBadInvite', true);
      return;
    }
    // a long wait gets a word on what it may mean
    setTimeout(() => { if (s === this.session && this.view === 'join') this.redraw(); }, SLOW_HOST_MS + 100);
    this.redraw();
  }

  watch(s) {
    // the match itself goes to main.js
    s.on('message', (msg) => {
      if (s === this.session) this.on.message?.(s, msg);
    });
    // the guns we like, for the spawns before we pick some in the match
    s.on('welcome', () => s.send({ t: 'guns', primary: settings.guns.primary, secondary: settings.guns.secondary }));
    s.on('lobby', () => {
      if (s !== this.session) return;
      if (this.view === 'join') {
        this.view = 'lobby';
        this.note = null;
        this.redraw();
      } else if (s.role === 'host' && this.listEl && this.listEl.isConnected) {
        // only the list: the host may be typing a reply code or changing settings
        this.fillPlayers(this.listEl);
      } else this.redraw();
    });
    s.on('join', (p) => this.say('onlJoined', false, { name: p.name }));
    s.on('leave', (p) => this.say('onlLeft', false, { name: p.name }));
    s.on('failed', (relay) => this.say(relay ? 'onlFriendFailedRelay' : 'onlFriendFailed', true));
    s.on('end', (why) => {
      if (s !== this.session) return;
      this.session = null;
      this.myReply = null;
      this.view = 'start';
      this.note = { text: t('onlEnded_' + (why || 'closed')), bad: why !== 'left' };
      this.on.ended?.(why);
      if (!this.isOpen()) this.open();
      else this.redraw();
    });
  }

  leave() {
    const s = this.session;
    if (!s) return;
    this.session = null;
    if (s.role === 'host') s.close('host');
    else s.close();
    // (a match going on ends with it)
    this.on.ended?.('left');
    this.view = 'start';
    this.invite = null;
    this.myReply = null;
    this.note = null;
    this.redraw();
  }

  async makeInvite() {
    const s = this.session;
    if (!s || s.role !== 'host') return;
    this.invite = { making: true };
    this.note = null;
    this.redraw();
    try {
      const inv = await s.invite();
      if (s !== this.session) return;
      this.invite = inv;
    } catch (e) {
      this.invite = null;
      this.note = { text: t(e.message === 'full' ? 'onlFull' : 'onlInviteFailed'), bad: true };
    }
    this.redraw();
  }

  async addReply() {
    if (this.reply.trim() && (await this.acceptReply(this.reply)) === 'ok') {
      this.reply = '';
      this.redraw();
    }
  }

  // a friend's reply (link or code) -> 'ok' | 'other' | 'full' | 'version' | 'bad' | 'nohost'
  async acceptReply(text) {
    const s = this.session;
    if (!s || s.role !== 'host') return 'nohost';
    let result = 'ok';
    try {
      await s.accept(codeFrom(text));
    } catch (e) {
      result = ['other', 'full', 'version'].includes(e.message) ? e.message : 'bad';
    }
    if (result === 'ok') this.say('onlConnecting');
    else this.say({ other: 'onlReplyOther', full: 'onlFull', version: 'onlEnded_version', bad: 'onlReplyBad' }[result], true);
    return result;
  }

  // a reply link clicked in another tab (only a tab that hosts answers)
  async replyFromTab(m) {
    if (!m || m.t !== 'reply' || typeof m.code !== 'string' || this.session?.role !== 'host') return;
    const result = await this.acceptReply(m.code);
    this.channel?.postMessage({ t: 'replied', nonce: m.nonce, result });
    if (result === 'ok' && !this.isOpen() && !this.on.inMatch?.()) this.open('lobby');
  }

  // a reply link opened in this very tab (pasted into its address bar)
  replyFromLink(code) {
    if (this.session?.role !== 'host') return;
    if (!this.on.inMatch?.()) this.open('lobby');
    this.acceptReply(code);
  }

  copy(text, what) {
    const done = () => { this.copied = what; this.redraw(); setTimeout(() => { if (this.copied === what) { this.copied = ''; this.redraw(); } }, 1500); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => {});
  }

  // ---------------------------------------------------------------- window

  render() {
    const ui = this.ui;
    let body, buttons;
    if (this.view === 'name') [body, buttons] = this.nameView();
    else if (this.view === 'lobby' && this.session) [body, buttons] = this.lobbyView();
    else if (this.view === 'join') [body, buttons] = this.joinView();
    else [body, buttons] = this.startView();
    const note = this.note ? h('div', { class: 'onl-note' + (this.note.bad ? ' bad' : '') }, this.note.text) : null;
    return ui.win(t('playOnline'), h('div', { class: 'onl' }, note, body), buttons, 'w-online');
  }

  nameView() {
    const ui = this.ui;
    let name = settings.playerName;
    const ok = () => {
      const v = name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
      if (!v) return;
      settings.playerName = v;
      saveSettings();
      this.view = this.after || 'start';
      this.after = null;
      if (this.view === 'join' && this.joinText && !this.session) this.join();
      else this.redraw();
    };
    const input = h('input', {
      class: 'vgui-input onl-name', value: name, maxlength: 20, placeholder: t('onlNamePh'),
      oninput: (e) => { name = e.target.value; },
      onkeydown: (e) => { if (e.key === 'Enter') ok(); },
    });
    setTimeout(() => input.focus(), 0);
    return [h('div', { class: 'vgui-form' },
      h('div', { class: 'ar-head' }, t('onlNameTitle')),
      input,
      h('div', { class: 'vgui-desc' }, t('onlNameDesc'))),
    [ui.btn(t('ok'), ok, true), ui.btn(t('cancel'), () => ui.closeDialog())]];
  }

  startView() {
    const ui = this.ui;
    const joinInput = h('input', {
      class: 'vgui-input onl-code', value: this.joinText, placeholder: t('onlPasteInvite'),
      oninput: (e) => { this.joinText = e.target.value; },
      onkeydown: (e) => { if (e.key === 'Enter') this.join(); },
    });
    return [h('div', { class: 'onl-start' },
      h('div', { class: 'onl-box' },
        h('div', { class: 'ar-head big' }, t('onlHost')),
        h('div', { class: 'vgui-desc' }, t('onlHostDesc')),
        ui.btn(t('onlHostBtn'), () => this.host(), true)),
      h('div', { class: 'onl-box' },
        h('div', { class: 'ar-head big' }, t('onlJoin')),
        h('div', { class: 'vgui-desc' }, t('onlJoinDesc')),
        joinInput,
        ui.btn(t('onlJoinBtn'), () => this.join())),
      h('div', { class: 'vgui-desc onl-foot' }, t('onlPlayingAs', { name: settings.playerName }), ' ',
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); this.after = 'start'; this.view = 'name'; this.redraw(); } }, t('onlChangeName')))),
    [ui.btn(t('close'), () => ui.closeDialog())]];
  }

  joinView() {
    const ui = this.ui, s = this.session;
    if (!s) return this.startView();
    const rows = [];
    if (!this.myReply) rows.push(h('div', { class: 'vgui-desc' }, t('onlMaking')));
    else {
      rows.push(h('div', { class: 'ar-head big' }, t('onlReplyTitle')),
        h('div', { class: 'vgui-desc' }, t('onlReplyDesc')),
        h('div', { class: 'onl-copyrow' },
          h('input', { class: 'vgui-input onl-code', value: this.myReply, readonly: true, onfocus: (e) => e.target.select() }),
          ui.btn(this.copied === 'reply' ? t('onlCopied') : t('onlCopy'), () => this.copy(this.myReply, 'reply'), true)),
        h('div', { class: 'onl-wait' }, t(s.link?.state === 'open' ? 'onlConnecting' : 'onlWaitingHost')));
      if (s.link?.state !== 'open' && performance.now() - s.waitingSince > SLOW_HOST_MS) {
        rows.push(h('div', { class: 'vgui-desc onl-slow' }, t(s.link?.relay ? 'onlSlowHostRelay' : 'onlSlowHost')));
      }
    }
    return [h('div', { class: 'vgui-form' }, rows), [ui.btn(t('cancel'), () => this.leave())]];
  }

  lobbyView() {
    const ui = this.ui, s = this.session, host = s.role === 'host';
    const lobby = host ? s.view() : s.lobby;
    if (!lobby) return this.joinView();
    // a match is on: no settings to change; a friend outside it can join it
    const playing = lobby.state === 'match';
    const me = lobby.players.find((p) => p.pid === (host ? 0 : s.pid));
    const left = h('div', { class: 'onl-left' });
    if (playing) left.append(h('div', { class: 'onl-running' }, t('onlMatchRunning')));
    this.listEl = h('div', { class: 'onl-players' });
    this.fillPlayers(this.listEl);
    left.append(this.listEl);
    if (host) left.append(this.invitePanel());
    const right = h('div', { class: 'onl-right' }, host && !playing ? this.hostSettings() : this.settingsSummary(lobby.cfg, playing));
    let buttons;
    if (host) {
      buttons = [
        playing ? null : ui.btn(t('onlStart'), () => this.on.start(s), true),
        ui.btn(t('onlCloseGame'), () => this.leave()),
        ui.btn(t('close'), () => ui.closeDialog()),
      ];
    } else {
      buttons = [
        playing && me && !me.inMatch ? ui.btn(t('onlJoinMatch'), () => this.on.joinMatch(s), true) : null,
        ui.btn(t('onlLeave'), () => this.leave()),
        ui.btn(t('close'), () => ui.closeDialog()),
      ];
    }
    return [h('div', { class: 'onl-cols' }, left, right), buttons];
  }

  // the players and the team buttons (redrawn on its own when the lobby changes)
  fillPlayers(el) {
    const ui = this.ui, s = this.session;
    if (!s) return;
    const lobby = s.role === 'host' ? s.view() : s.lobby;
    if (!lobby) return;
    const myPid = s.role === 'host' ? 0 : s.pid;
    const teamsMode = hasTeams(lobby.cfg);
    const me = lobby.players.find((p) => p.pid === myPid);
    el.innerHTML = '';
    el.append(h('div', { class: 'ar-head' }, t('onlPlayers', { n: lobby.players.length, max: MAX_PLAYERS })));
    const label = (team) => t(teamsMode ? TEAM_LABEL[team] : team === 'spec' ? 'spectate' : 'onlPlay');
    for (const p of lobby.players) {
      el.append(h('div', { class: 'onl-player' + (p.pid === myPid ? ' me' : '') },
        h('b', {}, p.name),
        p.pid === 0 ? h('span', { class: 'onl-tag' }, t('onlHostTag')) : null,
        lobby.state === 'match' && p.inMatch ? h('span', { class: 'onl-tag play' }, t('onlInMatchTag')) : null,
        h('span', { class: 'ar-sub' }, label(p.team)),
        p.pid === 0 ? null : h('span', { class: 'ar-sub onl-ping' }, t('onlPing', { n: p.ping }))));
    }
    // (in the match, the team menu there changes teams: M)
    if (lobby.state === 'match' && me && me.inMatch) return;
    const count = (team) => lobby.players.filter((p) => p.team === team && p.pid !== myPid).length;
    const choices = teamsMode ? ['auto', 'T', 'CT', 'spec'] : ['auto', 'spec'];
    el.append(h('div', { class: 'ar-head' }, t('onlTeamPick')),
      h('div', { class: 'ar-btns' }, choices.map((team) => {
        const full = (team === 'T' || team === 'CT') && count(team) >= MAX_TEAM;
        const b = ui.btn(label(team) + (full ? ' (' + t('onlTeamFull') + ')' : ''), () => s.setTeam(team), me && me.team === team);
        if (full) b.disabled = true;
        return b;
      })));
  }

  invitePanel() {
    const ui = this.ui, s = this.session, inv = this.invite;
    const relay = relayServers(settings.relay).length > 0;
    const rows = [h('div', { class: 'ar-head' }, t('onlInvite')), h('div', { class: 'vgui-desc' }, t('onlInviteDesc')),
      h('div', { class: 'vgui-desc onl-relay' + (relay ? ' on' : '') }, t(relay ? 'onlRelayOnNote' : 'onlRelayOffNote'))];
    if (inv && inv.making) rows.push(h('div', { class: 'vgui-desc' }, t('onlMaking')));
    else if (inv) {
      rows.push(h('div', { class: 'onl-copyrow' },
        h('input', { class: 'vgui-input onl-code', value: inv.url, readonly: true, onfocus: (e) => e.target.select() }),
        ui.btn(this.copied === 'link' ? t('onlCopied') : t('onlCopy'), () => this.copy(inv.url, 'link'), true)));
    }
    rows.push(h('div', { class: 'ar-btns' }, ui.btn(inv && !inv.making ? t('onlInviteAnother') : t('onlInviteBtn'), () => this.makeInvite(), !inv)));
    if (s.invites.size) {
      rows.push(h('div', { class: 'vgui-desc' }, t('onlInvitesWaiting', { n: s.invites.size })),
        h('div', { class: 'onl-copyrow' },
          h('input', {
            class: 'vgui-input onl-code', value: this.reply, placeholder: t('onlPasteReply'),
            oninput: (e) => { this.reply = e.target.value; },
            onkeydown: (e) => { if (e.key === 'Enter') this.addReply(); },
          }),
          ui.btn(t('onlAdd'), () => this.addReply(), true)));
    }
    return h('div', { class: 'onl-invite' }, rows);
  }

  hostSettings() {
    const ui = this.ui, m = settings.onlineMatch;
    const tabs = [['game', t('cgTabGame')], ['advanced', t('cgTabAdvanced')], ['hacks', t('cgTabHacks')]];
    const bar = h('div', { class: 'vgui-tabs' }, tabs.map(([id, label]) =>
      h('button', { class: 'vgui-tab' + (this.tab === id ? ' on' : ''), onclick: () => { ui.click(); this.tab = id; this.redraw(); } }, label)));
    const body = this.tab === 'advanced' ? ui.createAdvanced(m) : this.tab === 'hacks' ? ui.createHacks(m, true) : ui.createMain(m, true);
    // anything changed goes out to the friends (the controls write into m)
    const el = h('div', { class: 'vgui-tabbody onl-settings', onchange: () => this.session?.changed?.(), oninput: () => this.session?.changed?.() }, body);
    return h('div', {}, bar, el);
  }

  // the match settings, to read (playing: a match is on, the host's too)
  settingsSummary(cfg, playing = false) {
    const rows = [
      [t('map'), cfg.map],
      [t('gameMode'), t('mode_' + cfg.mode) + (cfg.mode === 'gungame' ? ' (' + t(cfg.ggTeams ? 'ggTeams' : 'ggFfa') + ')' : '')],
      [t(hasTeams(cfg) ? 'onlFillTeam' : 'onlFillAll'), hasTeams(cfg) ? `${cfg.fill} v ${cfg.fill}` : String(cfg.fill)],
      [t('botDifficulty'), t('diff_' + cfg.difficulty)],
      [t('hacksAllowed'), t(cfg.hacks ? 'yes' : 'no')],
    ];
    return h('div', { class: 'vgui-form' },
      h('div', { class: 'ar-head' }, t('onlSettings')),
      rows.map(([k, v]) => ui_row(k, v)),
      h('div', { class: 'vgui-desc' }, t(playing ? 'onlSettingsAfter' : 'onlSettingsHostOnly')));
  }
}

const ui_row = (k, v) => h('div', { class: 'vgui-row' }, h('label', {}, k), h('span', {}, v));
