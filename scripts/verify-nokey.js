// 验证打包应用不含任何 API Key（默认 Key 为空、无测试/真实 Key 残留）
const asar = require('@electron/asar');
const ASAR = 'C:/Users/anweijian/AppData/Local/Programs/meeting-tracker/resources/app.asar';

const files = ['src/settings.js', 'src/ai.js', 'preload.js', 'renderer/settings.js', 'main.js', 'package.json'];
let hasKey = false;
for (const f of files) {
  const s = asar.extractFile(ASAR, f).toString('utf8');
  if (/sk-[A-Za-z0-9]{8,}/.test(s)) { console.log('KEY_FOUND_IN:', f); hasKey = true; }
}
console.log('NO_EMBEDDED_KEY:', !hasKey);
const s = asar.extractFile(ASAR, 'src/settings.js').toString('utf8');
console.log('DEFAULTS_EMPTY_KEYS:', s.includes("deepseekKey: ''") && s.includes("openaiKey: ''"));
