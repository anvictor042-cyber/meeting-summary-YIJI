// 临时验证：新构建 asar 零 Key + 元信息
const asar = require('@electron/asar');
const ASAR = 'dist/win-unpacked/resources/app.asar';
const files = ['src/settings.js', 'src/ai.js', 'preload.js', 'renderer/settings.js', 'main.js', 'package.json', 'src/transcribe.js', 'src/db.js'];
let hasKey = false;
for (const f of files) {
  const s = asar.extractFile(ASAR, f).toString('utf8');
  if (/sk-[A-Za-z0-9]{8,}/.test(s)) { console.log('KEY_FOUND_IN:', f); hasKey = true; }
}
console.log('NO_EMBEDDED_KEY:', !hasKey);
const s = asar.extractFile(ASAR, 'src/settings.js').toString('utf8');
console.log('DEFAULTS_EMPTY_KEYS:', s.includes("deepseekKey: ''") && s.includes("openaiKey: ''"));
const pkg = JSON.parse(asar.extractFile(ASAR, 'package.json').toString('utf8'));
console.log('PRODUCT_NAME:', pkg.productName, '| VERSION:', pkg.version);
// 关键文件都在包里
for (const f of ['main.js', 'preload.js', 'schema.sql', 'scripts/setup_whisper.bat', 'scripts/setup_whisper.sh', 'src/transcribe.js']) {
  console.log('HAS', f, ':', asar.listPackage(ASAR).includes('\\' + f.replace(/\//g, '\\')));
}
// 内置 Python（extraResources → resources/python/python.exe）
const fs = require('fs');
const embeddedPy = 'dist/win-unpacked/resources/python/python.exe';
console.log('EMBEDDED_PYTHON:', fs.existsSync(embeddedPy), embeddedPy);
// 内置 SenseVoiceSmall 模型（extraResources → resources/models/sensevoice-small）
const modelOnnx = 'dist/win-unpacked/resources/models/sensevoice-small/model_quant.onnx';
console.log('BUNDLED_MODEL:', fs.existsSync(modelOnnx), modelOnnx);
// 默认转写引擎 = sensevoice（装完即用）
console.log('DEFAULT_ENGINE_SENSEVOICE:', s.includes("whisperEngine: 'sensevoice'"));
// 自定义 AI provider 字段存在
console.log('HAS_CUSTOM_AI:', s.includes('customBaseUrl') && s.includes('customModel') && s.includes('customKey'));
