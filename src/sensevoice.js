'use strict';
/**
 * SenseVoiceSmall 语音模块管理
 * - 一键下载：ModelScope 官方源（本机可达、免费 Apache 2.0）
 *   · 语音识别：iic/SenseVoiceSmall-onnx（int8 量化，约 230MB）
 *   · 标点恢复：iic/punc_ct-transformer_zh-cn-common-vocab272727-onnx（约 270MB，可选）
 * - 完整性：每个文件按 ModelScope 官方 sha256 校验，失败自动重试
 * - 运行时：funasr-onnx + onnxruntime（pip 安装到 Whisper 同一虚拟环境，无需 torch）
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const MS_BASE = 'https://www.modelscope.cn/models';

/* ModelScope 官方文件清单（名称 / 字节数 / sha256 / 所属仓库） */
const ASR_FILES = [
  { name: 'model_quant.onnx', size: 241216270, sha256: '21dc965f689a78d1604717bf561e40d5a236087c85a95584567835750549e822', model: 'iic/SenseVoiceSmall-onnx' },
  { name: 'am.mvn', size: 11203, sha256: '29b3c740a2c0cfc6b308126d31d7f265fa2be74f3bb095cd2f143ea970896ae5', model: 'iic/SenseVoiceSmall-onnx' },
  { name: 'config.yaml', size: 1855, sha256: 'f71e239ba36705564b5bf2d2ffd07eece07b8e3f2bbf6d2c99d8df856339ac19', model: 'iic/SenseVoiceSmall-onnx' },
  { name: 'configuration.json', size: 56, sha256: 'c57f6a580d63f7465c6a22ba95847aee05a1ae1181f5abddffb943d9febda061', model: 'iic/SenseVoiceSmall-onnx' },
  { name: 'tokens.json', size: 352064, sha256: 'a2594fc1474e78973149cba8cd1f603ebed8c39c7decb470631f66e70ce58e97', model: 'iic/SenseVoiceSmall-onnx' },
  // 分词器 BPE 模型只在 PyTorch 版仓库发布，onnx 运行时同样需要它
  { name: 'chn_jpn_yue_eng_ko_spectok.bpe.model', size: 377341, sha256: 'aa87f86064c3730d799ddf7af3c04659151102cba548bce325cf06ba4da4e6a8', model: 'iic/SenseVoiceSmall' },
];
const PUNC_FILES = [
  { name: 'model_quant.onnx', size: 282752912, sha256: 'e6cd8399bf7d0e75f8d9af4a107310e1968ecab1d50135e765b8f0265b27a83d', model: 'iic/punc_ct-transformer_zh-cn-common-vocab272727-onnx' },
  { name: 'config.yaml', size: 810, sha256: 'a56ec10925b06fa976ad51af373396be2b13e1eb8dc62a5426b5adebaba7071d', model: 'iic/punc_ct-transformer_zh-cn-common-vocab272727-onnx' },
  { name: 'configuration.json', size: 521, sha256: '16097d3034818080e39331fa08909dffe75189f5c986f74155afd90b5f531ee4', model: 'iic/punc_ct-transformer_zh-cn-common-vocab272727-onnx' },
  { name: 'tokens.json', size: 4207480, sha256: 'c960ab87bccea4aa15cf49a59f71973c2c330b46668048cd8da253749ec71ee3', model: 'iic/punc_ct-transformer_zh-cn-common-vocab272727-onnx' },
];

function defaultModelDir(userData) { return path.join(userData, 'models', 'sensevoice-small'); }
function defaultPuncDir(userData) { return path.join(userData, 'models', 'sensevoice-punc'); }

/**
 * 安装包内置模型目录（resources\models\sensevoice-small，随安装包分发，只读）。
 * 打包后：process.resourcesPath/models/sensevoice-small；开发模式：vendor/models/sensevoice-small。
 */
function bundledModelDir() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'models', 'sensevoice-small') : '',
    path.join(__dirname, '..', 'vendor', 'models', 'sensevoice-small'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'model_quant.onnx'))) return c;
  }
  return null;
}

function fileOk(dir, f) {
  try { return fs.statSync(path.join(dir, f.name)).size === f.size; } catch (_) { return false; }
}

