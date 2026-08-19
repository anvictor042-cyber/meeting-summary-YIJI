'use strict';
/* 议迹 · 任务详情：会议时间线 + 对比选择 */

Views.taskDetail = {
  task: null,
  meetings: [],
  sel: new Set(),   // 对比选择中的会议 id
  compareMode: false,
  turnpoints: new Set(),

  async render(id, opts = {}) {
    const view = App.viewEl;
    this.task = (await window.api.tasks.list()).find(t => t.id === id);
    if (!this.task) { location.hash = '#/tasks'; return; }
    this.meetings = await window.api.meetings.listByTask(id);
    this.selOrder = []; // 有序选择：[旧会议id, 新会议id]
    this.compareMode = !!opts.compare; // 进入对比模式由调用方指定，render 不再擅自重置

    // 相邻会议快检，标记转折点（决策新增/调整/废弃 ≥ 2）
    this.turnpoints = new Set();
    for (let i = 0; i < this.meetings.length - 1; i++) {
      const older = this.meetings[i + 1], newer = this.meetings[i]; // 列表按日期倒序
      if (await this.isTurnpoint(older, newer)) this.turnpoints.add(newer.id);
    }

    view.innerHTML = `<div class="view-inner" id="td-inner">${this.html()}</div>`;
    this.bind();
  },

  html() {
    const t = this.task;
    const meetings = this.meetings;
    const turnpoints = this.turnpoints;

    const card = (m, idx) => {
      const isTurn = turnpoints.has(m.id);
      const isSel = this.selOrder.includes(m.id);
      // 待办/遗留全部完成 → 会议完成
      const allDone = (m.action_count || 0) + (m.issue_count || 0) > 0
        && !(m.pending_action_count || 0) && !(m.pending_issue_count || 0);
      const chips = [];
      if (m.decision_count) chips.push(`<span class="chip">决 ${m.decision_count}</span>`);
      if (m.action_count) chips.push(`<span class="chip">待 ${m.pending_action_count || 0}</span>`);
      if (m.issue_count) chips.push(`<span class="chip">遗 ${m.pending_issue_count || 0}</span>`);
      return `
      <div class="meeting-card ${isSel ? 'selected' : ''}" data-id="${m.id}" style="animation-delay:${Math.min(idx * 40, 240)}ms">
        <button class="mc-check" data-check="${m.id}" title="选择对比"><i class="ph ph-check"></i></button>
        <div class="mc-top">
          <span class="mc-date">${esc(m.date)}</span>
          ${isTurn ? '<span class="badge warn"><i class="ph ph-signpost"></i>转折点</span>' : ''}
          ${allDone ? '<span class="badge ok"><i class="ph ph-check-circle"></i>会议完成</span>' : ''}
          <h3 class="mc-topic">${esc(m.topic || '未命名会议')}</h3>
        </div>
        <p class="mc-summary">${esc(m.summary || '尚未生成一句话摘要，可在会议页填写或由 AI 生成。')}</p>
        <div class="mc-foot">
          <span class="badge accent"><i class="ph ph-chats-circle"></i>${esc(relDate(m.date))}</span>
          <div class="mc-chips">${chips.join('')}</div>
        </div>
      </div>`;
    };

    const selN = this.selOrder.length;
    const selHint = selN === 0
      ? '请先选择 <b>旧会议</b>（时间较早的一场）'
      : selN === 1
        ? '已选旧会议 ✓　请选择 <b>新会议</b>（时间较晚的一场）'
        : '已选 <b>2/2</b> 场（旧 → 新），点击开始对比';
    const compareBar = this.compareMode ? `
      <div class="compare-bar">
        <span class="sel">${selHint}</span>
        <span class="spacer"></span>
        <button class="btn btn-cancel" id="cb-cancel"><i class="ph ph-x"></i>取消</button>
        <button class="btn" id="cb-go" ${selN !== 2 ? 'disabled' : ''}><i class="ph ph-arrows-left-right"></i>开始对比</button>
      </div>` : '';

    return `
      ${App.pageHead(
        `<a class="back-link" href="#/tasks"><i class="ph ph-arrow-left"></i></a> ${esc(t.name)}`,
        `${t.description ? esc(t.description) + ' · ' : ''}共 ${meetings.length} 次会议`,
        this.compareMode
          ? `<button class="btn" id="td-new" disabled><i class="ph ph-plus"></i>新建会议</button>
             <button class="btn btn-primary" id="td-exit-compare"><i class="ph ph-x"></i>退出对比</button>`
          : `<button class="btn" id="td-compare" ${meetings.length < 2 ? 'disabled' : ''}><i class="ph ph-arrows-left-right"></i>选择对比</button>
             <button class="btn btn-primary" id="td-new"><i class="ph ph-plus"></i>新建会议</button>`
      )}
      ${meetings.length === 0
        ? App.emptyState('ph ph-chats-circle', '这个任务还没有会议',
            '点击“新建会议”开始第一次记录。录音转写、结构化纪要与跨会议对比都会在这里沉淀。',
            `<button class="btn btn-primary" id="td-new-empty"><i class="ph ph-plus"></i>新建会议</button>`)
        : `<div class="timeline ${this.compareMode ? 'compare-mode' : ''}">
             ${meetings.map(card).join('')}
           </div>
           ${compareBar}`}`;
  },

  async isTurnpoint(older, newer) {
    const [oa, na] = await Promise.all([
      window.api.notes.listForMeeting(older.id),
      window.api.notes.listForMeeting(newer.id),
    ]);
    const r = CompareEngine.diff({ ...older, notes: oa }, { ...newer, notes: na }, 0.55);
    return r.decisions.filter(d => d.mark === 'new' || d.mark === 'adjusted' || d.mark === 'deprecated').length >= 2;
  },

  bind() {
    const view = App.viewEl;
    $('#td-new', view)?.addEventListener('click', () => this.newMeeting());
    $('#td-new-empty', view)?.addEventListener('click', () => this.newMeeting());
    $('#td-compare', view)?.addEventListener('click', () => { this.compareMode = true; this.render(this.task.id, { compare: true }); });
    $('#td-exit-compare', view)?.addEventListener('click', () => this.render(this.task.id));
    $('#cb-cancel', view)?.addEventListener('click', () => this.render(this.task.id));
    $('#cb-go', view)?.addEventListener('click', () => {
      const [a, b] = this.selOrder;
      if (!a || !b) return;
      location.hash = `#/compare/${this.task.id}?a=${a}&b=${b}`;
    });

    $$('.meeting-card', view).forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('.mc-check')) return;
        location.hash = `#/meeting/${el.dataset.id}`;
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.target.closest('.mc-check')) location.hash = `#/meeting/${el.dataset.id}`;
      });
    });
    $$('.mc-check', view).forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = Number(btn.dataset.check);
        const idx = this.selOrder.indexOf(id);
        const card = btn.closest('.meeting-card');
        if (idx >= 0) {
          this.selOrder.splice(idx, 1);
          card.classList.remove('selected');
          App.toast('已取消选择');
        } else {
          if (this.selOrder.length >= 2) { App.toast('最多选择两场会议进行对比', 'err'); return; }
          this.selOrder.push(id);
          card.classList.add('selected');
          App.toast(this.selOrder.length === 1 ? '已选择旧会议，请再选择新会议' : '已选择新会议，可以开始对比');
        }
        const go = $('#cb-go', view);
        if (go) go.disabled = this.selOrder.length !== 2;
        const hint = $('.compare-bar .sel', view);
        if (hint) {
          const n = this.selOrder.length;
          hint.innerHTML = n === 0
            ? '请先选择 <b>旧会议</b>（时间较早的一场）'
            : n === 1
              ? '已选旧会议 ✓　请选择 <b>新会议</b>（时间较晚的一场）'
              : '已选 <b>2/2</b> 场（旧 → 新），点击开始对比';
        }
      });
    });
  },

  async newMeeting() {
    const m = await window.api.meetings.create({ taskId: this.task.id, topic: '', attendees: '' });
    App.toast('会议已创建');
    location.hash = `#/meeting/${m.id}`;
  },
};
