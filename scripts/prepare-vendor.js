'use strict';
/**
 * 议迹 · 构建期准备脚本
 * 目的：让安装包「装完即用」——把 SenseVoiceSmall 模型与转写依赖预置进 vendor，
 *       随安装包内置（resources\models / resources\python），用户无需联网下载。
 *
 * 用法：node scripts/prepare-vendor.js [--skip-model] [--skip-python]
 * - 模型：下载 SenseVoiceSmall ONNX 文件（sha256 校验，重复运行跳过完整文件）→ vendor/models/sensevoice-small
 * - Python 依赖：给当前平台的内置 Python 预装 funasr-onnx / onnxruntime / av / numpy
 *   · Windows：vendor\python\python.exe
 *   · macOS：vendor/python-mac-arm64/bin/python3（由 CI 在 mac runner 上执行）
 *   · 无当前平台内置 Python 时仅提示（例如 Windows 本地无法为 mac 安装 wheel，mac 依赖由 CI 安装）
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { ASR_FILES } = require('../src/sensevoice');

const ROOT = path.join(__dirname, '..');
const MODEL_DIR = path.join(ROOT, 'vendor', 'models', 'sensevoice-small');
const MS_BASE = 'https://www.modelscope.cn/models';
const HF_BASE = 'https://huggingface.co/haixuantao/SenseVoiceSmall-onnx/resolve/main'; // 备用源（CI 海外可达）
const PY_DEPS = ['funasr-onnx', 'onnxruntime', 'av', 'numpy'];
const PY_IMPORT_TEST = 'import funasr_onnx, onnxruntime, av, numpy, yaml';

const args = process.argv.slice(2);
const skipModel = args.includes('--skip-model');
const skipPython = args.includes('--skip-python');

/* ---------------- 下载 ---------------- */
function httpGet(url, onResponse) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'yiji-meeting-tracker' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve({ redirect: res.headers.location });
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      resolve({ res });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('下载超时')));
  });
}

async function downloadOne(url, dest, { expectedSize, sha256 }) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  let redirects = 0, current = url;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { res, redirect } = await httpGet(current);
    if (redirect) {
      if (++redirects > 6) throw new Error('重定向次数过多');
      current = redirect.startsWith('http') ? redirect : new URL(redirect, current).href;
      continue;
    }
    await new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      let bytes = 0;
      const out = fs.createWriteStream(tmp);
      res.on('data', (c) => { bytes += c.length; hash.update(c); });
      res.pipe(out);
      out.on('finish', () => out.close(() => {
        const got = hash.digest('hex');
        if (sha256 && got !== sha256) {
          try { fs.unlinkSync(tmp); } catch (_) {}
          reject(new Error(`校验失败 ${path.basename(dest)}（期望 ${sha256.slice(0, 12)}…，实际 ${got.slice(0, 12)}…）`));
          return;
        }
        fs.renameSync(tmp, dest);
        resolve();
      }));
      out.on('error', reject);
      res.on('error', reject);
    });
    return;
  }
}

async function downloadModels() {
  console.log(`[模型] 目标：${MODEL_DIR}`);
  for (const f of ASR_FILES) {
    const dest = path.join(MODEL_DIR, f.name);
    try {
      if (fs.statSync(dest).size === f.size) { console.log(`[模型] 已存在 ✓ ${f.name}`); continue; }
    } catch (_) {}
    // 主源 ModelScope（sha256 校验）；失败自动切换 HF 镜像（两者文件应一致，校验不过即报错）
    const urls = [
      `${MS_BASE}/${f.model}/resolve/master/${f.name}`,
      `${HF_BASE}/${encodeURIComponent(f.name)}`,
    ];
    let lastErr = null;
    for (let i = 0; i < urls.length; i++) {
      process.stdout.write(`[模型] 下载 ${f.name}（${(f.size / 1048576).toFixed(0)}MB）${i ? '· HF 镜像' : ''}…`);
      try {
        await downloadOne(urls[i], dest, { expectedSize: f.size, sha256: f.sha256 });
        console.log(' 完成');
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        console.log(` 失败（${e.message}）`);
      }
    }
    if (lastErr) throw new Error(`${f.name} 下载失败：${lastErr.message}`);
  }
  const total = ASR_FILES.reduce((s, f) => s + f.size, 0);
  console.log(`[模型] 就绪（${(total / 1048576).toFixed(0)}MB）`);
}

