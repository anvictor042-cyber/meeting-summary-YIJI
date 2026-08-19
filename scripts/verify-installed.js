// 验证已安装应用：版本 + 零 Key + 关键文件
const asar = require('@electron/asar');
const ASAR = 'C:/Users/anweijian/AppData/Local/Programs/meeting-tracker/resources/app.asar';
const pkg = JSON.parse(asar.extractFile(ASAR, 'package.json').toString('utf8'));
console.log('INSTALLED_VERSION:', pkg.version, '| PRODUCT:', pkg.productName);
let hasKey = false;
for (const f of ['src/settings.js', 'src/ai.js', 'main.js', 'renderer/settings.js', 'preload.js']) {
  const s = asar.extractFile(ASAR, f).toString('utf8');
  if (/sk-[A-Za-z0-9]{8,}/.test(s)) { console.log('KEY_FOUND_IN:', f); hasKey = true; }
}
console.log('INSTALLED_NO_EMBEDDED_KEY:', !hasKey);
console.log('HAS_SH:', asar.listPackage(ASAR).includes('\\scripts\\setup_whisper.sh'));
const fs = require('fs');
const base = 'C:/Users/anweijian/AppData/Local/Programs/meeting-tracker/resources';
console.log('INSTALLED_EMBEDDED_PYTHON:', fs.existsSync(base + '/python/python.exe'));
console.log('INSTALLED_BUNDLED_MODEL:', fs.existsSync(base + '/models/sensevoice-small/model_quant.onnx'));
const settingsSrc = asar.extractFile(ASAR, 'src/settings.js').toString('utf8');
console.log('INSTALLED_DEFAULT_ENGINE_SENSEVOICE:', settingsSrc.includes("whisperEngine: 'sensevoice'"));
console.log('INSTALLED_HAS_CUSTOM_AI:', settingsSrc.includes('customBaseUrl') && settingsSrc.includes('customModel'));
