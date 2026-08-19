'use strict';
// 临时审计：检查会议页顶部布局几何（真实数据库）
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { init: initDb } = require('../src/db');
const settings = require('../src/settings');

const DB = 'D:\\ClawData\\议迹\\meeting-tracker.db';

app.whenReady().then(async () => {
  await initDb(DB);
  // 注册真实 IPC 处理器（复用 main.js 逻辑太绕，这里最小实现）
  const db = require('../src/db');
  ipcMain.handle('settings:get', () => settings.getAll());
  ipcMain.handle('settings:set', (_e, p) => settings.set(p));
  ipcMain.handle('tasks:list', () => db.all(`SELECT t.*, (SELECT COUNT(*) FROM meetings m WHERE m.task_id=t.id) AS meeting_count, (SELECT MAX(m.date) FROM meetings m WHERE m.task_id=t.id) AS last_meeting_date FROM tasks t ORDER BY t.updated_at DESC`));
  ipcMain.handle('meetings:listByTask', (_e, taskId) => db.all(`SELECT m.*, (SELECT COUNT(*) FROM meeting_notes n WHERE n.meeting_id=m.id AND n.type='decision') AS decision_count, (SELECT COUNT(*) FROM meeting_notes n WHERE n.meeting_id=m.id AND n.type='action') AS action_count, (SELECT COUNT(*) FROM meeting_notes n WHERE n.meeting_id=m.id AND n.type='action' AND n.status!='done') AS pending_action_count, (SELECT COUNT(*) FROM meeting_notes n WHERE n.meeting_id=m.id AND n.type='issue') AS issue_count, (SELECT COUNT(*) FROM meeting_notes n WHERE n.meeting_id=m.id AND n.type='issue' AND n.status!='resolved') AS pending_issue_count FROM meetings m WHERE m.task_id=? ORDER BY m.date DESC, m.id DESC`, [taskId]));
  ipcMain.handle('meetings:get', (_e, id) => db.get('SELECT * FROM meetings WHERE id=?', [id]));
  ipcMain.handle('notes:listForMeeting', (_e, id) => db.all('SELECT * FROM meeting_notes WHERE meeting_id=? ORDER BY order_index ASC, id ASC', [id]));

  const win = new BrowserWindow({
    width: 1280, height: 820, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.log('[renderer] ' + message); });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise(r => setTimeout(r, 1500));

  // 进入第一个任务的第一个会议
  const diag = await win.webContents.executeJavaScript(`(async () => {
    const tasks = await window.api.tasks.list();
    if (!tasks.length) return { error: 'no tasks' };
    const ms = await window.api.meetings.listByTask(tasks[0].id);
    if (!ms.length) return { error: 'no meetings', task: tasks[0].name };
    location.hash = '#/meeting/' + ms[0].id;
    await new Promise(r => setTimeout(r, 1200));
    // 先滚动一段距离，再测量吸顶栏位置
    document.querySelector('#view').scrollTop = 500;
    await new Promise(r => setTimeout(r, 300));
    const head = document.querySelector('.page-head');
    const view = document.querySelector('#view');
    const out = {};
    if (head) {
      const r = head.getBoundingClientRect();
      const cs = getComputedStyle(head);
      out.head = { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), position: cs.position, zIndex: cs.zIndex, background: cs.backgroundImage.slice(0, 60) };
      out.headChildren = [...head.children].map(c => { const rc = c.getBoundingClientRect(); return { cls: c.className.slice(0, 30), top: Math.round(rc.top), bottom: Math.round(rc.bottom), w: Math.round(rc.width), text: (c.innerText || '').slice(0, 20) }; });
      const firstCard = document.querySelector('.card');
      if (firstCard) { const rc = firstCard.getBoundingClientRect(); out.firstCardTop = Math.round(rc.top); out.headOverlapsCard = rc.top < r.bottom; }
    }
    const save = document.querySelector('#save-state');
    if (save) { const r = save.getBoundingClientRect(); out.saveState = { visible: r.top >= 0 && r.bottom <= innerHeight, text: save.textContent }; }
    out.title = document.querySelector('.page-title') ? document.querySelector('.page-title').innerText.slice(0, 40) : null;
    out.viewport = { w: innerWidth, h: innerHeight };
    // 检查是否横向溢出
    out.overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth;
    return out;
  })()`);
  console.log('AUDIT ' + JSON.stringify(diag, null, 2));
  app.quit();
});