/** 指定目录是否完整安装了某组文件 */
function dirInstalled(dir, files) {
  if (!dir || !files) return false;
  return files.every(f => fileOk(dir, f));
}

function dirSize(dir) {
  let total = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isFile()) total += fs.statSync(p).size;
    }
  } catch (_) {}
  return total;
}

/**
 * 模块状态
 * @param {object} s 设置
 * @param {string} userData 用户数据目录
 */
function status(s, userData) {
  const bundled = bundledModelDir();
  // 用户自定义目录 > 内置模型目录（安装包自带）> 默认下载目录
  let asrDir = s.svModelDir || bundled || defaultModelDir(userData);
  const puncDir = defaultPuncDir(userData);
  const asrInstalled = dirInstalled(asrDir, ASR_FILES);
  const puncInstalled = dirInstalled(puncDir, PUNC_FILES);
  // Whisper 模型状态：缓存目录下存在 faster-whisper 模型即视为已安装
  const whisperDir = s.whisperModelDir || '';
  let whisperInstalled = false;
  if (whisperDir) {
    try { whisperInstalled = fs.readdirSync(whisperDir).some(n => n.includes('faster-whisper')); } catch (_) {}
  }
  return {
    asrInstalled,
    puncInstalled,
    asrDir,
    puncDir,
    bundled: !!bundled,
    bundledDir: bundled,
    asrSize: asrInstalled ? dirSize(asrDir) : 0,
    puncSize: puncInstalled ? dirSize(puncDir) : 0,
    whisperDir,
    whisperInstalled,
    whisperModel: s.whisperModel || 'small',
  };
}

/* ---------------- 下载 ---------------- */

function httpGet(url, onResponse) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'yiji-meeting-tracker' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve({ redirect: res.headers.location });
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      resolve({ res });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('下载超时')));
  });
}

/** 下载单个文件（跟随重定向，流式写盘，带进度回调），返回 { bytes, sha256 } */
async function downloadOne(url, dest, { expectedSize, sha256, onProgress } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  let redirects = 0;
  let current = url;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { res, redirect } = await httpGet(current);
    if (redirect) {
      if (++redirects > 6) throw new Error('重定向次数过多');
      current = redirect.startsWith('http') ? redirect : new URL(redirect, current).href;
      continue;
    }
    return await new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      let bytes = 0;
      const out = fs.createWriteStream(tmp);
      res.on('data', (c) => {
        bytes += c.length;
        hash.update(c);
        if (onProgress && expectedSize) onProgress(Math.min(1, bytes / expectedSize), bytes);
      });
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          const got = hash.digest('hex');
          if (sha256 && got !== sha256) {
            try { fs.unlinkSync(tmp); } catch (_) {}
            reject(new Error(`校验失败（期望 ${sha256.slice(0, 12)}…，实际 ${got.slice(0, 12)}…）`));
            return;
          }
          fs.renameSync(tmp, dest);
          resolve({ bytes, sha256: got });
        });
      });
      out.on('error', reject);
      res.on('error', reject);
    });
  }
}

/**
 * 下载模型文件
 * @param {object} p { asrDir, puncDir, withPunc, onProgress(percent, text) }
 */
async function downloadModels({ asrDir, puncDir, withPunc = true, onProgress = () => {} } = {}) {
  const jobs = ASR_FILES.map(f => ({ dir: asrDir, f }));
  if (withPunc) PUNC_FILES.forEach(f => jobs.push({ dir: puncDir, f }));
  const totalBytes = jobs.reduce((s, j) => s + j.f.size, 0);
  let doneBytes = 0;

  for (let i = 0; i < jobs.length; i++) {
    const { dir, f } = jobs[i];
    const dest = path.join(dir, f.name);
    if (fileOk(dir, f)) { doneBytes += f.size; continue; } // 已存在且完整，跳过
    const url = `${MS_BASE}/${f.model}/resolve/master/${f.name}`;
    onProgress(doneBytes / totalBytes, `下载 ${f.name}（${(f.size / 1048576).toFixed(0)}MB）`);
    let lastPct = 0;
    try {
      await downloadOne(url, dest, {
        expectedSize: f.size,
        sha256: f.sha256,
        onProgress: (p) => {
          const overall = (doneBytes + f.size * p) / totalBytes;
          if (overall - lastPct > 0.002 || overall >= 1) { lastPct = overall; onProgress(overall, `下载 ${f.name}（${(f.size / 1048576).toFixed(0)}MB）`); }
        },
      });
    } catch (e) {
      // 失败重试一次（网络抖动）
      try {
        await downloadOne(url, dest, { expectedSize: f.size, sha256: f.sha256 });
      } catch (e2) {
        throw new Error(`${f.name} 下载失败：${e2.message}`);
      }
    }
    doneBytes += f.size;
  }
  onProgress(1, '模型文件就绪');
  return { ok: true, asrDir, puncDir };
}

