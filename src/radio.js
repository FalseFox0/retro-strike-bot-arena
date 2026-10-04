// The radio voice: round announcements ("Bomb has been planted") spoken by
// the browser's speech synthesizer, pitched down into a flat robot voice,
// with a radio squelch before and after. English like in 1.6.

import { settings } from './settings.js';

let voice = null;
let sound = null;

function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const all = window.speechSynthesis.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
  // a plain male voice suits the radio best
  const prefer = [/david/i, /mark/i, /daniel/i, /google us english/i, /male/i, /en-us/i];
  for (const re of prefer) {
    const v = all.find((x) => re.test(x.name) || re.test(x.lang));
    if (v) {
      voice = v;
      return;
    }
  }
  voice = all[0] || null;
}

if ('speechSynthesis' in window) {
  pickVoice();
  window.speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

export const radio = {
  // the SoundSystem plays the squelch clicks
  attach(soundSystem) {
    sound = soundSystem;
  },

  say(text) {
    if (!('speechSynthesis' in window) || settings.volume <= 0) return;
    const synth = window.speechSynthesis;
    // never let announcements pile up behind each other
    if (synth.pending) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = 'en-US';
    u.rate = 1.05;
    u.pitch = 0.35;
    u.volume = Math.min(1, settings.volume * 1.3);
    u.onstart = () => sound && sound.play('radio_on', { volume: 0.5 });
    u.onend = () => sound && sound.play('radio_off', { volume: 0.5 });
    synth.speak(u);
  },

  cancel() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  },
};
