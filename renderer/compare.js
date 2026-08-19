'use strict';
/* 议迹 · 会议对比：本地确定性演进分析 + AI 改进总结 */

/** 总结文本 → 要点列表（每条一行；长段落自动按句切分） */
function renderSummaryList(text) {
  let lines = String(text || '').split(/\n+/).map(l => l.trim().replace(/^[-•*]\s*/, '')).filter(Boolean);
  if (lines.length === 1 && lines[0].length > 60) {
    // AI 偶尔仍返回整段：按句号切分为要点
    lines = lines[0].split(/[。；;]+/).map(l => l.trim()).filter(Boolean).slice(0, 8);
  }
  if (!lines.length) return '<p class="empty-txt">暂无总结内容</p>';
  return '<ul class="summary-list">' + lines.map(l => `<li>${esc(l)}</li>`).join('') + '</ul>';
}

const CompareEngine = {
  /** a=旧会议, b=新会议, threshold=相似度阈值 */
  diff(a, b, threshold = 0.55) {
    const A = (a.notes || []), B = (b.notes || []);
    const byType = (arr, t) => arr.filter(n => n.type === t);
    const aT = byType(A, 'topic'), bT = byType(B, 'topic');
    const aD = byType(A, 'decision'), bD = byType(B, 'decision');
    const aA = byType(A, 'action'), bA = byType(B, 'action');
    const aI = byType(A, 'issue'), bI = byType(B, 'issue');

    // ---- 议题变化 ----
    const topics = [];
    const bTUsed = new Set();
    for (const ta of aT) {
      let best = null, bestSim = 0;
      bT.forEach((tb, i) => {
        if (bTUsed.has(i)) return;
        const s = Utils.sim(ta.content, tb.content);
        if (s > bestSim) { bestSim = s; best = i; }
      });
      if (best != null && bestSim >= threshold * 0.75) {
        bTUsed.add(best);
        topics.push({
          kind: 'pair', sim: bestSim,
          a: ta.content, b: bT[best].content,
          aDiff: Utils.diffHtml(Utils.charDiff(ta.content, bT[best].content)),
          bDiff: Utils.diffHtml(Utils.charDiff(bT[best].content, ta.content)),
        });
      } else {
        topics.push({ kind: 'gone', a: ta.content });
      }
    }
    bT.forEach((tb, i) => {
      if (!bTUsed.has(i)) topics.push({ kind: 'new', b: tb.content });
    });

    // ---- 决策演进 ----
    const decisions = [];
    const bDUsed = new Set();
    for (const da of aD) {
      let best = null, bestSim = 0;
      bD.forEach((db, i) => {
        if (bDUsed.has(i)) return;
        const s = Utils.sim(da.content, db.content);
        if (s > bestSim) { bestSim = s; best = i; }
      });
      if (best != null && bestSim >= threshold) {
        bDUsed.add(best);
        decisions.push({ mark: 'kept', text: da.content });
      } else if (best != null && bestSim >= threshold * 0.6) {
        bDUsed.add(best);
        decisions.push({ mark: 'adjusted', a: da.content, b: bD[best].content });
      } else {
        decisions.push({ mark: 'deprecated', text: da.content });
      }
    }
    bD.forEach((db, i) => {
      if (!bDUsed.has(i)) decisions.push({ mark: 'new', text: db.content });
    });

    // ---- 待办追踪 ----
    const actions = [];
    const bAUsed = new Set();
    for (const aa of aA) {
      let best = null, bestSim = 0;
      bA.forEach((ab, i) => {
        if (bAUsed.has(i)) return;
        const s = Utils.sim(aa.content, ab.content) * (aa.assignee && ab.assignee === aa.assignee ? 1.08 : 1);
        if (s > bestSim) { bestSim = s; best = i; }
      });
      if (best != null && bestSim >= threshold) {
        bAUsed.add(best);
        const st = bA[best].status;
        actions.push({
          mark: st === 'done' ? 'done' : st === 'paused' ? 'paused' : 'ongoing',
          a: aa.content, aAssignee: aa.assignee, aDue: aa.due_date,
          content: bA[best].content, assignee: bA[best].assignee, due: bA[best].due_date,
          sim: bestSim,
        });
      } else {
        actions.push({
          mark: aa.status === 'done' ? 'done' : 'dropped',
          a: aa.content, aAssignee: aa.assignee, aDue: aa.due_date,
          content: aa.content, assignee: aa.assignee, due: aa.due_date,
        });
      }
    }
    bA.forEach((ab, i) => {
      if (!bAUsed.has(i)) actions.push({ mark: 'new', content: ab.content, assignee: ab.assignee, due: ab.due_date });
    });

    // ---- 遗留问题 ----
    const issues = [];
    const bIUsed = new Set();
    for (const ia of aI) {
      let best = null, bestSim = 0;
      bI.forEach((ib, i) => {
        if (bIUsed.has(i)) return;
        const s = Utils.sim(ia.content, ib.content);
        if (s > bestSim) { bestSim = s; best = i; }
      });
      if (best != null && bestSim >= threshold) {
        bIUsed.add(best);
        issues.push({ mark: 'remaining', content: bI[best].content });
      } else {
        issues.push({ mark: ia.status === 'resolved' ? 'resolved' : 'unfollowed', content: ia.content });
      }
    }
    bI.forEach((ib, i) => {
      if (!bIUsed.has(i)) issues.push({ mark: 'new', content: ib.content });
    });

    return { topics, decisions, actions, issues };
  },

  /** 本地启发式总结（AI 不可用时展示，要点式） */
  heuristicSummary(r) {
    const cnt = (arr, mark) => arr.filter(x => x.mark === mark).length;
    const lines = [];
    const dK = cnt(r.decisions, 'kept'), dA = cnt(r.decisions, 'adjusted'),
          dN = cnt(r.decisions, 'new'), dD = cnt(r.decisions, 'deprecated');
    if (r.decisions.length) {
      const parts = [];
      if (dK) parts.push(`${dK} 项决策保持不变`);
      if (dA) parts.push(`${dA} 项已调整`);
      if (dN) parts.push(`${dN} 项新增`);
      if (dD) parts.push(`${dD} 项已废弃`);
      lines.push(`决策层面：${parts.join('，')}。`);
    }
    const aDone = cnt(r.actions, 'done'), aOn = cnt(r.actions, 'ongoing'),
          aP = cnt(r.actions, 'paused'), aNew = cnt(r.actions, 'new'), aDrop = cnt(r.actions, 'dropped');
    if (r.actions.length) {
      const parts = [];
      if (aDone) parts.push(`${aDone} 项已完成`);
      if (aOn) parts.push(`${aOn} 项仍在推进`);
      if (aP) parts.push(`${aP} 项暂停`);
      if (aNew) parts.push(`${aNew} 项新增`);
      if (aDrop) parts.push(`${aDrop} 项未延续`);
      lines.push(`待办推进：${parts.join('，')}。`);
    }
    const iR = cnt(r.issues, 'remaining'), iRes = cnt(r.issues, 'resolved'),
          iU = cnt(r.issues, 'unfollowed'), iN = cnt(r.issues, 'new');
    if (r.issues.length) {
      const parts = [];
      if (iRes) parts.push(`${iRes} 项已解决`);
      if (iR) parts.push(`${iR} 项仍遗留`);
      if (iN) parts.push(`${iN} 项新出现`);
      if (iU) parts.push(`${iU} 项未再提及`);
      lines.push(`遗留问题：${parts.join('，')}。`);
    }
    if (dN + dA + dD > 0) lines.push('建议优先推进新增与调整后决策的落地，并在下次会议确认执行情况。');
    return lines.join('\n') || '两次会议暂无结构化数据，先在会议页补充纪要后再对比。';
  },

  badges: {
    kept:       ['保持不变', ''],
    adjusted:   ['已调整', 'warn'],
    new:        ['新增', 'accent'],
    deprecated: ['已废弃', 'danger'],
    done:       ['已完成', 'ok'],
    ongoing:    ['进行中', 'info'],
    paused:     ['暂停', 'warn'],
    dropped:    ['未延续', 'warn'],
    remaining:  ['仍遗留', 'warn'],
    resolved:   ['已解决', 'ok'],
    unfollowed: ['未再提及', 'warn'],
  },

  badgeHtml(mark) {
    const [label, kind] = this.badges[mark] || [mark, ''];
    return App.badge(label, kind);
  },
};

