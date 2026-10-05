/* Signalen tijdens een begeleide training: piep, trillen en gesproken
   aanwijzingen (Web Speech API, Nederlandse stem als die er is).
   iOS staat geluid en spraak pas toe na een tik van de gebruiker; daarom
   unlockCues() aanroepen vanuit de Start-knop. */
let ctx = null;
let voice = null;
let muted = false;

function pickVoice() {
  try {
    const vs = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    voice = vs.find((v) => /^nl(-|_)NL/i.test(v.lang)) || vs.find((v) => /^nl/i.test(v.lang)) || null;
  } catch (e) {
    voice = null;
  }
}

export function unlockCues() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC && !ctx) ctx = new AC();
    if (ctx && ctx.state === "suspended") ctx.resume();
  } catch (e) {
    ctx = null;
  }
  try {
    if (window.speechSynthesis) {
      pickVoice();
      window.speechSynthesis.onvoiceschanged = pickVoice;
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  } catch (e) {
    /* geen spraak */
  }
}

export const setMuted = (m) => (muted = !!m);
export const isMuted = () => muted;

export function beep(freq = 880, ms = 160) {
  if (muted) return;
  try {
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
    o.start();
    o.stop(ctx.currentTime + ms / 1000 + 0.02);
  } catch (e) {
    /* geen geluid */
  }
}

export function buzz(pattern = 200) {
  try {
    navigator.vibrate && navigator.vibrate(pattern);
  } catch (e) {
    /* geen trilfunctie */
  }
}

export function speak(text) {
  if (muted || !text) return;
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "nl-NL";
    if (voice) u.voice = voice;
    u.rate = 1;
    window.speechSynthesis.speak(u);
  } catch (e) {
    /* geen spraak */
  }
}

/* Wissel naar een nieuw segment: twee piepjes, trillen en de aanwijzing. */
export function cue(text) {
  beep(660, 140);
  setTimeout(() => beep(990, 200), 180);
  buzz([180, 80, 180]);
  setTimeout(() => speak(text), 450);
}
