'use strict';
/**
 * 议迹 · Electron 主进程
 * 负责：窗口管理、IPC 服务（数据库 / 录音落盘 / AI / 转写 / 设置）、预览截图模式
 */
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// 数据目录迁到 D 盘（用户要求）；D 盘不可用时回退默认位置
const DATA_DIR_D = 'D:\\ClawData\\议迹';
try {
  if (fs.existsSync('D:\\')) {
    app.setPath('userData', DATA_DIR_D);
  }
} catch (_) {}

const db = require('./src/db');
const ai = require('./src/ai');
const transcribe = require('./src/transcribe');
const settings = require('./src/settings');
const sensevoice = require('./src/sensevoice');

const PREVIEW = process.argv.includes('--preview');
const isDev = !app.isPackaged;

// 非商业使用声明（每次启动应用时弹出）
const DISCLAIMER_TEXT = `议迹（MeetingTracker）非商业使用声明

1. 本软件（含源代码、安装包、内置模型及文档，下称「本软件」）由作者开发并免费提供，仅限个人学习、研究及个人日常使用。
2. 禁止任何形式的商业使用：包括但不限于商业销售、捆绑销售、商业性技术服务、企业内商业化部署、以本软件为卖点的产品化行为，以及将本软件或其衍生版本用于盈利目的。
3. 禁止在未获作者书面授权的情况下，对本软件进行再分发、转售或以「修改后」形式对外提供商业服务。
4. 本软件按「现状」提供，作者不对其适用性、可靠性及任何使用后果承担责任。使用者因使用本软件产生的一切风险与损失自负。
5. 本声明与软件本身不可分割；任何复制、修改、使用本软件的行为，均视为已阅读并同意本声明。

如需商业合作或授权，请联系作者另行协商。`;