/* ---------------- 对比视图 ---------------- */
Views.compare = {
  task: null,
  a: null, b: null,
  aNotes: [], bNotes: [],
  result: null,
  aiSummary: '',

  async render(taskId, aId, bId) {
    if (!taskId || !aId || !bId) { location.hash = '#/tasks'; return; }
    const view = App.viewEl;
    const tasks = await window.api.tasks.list();
    this.task = tasks.find(t => t.id === taskId) || { name: '任务' };
    this.a = await window.api.meetings.get(aId);
    this.b = await window.api.meetings.get(bId);
    this.aNotes = await window.api.notes.listForMeeting(aId);
    this.bNotes = await window.api.notes.listForMeeting(bId);
    this.result = CompareEngine.diff({ ...this.a, notes: this.aNotes }, { ...this.b, notes: this.bNotes },
      Number(App.settings.matchThreshold || 0.55));

    // 尝试读取缓存
    const cached = await window.api.comparisons.get({ taskId, aId, bId });
    if (cached) {
      try { this.aiSummary = JSON.parse(cached.result_json).summary || ''; } catch (_) {}
    }
    const heur = CompareEngine.heuristicSummary(this.result);

    view.innerHTML = `<div class="view-inner">${this.html(heur)}</div>`;
    this.bind(heur);
  },

  html(heur) {
    const { a, b } = this;
    const r = this.result;

    const topicRows = r.topics.map(t => {
      if (t.kind === 'pair') return `
        <div class="diff-row">
          <div class="diff-cell">${t.aDiff}</div>
          <div class="diff-cell">${t.bDiff} ${App.badge('更新', 'warn')}</div>
        </div>`;
      if (t.kind === 'new') return `
        <div class="diff-row">
          <div class="diff-cell"><span class="empty-txt">—</span></div>
          <div class="diff-cell">${esc(t.b)} ${App.badge('新增', 'accent')}</div>
        </div>`;
      return `
        <div class="diff-row">
          <div class="diff-cell">${esc(t.a)} ${App.badge('未再讨论', 'warn')}</div>
          <div class="diff-cell"><span class="empty-txt">—</span></div>
        </div>`;
    }).join('') || `<div class="diff-row"><div class="diff-cell empty-txt" style="grid-column:1/-1;padding:8px 0">两场会议均未记录核心议题</div></div>`;

    const cell = (html, span) => `<div class="diff-cell${span ? ' span2' : ''}">${html}</div>`;
    const dash = () => `<span class="empty-txt">—</span>`;
    const tags = (assignee, due) =>
      `${assignee ? `<span class="tag">负责人：${esc(assignee)}</span>` : ''}${due ? `<span class="tag">截止：${esc(due)}</span>` : ''}`;

    // 决策演进：旧会议在左，新会议在右
    const decisionRows = r.decisions.map(d => {
      if (d.mark === 'kept') return `<div class="diff-row">${cell(esc(d.text))}${cell(`${esc(d.text)} ${CompareEngine.badgeHtml('kept')}`)}</div>`;
      if (d.mark === 'adjusted') return `<div class="diff-row">${cell(`<span class="cell-tag old">旧</span>${esc(d.a)}`)}${cell(`<span class="cell-tag new">新</span>${esc(d.b)} ${CompareEngine.badgeHtml('adjusted')}`)}</div>`;
      if (d.mark === 'deprecated') return `<div class="diff-row">${cell(`${esc(d.text)} ${CompareEngine.badgeHtml('deprecated')}`)}${cell(dash())}</div>`;
      return `<div class="diff-row">${cell(dash())}${cell(`${esc(d.text)} ${CompareEngine.badgeHtml('new')}`)}</div>`;
    }).join('') || `<div class="diff-row">${cell(`<span class="empty-txt">两场会议均未记录关键决策</span>`, true)}</div>`;

    // 待办追踪：旧会议在左（含旧内容/负责人/截止），新会议在右（v1.5.0 起只显示状态徽章，不重复旧全文；负责人/截止有变化时附上新值）
    const actionRows = r.actions.map(x => {
      if (x.mark === 'new') {
        return `<div class="diff-row">${cell(dash())}${cell(`${esc(x.content)}${tags(x.assignee, x.due)} ${CompareEngine.badgeHtml('new')}`)}</div>`;
      }
      if (x.a) {
        // 右侧：仅状态徽章；若新会议中负责人/截止与旧不同，附加显示新值（增量信息，非全文）
        const changed = [];
        if (x.assignee && x.assignee !== x.aAssignee) changed.push(`<span class="tag">新负责人：${esc(x.assignee)}</span>`);
        if (x.due && x.due !== x.aDue) changed.push(`<span class="tag">新截止：${esc(x.due)}</span>`);
        const statusCell = `<span class="status-only">${CompareEngine.badgeHtml(x.mark)}</span>${changed.length ? `<div class="status-delta">${changed.join('')}</div>` : ''}`;
        return `<div class="diff-row">${cell(`${esc(x.a)}${tags(x.aAssignee, x.aDue)}`)}${cell(statusCell)}</div>`;
      }
      return `<div class="diff-row">${cell(`${esc(x.content)}${tags(x.assignee, x.due)} ${CompareEngine.badgeHtml(x.mark)}`)}${cell(dash())}</div>`;
    }).join('') || `<div class="diff-row">${cell(`<span class="empty-txt">两场会议均未记录待办事项</span>`, true)}</div>`;

    // 遗留问题：旧会议在左，新会议在右
    const issueRows = r.issues.map(x => {
      if (x.mark === 'new') return `<div class="diff-row">${cell(dash())}${cell(`${esc(x.content)} ${CompareEngine.badgeHtml('new')}`)}</div>`;
      if (x.mark === 'remaining') return `<div class="diff-row">${cell(esc(x.content))}${cell(`${esc(x.content)} ${CompareEngine.badgeHtml('remaining')}`)}</div>`;
      return `<div class="diff-row">${cell(`${esc(x.content)} ${CompareEngine.badgeHtml(x.mark)}`)}${cell(dash())}</div>`;
    }).join('') || `<div class="diff-row">${cell(`<span class="empty-txt">两场会议均未记录遗留问题</span>`, true)}</div>`;

    const summaryBody = this.aiSummary
      ? `<div class="summary-body" id="summary-body">${renderSummaryList(this.aiSummary)}</div>
         <div class="summary-actions">
           <button class="btn btn-sm" id="s-regenerate"><i class="ph ph-arrows-clockwise"></i>重新生成（AI）</button>
           <button class="btn btn-sm" id="s-copy"><i class="ph ph-copy"></i>复制</button>
         </div>`
      : `<div class="summary-body" id="summary-body">${renderSummaryList(heur)}</div>
         <p class="summary-local-note">以上为本地规则分析。连接 Ollama 或 DeepSeek/OpenAI 后可生成更深入的 AI 改进总结。</p>
         <div class="summary-actions">
           <button class="btn btn-sm btn-primary" id="s-regenerate"><i class="ph ph-sparkle"></i>AI 生成改进总结</button>
           <button class="btn btn-sm" id="s-copy"><i class="ph ph-copy"></i>复制</button>
         </div>`;

    return `
      ${App.pageHead(
        `<a class="back-link" href="#/task/${this.task.id}"><i class="ph ph-arrow-left"></i></a> ${esc(this.task.name)}`,
        '两次会议的自动对比',
        `<button class="btn" id="c-save"><i class="ph ph-download-simple"></i>保存对比结果</button>
         <button class="btn" id="c-again"><i class="ph ph-arrows-left-right"></i>重新选择</button>`)}

      <div class="vs-grid">
        <div class="vs-card old">
          <div class="vs-label">第一次 · 旧</div>
          <div class="vs-date">${esc(a.date)}</div>
          <div class="vs-topic">${esc(a.topic || '未命名会议')}</div>
          <div class="vs-people"><i class="ph ph-users"></i>${esc(a.attendees || '未记录参会人员')}</div>
        </div>
        <div class="vs-mid"><div class="vs-orb"><i class="ph ph-arrows-left-right"></i></div></div>
        <div class="vs-card new">
          <div class="vs-label new-label">第二次 · 新</div>
          <div class="vs-date">${esc(b.date)}</div>
          <div class="vs-topic">${esc(b.topic || '未命名会议')}</div>
          <div class="vs-people"><i class="ph ph-users"></i>${esc(b.attendees || '未记录参会人员')}</div>
        </div>
      </div>

      <div class="card">
        <h2 class="card-title"><i class="ph ph-push-pin-simple"></i>议题变化</h2>
        <div class="diff-row" style="border-bottom:1px solid var(--border-strong)">
          <div class="diff-cell" style="font-size:12px;color:var(--ink-3);font-weight:600">旧会议</div>
          <div class="diff-cell" style="font-size:12px;color:var(--accent);font-weight:600">新会议（<span class="hl-add">高亮</span>为新增，<span class="hl-del">删除线</span>为调整）</div>
        </div>
        ${topicRows}
      </div>

      <div class="card">
        <h2 class="card-title"><i class="ph ph-git-branch"></i>决策演进</h2>
        <div class="diff-row" style="border-bottom:1px solid var(--border-strong)">
          <div class="diff-cell" style="font-size:12px;color:var(--ink-3);font-weight:600">旧会议 · 决策</div>
          <div class="diff-cell" style="font-size:12px;color:var(--accent);font-weight:600">新会议 · 决策</div>
        </div>
        ${decisionRows}
      </div>

      <div class="card">
        <h2 class="card-title"><i class="ph ph-list-checks"></i>待办追踪</h2>
        <div class="diff-row" style="border-bottom:1px solid var(--border-strong)">
          <div class="diff-cell" style="font-size:12px;color:var(--ink-3);font-weight:600">旧会议 · 待办</div>
          <div class="diff-cell" style="font-size:12px;color:var(--accent);font-weight:600">新会议 · 状态</div>
        </div>
        ${actionRows}
      </div>

      <div class="card">
        <h2 class="card-title"><i class="ph ph-question"></i>遗留问题</h2>
        <div class="diff-row" style="border-bottom:1px solid var(--border-strong)">
          <div class="diff-cell" style="font-size:12px;color:var(--ink-3);font-weight:600">旧会议 · 问题</div>
          <div class="diff-cell" style="font-size:12px;color:var(--accent);font-weight:600">新会议 · 问题</div>
        </div>
        ${issueRows}
      </div>

      <div class="card summary-card">
        <h2 class="card-title"><i class="ph ph-sparkle"></i>改进总结</h2>
        ${summaryBody}
      </div>
    `;
  },

  /** 构建 Markdown 对比报告 */
  buildMarkdown(heur) {
    const { a, b } = this;
    const r = this.result;
    const L = [];
    L.push('# 会议对比报告');
    L.push('');
    L.push(`- 任务：${this.task.name}`);
    L.push(`- 旧会议：${a.date}　${a.topic || '（无主题）'}`);
    L.push(`- 新会议：${b.date}　${b.topic || '（无主题）'}`);
    L.push('');
    L.push('## 议题变化');
    if (!r.topics.length) L.push('（两场会议均未记录核心议题）');
    for (const t of r.topics) {
      if (t.kind === 'pair') L.push(`- ${t.a} → ${t.b}（更新）`);
      else if (t.kind === 'new') L.push(`- 【新增】${t.b}`);
      else L.push(`- ${t.a}（未再讨论）`);
    }
    L.push('');
    L.push('## 决策演进');
    if (!r.decisions.length) L.push('（两场会议均未记录关键决策）');
    for (const d of r.decisions) {
      const [label] = CompareEngine.badges[d.mark] || [d.mark, ''];
      L.push(`- [${label}] ${d.mark === 'adjusted' ? `${d.a} → ${d.b}` : (d.text || d.a)}`);
    }
    L.push('');
    L.push('## 待办追踪');
    if (!r.actions.length) L.push('（两场会议均未记录待办事项）');
    for (const x of r.actions) {
      const [label] = CompareEngine.badges[x.mark] || [x.mark, ''];
      L.push(`- [${label}] ${x.content}${x.assignee ? `（负责人：${x.assignee}）` : ''}${x.due ? `（截止：${x.due}）` : ''}`);
    }
    L.push('');
    L.push('## 遗留问题');
    if (!r.issues.length) L.push('（两场会议均未记录遗留问题）');
    for (const x of r.issues) {
      const [label] = CompareEngine.badges[x.mark] || [x.mark, ''];
      L.push(`- [${label}] ${x.content}`);
    }
    L.push('');
    L.push('## 改进总结');
    L.push(this.aiSummary || heur);
    L.push('');
    L.push(`生成时间：${new Date().toLocaleString('zh-CN')} · 由「议迹」生成`);
    return L.join('\n');
  },

  bind(heur) {
    const view = App.viewEl;
    $('#c-again', view).addEventListener('click', () => location.hash = `#/task/${this.task.id}`);
    $('#c-save', view).addEventListener('click', async () => {
      const md = this.buildMarkdown(heur);
      const name = `对比报告-${this.task.name}-${this.b.date}.md`;
      try {
        const res = await window.api.exportApi.saveCompare(md, name);
        if (res.canceled) return;
        App.toast(`对比结果已保存：${res.path}`);
        window.api.shell.showInFolder(res.path);
      } catch (e) {
        App.toast('保存失败：' + e.message, 'err');
      }
    });
    $('#s-copy', view).addEventListener('click', async () => {
      const txt = $('#summary-body', view).textContent;
      try {
        await window.api.clipboard.write(txt);
        App.toast('总结已复制');
      } catch (e) {
        App.toast('复制失败：' + e.message, 'err');
      }
    });
    $('#s-regenerate', view).addEventListener('click', async () => {
      const btn = $('#s-regenerate', view);
      const original = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<i class="ph ph-circle-notch spin"></i>AI 生成中…`;
      try {
        const summary = await window.api.ai.compareSummary({
          ...this.a, notes: this.aNotes,
        }, {
          ...this.b, notes: this.bNotes,
        });
        this.aiSummary = summary.trim();
        const body = $('#summary-body', view);
        body.innerHTML = renderSummaryList(this.aiSummary);
        const note = $('.summary-local-note', view);
        if (note) note.remove();
        const actions = $('.summary-actions', view);
        if (actions) {
          const regen = actions.querySelector('#s-regenerate');
          if (regen) {
            regen.innerHTML = `<i class="ph ph-arrows-clockwise"></i>重新生成（AI）`;
            regen.classList.remove('btn-primary');
          }
        }
        await window.api.comparisons.save({
          taskId: this.task.id, aId: this.a.id, bId: this.b.id,
          resultJson: JSON.stringify({ summary: this.aiSummary }),
        });
        App.toast('AI 改进总结已生成并缓存');
      } catch (e) {
        App.toast('AI 生成失败：' + e.message, 'err', 5200);
      } finally {
        btn.disabled = false;
      }
    });
  },
};