/* ---------------- Python 依赖 ---------------- */
const PBS_TAG = '20260807';
const PY_VER = '3.12.13';
const MAC_PY_URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/cpython-${PY_VER}%2B${PBS_TAG}-aarch64-apple-darwin-install_only_stripped.tar.gz`;
const WIN_PY_URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/cpython-${PY_VER}%2B${PBS_TAG}-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`;
const MAC_PY_DIR = path.join(ROOT, 'vendor', 'python-mac-arm64');
const WIN_PY_DIR = path.join(ROOT, 'vendor', 'python');

/** 下载 python-build-standalone 并解压到 vendor/python[-mac-arm64] */
async function downloadPython(url, destDir, tag) {
  const probe = path.join(destDir, process.platform === 'win32' ? 'python.exe' : 'bin', 'python3');
  if (fs.existsSync(probe)) { console.log(`[Python] 内置 Python 已存在 ✓ ${probe}`); return; }
  console.log(`[Python] 下载内置 Python（${tag}）…`);
  const tgz = path.join(ROOT, 'vendor', `python-${tag}.tar.gz`);
  await downloadOne(url, tgz, {});
  const tmpDir = path.join(ROOT, 'vendor', '.pbs-tmp');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  execFileSync('tar', ['-xzf', tgz, '-C', tmpDir], { stdio: 'inherit' });
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.renameSync(path.join(tmpDir, 'python'), destDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(tgz, { force: true });
  console.log(`[Python] 内置 Python 就绪 ✓ ${probe}`);
}

function platformPython() {
  if (process.platform === 'win32') {
    const p = path.join(ROOT, 'vendor', 'python', 'python.exe');
    return fs.existsSync(p) ? p : null;
  }
  if (process.platform === 'darwin') {
    const p = path.join(MAC_PY_DIR, 'bin', 'python3');
    return fs.existsSync(p) ? p : null;
  }
  return null;
}

function pyInstalled(py) {
  try { execFileSync(py, ['-c', PY_IMPORT_TEST], { stdio: 'pipe' }); return true; } catch (_) { return false; }
}

function pipInstall(py, extraArgs) {
  const base = [py, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-warn-script-location', ...PY_DEPS];
  try {
    execFileSync(base[0], [...base.slice(1), '-i', 'https://pypi.tuna.tsinghua.edu.cn/simple', ...extraArgs], { stdio: 'inherit', timeout: 30 * 60 * 1000 });
  } catch (e) {
    console.log('[Python] 清华镜像失败，改用官方 PyPI…');
    execFileSync(base[0], [...base.slice(1), ...extraArgs], { stdio: 'inherit', timeout: 30 * 60 * 1000 });
  }
}

async function installPythonDeps() {
  // 平台内置 Python 缺失时自动下载（本地首次 / CI 干净环境）
  if (process.platform === 'win32' && !fs.existsSync(path.join(WIN_PY_DIR, 'python.exe'))) {
    await downloadPython(WIN_PY_URL, WIN_PY_DIR, 'win');
  }
  if (process.platform === 'darwin' && !fs.existsSync(path.join(MAC_PY_DIR, 'bin', 'python3'))) {
    await downloadPython(MAC_PY_URL, MAC_PY_DIR, 'mac');
  }
  const py = platformPython();
  if (!py) {
    console.log(`[Python] 当前平台（${process.platform}）没有预置的内置 Python，跳过依赖安装。`);
    console.log('[Python] 提示：macOS 依赖需在 mac 环境（本地 mac 或 CI macos runner）执行本脚本。');
    return;
  }
  if (pyInstalled(py)) { console.log(`[Python] 依赖已就绪 ✓ ${py}`); return; }
  console.log(`[Python] 预装依赖到 ${py}：${PY_DEPS.join(', ')}`);
  pipInstall(py, []);
  if (!pyInstalled(py)) throw new Error('Python 依赖安装后校验失败');
  console.log('[Python] 依赖就绪 ✓');
}

/* ---------------- 主流程 ---------------- */
(async () => {
  if (!skipModel) await downloadModels();
  if (!skipPython) await installPythonDeps();
  console.log('PREPARE_VENDOR_DONE');
})().catch((e) => {
  console.error('PREPARE_VENDOR_FAIL', e && e.message || e);
  process.exit(1);
});
