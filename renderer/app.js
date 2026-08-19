'use strict';
/* 议迹 · 应用外壳：路由、导航、Toast、模态框、启动 */

// $ / $$ / esc 为 utils.js 中的全局 const，此处直接使用

const App = {
  tasks: [],
  settings: null,
  viewEl: null,

  async boot() {
    this.viewEl = $('#view');
    this.settings = await window.api.settings.get();

    // 侧边栏导航
    $$('#nav .nav-item').forEach(btn => {
      btn.addEventListener('click', () => { location.hash = btn.dataset.route; });
    });

    window.addEventListener('hashchange', () => this.route());
    await this.route();
  },

  async route() {
    const hash = (location.hash || '#/tasks').replace(/^#/, '');
    const [path, query] = hash.split('?');
    const params = new URLSearchParams(query || '');
    this.setNav(path);

    const segs = path.split('/').filter(Boolean);
    try {
      if (segs[0] === 'tasks' || segs.length === 0) {
        await Views.tasks.render();
      } else if (segs[0] === 'task' && segs[1]) {
        await Views.taskDetail.render(Number(segs[1]));
      } else if (segs[0] === 'meeting' && segs[1]) {
        await Views.meeting.render(Number(segs[1]));
      } else if (segs[0] === 'compare') {
        await Views.compare.render(Number(segs[1]), Number(params.get('a')), Number(params.get('b')));
      } else if (segs[0] === 'settings') {
        await Views.settings.render();
      } else {
        location.hash = '#/tasks';
      }
    } catch (err) {
      console.error(err);
      this.viewEl.innerHTML = `<div class="view-inner"><div class="card"><div class="page-sub" style="color:var(--danger)">页面加载失败：${esc(err.message)}</div>
        <button class="btn" onclick="location.hash='#/tasks'">返回任务列表</button></div></div>`;
    }
    this.viewEl.scrollTop = 0;
  },

  setNav(path) {
    // /task /meeting /compare 均属于“任务”分组
    const inTasks = path.startsWith('/tasks') || path.startsWith('/task') || path.startsWith('/meeting') || path.startsWith('/compare');
    $$('#nav .nav-item').forEach(b => {
      const isTasks = b.dataset.route === '#/tasks';
      b.classList.toggle('active', inTasks ? isTasks : b.dataset.route === `#${path}`);
    });
  },

  /* ---------- Toast ---------- */
  toast(message, type = 'ok', ms = 2600) {
    const root = $('#toast-root');
    const icon = type === 'ok' ? 'ph ph-check-circle' : type === 'err' ? 'ph ph-warning-circle' : 'ph ph-info';
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<i class="${icon}"></i><span>${esc(message)}</span>`;
    root.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 260);
    }, ms);
  },

  /* ---------- 模态框 ---------- */
  modal({ title, sub, body, actions = [], onClose }) {
    const root = $('#modal-root');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3 class="modal-title">${esc(title)}</h3>
        ${sub ? `<p class="modal-sub">${esc(sub)}</p>` : ''}
        <div class="modal-body"></div>
        <div class="modal-actions"></div>
      </div>`;
    const bodyEl = $('.modal-body', backdrop);
    const actionsEl = $('.modal-actions', backdrop);
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body) bodyEl.appendChild(body);
    const close = () => { backdrop.remove(); if (onClose) onClose(); };
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
    (actions.length ? actions : [{ label: '关闭', kind: 'ghost' }]).forEach(a => {
      const btn = document.createElement('button');
      btn.className = `btn ${a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : 'btn-ghost'}`;
      btn.innerHTML = a.icon ? `<i class="${a.icon}"></i>${esc(a.label)}` : esc(a.label);
      btn.addEventListener('click', async () => {
        const res = await (a.onClick ? a.onClick(close) : undefined);
        if (res !== false) close();
      });
      actionsEl.appendChild(btn);
    });
    root.appendChild(backdrop);
    return backdrop;
  },

  confirm({ title, sub, danger = false, confirmLabel = '确认' }) {
    return new Promise(resolve => {
      this.modal({
        title, sub,
        actions: [
          { label: '取消', kind: 'ghost', onClick: () => resolve(false) },
          { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: () => resolve(true) },
        ],
      });
    });
  },

  /* ---------- 共享小组件 ---------- */
  badge(label, kind) {
    return `<span class="badge ${kind || ''}">${esc(label)}</span>`;
  },

  emptyState(icon, title, desc, ctaHtml = '') {
    return `<div class="empty">
      <div class="empty-art"><i class="${icon}"></i></div>
      <p class="empty-title">${esc(title)}</p>
      <p class="empty-desc">${esc(desc)}</p>
      ${ctaHtml}
    </div>`;
  },

  pageHead(title, sub, actionsHtml = '') {
    return `<header class="page-head">
      <div><h1 class="page-title">${title}</h1>${sub ? `<p class="page-sub">${sub}</p>` : ''}</div>
      <div class="head-actions">${actionsHtml}</div>
    </header>`;
  },
};

const Views = {}; // 由各视图文件注册

// 预览自检钩子（--preview 模式）：依次渲染各视图供截图
window.__preview = {
  task: () => { location.hash = '#/task/1'; },
  meeting: () => { location.hash = '#/meeting/1'; },
  compare: () => { location.hash = '#/compare/1?a=1&b=2'; },
  settings: () => { location.hash = '#/settings'; },
};

window.App = App;
window.Views = Views;
document.addEventListener('DOMContentLoaded', () => App.boot());
