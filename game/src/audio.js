// audio.js — every sound is synthesized with WebAudio; no audio files ship.
// All calls are guarded: a missing or blocked AudioContext never throws, and
// every helper catches its own errors so a sound failure cannot break the game.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  /** Call on the first click / pointer lock so the browser allows sound. */
  function unlock() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  }

  function tone(freq, dur, type, gain, slideTo, delay) {
    const c = ensure();
    if (!c) return;
    try {
      const t0 = c.currentTime + (delay || 0);
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    } catch (e) { /* never throw for sound */ }
  }

  function noise(dur, filterFreq, gain, delay) {
    const c = ensure();
    if (!c) return;
    try {
      const t0 = c.currentTime + (delay || 0);
      const len = Math.max(1, Math.floor(c.sampleRate * dur));
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource();
      src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filterFreq;
      const g = c.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(f).connect(g).connect(master);
      src.start(t0);
    } catch (e) { /* never throw for sound */ }
  }

  return {
    unlock,
    // resume() is the name the game uses for the first-gesture unlock.
    resume: unlock,
    shot(kind, dist) {
      // dist attenuates: the player's own shots are dist 0, a bot's shot
      // across the yard is quiet.
      const atten = dist ? Math.max(0.08, 1 - dist / 60) : 1;
      if (kind === 'rifle') { noise(0.09, 2400, 0.5 * atten); tone(160, 0.08, 'square', 0.25 * atten, 60); }
      else if (kind === 'smg') { noise(0.06, 3000, 0.35 * atten); tone(220, 0.05, 'square', 0.18 * atten, 90); }
      else { noise(0.08, 2000, 0.45 * atten); tone(140, 0.09, 'square', 0.22 * atten, 55); }
    },
    distantShot() { noise(0.12, 700, 0.12); tone(90, 0.1, 'sine', 0.08, 50); },
    dryClick() { tone(1800, 0.03, 'square', 0.12); },
    click() { tone(1200, 0.03, 'square', 0.12); },
    reload() { tone(900, 0.04, 'square', 0.15); tone(1300, 0.04, 'square', 0.15, null, 0.25); tone(700, 0.05, 'square', 0.18, null, 0.55); },
    hit() { tone(1150, 0.06, 'sine', 0.25); },
    kill() { tone(880, 0.09, 'sine', 0.28); tone(1318, 0.14, 'sine', 0.28, null, 0.09); },
    hurt() { tone(110, 0.18, 'sine', 0.4, 45); noise(0.12, 500, 0.2); },
    explosion() { noise(0.7, 900, 0.7); tone(70, 0.6, 'sine', 0.5, 30); },
    explode(dist) {
      const atten = dist ? Math.max(0.1, 1 - dist / 50) : 1;
      noise(0.7, 900, 0.7 * atten);
      tone(70, 0.6, 'sine', 0.5 * atten, 30);
    },
    plantBeep() { tone(1500, 0.07, 'sine', 0.22); },
    plant() { tone(1500, 0.07, 'sine', 0.22); },
    defuseBeep() { tone(1050, 0.07, 'sine', 0.22); },
    defuse() { tone(1050, 0.07, 'sine', 0.22); },
    roundStart() { tone(523, 0.12, 'sine', 0.25); tone(659, 0.12, 'sine', 0.25, null, 0.12); tone(784, 0.2, 'sine', 0.25, null, 0.24); },
    roundWin() { tone(784, 0.14, 'sine', 0.28); tone(1046, 0.22, 'sine', 0.28, null, 0.14); },
    roundLose() { tone(392, 0.16, 'sine', 0.25); tone(311, 0.28, 'sine', 0.25, null, 0.16); },
    round(won) {
      if (won) { tone(784, 0.14, 'sine', 0.28); tone(1046, 0.22, 'sine', 0.28, null, 0.14); }
      else { tone(392, 0.16, 'sine', 0.25); tone(311, 0.28, 'sine', 0.25, null, 0.16); }
    },
    buy() { tone(1046, 0.08, 'sine', 0.22); tone(1568, 0.12, 'sine', 0.2, null, 0.07); },
    denied() { tone(160, 0.16, 'sawtooth', 0.18, 120); },
  };
}
