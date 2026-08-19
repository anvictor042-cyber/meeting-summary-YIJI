-- ============================================================
-- 议迹 · 任务会议追踪与对比 — SQLite 建表脚本
-- 数据库文件由应用自动创建于用户数据目录（%APPDATA%/议迹/meeting-tracker.db）
-- 手动初始化：sqlite3 meeting-tracker.db < schema.sql
-- ============================================================

PRAGMA foreign_keys = ON;

-- 任务
CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 会议
CREATE TABLE IF NOT EXISTS meetings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id        INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  date           TEXT NOT NULL,                -- 会议日期（自动，YYYY-MM-DD）
  topic          TEXT NOT NULL DEFAULT '',     -- 主题
  attendees      TEXT NOT NULL DEFAULT '',     -- 参会人员
  transcript     TEXT NOT NULL DEFAULT '',     -- 转写全文
  audio_file_path TEXT NOT NULL DEFAULT '',    -- 录音文件路径
  audio_duration REAL NOT NULL DEFAULT 0,      -- 录音时长（秒）
  summary        TEXT NOT NULL DEFAULT '',     -- 一句话摘要
  minutes_full   TEXT NOT NULL DEFAULT '',     -- 会议纪要完整版
  created_at     TEXT NOT NULL
);

-- 结构化纪要条目（type: topic 核心议题 / decision 关键决策 / action 待办事项 / issue 遗留问题 / note 自由笔记）
CREATE TABLE IF NOT EXISTS meeting_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id  INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK(type IN ('topic','decision','action','issue','note')),
  content     TEXT NOT NULL,
  assignee    TEXT NOT NULL DEFAULT '',        -- action: 负责人
  due_date    TEXT NOT NULL DEFAULT '',        -- action: 截止日期 YYYY-MM-DD
  status      TEXT NOT NULL DEFAULT '',        -- action: open/in_progress/paused/done；issue: open/resolved
  timestamp   REAL,                            -- 录音时间戳（秒，note 类型绑定）
  order_index INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notes_meeting ON meeting_notes(meeting_id);

-- 对比结果缓存（可选）
CREATE TABLE IF NOT EXISTS comparisons (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       INTEGER NOT NULL,
  meeting_a_id  INTEGER NOT NULL,
  meeting_b_id  INTEGER NOT NULL,
  result_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- 会议附件（语音 / Word / PDF 等）
CREATE TABLE IF NOT EXISTS attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id  INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  size        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- 应用设置（键值）
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
