'use strict';
/* 议迹 · 任务列表视图 */

Views.tasks = {
  async render() {
    const view = App.viewEl;
    const tasks = await window.api.tasks.list();
    App.tasks = tasks; // 供编辑弹窗使用（之前漏赋值导致铅笔图标点不动）

    const card = (t) => `
      <article class="task-card" data-id="${t.id}" tabindex="0" role="link" aria-label="进入任务：${esc(t.name)}">
        <button class="task-edit" data-edit="${t.id}" title="编辑任务" aria-label="编辑任务"><i class="ph ph-pencil-simple"></i></button>
        <h2 class="task-name">${esc(t.name)}</h2>
        <p class="task-desc">${esc(t.description || '暂无描述')}</p>
        <div class="task-meta">
          <span>${t.meeting_count || 0} 次会议</span>
          <span class="dot-sep"></span>
          ${t.last_meeting_date
            ? `<span>最近会议 <span class="mono">${esc(t.last_meeting_date)}</span></span>`
            : '<span>尚无会议</span>'}
        </div>
      </article>`;

    view.innerHTML = `<div class="view-inner">
      ${App.pageHead('任务', '围绕一个任务记录多次会议，自动对比变化与改进', `
        <button class="btn btn-primary" id="new-task"><i class="ph ph-plus"></i>新建任务</button>`)}
      ${tasks.length
        ? `<div class="task-grid">${tasks.map(card).join('')}</div>`
        : App.emptyState('ph ph-list-checks', '还没有任务',
            '创建一个任务，然后开始记录会议。每次会议都会沉淀结构化纪要，并自动与之前的会议对比。',
            `<button class="btn btn-primary" id="new-task-empty"><i class="ph ph-plus"></i>新建任务</button>`)}
    </div>`;

    const openNew = () => this.newTaskModal();
    $('#new-task', view)?.addEventListener('click', openNew);
    $('#new-task-empty', view)?.addEventListener('click', openNew);

    $$('.task-card', view).forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('.task-edit')) return;
        location.hash = `#/task/${el.dataset.id}`;
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.target.closest('.task-edit')) location.hash = `#/task/${el.dataset.id}`;
      });
    });
    $$('.task-edit', view).forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); this.editTaskModal(Number(btn.dataset.edit)); });
    });
  },

  newTaskModal() {
    App.modal({
      title: '新建任务',
      sub: '任务是你追踪会议演进的容器，例如一个项目或一个专项。',
      body: `
        <div class="field"><label for="mt-name">任务名称</label>
          <input class="input" id="mt-name" placeholder="例如：AI 助手产品化项目" autofocus></div>
        <div class="field" style="margin-top:14px"><label for="mt-desc">任务描述（可选）</label>
          <textarea class="textarea" id="mt-desc" rows="3" placeholder="一句话说明这个任务的目标"></textarea></div>`,
      actions: [
        { label: '取消', kind: 'ghost' },
        { label: '创建任务', kind: 'primary', icon: 'ph ph-plus', onClick: async (close) => {
          const name = $('#mt-name').value.trim();
          if (!name) { App.toast('请填写任务名称', 'err'); return false; }
          const t = await window.api.tasks.create({ name, description: $('#mt-desc').value.trim() });
          App.toast(`已创建任务「${t.name}」`);
          close();
          location.hash = `#/task/${t.id}`;
        } },
      ],
    });
  },

  editTaskModal(id) {
    const task = App.tasks.find(t => t.id === id);
    if (!task) return;
    App.modal({
      title: '编辑任务',
      sub: task.name,
      body: `
        <div class="field"><label for="et-name">任务名称</label>
          <input class="input" id="et-name" value="${esc(task.name)}"></div>
        <div class="field" style="margin-top:14px"><label for="et-desc">任务描述（可选）</label>
          <textarea class="textarea" id="et-desc" rows="3">${esc(task.description || '')}</textarea></div>`,
      actions: [
        { label: '取消', kind: 'ghost' },
        { label: '删除任务', kind: 'danger', icon: 'ph ph-trash', onClick: async (close) => {
          const ok = await window.api.tasks.remove(id);
          if (!ok) return false;
          close(); App.toast('任务已删除'); this.render();
        } },
        { label: '保存', kind: 'primary', icon: 'ph ph-check', onClick: async (close) => {
          const name = $('#et-name').value.trim();
          if (!name) { App.toast('请填写任务名称', 'err'); return false; }
          await window.api.tasks.update({ id, name, description: $('#et-desc').value.trim() });
          App.toast('已保存');
          close();
          this.render();
        } },
      ],
    });
  },
};
