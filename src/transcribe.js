'use strict';
/**
 * 本地转写层：自动探测可用的转写引擎
 * 优先级：
 *   1. SenseVoiceSmall（推荐，scripts/transcribe_sensevoice.py + funasr-onnx；模型在设置中一键下载）
 *   2. faster-whisper（scripts/transcribe.py + venv，或系统 python 已装 faster_whisper）
 *   3. whisper.cpp（用户配置 whisper-cli.exe 路径）
 *   4. openai-whisper CLI（whisper 命令在 PATH 中）
 */
const { execFile } = require('child_process');
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const SRC_SCRIPTS = path.join(__dirname, '..', 'scripts');
const sensevoice = require('./sensevoice');

/**
 * Python 脚本路径：开发模式用项目内文件；打包模式（asar 内 Python 读不到，
 * 且 Electron 的 fs.existsSync 对 asar 路径也返回 true）必须用 app.isPackaged 判断，
 * 并把脚本释放到用户可写目录 userData/scripts 后执行
 */
function getPythonScript(name) {
  if (!app.isPackaged) {
    const project = path.join(SRC_SCRIPTS, name);
    if (fs.existsSync(project)) return project;
  }
  const destDir = path.join(app.getPath('userData'), 'scripts');
  const dest = path.join(destDir, name);
  try {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    // 打包模式：把转写脚本与它依赖的 diarize.py 一起释放到可写目录（启动时总是覆盖，保证最新）
    for (const f of ['transcribe.py', 'transcribe_sensevoice.py', 'diarize.py', 'setup_whisper.bat', 'setup_whisper.sh']) {
      const src = path.join(__dirname, '..', 'scripts', f);
      const dst = path.join(destDir, f);
      if (fs.existsSync(src)) {
        try { fs.copyFileSync(src, dst); } catch (_) {}
      }
    }
  } catch (e) {
    console.error('释放 Python 脚本失败', e);
  }
  return dest;
}

const SCRIPT = getPythonScript('transcribe.py');
const SENSEVOICE_SCRIPT = getPythonScript('transcribe_sensevoice.py');

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 30 * 60 * 1000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...opts },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
  });
}

