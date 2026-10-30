/** 一点点用 WebAudio 现场合成的音效，没有外部音频文件。 */
export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    try {
      const saved = localStorage.getItem('nailong.sound');
      if (saved != null) this.enabled = saved === '1';
    } catch {
      /* 隐私模式下 localStorage 可能不可用 */
    }
  }

  ensure() {
    if (!this.enabled) return null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!this.ctx) this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    try {
      localStorage.setItem('nailong.sound', this.enabled ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.enabled) this.ensure();
  }

  note(freq, delay, duration, type = 'sine', volume = 0.11) {
    const ctx = this.ensure();
    if (!ctx) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  click() {
    this.note(540, 0, 0.07, 'triangle', 0.05);
  }

  countdown(n) {
    this.note(n <= 1 ? 880 : 440, 0, 0.12, 'triangle', 0.09);
  }

  start() {
    [523.25, 659.25, 783.99].forEach((f, i) => {
      this.note(f, i * 0.075, 0.18, 'sine', 0.1);
    });
  }

  perfect() {
    [880, 1108.73, 1318.51, 1760].forEach((f, i) => {
      this.note(f, i * 0.07, 0.24, 'triangle', 0.1);
    });
  }

  success(stars = 3) {
    const base = stars >= 4 ? [523.25, 659.25, 783.99, 1046.5] : [392, 523.25, 659.25];
    base.forEach((f, i) => this.note(f, i * 0.09, 0.26, 'sine', 0.1));
  }

  fail() {
    [330, 277, 220].forEach((f, i) => this.note(f, i * 0.11, 0.2, 'sine', 0.07));
  }

  error() {
    this.note(180, 0, 0.18, 'sawtooth', 0.05);
  }
}
