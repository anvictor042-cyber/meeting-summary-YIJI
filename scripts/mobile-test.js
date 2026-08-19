'use strict';
// 手机版 UI 端到端自检（Electron 窗口模拟手机视口 390x844）
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const URL = 'http://localhost:18790/';

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 390, height: 844, show: true,
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: true },
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) console.log('[renderer-err] ' + message);
  });
  await win.loadURL(URL);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await wait(1800);

  const run = async (label, fn) => {
    try {
      const r = await win.webContents.executeJavaScript(fn, true);
      console.log(`[OK] ${label}: ${JSON.stringify(r)}`);
    } catch (e) {
      console.log(`[FAIL] ${label}: ${e.message}`);
    }
  };

  await run('boot-tasks-view', `(() => ({
    hash: location.hash,
    navItems: document.querySelectorAll('#bottom-nav .bn-item').length,
    hasTopbar: !!document.querySelector('#topbar'),
    emptyState: document.querySelector('.empty') ? document.querySelector('.empty-title').textContent : null,
    viewW: document.querySelector('#view').clientWidth,
    bodyW: document.body.clientWidth,
  }))()`);

  await run('create-task', `(async () => {
    document.querySelector('#new-task').click();
    await new Promise(r => setTimeout(r, 300));
    const input = document.querySelector('#mt-name');
    if (!input) return 'modal missing';
    input.value = '手机端测试任务';
    document.querySelector('.modal-actions .btn-primary').click();
    await new Promise(r => setTimeout(r, 800));
    return { hash: location.hash, title: document.querySelector('#tb-title').innerText };
  })()`);

  await run('create-meeting', `(async () => {
    const btn = document.querySelector('#td-new');
    if (!btn) return 'no td-new';
    btn.click();
    await new Promise(r => setTimeout(r, 900));
    return { hash: location.hash, hasTopic: !!document.querySelector('#m-topic'), hasSpeech: !!document.querySelector('#sp-toggle'),
             aiDisabled: document.querySelector('#m-ai') ? document.querySelector('#m-ai').disabled : 'no-btn',
             sections: document.querySelectorAll('.notes-section').length };
  })()`);

  await run('transcript-enables-ai', `(async () => {
    const ta = document.querySelector('#m-transcript');
    ta.value = '今天会议讨论了手机版测试，决定明天上线。';
    ta.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 200));
    return { aiDisabled: document.querySelector('#m-ai').disabled };
  })()`);

  await run('add-note-row', `(async () => {
    const before = document.querySelectorAll('.note-row').length;
    document.querySelector('[data-add="decision"]').click();
    await new Promise(r => setTimeout(r, 300));
    const rows = document.querySelectorAll('.note-row');
    const last = rows[rows.length - 1];
    const inp = last.querySelector('[data-f="content"]');
    inp.value = '测试决策条目';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
    return { before, after: document.querySelectorAll('.note-row').length };
  })()`);

  await run('fill-topic-save', `(async () => {
    const t = document.querySelector('#m-topic');
    t.value = '手机端测试会议';
    t.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 900));
    return 'saved';
  })()`);

  await run('second-meeting-and-compare', `(async () => {
    const taskId = (await window.api.tasks.list())[0].id;
    const m2 = await window.api.meetings.create({ taskId, topic: '第二次会议', attendees: '张三' });
    await window.api.meetings.update({ id: m2.id, topic: '第二次会议', attendees: '张三', date: '2026-08-05', transcript: '今天继续讨论。', summary: '第二次会议摘要' });
    await window.api.notes.add({ meetingId: m2.id, type: 'decision', content: '采用新方案', assignee: '', dueDate: '', status: '', timestamp: null });
    await window.api.notes.add({ meetingId: m2.id, type: 'action', content: '推进落地', assignee: '李四', dueDate: '', status: 'in_progress', timestamp: null });
    const m1 = (await window.api.meetings.listByTask(taskId)).find(x => x.id !== m2.id);
    location.hash = '#/compare/' + taskId + '?a=' + m1.id + '&b=' + m2.id;
    await new Promise(r => setTimeout(r, 900));
    return { cards: document.querySelectorAll('.card').length,
             summaryList: !!document.querySelector('.summary-list'),
             saveBtn: !!document.querySelector('#c-save'),
             evoRows: document.querySelectorAll('.evo-row').length };
  })()`);

  await run('compare-selection-flow', `(async () => {
    const taskId = (await window.api.tasks.list())[0].id;
    location.hash = '#/task/' + taskId;
    await new Promise(r => setTimeout(r, 1000));
    const compareBtn = document.querySelector('#td-compare');
    if (!compareBtn) return 'no compare btn';
    if (compareBtn.disabled) return { compareDisabled: true };
    compareBtn.click();
    await new Promise(r => setTimeout(r, 1500));
    const bar = document.querySelector('.compare-bar');
    if (!bar) return { barRendered: false };
    const checks = document.querySelectorAll('.mc-check');
    checks[0].click();
    await new Promise(r => setTimeout(r, 300));
    const hint1 = document.querySelector('.compare-bar .sel').textContent;
    checks[1].click();
    await new Promise(r => setTimeout(r, 300));
    const hint2 = document.querySelector('.compare-bar .sel').textContent;
    const go = document.querySelector('#cb-go');
    const goDisabled = go ? go.disabled : null;
    return { barRendered: true, hint1, hint2, goDisabled };
  })()`);

  await win.webContents.capturePage().then(img => {
    fs.writeFileSync(path.join(__dirname, '..', 'mobile-app', 'mobile-test.png'), img.toPNG());
  });
  console.log('[OK] screenshot saved');
  app.quit();
}).catch(e => { console.log('[FATAL]', e.message); app.quit(); });