function findVenvPython() {
  // 打包安装版：venv 位于可写目录 userData\whisper-venv（setup_whisper.bat/.sh 默认装到这里）
  // Windows venv 是 Scripts\python.exe；macOS/Linux venv 是 bin/python
  // 开发版：项目内 scripts\.venv；旧版数据目录 D:\ClawData\议迹\whisper-venv 作为历史路径兜底
  const candidates = [
    path.join(app.getPath('userData'), 'whisper-venv', 'Scripts', 'python.exe'),
    path.join(app.getPath('userData'), 'whisper-venv', 'bin', 'python'),
    'D:\\ClawData\\议迹\\whisper-venv\\Scripts\\python.exe',
    'D:\\ClawData\\议迹\\whisper-venv\\bin\\python',
    path.join(__dirname, '..', 'scripts', '.venv', 'Scripts', 'python.exe'),
    path.join(__dirname, '..', 'scripts', '.venv', 'bin', 'python'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

/**
 * 安装包内置 Python（python-build-standalone）：
 * 打包后位于 resources\python（Windows: python.exe；macOS: bin/python3）；
 * 开发模式位于项目 vendor\python（Win）或 vendor\python-mac-arm64（mac）。
 * 内置 Python 已预装 funasr-onnx / onnxruntime / av，用户无需自行安装任何东西。
 */
function findEmbeddedPython() {
  const rp = process.resourcesPath || '';
  const winCandidates = [
    path.join(rp, 'python', 'python.exe'),
    path.join(__dirname, '..', 'vendor', 'python', 'python.exe'),
  ];
  const macCandidates = [
    path.join(rp, 'python', 'bin', 'python3'),
    path.join(__dirname, '..', 'vendor', 'python-mac-arm64', 'bin', 'python3'),
  ];
  const candidates = process.platform === 'win32' ? winCandidates : macCandidates;
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}

/**
 * 确保 venv 存在：优先用内置 Python 创建（用户无需安装 Python），
 * 找不到内置 Python 时回退系统 python。返回 venv python 路径。
 */
async function ensureVenv(onProgress = () => {}) {
  const existing = findVenvPython();
  if (existing) return existing;
  const venvDir = path.join(app.getPath('userData'), 'whisper-venv');
  const venvPython = path.join(venvDir, process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
  const embedded = findEmbeddedPython();
  const base = embedded || 'python';
  onProgress(0.02, '创建 Python 虚拟环境（应用内置）…');
  await runCmd(base, ['-m', 'venv', venvDir]);
  if (fs.existsSync(venvPython)) return venvPython;
  throw new Error('创建虚拟环境失败，请检查系统是否安装了 Python 3.10+');
}

/** 转写可用 python 候选：显式指定 > venv > 内置 Python */
function pythonCandidates(s) {
  const list = [];
  if (s.whisperPython && fs.existsSync(s.whisperPython)) list.push(s.whisperPython);
  const venv = findVenvPython();
  if (venv) list.push(venv);
  const embedded = findEmbeddedPython();
  if (embedded) list.push(embedded);
  return list;
}

async function pythonHasModule(python, mod) {
  try {
    await runCmd(python, ['-c', `import ${mod}`], { timeout: 20000 });
    return true;
  } catch (_) { return false; }
}

function sensevoiceDirs(s) {
  const ud = app.getPath('userData');
  // 用户自定义目录 > 安装包内置模型（装完即用）> 默认下载目录
  const bundled = sensevoice.bundledModelDir ? sensevoice.bundledModelDir() : null;
  return {
    modelDir: s.svModelDir || bundled || path.join(ud, 'models', 'sensevoice-small'),
    puncDir: path.join(ud, 'models', 'sensevoice-punc'),
  };
}

function transcriptsDir(s) {
  // 转录文本默认存 D 盘（用户要求）；D 盘不可用时回退应用数据目录
  const custom = s && s.transcriptsDir;
  if (custom) {
    try { if (!fs.existsSync(custom)) fs.mkdirSync(custom, { recursive: true }); return custom; } catch (_) {}
  }
  try {
    if (fs.existsSync('D:\\')) {
      const dir = 'D:\\ClawOutput\\议迹转写文本';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
  } catch (_) {}
  const dir = path.join(app.getPath('userData'), 'transcripts');
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}

async function runSenseVoice(audioPath, s, python) {
  const { modelDir, puncDir } = sensevoiceDirs(s);
  if (!fs.existsSync(path.join(modelDir, 'model_quant.onnx'))) {
    throw new Error('未安装 SenseVoiceSmall 模型。请到「设置 - SenseVoiceSmall 语音模块」一键下载，或在转写引擎中选择其它引擎。');
  }
  const args = [SENSEVOICE_SCRIPT, audioPath, '--model-dir', modelDir];
  if (s.svPunc !== 'off' && fs.existsSync(path.join(puncDir, 'model_quant.onnx'))) args.push('--punc-dir', puncDir);
  if (s.whisperDiarize !== 'off') args.push('--diarize');
  const out = await runCmd(python, args);
  const result = parseTranscribeOut(out);
  // 转写文本存档到默认目录（D:\ClawOutput\议迹转写文本，可在设置中修改）
  try {
    const dir = transcriptsDir(s);
    const txtPath = path.join(dir, path.basename(audioPath, path.extname(audioPath)) + '.txt');
    fs.writeFileSync(txtPath, result.text || '', 'utf8');
    result.textPath = txtPath;
  } catch (_) {}
  return result;
}

async function pythonHasFasterWhisper(python) {
  return pythonHasModule(python, 'faster_whisper');
}

async function runFasterWhisper(audioPath, model, python, s) {
  const args = [SCRIPT, audioPath, '--model', model];
  if (s.whisperModelDir) args.push('--download-root', s.whisperModelDir);
  if (s.whisperDiarize !== 'off') args.push('--diarize');
  const out = await runCmd(python, args);
  const result = parseTranscribeOut(out);
  // 转写文本存档到默认目录（与 SenseVoice/whisper.cpp 行为一致）
  try {
    const dir = transcriptsDir(s);
    const txtPath = path.join(dir, path.basename(audioPath, path.extname(audioPath)) + '.txt');
    fs.writeFileSync(txtPath, result.text || '', 'utf8');
    result.textPath = txtPath;
  } catch (_) {}
  return result;
}

async function runWhisperCpp(audioPath, model, exe, s) {
  // 解析 GGML 模型文件：显式设置优先，其次 exe 旁 models 目录
  let modelPath = s.whisperModelPath || '';
  if (!modelPath) {
    const candidate = path.join(path.dirname(exe), 'models', `ggml-${model}.bin`);
    if (fs.existsSync(candidate)) modelPath = candidate;
  }
  if (!modelPath || !fs.existsSync(modelPath)) {
    throw new Error(`未找到 GGML 模型文件（期望：${path.join(path.dirname(exe), 'models', `ggml-${model}.bin`)}），请将模型放入该目录或在设置中指定模型路径。`);
  }
  // 转写文本输出到默认目录（D:\ClawOutput\议迹转写文本，可在设置中修改）
  const outDir = transcriptsDir(s);
  const outBase = path.basename(audioPath, path.extname(audioPath));
  const txtPath = path.join(outDir, `${outBase}.txt`);
  try { fs.unlinkSync(txtPath); } catch (_) {}
  const args = ['-m', modelPath, '-f', audioPath, '-otxt', '-nt', '-l', 'auto', '-od', outDir, '-of', outBase];
  await runCmd(exe, args);
  if (!fs.existsSync(txtPath)) throw new Error('whisper.cpp 未生成转写文件');
  const text = fs.readFileSync(txtPath, 'utf8').trim();
  return { text, segments: [{ start: 0, end: 0, text }] };
}

async function runOpenaiWhisper(audioPath, model, s) {
  const outDir = transcriptsDir(s);
  const out = await runCmd('whisper', [audioPath, '--model', model, '--language', 'zh', '--output_format', 'txt', '--output_dir', outDir, '--fp16', 'False']);
  const base = path.join(outDir, path.basename(audioPath, path.extname(audioPath)));
  const txtPath = `${base}.txt`;
  if (fs.existsSync(txtPath)) {
    const text = fs.readFileSync(txtPath, 'utf8').trim();
    return { text, segments: [{ start: 0, end: 0, text }] };
  }
  return { text: (out || '').trim(), segments: [] };
}

function parseTranscribeOut(raw) {
  try {
    const data = JSON.parse(raw);
    const text = (data.segments || [])
      .map(s => s.speaker ? `[${s.speaker}] ${s.text}` : s.text)
      .join('').trim();
    return { text, segments: data.segments || [], language: data.language || '' };
  } catch (_) {
    return { text: String(raw || '').trim(), segments: [] };
  }
}

async function run(audioPath, s) {
  if (!audioPath || !fs.existsSync(audioPath)) throw new Error('录音文件不存在。');
  const engine = s.whisperEngine || 'auto';
  const model = s.whisperModel || 'small';
  const errors = [];
  // 显式指定 > venv > 内置 Python；无 venv 时先自动创建（内置 Python，无需用户装 Python）
  const candidates = pythonCandidates(s);
  if (!candidates.length) {
    try { await ensureVenv(); candidates.push(findVenvPython()); } catch (_) {}
  }

  // 0) SenseVoiceSmall（推荐；auto 模式下已安装即优先使用）
  if (engine === 'auto' || engine === 'sensevoice') {
    const { modelDir } = sensevoiceDirs(s);
    const modelInstalled = fs.existsSync(path.join(modelDir, 'model_quant.onnx'));
    if (modelInstalled) {
      let ran = false;
      for (const py of candidates) {
        if (py && await pythonHasModule(py, 'funasr_onnx')) {
          try { return await runSenseVoice(audioPath, s, py); }
          catch (e) { errors.push(`sensevoice: ${e.message}`); ran = true; break; }
        }
      }
      if (!ran) {
        // 模型在但运行时未装：尝试系统 python
        try {
          if (await pythonHasModule('python', 'funasr_onnx')) return await runSenseVoice(audioPath, s, 'python');
        } catch (e) { errors.push(`sensevoice(python): ${e.message}`); }
        errors.push('sensevoice: 模型已安装但缺少 funasr-onnx 运行时，请到设置重新执行一键下载');
      }
    } else if (engine === 'sensevoice') {
      throw new Error('未安装 SenseVoiceSmall 模型。请到「设置 - SenseVoiceSmall 语音模块」一键下载（约 230MB），安装后即可使用。');
    }
  }

  // 1) faster-whisper（显式 python 或自动探测）
  if (engine === 'auto' || engine === 'faster-whisper') {
    for (const py of candidates) {
      if (py && await pythonHasFasterWhisper(py)) {
        try { return await runFasterWhisper(audioPath, model, py, s); }
        catch (e) { errors.push(`faster-whisper: ${e.message}`); }
      }
    }
    // 系统 python 兜底
    try {
      if (await pythonHasFasterWhisper('python')) return await runFasterWhisper(audioPath, model, 'python', s);
    } catch (e) { errors.push(`python: ${e.message}`); }
  }

  // 2) whisper.cpp
  if (engine === 'auto' || engine === 'whisper-cpp') {
    if (s.whisperCppPath && fs.existsSync(s.whisperCppPath)) {
      try { return await runWhisperCpp(audioPath, model, s.whisperCppPath, s); }
      catch (e) { errors.push(`whisper.cpp: ${e.message}`); }
    } else if (engine === 'whisper-cpp') {
      throw new Error('未配置 whisper.cpp 的 whisper-cli.exe 路径，请在设置中填写。');
    }
  }

  // 3) openai-whisper CLI
  if (engine === 'auto' || engine === 'openai-whisper') {
    try { return await runOpenaiWhisper(audioPath, model, s); }
    catch (e) { errors.push(`openai-whisper: ${e.message}`); }
  }

  throw new Error(
    '没有可用的转写引擎。\n推荐：在「设置 - SenseVoiceSmall 语音模块」一键下载后自动使用；' +
    '或运行 scripts\\setup_whisper.bat 安装 faster-whisper，或在设置中配置 whisper.cpp。\n详细错误：' + errors.join('；')
  );
}

module.exports = { run, findVenvPython, findEmbeddedPython, ensureVenv, transcriptsDir, pythonHasModule };
