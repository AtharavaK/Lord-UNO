/**
 * sound.js — UNO Arena Sound Engine
 * ═══════════════════════════════════════════════════════════════
 * 100% Web Audio API — zero external files, works offline/LAN
 * Two complete themes: MODERN (funny/electronic) · CLASSIC (card game)
 *
 * Events handled:
 *   cardPlay · cardDraw · actionCard · wildCard · drawPenalty
 *   unoCall  · unoCaught · shuffle · gameStart · win · lose
 *   bgMusic  · flip (UNO Flip) · roulette · buttonClick · error
 * ═══════════════════════════════════════════════════════════════
 */

const SoundEngine = (() => {
  'use strict';

  // ── Audio context (lazy init on first user gesture) ──────────
  let ctx = null;
  let masterGain = null;
  let bgNode     = null;      // background music oscillator group
  let bgRunning   = false;
  let bgInterval  = null;

  // ── Settings ─────────────────────────────────────────────────
  const settings = {
    theme:    'modern',   // 'modern' | 'classic'
    sfxVol:   0.7,
    musicVol: 0.25,
    enabled:  true,
  };

  // ── Persist settings ─────────────────────────────────────────
  function saveSettings() {
    try { localStorage.setItem('uno_sound', JSON.stringify(settings)); } catch(_) {}
  }
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('uno_sound') || '{}');
      Object.assign(settings, s);
    } catch(_) {}
  }

  // ── Init audio context ────────────────────────────────────────
  function ensureCtx() {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = settings.enabled ? 1 : 0;
    masterGain.connect(ctx.destination);
    return ctx;
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  // ── Core synthesis helpers ────────────────────────────────────

  /** Play a single oscillator note */
  function tone(freq, type, startTime, duration, vol = 0.3, pan = 0) {
    if (!settings.enabled) return;
    const ac  = ensureCtx();
    const osc = ac.createOscillator();
    const env = ac.createGain();
    const panner = ac.createStereoPanner();

    osc.type      = type;
    osc.frequency.setValueAtTime(freq, startTime);

    env.gain.setValueAtTime(0, startTime);
    env.gain.linearRampToValueAtTime(vol, startTime + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    panner.pan.value = pan;

    osc.connect(env);
    env.connect(panner);
    panner.connect(masterGain);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }

  /** Play a noise burst (for shuffle, whoosh, etc.) */
  function noise(startTime, duration, vol = 0.15, lowpass = 2000) {
    if (!settings.enabled) return;
    const ac     = ensureCtx();
    const buffer = ac.createBuffer(1, ac.sampleRate * duration, ac.sampleRate);
    const data   = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);

    const src    = ac.createBufferSource();
    src.buffer   = buffer;

    const filter = ac.createBiquadFilter();
    filter.type  = 'lowpass';
    filter.frequency.value = lowpass;

    const env    = ac.createGain();
    env.gain.setValueAtTime(vol, startTime);
    env.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    src.connect(filter);
    filter.connect(env);
    env.connect(masterGain);
    src.start(startTime);
    src.stop(startTime + duration + 0.05);
  }

  /** Play frequency-modulated sweep */
  function sweep(startFreq, endFreq, type, startTime, duration, vol = 0.25) {
    if (!settings.enabled) return;
    const ac  = ensureCtx();
    const osc = ac.createOscillator();
    const env = ac.createGain();
    osc.type  = type;
    osc.frequency.setValueAtTime(startFreq, startTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, startTime + duration);
    env.gain.setValueAtTime(vol, startTime);
    env.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(env);
    env.connect(masterGain);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }

  /** Chord — play multiple notes simultaneously */
  function chord(freqs, type, startTime, duration, vol = 0.2) {
    freqs.forEach((f, i) => tone(f, type, startTime, duration, vol, (i - 1) * 0.3));
  }

  // ── now() shorthand ──────────────────────────────────────────
  function now() { return ensureCtx().currentTime; }

  // ════════════════════════════════════════════════════════════
  //  MODERN THEME — Electronic, punchy, funny
  // ════════════════════════════════════════════════════════════

  const Modern = {

    cardPlay() {
      // Crisp digital "thwack" — short sine pop + high transient
      const t = now();
      tone(320, 'sine',   t,       0.06, 0.5);
      tone(800, 'square', t,       0.03, 0.15);
      tone(160, 'sine',   t+0.03,  0.08, 0.3);
    },

    cardDraw() {
      // Soft "swish" slide-up
      const t = now();
      sweep(200, 600, 'sine', t, 0.12, 0.2);
      noise(t, 0.1, 0.06, 1200);
    },

    actionCard() {
      // Punchy "bwop" — electronic impact
      const t = now();
      sweep(600, 80, 'sawtooth', t, 0.15, 0.35);
      tone(880, 'square', t, 0.04, 0.12);
    },

    wildCard() {
      // Magical arpeggio up — "sparkle"
      const t = now();
      [523, 659, 784, 1047].forEach((f, i) => {
        tone(f, 'sine', t + i * 0.06, 0.18, 0.22);
        tone(f * 2, 'sine', t + i * 0.06, 0.1, 0.06);
      });
    },

    drawPenalty() {
      // Descending "dun dun dun" — cartoon doom
      const t = now();
      [392, 311, 247].forEach((f, i) => {
        tone(f, 'sawtooth', t + i * 0.13, 0.18, 0.28);
      });
      noise(t + 0.35, 0.12, 0.1, 800);
    },

    unoCall() {
      // Loud BOING + fanfare — "UNO!"
      const t = now();
      sweep(200, 900, 'sine', t, 0.1, 0.6);
      tone(900, 'sine', t + 0.08, 0.25, 0.4);
      tone(1800, 'sine', t + 0.12, 0.18, 0.2);
      // Echo
      tone(900, 'sine', t + 0.35, 0.2, 0.15);
    },

    unoCaught() {
      // Sad "wahwah" descend — cartoon fail
      const t = now();
      sweep(600, 150, 'sawtooth', t, 0.3, 0.35);
      sweep(400, 100, 'sawtooth', t + 0.15, 0.3, 0.2);
    },

    shuffle() {
      // Rapid paper-shuffling — multiple noise bursts
      const t = now();
      for (let i = 0; i < 8; i++) {
        noise(t + i * 0.045, 0.04, 0.12, 3000 - i * 200);
        tone(200 + i * 30, 'sine', t + i * 0.045, 0.03, 0.08);
      }
    },

    flip() {
      // Dramatic "whoooosh" reverse + pitch spike
      const t = now();
      sweep(100, 2000, 'sawtooth', t, 0.25, 0.3);
      sweep(2000, 100, 'sawtooth', t + 0.22, 0.25, 0.2);
      noise(t + 0.1, 0.2, 0.15, 4000);
    },

    roulette() {
      // Spinning dice rapid ticks then landing
      const t = now();
      for (let i = 0; i < 12; i++) {
        const gap = 0.04 + i * 0.015;  // slowing down
        tone(1200, 'square', t + gap * i, 0.025, 0.1);
      }
      // Landing thud
      tone(60, 'sine', t + 0.9, 0.18, 0.5);
      tone(120, 'sine', t + 0.91, 0.15, 0.3);
    },

    gameStart() {
      // Energetic ascending fanfare
      const t = now();
      const notes = [261, 329, 392, 523, 659, 784, 1047];
      notes.forEach((f, i) => {
        tone(f, 'sine',     t + i * 0.07, 0.22, 0.25);
        tone(f * 1.5, 'sine', t + i * 0.07, 0.15, 0.08);
      });
      // Final chord
      chord([523, 659, 784, 1047], 'sine', t + 0.55, 0.6, 0.2);
    },

    win() {
      // Big victory fanfare — ascending + triumphant chord
      const t = now();
      const melody = [523, 523, 784, 523, 784, 1047];
      const times  = [0, 0.15, 0.3, 0.5, 0.65, 0.8];
      melody.forEach((f, i) => {
        tone(f,     'sine', t + times[i], 0.28, 0.3);
        tone(f * 2, 'sine', t + times[i], 0.12, 0.1);
      });
      chord([523, 659, 784, 1047], 'sine', t + 1.1, 1.2, 0.25);
      noise(t, 0.05, 0.1, 4000);
    },

    lose() {
      // Descending "Price is Right" losing horn
      const t = now();
      const notes = [392, 370, 349, 311, 294, 247];
      notes.forEach((f, i) => {
        tone(f, 'sawtooth', t + i * 0.12, 0.2, 0.25);
      });
    },

    buttonClick() {
      const t = now();
      tone(880, 'sine', t, 0.05, 0.12);
      tone(1320, 'sine', t + 0.02, 0.04, 0.06);
    },

    error() {
      const t = now();
      tone(180, 'sawtooth', t,      0.1, 0.25);
      tone(160, 'sawtooth', t+0.08, 0.1, 0.25);
    },

    // Background loop — 4-on-the-floor electronic
    bgStart() {
      if (bgRunning || !settings.enabled) return;
      bgRunning = true;

      let beat = 0;
      const BPM = 128;
      const step = 60 / BPM;

      bgInterval = setInterval(() => {
        if (!settings.enabled) return;
        const t  = now();
        const vol = settings.musicVol;

        // Kick drum (every beat)
        sweep(120, 40, 'sine', t, step * 0.4, vol * 0.6);
        noise(t, 0.02, vol * 0.08, 300);

        // Hi-hat (every half beat)
        noise(t + step * 0.5, 0.02, vol * 0.04, 8000);

        // Bass line pattern
        const bassPattern = [130, 0, 130, 146, 0, 130, 0, 110];
        const bassFreq = bassPattern[beat % 8];
        if (bassFreq) tone(bassFreq, 'sawtooth', t, step * 0.7, vol * 0.18);

        // Chord stab every 4 beats
        if (beat % 4 === 0) {
          chord([261, 329, 392], 'sine', t + step * 0.75, step * 0.3, vol * 0.06);
        }

        // Synth arp every 2 beats
        if (beat % 2 === 0) {
          const arpNotes = [523, 659, 784, 659];
          tone(arpNotes[(beat / 2) % 4], 'sine', t + step * 0.25, step * 0.2, vol * 0.07);
        }

        beat++;
      }, step * 1000);
    },

    bgStop() {
      bgRunning = false;
      if (bgInterval) { clearInterval(bgInterval); bgInterval = null; }
    },
  };

  // ════════════════════════════════════════════════════════════
  //  CLASSIC THEME — Acoustic, warm, traditional card-game feel
  // ════════════════════════════════════════════════════════════

  const Classic = {

    cardPlay() {
      // Realistic card slap — paper thwack
      const t = now();
      noise(t,       0.04, 0.4,  5000);  // sharp attack
      noise(t+0.035, 0.06, 0.15, 800);   // low body
      tone(200, 'sine', t, 0.05, 0.15);  // table thud
    },

    cardDraw() {
      // Single card slide from deck — soft whoosh
      const t = now();
      noise(t, 0.09, 0.15, 2500);
      sweep(300, 500, 'sine', t, 0.08, 0.06);
    },

    actionCard() {
      // Heavier card slam + low resonance
      const t = now();
      noise(t,       0.03, 0.55, 4000);
      noise(t+0.02,  0.08, 0.2,  600);
      tone(110, 'sine', t + 0.01, 0.1, 0.3);
    },

    wildCard() {
      // Magical harp glissando — warm tones
      const t = now();
      const harp = [261, 329, 392, 523, 659, 784];
      harp.forEach((f, i) => {
        tone(f,       'sine',     t + i * 0.055, 0.35, 0.18);
        tone(f * 2,   'triangle', t + i * 0.055, 0.2,  0.06);
      });
    },

    drawPenalty() {
      // Timpani-like boom × 2
      const t = now();
      [0, 0.25].forEach(offset => {
        sweep(120, 60, 'sine', t + offset, 0.22, 0.45);
        noise(t + offset, 0.05, 0.2, 500);
      });
    },

    unoCall() {
      // Trumpet-like staccato — "da-DUM"
      const t = now();
      tone(523, 'sawtooth', t,      0.08, 0.3);
      tone(784, 'sawtooth', t+0.1,  0.12, 0.35);
      tone(1047,'sawtooth', t+0.18, 0.22, 0.3);
      // Add warm sine underneath
      tone(523, 'sine', t,      0.08, 0.15);
      tone(784, 'sine', t+0.1,  0.12, 0.18);
      tone(1047,'sine', t+0.18, 0.22, 0.15);
    },

    unoCaught() {
      // Low tuba "bwaaah"
      const t = now();
      sweep(196, 98, 'sawtooth', t,      0.2, 0.4);
      sweep(147, 73, 'sawtooth', t+0.18, 0.22, 0.25);
      tone(98, 'sine', t, 0.35, 0.3);
    },

    shuffle() {
      // Real card riffle sound — rapid papery noise
      const t = now();
      for (let i = 0; i < 16; i++) {
        noise(t + i * 0.022, 0.02, 0.18 - i * 0.005, 4000 + i * 100);
      }
    },

    flip() {
      // Whoosh of many cards + resonant slap
      const t = now();
      noise(t, 0.35, 0.3, 3000);
      noise(t + 0.3, 0.08, 0.5, 1000);
      tone(150, 'sine', t + 0.3, 0.2, 0.4);
    },

    roulette() {
      // Rolling die on table — rattles then stops
      const t = now();
      for (let i = 0; i < 10; i++) {
        const delay = Math.pow(i / 10, 1.5) * 0.8;
        noise(t + delay, 0.02, 0.2, 3000);
        tone(300 + Math.random() * 200, 'sine', t + delay, 0.02, 0.08);
      }
      // Final stop
      noise(t + 0.82, 0.06, 0.4, 1000);
      tone(150, 'sine', t + 0.82, 0.15, 0.35);
    },

    gameStart() {
      // Classical fanfare — bugle call style
      const t = now();
      const fanfare = [392, 523, 659, 784, 659, 784, 1047];
      const timing  = [0, 0.12, 0.24, 0.36, 0.55, 0.67, 0.82];
      fanfare.forEach((f, i) => {
        tone(f,   'sawtooth', t + timing[i], 0.25, 0.28);
        tone(f,   'sine',     t + timing[i], 0.25, 0.1);
      });
      chord([523, 659, 784, 1047], 'sine', t + 1.1, 0.8, 0.18);
    },

    win() {
      // Grand classical victory — multi-part
      const t = now();
      // Brass chord
      chord([261, 329, 392, 523], 'sawtooth', t, 0.3, 0.15);
      chord([261, 329, 392, 523], 'sine',     t, 0.3, 0.08);
      // Melody
      const mel   = [523, 659, 784, 1047, 784, 1047, 1568];
      const mtimes= [0.35, 0.5, 0.65, 0.8, 1.0, 1.15, 1.3];
      mel.forEach((f, i) => {
        tone(f, 'sine',     t + mtimes[i], 0.28, 0.25);
        tone(f, 'triangle', t + mtimes[i], 0.28, 0.08);
      });
      chord([523, 659, 784, 1047, 1568], 'sine', t + 1.6, 1.5, 0.2);
    },

    lose() {
      // Funeral march style — low and slow
      const t = now();
      const notes = [294, 277, 262, 247, 233, 220, 196];
      notes.forEach((f, i) => {
        tone(f,   'sawtooth', t + i * 0.18, 0.24, 0.22);
        tone(f/2, 'sine',     t + i * 0.18, 0.24, 0.12);
      });
    },

    buttonClick() {
      const t = now();
      noise(t, 0.03, 0.12, 3000);
      tone(440, 'sine', t, 0.04, 0.08);
    },

    error() {
      const t = now();
      tone(220, 'sawtooth', t,      0.12, 0.2);
      tone(196, 'sawtooth', t+0.1,  0.12, 0.2);
    },

    // Background loop — gentle casino / card room ambience
    bgStart() {
      if (bgRunning || !settings.enabled) return;
      bgRunning = true;

      let beat = 0;
      const BPM  = 72;
      const step = 60 / BPM;

      bgInterval = setInterval(() => {
        if (!settings.enabled) return;
        const t   = now();
        const vol = settings.musicVol;

        // Gentle bass walk
        const bassWalk = [130, 146, 164, 146, 130, 110, 123, 146];
        tone(bassWalk[beat % 8], 'triangle', t, step * 0.8, vol * 0.15);

        // Warm pad chord stab every 4 beats
        if (beat % 4 === 0) {
          const pads = [[261, 329, 392], [220, 277, 349], [246, 311, 369], [261, 329, 392]];
          chord(pads[Math.floor(beat / 4) % 4], 'sine', t, step * 1.8, vol * 0.05);
        }

        // Subtle hi-hat
        noise(t + step * 0.5, 0.015, vol * 0.025, 9000);

        // Gentle pluck melody every 8 beats
        if (beat % 8 === 0) {
          const mel = [523, 659, 784, 659, 523, 440, 523];
          mel.forEach((f, i) => {
            tone(f, 'triangle', t + i * step * 0.25, step * 0.3, vol * 0.06);
          });
        }

        beat++;
      }, step * 1000);
    },

    bgStop() {
      bgRunning = false;
      if (bgInterval) { clearInterval(bgInterval); bgInterval = null; }
    },
  };

  // ── Theme router ─────────────────────────────────────────────
  function T() { return settings.theme === 'classic' ? Classic : Modern; }

  // ── Public API ───────────────────────────────────────────────
  function play(event, ...args) {
    if (!settings.enabled) return;
    resume();
    const fn = T()[event];
    if (fn) fn(...args);
  }

  function startMusic() {
    if (!settings.enabled) return;
    resume();
    T().bgStart();
  }

  function stopMusic() {
    Modern.bgStop();
    Classic.bgStop();
  }

  function setTheme(t) {
    stopMusic();
    settings.theme = t;
    saveSettings();
    startMusic();
  }

  function setVolume(type, val) {
    settings[type === 'music' ? 'musicVol' : 'sfxVol'] = Math.max(0, Math.min(1, val));
    saveSettings();
  }

  function toggle(on) {
    settings.enabled = on;
    if (masterGain) masterGain.gain.value = on ? 1 : 0;
    if (!on) stopMusic();
    saveSettings();
  }

  function isEnabled() { return settings.enabled; }
  function getTheme()  { return settings.theme; }

  // ── Init ─────────────────────────────────────────────────────
  loadSettings();

  return { play, startMusic, stopMusic, setTheme, setVolume, toggle, isEnabled, getTheme };
})();
