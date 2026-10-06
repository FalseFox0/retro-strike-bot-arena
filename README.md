# Retro Strike: Bot Arena

A from-scratch browser shooter in the style of Counter-Strike 1.6 (JavaScript + Three.js), with a **Bot Arena** where bot characters play thousands of matches, seasons and cups in the background.
All textures, models and sounds are generated in code. No original game files are used.

> Fan-made. Not affiliated with, endorsed or sponsored by Valve Corporation. Counter-Strike and CS are trademarks of Valve Corporation.

## Play

**Online:** https://falsefox0.github.io/retro-strike-bot-arena/ — nothing to install; use a computer with a keyboard and mouse and a current Chrome, Edge or Firefox.
Your saves (Bot Arena, settings, highlights) stay in that browser on that computer.

**On your own computer:** double-click `start.bat`. It starts a small local server (`serve.py`, Python) and opens http://localhost:8016.
The server only listens on your own computer and turns off caching, so a normal reload always gets the latest files.
Keep its window open while you play: Bot Arena's background threads load the game from it every time they start.

(Browsers won't load JavaScript modules straight from disk, so opening `index.html` directly doesn't work.)

> **TR:** Çevrimiçi oyna: https://falsefox0.github.io/retro-strike-bot-arena/ (kurulum yok). Kendi bilgisayarında: `start.bat` dosyasına çift tıkla, oyun http://localhost:8016 adresinde açılır. Oynarken açılan pencereyi kapatma (Bot Arenası ona ihtiyaç duyar).

## Play with friends

Up to 10 players (5 v 5) in every mode and on every map, with bots in the places nobody plays. There's no account and no game server: the host's browser runs the match, and the friends' browsers connect straight to it (WebRTC, encrypted). Connecting takes one link each way:

1. The host: **Play online → Host**, then **Make an invite link**, and sends it to one friend (each friend needs a link of their own).
2. The friend opens the link. The game shows them a short **reply link**, which they send back.
3. The host clicks the reply link (in the browser where the game is open), and the friend is in the lobby. Pasting it into the lobby works too.
4. Everyone picks a team; the host picks the match settings and presses **Start match**.

Friends can join a running match from the lobby, and a friend's **Esc → Back to the lobby** leaves the match without disconnecting. The host's **Esc → End the match** sends everyone back to the lobby; after a match everyone goes back by themselves after 20 s (the host can go sooner). Keep the host's page open: closing it ends the game for everyone.
Your own movement doesn't wait for the host, and shots are checked against what the shooter saw (lag compensation).

**Universities, offices and mobile data** often block direct connections between players. For those, the host can add a free **relay** (a TURN server, for example a free account at expressturn.com) in **Options → Game**: copy its server, username and password there and press **Test the relay**. The host's invite links pass it on to the friends, and it's only used when a direct connection doesn't work. The relay only passes the game data along; it can't read it.

> **TR:** Arkadaşlarla oyna: **Çevrimiçi oyna → Kur**, **Davet bağlantısı oluştur**, bağlantıyı bir arkadaşına gönder; o bağlantıyı açınca çıkan kısa **yanıt bağlantısını** sana geri gönderir, sen ona tıklarsın. Herkes lobideyken **Maçı başlat**. Üniversite veya mobil veri bağlantıyı engelliyorsa kurucu **Seçenekler → Oyun** kısmına ücretsiz bir **aktarıcı** (TURN sunucusu, ör. expressturn.com) ekleyebilir.

## What's in it