function showDisclaimer() {
  if (PREVIEW) return;
  try {
    dialog.showMessageBox({
      type: 'info',
      title: '非商业使用声明',
      message: '议迹（MeetingTracker）非商业使用声明',
      detail: DISCLAIMER_TEXT,
      buttons: ['我已阅读并同意'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    }).catch(() => {});
  } catch (_) {}
}

let win = null;
let recordingsDir = null;

function userDataDir() {
  const d = app.getPath('userData');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

const DEFAULT_RECORDINGS_DIR = 'D:\\ClawOutput\\议迹录音';

function getRecordingsDir() {
  const custom = settings.get('recordingsDir');
  if (custom && fs.existsSync(custom)) return custom;
  // 默认存 D 盘（用户要求）；D 盘不可用时回退到用户数据目录
  try {
    if (fs.existsSync('D:\\')) {
      if (!fs.existsSync(DEFAULT_RECORDINGS_DIR)) fs.mkdirSync(DEFAULT_RECORDINGS_DIR, { recursive: true });
      return DEFAULT_RECORDINGS_DIR;
    }
  } catch (_) {}
  const dir = path.join(userDataDir(), 'recordings');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: true, // 预览模式也显示窗口，capturePage 才能拿到真实画面
    backgroundColor: '#f4f3ee',
    title: '议迹',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 每次打开应用（创建窗口）后弹出非商业使用声明
  win.webContents.once('did-finish-load', () => setTimeout(showDisclaimer, 600));

  // 右键菜单：文本框内提供 撤销/剪切/复制/粘贴/全选（解决无法粘贴问题）
  win.webContents.on('context-menu', (_e, params) => {
    const items = [];
    if (params.isEditable) {
      items.push({ label: '撤销', click: () => win.webContents.undo() });
      items.push({ type: 'separator' });
      items.push({ label: '剪切', click: () => win.webContents.cut() });
      items.push({ label: '复制', click: () => win.webContents.copy() });
      items.push({ label: '粘贴', click: () => win.webContents.paste() });
      items.push({ label: '删除', click: () => win.webContents.delete() });
      items.push({ type: 'separator' });
      items.push({ label: '全选', click: () => win.webContents.selectAll() });
    } else {
      items.push({ label: '复制', click: () => win.webContents.copy() });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  // 权限：录音 + 剪贴板写入（复制按钮依赖），其余一律拒绝
  const allow = ['media', 'clipboard-sanitized-write', 'clipboard-write'];
  win.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
    callback(allow.includes(permission));
  });
  win.webContents.session.setPermissionCheckHandler((wc, permission) => allow.includes(permission));

  win.webContents.on('did-finish-load', () => {
    if (PREVIEW) runPreview(win);
  });

  if (PREVIEW) {
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
    win.webContents.on('preload-error', (_e, p, err) => {
      console.log('[preload-error]', p, err && err.message);
    });
  }
}

/* ---------------- IPC：任务 ---------------- */
ipcMain.handle('tasks:list', () => {
  return db.all(
    `SELECT t.*,
            (SELECT COUNT(*) FROM meetings m WHERE m.task_id = t.id) AS meeting_count,
            (SELECT MAX(m.date) FROM meetings m WHERE m.task_id = t.id) AS last_meeting_date
     FROM tasks t ORDER BY t.updated_at DESC`
  );
});
ipcMain.handle('tasks:create', (_e, { name, description }) => {
  const now = new Date().toISOString();
  const id = db.run(
    'INSERT INTO tasks (name, description, created_at, updated_at) VALUES (?,?,?,?)',
    [String(name || '').trim(), String(description || ''), now, now]
  );
  return db.get('SELECT * FROM tasks WHERE id = ?', [id]);
});
ipcMain.handle('tasks:update', (_e, { id, name, description }) => {
  const now = new Date().toISOString();
  db.run('UPDATE tasks SET name=?, description=?, updated_at=? WHERE id=?',
    [String(name || '').trim(), String(description || ''), now, id]);
  return db.get('SELECT * FROM tasks WHERE id = ?', [id]);
});
ipcMain.handle('tasks:remove', async (_e, id) => {
  const res = await dialog.showMessageBox(win, {
    type: 'warning',
    title: '删除任务',
    message: '确认删除该任务？',
    detail: '任务下的全部会议、纪要、录音文件引用将被一并删除。此操作不可撤销。',
    buttons: ['取消', '删除'],
    defaultId: 0,
    cancelId: 0,
  });
  if (res.response !== 1) return false;
  db.run('DELETE FROM tasks WHERE id=?', [id]);
  return true;
});

/* ---------------- IPC：会议 ---------------- */
ipcMain.handle('meetings:listByTask', (_e, taskId) => {
  return db.all(
    `SELECT m.*,
            (SELECT COUNT(*) FROM meeting_notes n WHERE n.meeting_id=m.id AND n.type='decision') AS decision_count,
            (SELECT COUNT(*) FROM meeting_notes n WHERE n.meeting_id=m.id AND n.type='action') AS action_count,
            (SELECT COUNT(*) FROM meeting_notes n WHERE n.meeting_id=m.id AND n.type='action' AND n.status != 'done') AS pending_action_count,
            (SELECT COUNT(*) FROM meeting_notes n WHERE n.meeting_id=m.id AND n.type='issue') AS issue_count,
            (SELECT COUNT(*) FROM meeting_notes n WHERE n.meeting_id=m.id AND n.type='issue' AND n.status != 'resolved') AS pending_issue_count
     FROM meetings m WHERE m.task_id=? ORDER BY m.date DESC, m.id DESC`,
    [taskId]
  );
});
ipcMain.handle('meetings:get', (_e, id) => {
  return db.get('SELECT * FROM meetings WHERE id=?', [id]);
});
ipcMain.handle('meetings:create', (_e, { taskId, topic, attendees, date }) => {
  const d = date || new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const id = db.run(
    'INSERT INTO meetings (task_id, date, topic, attendees, created_at) VALUES (?,?,?,?,?)',
    [taskId, d, String(topic || '').trim(), String(attendees || ''), now]);
  db.run('UPDATE tasks SET updated_at=? WHERE id=?', [now, taskId]);
  return db.get('SELECT * FROM meetings WHERE id=?', [id]);
});
ipcMain.handle('meetings:update', (_e, { id, topic, attendees, date, summary, transcript, minutes_full, audio_file_path, audio_duration }) => {
  const m = db.get('SELECT * FROM meetings WHERE id=?', [id]);
  db.run('UPDATE meetings SET topic=?, attendees=?, date=?, summary=?, transcript=?, minutes_full=?, audio_file_path=?, audio_duration=? WHERE id=?',
    [topic, attendees, date, summary, transcript,
     minutes_full !== undefined ? minutes_full : (m ? m.minutes_full : ''),
     audio_file_path !== undefined ? audio_file_path : (m ? m.audio_file_path : ''),
     audio_duration !== undefined ? audio_duration : (m ? m.audio_duration : 0),
     id]);
  if (m) db.run('UPDATE tasks SET updated_at=? WHERE id=?', [new Date().toISOString(), m.task_id]);
  return db.get('SELECT * FROM meetings WHERE id=?', [id]);
});
ipcMain.handle('meetings:remove', async (_e, id) => {
  const m = db.get('SELECT * FROM meetings WHERE id=?', [id]);
  const res = await dialog.showMessageBox(win, {
    type: 'warning',
    title: '删除会议',
    message: '确认删除该会议？',
    detail: '会议纪要、转写与录音文件引用将被一并删除。录音文件本体可手动清理。',
    buttons: ['取消', '删除'],
    defaultId: 0,
    cancelId: 0,
  });
  if (res.response !== 1) return false;
  db.run('DELETE FROM meetings WHERE id=?', [id]);
  if (m) db.run('UPDATE tasks SET updated_at=? WHERE id=?', [new Date().toISOString(), m.task_id]);
  return true;
});

/* ---------------- IPC：纪要条目 ---------------- */
ipcMain.handle('notes:listForMeeting', (_e, meetingId) => {
  return db.all('SELECT * FROM meeting_notes WHERE meeting_id=? ORDER BY order_index ASC, id ASC', [meetingId]);
});
ipcMain.handle('notes:replaceForMeeting', (_e, { meetingId, notes }) => {
  db.run('DELETE FROM meeting_notes WHERE meeting_id=?', [meetingId]);
  const stmt = db.prepare(
    'INSERT INTO meeting_notes (meeting_id, type, content, assignee, due_date, status, timestamp, order_index) VALUES (?,?,?,?,?,?,?,?)');
  (notes || []).forEach((n, i) => {
    stmt.run([meetingId, n.type, String(n.content || ''), n.assignee || '', n.due_date || '',
      n.status || '', n.timestamp ?? null, n.order_index ?? i]);
  });
  stmt.free();
  db.flush();
  return db.all('SELECT * FROM meeting_notes WHERE meeting_id=? ORDER BY order_index ASC, id ASC', [meetingId]);
});
ipcMain.handle('notes:add', (_e, { meetingId, type, content, assignee, dueDate, status, timestamp }) => {
  const max = db.get('SELECT COALESCE(MAX(order_index),0) AS m FROM meeting_notes WHERE meeting_id=?', [meetingId]);
  const id = db.run(
    'INSERT INTO meeting_notes (meeting_id, type, content, assignee, due_date, status, timestamp, order_index) VALUES (?,?,?,?,?,?,?,?)',
    [meetingId, type, String(content || ''), assignee || '', dueDate || '', status || '', timestamp ?? null, (max ? max.m : 0) + 1]);
  return db.get('SELECT * FROM meeting_notes WHERE id=?', [id]);
});
ipcMain.handle('notes:update', (_e, { id, content, assignee, dueDate, status }) => {
  db.run('UPDATE meeting_notes SET content=?, assignee=?, due_date=?, status=? WHERE id=?',
    [content, assignee || '', dueDate || '', status || '', id]);
  return db.get('SELECT * FROM meeting_notes WHERE id=?', [id]);
});
ipcMain.handle('notes:remove', (_e, id) => db.run('DELETE FROM meeting_notes WHERE id=?', [id]));

/* ---------------- IPC：对比 ---------------- */
ipcMain.handle('comparisons:get', (_e, { taskId, aId, bId }) => {
  return db.get('SELECT * FROM comparisons WHERE task_id=? AND meeting_a_id=? AND meeting_b_id=?',
    [taskId, aId, bId]);
});
ipcMain.handle('comparisons:save', (_e, { taskId, aId, bId, resultJson }) => {
  const now = new Date().toISOString();
  const existing = db.get('SELECT id FROM comparisons WHERE task_id=? AND meeting_a_id=? AND meeting_b_id=?',
    [taskId, aId, bId]);
  if (existing) {
    db.run('UPDATE comparisons SET result_json=?, created_at=? WHERE id=?', [resultJson, now, existing.id]);
  } else {
    db.run('INSERT INTO comparisons (task_id, meeting_a_id, meeting_b_id, result_json, created_at) VALUES (?,?,?,?,?)',
      [taskId, aId, bId, resultJson, now]);
  }
  return true;
});

/* ---------------- IPC：附件 ---------------- */
const extract = require('./src/extract');
const MAX_ATTACHMENT = 80 * 1024 * 1024; // 80MB

function getAttachmentsDir() {
  const dir = path.join(userDataDir(), 'attachments');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

ipcMain.handle('attachments:list', (_e, meetingId) => {
  return db.all('SELECT * FROM attachments WHERE meeting_id=? ORDER BY id DESC', [meetingId]);
});
ipcMain.handle('attachments:add', (_e, { meetingId, name, buffer }) => {
  if (!buffer || buffer.length > MAX_ATTACHMENT) throw new Error('文件不能超过 80MB');
  const safe = path.basename(String(name || 'file')).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  const filePath = path.join(getAttachmentsDir(), `${Date.now()}-${Math.round(Math.random() * 999)}-${safe}`);
  fs.writeFileSync(filePath, Buffer.from(buffer));
  const id = db.run('INSERT INTO attachments (meeting_id, name, file_path, size, created_at) VALUES (?,?,?,?,?)',
    [meetingId, safe, filePath, buffer.length, new Date().toISOString()]);
  return db.get('SELECT * FROM attachments WHERE id=?', [id]);
});
ipcMain.handle('attachments:remove', (_e, id) => {
  const a = db.get('SELECT * FROM attachments WHERE id=?', [id]);
  db.run('DELETE FROM attachments WHERE id=?', [id]);
  if (a) { try { fs.unlinkSync(a.file_path); } catch (_) {} }
  return true;
});
ipcMain.handle('attachments:open', (_e, id) => {
  const a = db.get('SELECT * FROM attachments WHERE id=?', [id]);
  if (a && fs.existsSync(a.file_path)) shell.openPath(a.file_path);
  return true;
});

/** 提取附件内容到转写文本（音频走 Whisper；docx/pdf/txt 直接解析） */
ipcMain.handle('attachments:extractToTranscript', async (_e, { id, meetingId }) => {
  const a = db.get('SELECT * FROM attachments WHERE id=?', [id]);
  if (!a || !fs.existsSync(a.file_path)) throw new Error('附件不存在');
  const ext = path.extname(a.file_path).toLowerCase();
  const m = db.get('SELECT * FROM meetings WHERE id=?', [meetingId]);
  if (!m) throw new Error('会议不存在');

  let appended = '';
  let kind = '';
  if (['.wav', '.mp3', '.m4a', '.webm', '.ogg', '.flac', '.aac', '.amr', '.wma'].includes(ext)) {
    // 语音附件：本地 Whisper 转写
    const res = await transcribe.run(a.file_path, settings.getAll());
    appended = res.text || '';
    kind = '语音转写';
  } else {
    const r = await extract.extractText(a.file_path);
    appended = r.text || '';
    kind = r.sourceType === 'unsupported' ? '' : `文档提取（${r.sourceType}）`;
  }
  if (!appended.trim()) throw new Error('未能从该附件提取到文字内容');

  const old = m.transcript || '';
  const sep = old.trim() ? (old.trim().endsWith('\n') ? '' : '\n') + `\n【${a.name} · ${kind}】\n` : `【${a.name} · ${kind}】\n`;
  const transcript = old.trim() ? old.trimEnd() + sep + appended : appended;
  db.run('UPDATE meetings SET transcript=? WHERE id=?', [transcript, meetingId]);
  return { transcript, appended, kind, appendedChars: appended.length };
});
ipcMain.handle('audio:save', (_e, { buffer, ext }) => {
  recordingsDir = getRecordingsDir();
  const name = `rec-${Date.now()}-${Math.round(Math.random() * 9999)}.${ext || 'wav'}`;
  const filePath = path.join(recordingsDir, name);
  fs.writeFileSync(filePath, Buffer.from(buffer));
  return { path: filePath, dir: recordingsDir };
});

// 长录音流式写盘：开始 / 追加 / 结束（支持连续 2 小时以上，不占内存）
let recStream = null;
ipcMain.handle('audio:startStream', () => {
  recordingsDir = getRecordingsDir();
  const name = `rec-${Date.now()}-${Math.round(Math.random() * 9999)}.webm`;
  const filePath = path.join(recordingsDir, name);
  recStream = { filePath, fd: fs.openSync(filePath, 'w'), bytes: 0 };
  return { path: filePath };
});
ipcMain.handle('audio:appendChunk', (_e, buf) => {
  if (!recStream) return { ok: false };
  const b = Buffer.from(buf);
  fs.writeSync(recStream.fd, b);
  recStream.bytes += b.length;
  return { ok: true, bytes: recStream.bytes };
});
ipcMain.handle('audio:endStream', () => {
  if (recStream) { try { fs.closeSync(recStream.fd); } catch (_) {} recStream = null; }
  return { ok: true };
});
ipcMain.handle('audio:saveTo', (_e, { path: targetPath, buffer }) => {
  fs.writeFileSync(targetPath, Buffer.from(buffer));
  return { path: targetPath, dir: path.dirname(targetPath) };
});
ipcMain.handle('audio:delete', (_e, p) => {
  try { fs.unlinkSync(p); } catch (_) {}
  return true;
});

ipcMain.handle('transcribe:run', async (_e, { audioPath }) => {
  return await transcribe.run(audioPath, settings.getAll());
});

ipcMain.handle('ai:chat', async (_e, { messages, temperature }) => {
  return await ai.chat(messages, settings.getAll(), temperature);
});
ipcMain.handle('ai:generateSummary', async (_e, meetingId) => {
  const meeting = db.get('SELECT * FROM meetings WHERE id=?', [meetingId]);
  if (!meeting) throw new Error('会议不存在');
  const notes = db.all('SELECT * FROM meeting_notes WHERE meeting_id=? ORDER BY order_index ASC', [meetingId]);
  const transcript = (meeting.transcript || '').slice(0, 30000);
  if (!transcript.trim()) throw new Error('该会议还没有转写文本，请先完成录音转写或手动粘贴转写内容。');
  return await ai.generateStructuredSummary({ meeting, notes, transcript }, settings.getAll());
});
ipcMain.handle('ai:compareSummary', async (_e, { a, b }) => {
  return await ai.generateComparisonSummary(a, b, settings.getAll());
});
ipcMain.handle('ai:test', async (_e) => {
  return await ai.test(settings.getAll());
});
ipcMain.handle('ai:listOllamaModels', async (_e) => {
  return await ai.listOllamaModels(settings.getAll());
});

/* 导出对比结果为 Markdown 报告 */
ipcMain.handle('export:saveCompare', async (_e, { md, defaultName }) => {
  const res = await dialog.showSaveDialog(win, {
    title: '保存对比结果',
    defaultPath: path.join(getRecordingsDir(), defaultName || '会议对比报告.md'),
    filters: [
      { name: 'Markdown 文档', extensions: ['md'] },
      { name: '纯文本', extensions: ['txt'] },
    ],
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  fs.writeFileSync(res.filePath, String(md || ''), 'utf8');
  return { path: res.filePath };
});

ipcMain.handle('settings:get', () => settings.getAll());
ipcMain.handle('settings:set', (_e, patch) => settings.set(patch));

/* 目录选择（录音/转写文本目录用） */
ipcMain.handle('dialog:pickDir', async (_e, { title, defaultPath } = {}) => {
  const res = await dialog.showOpenDialog(win, {
    title: title || '选择目录',
    defaultPath: defaultPath || app.getPath('home'),
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: '使用此目录',
  });
  if (res.canceled || !res.filePaths || !res.filePaths.length) return { canceled: true };
  return { path: res.filePaths[0] };
});

/* ---------------- IPC：SenseVoiceSmall 语音模块 ---------------- */

ipcMain.handle('sensevoice:status', () => sensevoice.status(settings.getAll(), userDataDir()));

const DEFAULT_TRANSCRIPTS_DIR = 'D:\\ClawOutput\\议迹转写文本';

/** 自动设置转录文本目录（不要 C 盘）：默认 D:\ClawOutput\议迹转写文本；D 盘不可用时让用户选非 C 目录 */
async function ensureTranscriptsDir() {
  const cur = settings.get('transcriptsDir');
  if (cur) return cur;
  try {
    if (fs.existsSync('D:\\')) {
      settings.set({ transcriptsDir: DEFAULT_TRANSCRIPTS_DIR });
      return DEFAULT_TRANSCRIPTS_DIR;
    }
  } catch (_) {}
  const res = await dialog.showOpenDialog(win, {
    title: '选择转录文本保存目录（请勿选择 C 盘）',
    defaultPath: path.join(app.getPath('home'), 'Documents'),
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: '使用此目录',
  });
  if (!res.canceled && res.filePaths && res.filePaths.length) {
    settings.set({ transcriptsDir: res.filePaths[0] });
    return res.filePaths[0];
  }
  return '';
}

/** 统一模型下载：SenseVoiceSmall / Whisper small / Whisper base；可选安装路径，装完自动配置并设好转录文本目录 */
ipcMain.handle('model:download', async (e, opts = {}) => {
  const send = (phase, percent, text) => {
    try { e.sender.send('sensevoice:progress', { phase, percent, text }); } catch (_) {}
  };
  try {
    const ud = userDataDir();
    const type = opts.type || 'sensevoice';
    const s = settings.getAll();
    const modelName = type === 'whisper-base' ? 'base' : type === 'whisper-small' ? 'small' : null;

    // 1) 安装路径（可选；取消则中止）
    let targetDir = modelName
      ? (s.whisperModelDir || path.join(ud, 'models', `whisper-${modelName}`))
      : (s.svModelDir || path.join(ud, 'models', 'sensevoice-small'));
    if (opts.pickDir !== false) {
      const res = await dialog.showOpenDialog(win, {
        title: modelName ? `选择 Whisper ${modelName} 模型目录` : '选择 SenseVoiceSmall 模型目录',
        defaultPath: targetDir,
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: '安装到此目录',
      });
      if (res.canceled || !res.filePaths || !res.filePaths.length) return { canceled: true };
      targetDir = res.filePaths[0];
    }

    // 2) 确保 Python 环境：优先复用已有 venv；内置 Python 已预装识别运行时则直接用；
    //    都没有才用内置 Python 创建 venv（用户无需自行安装 Python，全程离线可用）
    let python = transcribe.findVenvPython();
    if (!python) {
      const embedded = transcribe.findEmbeddedPython();
      if (embedded && await transcribe.pythonHasModule(embedded, 'funasr_onnx')) {
        python = embedded;
      } else {
        send('runtime', 0.02, '创建 Python 虚拟环境（应用内置 Python）…');
        python = await transcribe.ensureVenv((p, t) => send('runtime', p, t));
      }
    }

    // 3) 安装运行时 + 4) 下载模型
    if (modelName) {
      await sensevoice.installWhisperRuntime(python, (p, t) => send('runtime', p, t));
      await sensevoice.downloadWhisperModel(python, modelName, targetDir, (p, t) => send('model', p, t));
      settings.set({ whisperModelDir: targetDir, whisperModel: modelName, whisperEngine: 'faster-whisper' });
    } else {
      await sensevoice.installRuntime(python, (p, t) => send('runtime', p, t));
      const withPunc = opts.withPunc !== false;
      const puncDir = path.join(ud, 'models', 'sensevoice-punc');
      await sensevoice.downloadModels({ asrDir: targetDir, puncDir, withPunc, onProgress: (p, t) => send('model', p, t) });
      settings.set({ svModelDir: targetDir, svPunc: withPunc ? 'on' : 'off' });
    }

    // 5) 转录文本目录自动设为非 C 盘
    const transcriptsDir = await ensureTranscriptsDir();

    send('done', 1, '安装完成');
    return { ok: true, type, modelDir: targetDir, transcriptsDir, ...sensevoice.status(settings.getAll(), ud) };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
});

/* 剪贴板：主进程直写，绕开渲染层权限/焦点限制，100% 可靠 */
ipcMain.handle('clipboard:write', (_e, text) => {
  clipboard.writeText(String(text ?? ''));
  return true;
});
ipcMain.handle('paths:recordings', () => getRecordingsDir());
ipcMain.handle('paths:transcripts', () => transcribe.transcriptsDir(settings.getAll()));
ipcMain.handle('shell:showInFolder', (_e, p) => {
  if (p && fs.existsSync(p)) shell.showItemInFolder(p);
});
ipcMain.handle('shell:openPath', (_e, p) => {
  if (p && fs.existsSync(p)) shell.openPath(p);
  return true;
});
ipcMain.handle('shell:openSetupScript', () => {
  // 打包模式：scripts 在 asar 内无法直接打开，用 userData 中已释放的副本
  const ud = userDataDir();
  const scriptsDir = path.join(ud, 'scripts');
  const bat = path.join(scriptsDir, 'setup_whisper.bat');
  if (fs.existsSync(bat)) shell.openPath(bat);
  else if (fs.existsSync(path.join(__dirname, 'scripts', 'setup_whisper.bat'))) shell.openPath(path.join(__dirname, 'scripts', 'setup_whisper.bat'));
  else shell.openPath(scriptsDir);
});

/* ---------------- 预览截图（开发自检用） ---------------- */
async function runPreview(w) {
  const domLog = [];
  const dumpDom = async (name, stats) => {
    try {
      const info = await w.webContents.executeJavaScript(`(() => {
        const txt = document.body.innerText.replace(/\\n+/g, ' | ').slice(0, 1600);
        const cs = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : 'N/A'; };
        const audit = {
          phFont: document.fonts.check('16px Phosphor'),
          overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          btnPrimaryBg: cs('.btn-primary', 'backgroundColor'),
          btnPrimaryColor: cs('.btn-primary', 'color'),
          cardRadius: cs('.card', 'borderRadius'),
          bodyFont: cs('body', 'fontFamily').slice(0, 40),
        };
        return { hash: location.hash, cards: document.querySelectorAll('.task-card, .meeting-card').length,
                 rows: document.querySelectorAll('.note-row, .diff-row, .evo-row').length, txt, audit };
      })()`, true);
      domLog.push(`${name}: ${JSON.stringify(info)} ${stats ? JSON.stringify(stats) : ''}`);
    } catch (e) { domLog.push(`${name}: DOM_ERROR ${e.message}`); }
  };
  try {
    const shot = async (name) => {
      const img = await w.webContents.capturePage();
      fs.writeFileSync(path.join(__dirname, 'preview', `${name}.png`), img.toPNG());
      const stats = imgStats(img);
      await dumpDom(name, stats);
    };
    fs.mkdirSync(path.join(__dirname, 'preview'), { recursive: true });
    await new Promise(r => setTimeout(r, 1300));
    await shot('1-tasks');
    await w.webContents.executeJavaScript(`window.__preview && window.__preview.task()`, true);
    await new Promise(r => setTimeout(r, 900));
    await shot('2-task');
    await w.webContents.executeJavaScript(`window.__preview && window.__preview.meeting()`, true);
    await new Promise(r => setTimeout(r, 900));
    await shot('3-meeting');
    await w.webContents.executeJavaScript(`window.__preview && window.__preview.compare()`, true);
    await new Promise(r => setTimeout(r, 1100));
    await shot('4-compare');
    await w.webContents.executeJavaScript(`window.__preview && window.__preview.settings()`, true);
    await new Promise(r => setTimeout(r, 600));
    await shot('5-settings');
    // 录音目录解析自检（验证 D 盘默认目录逻辑）
    const recDir = await w.webContents.executeJavaScript(`window.api.paths.recordings()`, true);
    fs.writeFileSync(path.join(__dirname, 'preview', 'recordings-dir.txt'), String(recDir));
    // 剪贴板自检：走 IPC 直写（与复制按钮同一路径）后从主进程读回
    const tag = 'CLIPBOARD_TEST_' + Date.now();
    await w.webContents.executeJavaScript(`window.api.clipboard.write(${JSON.stringify(tag)})`, true);
    await new Promise(r => setTimeout(r, 300));
    fs.writeFileSync(path.join(__dirname, 'preview', 'clipboard.txt'), clipboard.readText());
    fs.writeFileSync(path.join(__dirname, 'preview', 'dom.txt'), domLog.join('\n'));
    console.log('PREVIEW_DONE');
    app.quit();
  } catch (err) {
    console.error('PREVIEW_ERROR', err);
    app.quit();
  }
}

/** 像素统计：用于无头验证渲染是否成功（背景占比 / 强调色 / 色彩数） */
function imgStats(img) {
  try {
    const size = img.getSize();
    const buf = img.toBitmap();
    const bg = [244, 243, 238]; // #f4f3ee
    const accent = [46, 94, 78]; // #2e5e4e
    let bgCount = 0, accentCount = 0, total = 0, inkCount = 0;
    const colors = new Set();
    for (let i = 0; i < buf.length; i += 4) {
      const r = buf[i], g = buf[i + 1], b = buf[i + 2];
      total++;
      if (Math.abs(r - bg[0]) < 12 && Math.abs(g - bg[1]) < 12 && Math.abs(b - bg[2]) < 12) bgCount++;
      if (Math.abs(r - accent[0]) < 28 && Math.abs(g - accent[1]) < 28 && Math.abs(b - accent[2]) < 28) accentCount++;
      if (r < 70 && g < 70 && b < 70) inkCount++;
      colors.add((r >> 4) + ':' + (g >> 4) + ':' + (b >> 4));
    }
    return {
      w: size.width, h: size.height,
      bgPct: Math.round(bgCount / total * 100),
      accentPx: accentCount,
      inkPct: Math.round(inkCount / total * 100),
      colorBands: colors.size,
    };
  } catch (e) { return { err: e.message }; }
}

/* ---------------- 启动 ---------------- */
app.whenReady().then(async () => {
  // 为语音识别留存目录结构（首次启动自动创建，用户可在此查看/替换模型与环境）
  try {
    const ud = userDataDir();
    for (const sub of ['whisper-venv', 'scripts', 'recordings', 'attachments', 'models']) {
      const d = path.join(ud, sub);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    }
  } catch (_) {}
  // 编辑菜单：注册 复制/粘贴/全选 等加速键（即使菜单栏隐藏也生效）
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'delete', label: '删除' },
        { type: 'separator' },
        { role: 'selectAll', label: '全选' },
      ],
    },
  ]));

  // 自检模式：--selftest-transcribe <音频路径>：用真实管线转写，结果写入 userData/selftest.txt 后退出
  const selfIdx = process.argv.indexOf('--selftest-transcribe');
  if (selfIdx !== -1) {
    const audio = process.argv[selfIdx + 1];
    const resultFile = path.join(userDataDir(), 'selftest.txt');
    if (audio) {
      try {
        if (!PREVIEW) await db.init(path.join(userDataDir(), 'meeting-tracker.db'));
        const result = await transcribe.run(audio, settings.getAll());
        fs.writeFileSync(resultFile, 'SELFTEST_OK ' + JSON.stringify({ text: (result.text || '').slice(0, 500), segments: (result.segments || []).length, language: result.language }));
      } catch (e) {
        fs.writeFileSync(resultFile, 'SELFTEST_FAIL ' + (e && e.message || e));
      }
      console.log('SELFTEST_DONE');
      app.quit();
      return;
    }
  }
  if (PREVIEW) {
    const previewDb = path.join(userDataDir(), 'preview.db');
    try { if (fs.existsSync(previewDb)) fs.unlinkSync(previewDb); } catch (_) {}
    await db.init(previewDb);
    seedPreview();
  } else {
    await db.init(path.join(userDataDir(), 'meeting-tracker.db'));
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(err => {
  console.error('启动失败', err);
  dialog.showErrorBox('议迹启动失败', String(err && err.stack || err));
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => db.flush());

function seedPreview() {
  const now = new Date().toISOString();
  const tid = db.run('INSERT INTO tasks (name, description, created_at, updated_at) VALUES (?,?,?,?)',
    ['AI 助手产品化项目', '面向内部运营团队的 AI 会议助手，核心是录音转写、结构化纪要与跨会议对比。', now, now]);

  const mkMeeting = (topic, attendees, date, transcript, summary, notes, minutesFull) => {
    const mid = db.run('INSERT INTO meetings (task_id, date, topic, attendees, transcript, summary, minutes_full, created_at) VALUES (?,?,?,?,?,?,?,?)',
      [tid, date, topic, attendees, transcript, summary, minutesFull || '', now]);
    notes.forEach((n, i) => {
      db.run('INSERT INTO meeting_notes (meeting_id, type, content, assignee, due_date, status, timestamp, order_index) VALUES (?,?,?,?,?,?,?,?)',
        [mid, n.type, n.content, n.assignee || '', n.dueDate || '', n.status || '', n.timestamp ?? null, i]);
    });
    return mid;
  };

  mkMeeting('立项评审：技术选型与范围确认', '陈默、林晚、周远、赵珂', '2026-07-10',
    '[男1] 讨论了技术选型，Electron 与 Tauri 各有取舍，最终选择 Electron 以降低团队学习成本。[女1] 转写方案上本地 Whisper 优先，云端 API 作为降级。[男2] 范围上确认首期只做单机版，不做多人协作。[女1] 那待办推进就按周维度同步吧。[男1] 同意，会后把任务拆解到人。',
    '首期范围确认：单机版、Electron 选型、本地 Whisper 优先',
    [
      { type: 'topic', content: '技术选型：Electron vs Tauri' },
      { type: 'topic', content: '转写方案：本地 Whisper 与云端降级' },
      { type: 'topic', content: '首期范围：单机版边界' },
      { type: 'decision', content: '采用 Electron，放弃 Tauri（团队学习成本更低）' },
      { type: 'decision', content: '转写默认本地 Whisper small 模型，失败时允许切换云端 API' },
      { type: 'decision', content: '首期不做多人协作与账号体系，保持免登录' },
      { type: 'action', content: '搭建项目骨架与 SQLite 数据层', assignee: '陈默', dueDate: '2026-07-15', status: 'done' },
      { type: 'action', content: '调研 Whisper 在 Windows 的部署方案并写文档', assignee: '周远', dueDate: '2026-07-17', status: 'done' },
      { type: 'action', content: '整理竞品对比功能的产品用例', assignee: '林晚', dueDate: '2026-07-18', status: 'done' },
      { type: 'issue', content: '离线机器上 Whisper 模型下载依赖网络，需要预置模型分发的方案', status: 'resolved' },
      { type: 'note', content: '赵珂提出对比视图可以参考 Git diff 的交互直觉', timestamp: 612 },
    ]);

  mkMeeting('原型评审：录音与结构化纪要体验', '陈默、林晚、周远', '2026-07-20',
    '原型演示了录音、波形与手动打点笔记。讨论重点在纪要录入效率：逐条添加太慢，希望 AI 一键生成后人工修正。波形显示获得认可，但需要显示录音时长。',
    '原型通过，纪要录入改为 AI 生成后人工修正的模式',
    [
      { type: 'topic', content: '录音与波形原型演示' },
      { type: 'topic', content: '纪要录入效率问题' },
      { type: 'decision', content: '保留逐条录入，但新增 AI 一键生成纪要作为默认路径' },
      { type: 'decision', content: '波形界面保留，补充录音时长与暂停能力' },
      { type: 'action', content: '开发 AI 纪要生成（Ollama 接入）', assignee: '陈默', dueDate: '2026-07-28', status: 'in_progress' },
      { type: 'action', content: '补充录音暂停与时长显示', assignee: '林晚', dueDate: '2026-07-25', status: 'done' },
      { type: 'action', content: '设计对比结果的状态标记规则（沿用/调整/新增/废弃）', assignee: '林晚', dueDate: '2026-07-30', status: 'open' },
      { type: 'issue', content: '长会议转写耗时，缺少进度反馈' },
      { type: 'note', content: 'AI 生成的字段需要可逐项修改，不能只给整体覆盖', timestamp: 1043 },
    ]);

  mkMeeting('冲刺评审：对比功能第一版', '陈默、林晚、周远、赵珂', '2026-08-01',
    '对比功能第一版完成，自动匹配决策与待办的状态演进。评审提出两个问题：跨会议匹配误判较多，需要相似度阈值可调；AI 改进总结在 Ollama 不可用时没有降级方案。另外确认待办需要显式状态字段。',
    '对比 v1 可用，重点修复匹配误判与 AI 降级',
    [
      { type: 'topic', content: '对比功能第一版演示' },
      { type: 'topic', content: '匹配准确率与阈值' },
      { type: 'topic', content: 'AI 不可用时的降级策略' },
      { type: 'decision', content: '相似度阈值默认 0.55，设置中可调' },
      { type: 'decision', content: '待办事项增加显式状态字段（未开始/进行中/已完成/暂停）' },
      { type: 'decision', content: 'AI 总结不可用时回退为本地规则生成摘要' },
      { type: 'action', content: '重构匹配算法，支持阈值配置', assignee: '陈默', dueDate: '2026-08-05', status: 'in_progress' },
      { type: 'action', content: '实现 AI 降级与错误提示', assignee: '周远', dueDate: '2026-08-06', status: 'open' },
      { type: 'action', content: '准备 8 月中旬的内部试用', assignee: '赵珂', dueDate: '2026-08-15', status: 'open' },
      { type: 'issue', content: '语音转写对多说话人的区分不准确' },
      { type: 'note', content: '赵珂建议在时间线上标记转折点会议', timestamp: 760 },
    ],
    `## 核心议题\n本次评审围绕对比功能第一版展开，重点讨论了跨会议匹配的准确率与 AI 不可用时的降级策略。\n\n## 关键决策\n1. 相似度阈值默认 0.55，可在设置中调整；\n2. 待办事项增加显式状态字段；\n3. AI 总结不可用时回退为本地规则生成摘要。\n\n## 待办事项\n- 陈默：重构匹配算法（8 月 5 日前）；\n- 周远：实现 AI 降级与错误提示（8 月 6 日前）；\n- 赵珂：准备 8 月中旬内部试用。\n\n## 遗留问题\n语音转写对多说话人的区分仍不准确，需进一步调研。`);

  return tid;
}
