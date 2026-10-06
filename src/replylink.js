// A reply link a friend sent back (#reply=CODE). The host clicks it, so this
// tab only hands the reply to the game this browser already has open (where
// the host is hosting) and says how it went; the game itself doesn't load here.

import { setLang, t } from './i18n.js';

const CHANNEL = 'retro-strike-online';   // as in onlineui.js
const WAIT_MS = 2500;                     // how long the game tabs have to answer

const code = (location.hash.match(/^#reply=([A-Za-z0-9_-]+)/) || [])[1] || '';
history.replaceState(null, '', location.pathname + location.search);

// in the player's language (the game's settings, else the browser's)
let lang = (navigator.language || 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en';
try {
  const s = JSON.parse(localStorage.getItem('cs16remake.settings.v1') || 'null');
  if (s && typeof s.lang === 'string') lang = s.lang;
} catch { /* storage blocked */ }
setLang(lang);
document.title = 'Retro Strike: Bot Arena';

const text = document.getElementById('boot-text');
const say = (...parts) => {
  text.textContent = '';
  text.append(...parts);
};

// no game here to take it: the code, to paste in the game by hand
function showCode(key) {
  const input = Object.assign(document.createElement('input'), { className: 'vgui-input rl-code', value: code, readOnly: true });
  input.onfocus = () => input.select();
  const copy = Object.assign(document.createElement('button'), { className: 'vgui-btn primary', textContent: t('onlCopy') });
  const copied = () => { copy.textContent = t('onlCopied'); };
  // (the old way where the clipboard can't be written to directly)
  const old = () => {
    input.select();
    try { if (document.execCommand('copy')) copied(); } catch { /* selected: Ctrl+C works */ }
  };
  copy.onclick = () => {
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(code).then(copied, old);
    else old();
  };
  const row = Object.assign(document.createElement('div'), { className: 'rl-row' });
  row.append(input, copy);
  say(Object.assign(document.createElement('div'), { textContent: t(key) }), row);
}

if (!code) say(t('rlBad'));
else {
  say(t('rlSending'));
  let channel = null;
  try { channel = new BroadcastChannel(CHANNEL); } catch { /* an old browser */ }
  if (!channel) showCode('rlNoGame');
  else {
    const nonce = Math.random().toString(36).slice(2);
    const answers = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      channel.close();
      // a tab that took it wins (or had it already: the link clicked twice);
      // else the most telling answer
      const ok = answers.includes('ok') || answers.includes('again');
      if (ok) {
        say(t('rlSent'));
        // (a tab opened from a link may close itself; if not, the text says so)
        setTimeout(() => window.close(), 1500);
      } else if (!answers.length) showCode('rlNoGame');
      else {
        const why = ['full', 'version', 'bad', 'other'].find((r) => answers.includes(r)) || 'other';
        if (why === 'other') showCode('rl_other');
        else say(t(why === 'bad' ? 'rlBad' : 'rl_' + why));
      }
    };
    channel.onmessage = (e) => {
      const m = e.data;
      if (!m || m.t !== 'replied' || m.nonce !== nonce) return;
      answers.push(m.result);
      if (m.result === 'ok' || m.result === 'again') finish();
    };
    channel.postMessage({ t: 'reply', code, nonce });
    setTimeout(finish, WAIT_MS);
  }
}
