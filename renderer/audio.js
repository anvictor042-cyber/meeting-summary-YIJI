'use strict';
/* 议迹 · 录音引擎：MediaRecorder + AnalyserNode 波形 + WebM→WAV 转换 */

class Recorder {
  constructor({ onTick, onState, onChunk } = {}) {
    this.mediaRecorder = null;
    this.stream = null;
    this.analyser = null;
    this.dataArr = [];
    this.startTs = 0;
    this.elapsed = 0;          // 已录时长（秒，含暂停前累计）
    this.pausedAt = 0;
    this.state = 'idle';       // idle | recording | paused
    this.onTick = onTick || (() => {});
    this.onState = onState || (() => {});
    this.onChunk = onChunk || null;  // 每个分片回调（用于流式写盘，支持长录音）
    this.mime = 'audio/webm;codecs=opus';
  }

  async start() {
    if (this.state !== 'idle') return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(this.stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.82;
    src.connect(this.analyser);

    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m));
    this.mime = mime || 'audio/webm';
    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: this.mime, audioBitsPerSecond: 128000 });
    this.dataArr = [];
    this.mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size) {
        this.dataArr.push(e.data);
        if (this.onChunk) this.onChunk(e.data);
      }
    };
    this.mediaRecorder.start(200);
    this.startTs = Date.now();
    this.pausedAt = 0;
    this.elapsed = 0;
    this.setState('recording');
    this._tick();
  }

  pause() {
    if (this.state !== 'recording') return;
    this.mediaRecorder.pause();
    this.pausedAt = Date.now();
    this.setState('paused');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.mediaRecorder.resume();
    this.startTs = Date.now();
    this.setState('recording');
  }

  async stop() {
    if (this.state === 'idle') return null;
    const stopped = new Promise(res => {
      this.mediaRecorder.onstop = res;
      this.mediaRecorder.stop();
    });
    this.elapsed += this.state === 'paused' ? (this.pausedAt - this.startTs) / 1000 : (Date.now() - this.startTs) / 1000;
    await stopped;
    const blob = new Blob(this.dataArr, { type: this.mime });
    this._cleanup();
    this.setState('idle');
    this.onTick(0, []);
    return blob;
  }

  _tick() {
    if (this.state !== 'recording') return;
    const loop = () => {
      if (this.state !== 'recording') return;
      const now = Date.now();
      const cur = this.elapsed + (now - this.startTs) / 1000;
      const levels = this.getLevels(48);
      this.onTick(cur, levels);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  getLevels(count) {
    if (!this.analyser) return new Array(count).fill(0.02);
    const buf = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(buf);
    const out = [];
    const step = Math.floor(buf.length / count);
    for (let i = 0; i < count; i++) {
      let peak = 0;
      for (let j = i * step; j < (i + 1) * step && j < buf.length; j++) {
        const v = Math.abs(buf[j] - 128) / 128;
        if (v > peak) peak = v;
      }
      out.push(peak);
    }
    return out;
  }

  setState(s) {
    this.state = s;
    this.onState(s);
  }

  _cleanup() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.mediaRecorder = null;
    this.analyser = null;
    this.dataArr = [];
  }
}

/** WebM/opus blob → 16bit 单声道 WAV ArrayBuffer（16kHz，Whisper 友好） */
async function blobToWav(blob) {
  const arrayBuf = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate: 16000 });
  try {
    const audioBuf = await ctx.decodeAudioData(arrayBuf);
    const src = audioBuf.getChannelData(0);
    const wavBuf = new ArrayBuffer(44 + src.length * 2);
    const view = new DataView(wavBuf);
    const wStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    wStr(0, 'RIFF'); view.setUint32(4, 36 + src.length * 2, true); wStr(8, 'WAVE');
    wStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true); view.setUint32(28, 16000 * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    wStr(36, 'data'); view.setUint32(40, src.length * 2, true);
    let off = 44;
    for (let i = 0; i < src.length; i++, off += 2) {
      let s = Math.max(-1, Math.min(1, src[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return wavBuf;
  } finally {
    ctx.close();
  }
}

/** 波形绘制：levels 0-1 数组 → canvas（强调色，历史淡出） */
function drawWave(canvas, levels, { color = '#2e5e4e', activeIdx = -1, history = 0 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  if (!levels || !levels.length) return;
  const n = levels.length;
  const gap = 2, barW = Math.max(2, Math.min(3.5, (w - gap * (n - 1)) / n));
  const mid = h / 2;
  for (let i = 0; i < n; i++) {
    const lv = Math.max(0.02, levels[i]);
    const bh = Math.max(2, lv * (h - 14));
    const x = i * (barW + gap);
    const alpha = history > 0 && i <= activeIdx ? Math.max(0.25, 1 - (activeIdx - i) / history * 0.75) : 1;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const r = Math.min(barW / 2, 2);
    roundBar(ctx, x, mid - bh / 2, barW, bh, r);
  }
  ctx.globalAlpha = 1;
}

function roundBar(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

window.Recorder = Recorder;
window.blobToWav = blobToWav;
window.drawWave = drawWave;
