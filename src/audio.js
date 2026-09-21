// audio.js — small procedural sound-effect engine using WebAudio.
// No external audio files: every sound is synthesized so nothing is "ripped" from anywhere.

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
  }

  // Must be called after a user gesture (browser autoplay policy).
  unlock() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
  }

  _noiseBuffer(duration) {
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  _envGain(attack, decay, peak = 1) {
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + attack + decay);
    return g;
  }

  swing() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.25);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.22);
    filter.Q.value = 0.8;
    const g = this._envGain(0.01, 0.22, 0.5);
    src.connect(filter).connect(g).connect(this.master);
    src.start();
  }

  impact(strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    // Low thud
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140 * strength, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.18);
    const og = this._envGain(0.002, 0.22, 0.9);
    osc.connect(og).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    // Metallic crack
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.12);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2500;
    const ng = this._envGain(0.001, 0.1, 0.35);
    src.connect(filter).connect(ng).connect(this.master);
    src.start();
  }

  block() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(500, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.1);
    const g = this._envGain(0.001, 0.15, 0.25);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  }

  parry() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1400, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(2600, ctx.currentTime + 0.08);
    const g = this._envGain(0.001, 0.25, 0.4);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  }

  hitGrunt() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.15);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    const g = this._envGain(0.001, 0.14, 0.3);
    src.connect(filter).connect(g).connect(this.master);
    src.start();
  }

  // A rising growl right as the enemy commits to a swing — an audio "tell"
  // distinct from footsteps/impacts so you can react to sound alone.
  telegraph(charge = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(90, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(70 + 40 * charge, ctx.currentTime + 0.35);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.35 * charge, ctx.currentTime + 0.3);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
    osc.connect(filter).connect(g).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + 0.42);
  }

  footstep() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.06);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    const g = this._envGain(0.001, 0.05, 0.18);
    src.connect(filter).connect(g).connect(this.master);
    src.start();
  }

  dodge() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.2);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.18);
    const g = this._envGain(0.001, 0.18, 0.3);
    src.connect(filter).connect(g).connect(this.master);
    src.start();
  }

  death() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.8);
    const g = this._envGain(0.01, 0.8, 0.3);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + 0.9);
  }
}