- **Modes:** Team Deathmatch, Free-for-all, Classic rounds, **Bomb defusal** and **Gun Game**. Every mode can be played on every map; bomb defusal needs a map with bomb sites
- **Gun Game:** free-for-all or T vs CT. Start with a Glock and climb the classic GunGame order (pistols, shotguns, SMGs, rifles, Scout, M249) to the knife; pistols need 1 kill, shotguns, SMGs and the Scout 2, rifles and the M249 3. A knife kill on the knife level wins; falling to your death costs a level. The HUD shows your level, kills and the next gun, and TAB shows everyone's level. The map's own gun rules (fy_ ground guns, awp_ AWPs) are off in this mode
- **Bomb defusal (like 1.6):** money ($800 start, $16000 max, $300 a kill, $3250–3500 for a won round, a loss bonus that grows with a losing streak, +$800 for Terrorists who planted but lost). The 1.6 buy menu (**B**, in the buy zone during the first 90 s; **F1** autobuy, **F2** rebuy) sells every gun, armor, helmet, grenades and the defuse kit; bought guns come with full ammo. A random Terrorist gets the C4: **5** takes it out, hold fire at site A or B for 3 s to plant. It beeps faster and faster for 35 s (the round clock disappears, like 1.6); CTs hold **E** on it to defuse (10 s, 5 s with a kit). 1:45 rounds, 3 s freeze time and $800 to start (all changeable in Create Game → Advanced). **G** drops your gun, dead players drop theirs and the bomb; walk over a gun to take it, **E** swaps. A radio voice announces the round events
- **Weapon menu:** a 1.6-style VGUI window (Pistols, Shotguns, SMGs, Rifles, Machine gun; mouse or number keys) pops up when you spawn (every round in Classic). Choices made then, or with **B** within ~10 s of spawning, apply at once; later picks apply on your next spawn. Team-only guns follow 1.6 in Team DM and Classic; FFA allows everything
- **Weapons:** the full 1.6 list. Pistols: Glock 18 (burst), USP (silencer), P228, Desert Eagle, Dual Elites (T), Five-SeveN (CT). Shotguns: M3 (pump, shell-by-shell reload), XM1014. SMGs: MAC-10 (T), TMP (CT, silenced), MP5 Navy, UMP45, P90. Rifles: Galil (T), FAMAS (CT, burst), AK-47 (T), M4A1 (CT, silencer), SG 552 (T, zoom), AUG (CT, zoom), Scout, AWP, G3/SG-1 (T), SG 550 (CT). Machine gun: M249
- **Grenades:** HE (1.6 blast damage and radius), flashbang (white-out depends on distance and where you look, about 40% shorter than 1.6: at most 1.8 s of white and a 1.8 s fade; bots get blinded the same way) and smoke (a cloud that blocks sight for about 20 s). Team DM and FFA give one HE, two flashbangs and a smoke every spawn; Classic has none. Press **4** again to switch grenade type
- **Movement:** GoldSrc physics with CS 1.6 values: air-strafing, bunnyhop with the 1.2× cap, jump stamina, landing slowdown, crouch-jump, tagging when shot
- **Gunplay:** CS 1.6 spread/accuracy formulas, KickBack recoil, hitgroups, armor and helmet, range falloff, wallbangs. As in 1.6, the AWP only hits where you aim when you're scoped, on the ground and stopped: after letting go of the keys it takes about half a second to stop (tap the opposite key to stop at once)
- **Bots:** Easy / Normal / Hard / Expert, with sight, hearing, reaction time, bursts, strafing and recoil control. They throw grenades (aimed by simulating the throw: an HE where an enemy was last seen, a flash before going after one, smokes on the way into a site), turn away from their team's flashbangs (and sometimes from the enemy's), avoid shooting through teammates when friendly fire is on, and talk on the radio
- **Bomb-defusal teamwork:** each team buys together (a full buy, a forced buy when saving won't help, or saving), with a smoke and flashes for the Terrorists and two defuse kits for the CTs; bots with money to spare drop a rifle for a broke teammate (you get a message). Terrorists gather outside a site, smoke the CTs' way in, flash the site and go in together (sometimes a straight rush, sometimes one lurks at the other site). CTs hold each site from spots that watch the Terrorists' way in, call enemies, rotate to a called site (one anchor stays), wait at the entrance instead of walking into a lost site alone, and after a plant gather, flash and retake together while one defuses (a kit first)
- **Radio (Z):** a short menu: Go go go, Fall back, Enemy spotted, Need backup, Sector clear, I'm in position, Roger that, Negative. Only your team hears it: a line in the chat area, the radio voice, a radio icon over the speaker's head and their dot flashing on the radar. A teammate bot answers your calls; bots also call enemies, ask for backup, say "Fire in the hole!", "Enemy down", "Sector clear"
- **Spectating:** Space switches the view: chase cam, first person (their gun, crosshair and scope), free camera (fly with WASD, Shift faster) and an overview map (the map from above with everyone, their shots and where people died). E turns the auto director on (the camera picks the action by itself), R the live stats panel (kills, deaths, health, gun, money). Click / right-click switches player. Dead players watch their teammates only (no free camera, only teammates on the overview) unless Create Game → Advanced says **Dead players watch: everyone**. The team menu has **6. Spectate** to just watch the bots play (any player, every view)
- **Bot Arena (main menu):** characters (bots with their own skills, play style, favorite guns, habits, color band and even hacks) fight thousands of matches in the background to see who is best. Pieces:
  - **Saves:** each holds its own copy of the characters and their stats. A save chooses **free sliders** or skills that **grow by use** (aim by shooting, grenades by throwing; slower the higher they are, never capped; unused skills fade very slowly and come back fast to their best), and evolution: off, **each tunes itself** (tries a small change every few matches, keeps it if it did at least as well) or **new generations** (the weakest quarter retires, children of the best take their places)
  - **Characters:** 20 ready ones with gamer tags (all editable), plus new ones. Skills: reaction, aim, headshots, recoil control, grenade skill (50 plays like a Normal bot, 72 Hard, 90 Expert). Play style: rusher, careful, camper or lurker. Habits: strafing, bunny hopping, crouching, grenade use, teamwork. Favorite gun and pistol. A **personality** (cocky, polite, smug, mysterious, hothead, joker, stoic or nervous: most rushers are cocky, a few are polite) that sets how they talk in the news. **Clans** for clan battles: a new save comes with 4 ready clans of 5 (as even as a draft makes them), all editable
  - **Battles:** pick the characters, maps, fight types (duel 1v1, Team DM, Classic rounds, free-for-all, bomb defusal, each with its size and length), random teams or clans, and how many matches. They play in background threads with nothing drawn (about 50 matches a minute on 12 threads); sides swap at half in round modes. **Watch a match** plays the next one on screen (P pause, - / + for 0.25× to 4×; you can bet on it first), and it counts like the others. While you watch (a match or a highlight), half the threads play, so it runs smoothly; all of them again when you leave. A battle cut off by closing the page can be continued. If the threads can't reach the game (the `start.bat` window was closed, or the internet dropped while playing online) or matches keep failing, the battle pauses and says why; **Resume** carries on
  - **Stats:** a chess-style rating leaderboard (sortable), each character's page (rating chart, kills per gun, results per map and mode, best and worst opponents, skill growth, trophies, rivals, best win streak), results by map and mode, a head-to-head grid, the evolution log and family tree, and a CSV export for Excel
  - **Season tab:**
    - **Seasons:** set one up, then a waiting room (fantasy team, bets on the champion), then the league and the playoffs. The **solo league** puts the characters in divisions (1–4; the bottom ones of a division swap with the top ones of the next at the end) where each matchday is a duel against everyone in turn, a free-for-all and a random-team match (each can be turned off; points: win 3, draw 1, free-for-all 3/2/1). The **clan league** has every clan play each other (Team DM, Classic, bomb defusal in turn). The top of the first division and of the clan table go to **playoffs** (best of 1, 3 or 5); a knockout round waits for **Play this round** (bet on its series first) or **Play all**. At the end: champions, division winners, who goes up and down, MVP, top fragger and rising star, trophies, and in "new generations" saves the next generation
    - **Cups:** knockout tournaments any time: the top 4–32 characters (or everyone) or the clans
    - **Bets:** play money per save. Bet on a match you watch, on a knockout series, or on who wins a season or cup; the odds come from the ratings (800 simulated runs of the competition for "who wins it all"). Three levels, picked per save and changing from the next season: **Easy** (never below 100 coins), **Normal** (1000 to start and a bonus every season) and **Hard** (better odds, but broke means starting over)
    - **Fantasy:** pick 5 characters with a budget of 50 before a season starts; their wins, draws, kills and titles score points, and at its end every 2 points become a coin
    - **News:** upsets, streaks, records, milestones, rivalries (pairs that meet often and are close), series, champions, who went up and down, new generations; with a line from the character in their own personality
    - **Highlights:** every match is recorded as it plays (in the threads too), and the best moments are kept: aces, clutches, multi-kills, knife kills, last-second defuses, the end of a final, upsets. A replay plays in the real game view, in the star's eyes with slow motion around their kills (click a player to watch someone else; every spectator view works); **Watch again**, **Next highlight**, or a reel of the top 10. Each save keeps its best 60 (starred ones always stay), stored in the browser's IndexedDB
    - **Hall of fame:** every past season and cup, and the trophy table
  - Characters can also take the bot slots in Create Game (Game tab → Bot players); those matches don't change the save
  - Bot Arena's saves are kept in the browser's localStorage, its highlight recordings in IndexedDB (both on this computer, for this address)
- **Hacker mode (Create Game → Hacks):** with **Hacks allowed** on, anyone can switch hacks on for themselves in the Esc menu → **Hacks**, each one on its own: wallhack (players show through walls in flat red, teammates in blue), ESP labels (name, health, gun, distance), radar hack (every enemy on the radar), no flash, no smoke (only a faint haze), aimbot (sliders: smoothness, how wide around the crosshair, head or body, always or only while shooting), triggerbot (delay 0–300 ms), no recoil, no spread, speedhack (1.2–3×) and auto bhop (hold jump). Nothing is hidden: a hacker gets a red [HACK] tag on their name (scoreboard, kill feed, radio text), a red glow around their body, a chat line every time they switch hacks, and a chip icon on the kills they make; the scoreboard gets a **Hack kills** column. Create Game also sets how many bots on each side hack and which hacks they use (they find enemies through walls, aim like an aimbot, and so on). Watching a hacker can show their hacks too: never, in first person, or always (a choice in the Hacks window)
- **Match settings (Create Game):** Terrorist and CT bot counts, and an Advanced tab with what applies to the mode: round time, freeze time, start money, friendly fire (bullets and the knife do about a third to teammates, grenades full damage, a team kill costs 1 point) and auto team balance (a bot moves when one team has 2 or more players more)
- **Maps (original designs):**
  - `de_dunetown`: a small sandstone desert town with two bomb sites, a covered B tunnel, half-open mid doors (with crates behind, so the spawns can't see each other) and a crawl duct
  - `de_foundry`: a medium steel works. Site A is inside the foundry hall (catwalks, a bridge over the site, two ladders and stairs, skylights and hanging lamps), site B is out in the container yard (a ladder up the container stack). Big sliding doors on the hall and the warehouse, an office with a door at each end, a door from mid into the warehouse, half-open metal mid doors
  - `fy_poolhouse`: two villas facing each other over a shallow pool. No weapon menu: you start with a knife and a pistol and pick guns up off the ground (mostly AK-47 / M4A1 / AWP, a few SMGs, a Deagle and grenades). The guns are put back every round, or every 60 s in Team DM / FFA. Both houses can be entered, with windows over the pool
  - `awp_rooftops`: two city rooftops at sunset with a street far below (falling is deadly) and one narrow plank across. Everyone gets an AWP, a pistol and a knife
  - `aim_classic`: an aim-style arena
- **Map features:** doors you open and close with **E** (swinging doors swing away from you, big sliding doors roll into the wall and go back if someone is in the way; bullets go through them; bots open them); ladders (**W** climbs, **S** goes down, jump lets go); shallow water that slows you down and splashes; windows, vent covers and small crates break when shot, knifed or blown up (they come back each round); fall damage with the 1.6 formula
- **Graphics:** GoldSrc-style baked lightmaps (sun shadows, ambient occlusion), 128px smooth-filtered textures, muzzle-flash lighting, explosions with scorch marks
- **Impacts:** per-material bullet holes, and what each surface throws up: sparks off metal, a cloud of sand, wood splinters, chips of stone and tile, earth from grass. Blood sprays onto the wall behind a hit (with a few drops around it) and drips on the floor
- **Gun smoke and shells:** after three or more quick shots a thin wisp of smoke rises from the barrel (yours and everyone else's); ejected shells (red ones for shotguns) stay on the floor for 10 s
- **Things on the floor move:** dropped guns, the bomb, defuse kits and grenades on the floor get knocked away and spin when shot, are thrown by HE and C4 blasts, and slide along when someone walks into them
- **Player animations:** others' bodies show reloads (the left hand fetches a magazine), drawing a gun, grenade pin and throw, knife slashes and stabs, attaching a silencer, and kneeling to plant or defuse the bomb. The legs walk the way the player moves (sideways when strafing, backward when backing up), and a hit jolts the upper body a little (a headshot snaps the head back)
- **Viewmodels:** detailed guns with hands; magazine-change, bolt/slide, pump, shell-loading, silencer and grenade pin/throw animations; CS 1.6 view bob, and the gun keeps pointing where you aimed while the view kicks. Sniper rifles have no crosshair until you scope in, like 1.6
- **Performance:** each player is one skinned mesh plus one gun mesh, decals are instanced, shaders are compiled before the match, the sky is drawn last (only where it shows), and smoke puffs right in front of your eyes fade out while the grey inside-smoke screen takes over (it hides at least as well). A Low / Medium / High quality setting (Options → Audio / Video) trades resolution and effects for speed; only High smooths edges (antialiasing), which doubled the drawing time on built-in graphics. A Bot Arena battle stops its threads at once when you start a normal game and carries on when you leave. Sound uses a 30 ms buffer so a busy computer doesn't make it crackle
- **Bullet tracers:** every bullet from every player leaves a yellow streak from the gun to where it stops, so you can see where shots go and where enemy fire comes from (Options → Game to turn them off)
- **Gamma and brightness (Options → Audio / Video):** gamma lifts or deepens the shadows, brightness the whole picture; both change only the 3D view (the HUD keeps its colors), and at the defaults they cost nothing
- **Crosshair (Options → Crosshair):** classic cross, T-shape, dot or circle; any color, opacity, length, thickness and gap; dynamic (opens up like 1.6) or static; center dot and black outline, with a live preview
- **Kill feedback:** when you kill someone, "You killed NAME" shows under the crosshair (with HEADSHOT for headshots) and a short confirm sound plays (a sharper one for headshots); your kills get a bold red box in the kill feed and stay there longer
- **Sound:** footsteps sound like what you walk on (sand, concrete, metal, catwalk grates, wood, tile, grass); each map has its own quiet background (desert wind, a factory hum with clanks and steam, water and birds at the pool, the city far below the rooftops, a breeze on aim_classic) with the odd sound around you; calm synth music plays in the main menu. Options → Audio / Video has separate Menu music and Map ambience sliders
- **UI:** CS-style HUD, radar, kill feed, scoreboard, CSDM gun menu, Create Game screen, rebindable keys, English / Türkçe

## Controls (defaults, all rebindable in Options → Keyboard)

| Key | Action | Key | Action |
|---|---|---|---|
| W A S D | Move | Mouse 1 / 2 | Fire / special (scope, silencer, burst, stab) |
| Space | Jump | R | Reload |
| Ctrl | Duck | 1 / 2 / 3 / 4, Q, wheel | Weapons (4 = grenades) |
| Shift | Walk (silent) | Tab | Scores |
| M | Change team | B | Weapon menu / buy menu |
| 5 | Bomb (C4) | E | Use: defuse, open / close a door, swap a gun on the floor |
| G | Drop weapon (bomb defusal, fy_ maps) | F1 / F2 | Autobuy / rebuy (bomb defusal) |
| Z | Radio menu (then 1–8) | Esc | Menu |
| Mouse 1 / 2, Space | Spectating: next / previous player, view | E / R | Spectating: auto director / stats panel |
| P, - / + | Watching a Bot Arena match or a highlight: pause, speed | Mouse 1 / 2 | In a highlight: stop following the star, watch someone else |

Ctrl+W normally closes a browser tab. While playing, the game goes fullscreen and locks the keyboard
(Chrome/Edge), so Ctrl works as duck. You can turn this off in Options → Audio / Video.

## Code layout

```
index.html, style.css     page, HUD and menu styling
serve.py, start.bat       local web server (for playing without the internet)
lib/three.module.js       Three.js r170 (MIT, see lib/three.LICENSE.txt)
src/main.js               renderer, main loop, pointer lock / fullscreen
src/config.js             shared constants (tick rate, player size, 1.6 movement values)
src/game.js               match rules, shooting, damage, rounds, breakables, cameras
src/player.js, input.js   the player and their hitboxes; keys and mouse (rebindable)
src/bomb.js               bomb defusal: money, buying, the C4, the bots' team plans
src/gungame.js            Gun Game: the gun ladder, levels, the knife win
src/items.js              guns on the ground: drops, pickups, the guns fy_ maps put out
src/doors.js              swinging and sliding doors
src/radio.js              the robot radio voice (round announcements, radio calls)
src/teamradio.js          team radio: the Z menu, bot calls and answers, radio icons
src/movement.js           player physics (moves like GoldSrc's pm_shared)
src/weapons.js            weapon stats, spread, recoil, reload, grenade throws
src/grenades.js           grenade flight, HE blast, flashbang, smoke clouds
src/effects.js            impacts, dust, sparks, chips, blood, shells, gun smoke, tracers, explosions
src/hacks.js              hacker mode: the hack list, aimbot, triggerbot
src/arena.js              Bot Arena: characters, saves, stats, ratings, practice, evolution, battle plans, CSV
src/arenarun.js           Bot Arena's battle runner (a pool of background workers)
src/simworker.js          a background worker: plays one match at a time with nothing drawn
src/arenaui.js            Bot Arena's menus (characters, battle, stats, saves, the highlights list)
src/league.js             seasons (divisions, schedules, tables, playoffs, the end) and cups
src/bets.js               the wallet, odds, bets and their settling, "who wins it all", fantasy
src/news.js, quotes.js    the news feed, and what each personality says
src/arenaevents.js        ties the competitions to the news and the bets
src/seasonui.js           the Season tab's pages
src/highlights.js         records matches and cuts out their best moments
src/replay.js             plays a highlight back in the game view
src/clipstore.js          keeps the highlights' recordings (IndexedDB)
src/matchstats.js         what each player did in a Bot Arena match
src/net.js                the connection between browsers (WebRTC), invite and reply codes, the relay
src/online.js             the online lobby: the host's session and a friend's
src/onlineui.js           the Play online window (name, invite links, replies, the lobby)
src/nethost.js            hosting an online match: the friends' keys in, snapshots and events out
src/netclient.js          a friend's side of an online match (own movement at once, the others smoothly)
src/netsync.js            what online matches send many times a second, packed into bytes
src/replylink.js          the small page a reply link opens: hands the reply to the game's tab
src/bot.js, src/nav.js    bot AI (fighting, grenades, the bomb plans) and A* navigation grid
src/map.js, collision.js  map building (lightmaps, breakables, signs), collision grid
src/maps/                 map layouts: de_dunetown, de_foundry, fy_poolhouse, awp_rooftops, aim_classic; kit.js helpers
src/lightmap.js           baked lighting (lightmap atlas)
src/models.js             characters, third-person guns, first-person viewmodel
src/weaponmodels.js       weapon meshes (src/modelkit.js: shared shape helpers)
src/textures.js, audio.js procedural textures and sounds
src/ambient.js            menu music and map ambience (made live from oscillators and noise)
src/hud.js, ui.js         HUD and menus
src/crosshair.js          crosshair drawing (HUD and Options preview)
src/i18n.js, settings.js  translations and saved preferences
```

## License

Copyright 2026 FalseFox0. The game's code and content are licensed under the **PolyForm Noncommercial License 1.0.0** (see [LICENSE.md](LICENSE.md)).
You may play, study, change and share it **for noncommercial purposes only**, and any copy must keep the license and the copyright line.
Any commercial use (selling it or a changed version, putting it behind ads or a paywall, using it in a paid product) needs written permission.

`lib/three.module.js` is [Three.js](https://threejs.org) (© 2010–2024 three.js authors) under the MIT License ([lib/three.LICENSE.txt](lib/three.LICENSE.txt)); the PolyForm license does not cover it.