/* ---------------- 运行时（pip） ---------------- */

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 20 * 60 * 1000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, ...opts },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
  });
}

/** 安装/补齐 funasr-onnx + onnxruntime（优先清华镜像，失败回退官方源） */
async function installRuntime(python, onProgress = () => {}) {
  // 内置 Python 已预装（安装包自带）时直接跳过，无需联网
  try {
    await runCmd(python, ['-c', 'import funasr_onnx, onnxruntime'], { timeout: 60000 });
    onProgress(1, '识别运行时就绪（内置）');
    return { ok: true };
  } catch (_) {}
  onProgress(0, '安装识别运行时（funasr-onnx + onnxruntime）…');
  const base = [python, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-warn-script-location', 'funasr-onnx', 'onnxruntime'];
  try {
    await runCmd(base[0], [...base.slice(1), '-i', 'https://pypi.tuna.tsinghua.edu.cn/simple']);
  } catch (e) {
    onProgress(0.5, '镜像源失败，改用官方 PyPI…');
    await runCmd(base[0], base.slice(1));
  }
  // 校验可导入
  await runCmd(python, ['-c', 'import funasr_onnx, onnxruntime'], { timeout: 60000 });
  onProgress(1, '识别运行时就绪');
  return { ok: true };
}

/* ---------------- Whisper（faster-whisper）模型 ---------------- */

const WHISPER_SIZES = { base: 142, small: 460, medium: 1500 };

/** 安装/补齐 faster-whisper 运行时 */
async function installWhisperRuntime(python, onProgress = () => {}) {
  onProgress(0, '安装 Whisper 运行时（faster-whisper）…');
  const base = [python, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-warn-script-location', 'faster-whisper'];
  try {
    await runCmd(base[0], [...base.slice(1), '-i', 'https://pypi.tuna.tsinghua.edu.cn/simple']);
  } catch (e) {
    onProgress(0.5, '镜像源失败，改用官方 PyPI…');
    await runCmd(base[0], base.slice(1));
  }
  await runCmd(python, ['-c', 'import faster_whisper'], { timeout: 60000 });
  onProgress(1, 'Whisper 运行时就绪');
  return { ok: true };
}

/** 预下载 Whisper 模型到指定目录（download_root；官方源失败自动切 hf-mirror.com 镜像） */
async function downloadWhisperModel(python, model, dir, onProgress = () => {}) {
  const mb = WHISPER_SIZES[model] || 460;
  onProgress(0, `下载 Whisper ${model} 模型（约 ${mb}MB）…`);
  const script = `from faster_whisper import WhisperModel; WhisperModel('${model}', device='cpu', compute_type='int8', download_root=${JSON.stringify(dir)})`;
  try {
    await runCmd(python, ['-c', script], { timeout: 40 * 60 * 1000 });
  } catch (e) {
    onProgress(0.5, '官方源失败，改用 hf-mirror.com 镜像…');
    await runCmd(python, ['-c', script], { timeout: 40 * 60 * 1000, env: { ...process.env, HF_ENDPOINT: 'https://hf-mirror.com' } });
  }
  onProgress(1, '模型就绪');
  return { ok: true };
}

module.exports = {
  ASR_FILES, PUNC_FILES,
  defaultModelDir, defaultPuncDir, bundledModelDir, dirInstalled, dirSize, status, downloadModels, installRuntime,
  installWhisperRuntime, downloadWhisperModel,
};
