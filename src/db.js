'use strict';
/**
 * SQLite 数据层（基于 sql.js，纯 WASM，无需原生编译）
 * 每次写操作后立即导出落盘，保证本地数据安全。
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  attendees TEXT NOT NULL DEFAULT '',
  transcript TEXT NOT NULL DEFAULT '',
  audio_file_path TEXT NOT NULL DEFAULT '',
  audio_duration REAL NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  minutes_full TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meeting_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('topic','decision','action','issue','note')),
  content TEXT NOT NULL,
  assignee TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  timestamp REAL,
  order_index INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notes_meeting ON meeting_notes(meeting_id);
CREATE TABLE IF NOT EXISTS comparisons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  meeting_a_id INTEGER NOT NULL,
  meeting_b_id INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`;

let db = null;
let dbPath = null;
let SQL = null;

async function init(filePath) {
  SQL = await initSqlJs();
  dbPath = filePath;
  if (fs.existsSync(filePath)) {
    db = new SQL.Database(fs.readFileSync(filePath));
  } else {
    db = new SQL.Database();
  }
  db.exec(SCHEMA);
  // 老库迁移：补充新列
  try {
    const cols = db.exec('PRAGMA table_info(meetings)')[0]?.values || [];
    if (!cols.some(c => c[1] === 'minutes_full')) {
      db.exec("ALTER TABLE meetings ADD COLUMN minutes_full TEXT NOT NULL DEFAULT ''");
    }
  } catch (_) {}
  flush();
  // 延迟加载 settings（避免循环依赖）
  const settings = require('./settings');
  settings.init({ all: (...a) => all(...a), get: (...a) => get(...a), run: (...a) => run(...a) });
}

function flush() {
  if (!db || !dbPath) return;
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

/** 查询多行 */
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

/** 查询单行 */
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows[0] || null;
}

/** 执行写语句，返回 lastInsertRowid */
function run(sql, params = []) {
  db.run(sql, params);
  const id = db.exec('SELECT last_insert_rowid() AS id')[0]?.values?.[0]?.[0] ?? null;
  flush();
  return id;
}

/** 批量写，返回影响行数 */
function exec(sql, params = []) {
  db.run(sql, params);
  flush();
  return db.getRowsModified();
}

function prepare(sql) {
  const stmt = db.prepare(sql);
  return {
    run: (params = []) => { stmt.bind(params); stmt.step(); },
    free: () => { stmt.free(); },
  };
}

module.exports = { init, flush, all, get, run, exec, prepare };
