'use strict';
/**
 * 设置存取（存于 SQLite settings 表）
 */
const DEFAULTS = {
  aiProvider: 'ollama',                 // ollama | deepseek | openai | custom（任意 OpenAI 兼容端点）
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'qwen2.5:7b',
  deepseekBaseUrl: 'https://api.deepseek.com',
  deepseekModel: 'deepseek-chat',
  deepseekKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o-mini',
  openaiKey: '',
  // 自定义 OpenAI 兼容服务（不限厂商：Ollama / LM Studio / vLLM / 通义 / Moonshot / 智谱 / 本地网关等）
  customBaseUrl: '',
  customModel: '',
  customKey: '',
  // 转写
  whisperEngine: 'sensevoice',         // sensevoice（默认，内置模型装完即用）| auto | faster-whisper | whisper-cpp | openai-whisper
  whisperModel: 'small',
  whisperDiarize: 'on',                 // on | off：说话人区分（男1/女1 标记）
  whisperPython: '',                    // 显式指定 venv python 路径，留空自动探测
  whisperCppPath: '',                   // whisper.cpp 的 whisper-cli.exe 路径
  // SenseVoiceSmall 语音模块
  svModelDir: '',                       // 模型安装路径，留空 = userData\models\sensevoice-small
  svPunc: 'on',                         // on | off：标点恢复模型（可选组件）
  whisperModelDir: '',                  // Whisper 模型缓存目录（下载后自动配置）
  // 存储
  recordingsDir: '',
  transcriptsDir: '',                   // 转写文本目录，留空默认 D:\ClawOutput\议迹转写文本
  // 对比
  matchThreshold: '0.55',
  // AI 提取精准度：conservative 保守 | balanced 标准 | thorough 全面
  aiPrecision: 'thorough',
  // 界面
  theme: 'light',
};

let cache = {};
let dbRef = null; // 供 set() 持久化到数据库

function init(db) {
  dbRef = db;
  const rows = db.all('SELECT key, value FROM settings');
  cache = { ...DEFAULTS };
  for (const r of rows) cache[r.key] = r.value;
}

function getAll() { return { ...cache }; }

function get(key) { return cache[key] ?? DEFAULTS[key]; }

function set(patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in DEFAULTS)) continue;
    cache[k] = String(v);
    // 持久化：写入 settings 表（重启后保留，避免每次重新输入 API Key）
    try {
      if (dbRef) {
        dbRef.run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, String(v)]);
      }
    } catch (e) {
      console.error('设置持久化失败', e);
    }
  }
  return getAll();
}

module.exports = { init, getAll, get, set, DEFAULTS };
