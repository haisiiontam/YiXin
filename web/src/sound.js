// 极简合成音效：用 WebAudio 现场合成，不引入任何音频素材（无版权与体积问题）。
// 浏览器要求先有用户手势才能出声，所以 AudioContext 在第一次播放时才创建。
let ctx = null;
let enabled = true;

export function setSoundEnabled(value) {
  enabled = Boolean(value);
}

function audio() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// 发一个带指数衰减包络的短音；freq 为起始频率，glide 为结束频率（制造“叩”的下滑感）。
function blip({ freq, glide = freq, duration = 0.12, type = 'sine', gain = 0.12, delay = 0 }) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(glide, 1), t0 + duration);
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

// 黑子偏低沉，白子偏清脆，模拟云子落在榧木棋盘上的差别。
export function playStone(player) {
  if (!enabled) return;
  if (player === 1) blip({ freq: 190, glide: 95, duration: 0.14, type: 'triangle', gain: 0.16 });
  else blip({ freq: 320, glide: 170, duration: 0.11, type: 'triangle', gain: 0.12 });
}

export function playWin() {
  if (!enabled) return;
  [523, 659, 784, 1047].forEach((freq, i) => blip({ freq, duration: 0.32, gain: 0.09, delay: i * 0.11 }));
}

export function playDraw() {
  if (!enabled) return;
  [392, 330].forEach((freq, i) => blip({ freq, duration: 0.36, gain: 0.08, delay: i * 0.16 }));
}

export function playSettle() {
  if (!enabled) return;
  blip({ freq: 880, duration: 0.2, gain: 0.07 });
  blip({ freq: 1320, duration: 0.3, gain: 0.06, delay: 0.1 });
}
