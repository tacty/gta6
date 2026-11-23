// audio.js — all sound is synthesized with WebAudio: engine hum, police
// siren, gunshots, impacts and the cash-register reward chime. No audio
// files. Press M to mute. Browsers require a user gesture before sound
// starts, so the context is created/resumed lazily from input handlers.

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let unlocked = false; // set by unlock() from a real user gesture
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenLfo = null;

  function ensure() {
    if (!unlocked) return false; // no AudioContext before a user gesture
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function blip(freq, dur, type = 'square', vol = 0.2, slideTo = null, delay = 0) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol = 0.25, freq = 1200, delay = 0) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(master);
    src.start(t0);
  }

  return {
    unlock() { unlocked = true; ensure(); },
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    shot() { noise(0.09, 0.3, 2600); blip(160, 0.08, 'square', 0.18, 60); },
    hit() { noise(0.06, 0.15, 700); },
    crash(strength = 1) { noise(0.22, 0.3 * strength, 500); blip(90, 0.2, 'sawtooth', 0.15, 40); },
    door() { blip(220, 0.07, 'square', 0.12, 140); },
    cash() { blip(880, 0.09, 'square', 0.16); blip(1320, 0.14, 'square', 0.16, null, 0.09); },
    pickup() { blip(520, 0.08, 'sine', 0.2, 780); },
    fail() { blip(300, 0.25, 'sawtooth', 0.16, 120); },
    phone() { blip(1046, 0.09, 'sine', 0.15); blip(1046, 0.09, 'sine', 0.15, null, 0.14); },
    // Continuous engine loop; speed 0..1 drives pitch. Call every frame.
    setEngine(on, speed = 0) {
      if (!on) {
        if (engineGain && ctx) engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
        return;
      }
      if (!ensure()) return;
      if (!engineOsc) {
        engineOsc = ctx.createOscillator();
        engineGain = ctx.createGain();
        engineOsc.type = 'sawtooth';
        engineGain.gain.value = 0;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 420;
        engineOsc.connect(filter).connect(engineGain).connect(master);
        engineOsc.start();
      }
      engineOsc.frequency.setTargetAtTime(55 + speed * 130, ctx.currentTime, 0.06);
      engineGain.gain.setTargetAtTime(0.05 + speed * 0.05, ctx.currentTime, 0.08);
    },
    // Wailing siren while wanted > 0 and police are near.
    setSiren(on) {
      if (!on) {
        if (sirenGain && ctx) sirenGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        return;
      }
      if (!ensure()) return;
      if (!sirenOsc) {
        sirenOsc = ctx.createOscillator();
        sirenGain = ctx.createGain();
        sirenOsc.type = 'triangle';
        sirenOsc.frequency.value = 800;
        sirenGain.gain.value = 0;
        sirenLfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        sirenLfo.frequency.value = 0.55;
        lfoGain.gain.value = 190;
        sirenLfo.connect(lfoGain).connect(sirenOsc.frequency);
        sirenOsc.connect(sirenGain).connect(master);
        sirenOsc.start();
        sirenLfo.start();
      }
      sirenGain.gain.setTargetAtTime(0.028, ctx.currentTime, 0.2);
    },
  };
}
