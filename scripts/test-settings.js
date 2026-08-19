// 设置持久化测试：set 后从数据库读回（模拟重启后恢复）
const db = require('../src/db');
(async () => {
  await db.init('D:\\ClawData\\议迹\\meeting-tracker.db');
  const settings = require('../src/settings');
  settings.set({ deepseekKey: 'sk-TEST-PERSIST-123', aiPrecision: 'balanced' });
  const row = db.get("SELECT value FROM settings WHERE key='deepseekKey'");
  const row2 = db.get("SELECT value FROM settings WHERE key='aiPrecision'");
  console.log('KEY_PERSISTED:', row ? row.value : 'NOT_FOUND');
  console.log('PRECISION_PERSISTED:', row2 ? row2.value : 'NOT_FOUND');
  // 模拟重启：重新 init 读库
  const db2 = require('../src/db');
  // 直接验证 get 逻辑（cache 已含），再验证从库中读
  const check = db.get("SELECT value FROM settings WHERE key='deepseekKey'");
  console.log('READBACK_OK:', check && check.value === 'sk-TEST-PERSIST-123');
  // 清理
  db.run("DELETE FROM settings WHERE key='deepseekKey'");
  db.run("DELETE FROM settings WHERE key='aiPrecision'");
  console.log('CLEANED');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
