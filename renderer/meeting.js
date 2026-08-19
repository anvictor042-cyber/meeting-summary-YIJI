'use strict';
/* 议迹 · 会议编辑：录音 / 波形 / 打点笔记 / 转写 / 结构化纪要 / AI 生成 */

Views.meeting = {
  meeting: null,
  notes: [],
  task: null,
  recorder: null,
  recLevels: [],
  recElapsed: 0,
  tempId: 0,
  transcribing: false,

  async render(id) {
    const view = App.viewEl;
    this.meeting = await window.api.meetings.get(id);
    if (!this.meeting) { location.hash = '#/tasks'; return; }
    const tasks = await window.api.tasks.list();
    this.task = tasks.find(t => t.id === this.meeting.task_id) || { name: '' };
    this.notes = await window.api.notes.listForMeeting(id);
    this.attachments = await window.api.attachments.list(id);

    view.innerHTML = `<div class="view-inner">${this.html()}</div>`;
    this.bind();
    this.renderWave();
  },

  html() {
    const m = this.meeting;
    const group = (type) => this.notes.filter(n => n.type === type);

    const row = (n, type) => {
      const c = n ? esc(n.content) : '';
      const a = n ? esc(n.assignee) : '';
      const d = n ? esc(n.due_date) : '';
      const st = n ? esc(n.status) : '';
      const ts = n && n.timestamp != null ? `<span class="note-ts-tag" title="录音时间戳">@${Utils.fmtTimecode(n.timestamp)}</span>` : '';
      const statusSel = type === 'action' || type === 'issue'
        ? `<select class="select status-sel st-${st || 'open'}" data-f="status">${type === 'action' ? actionStatusOptions(st) : issueStatusOptions(st)}</select>`
        : '';
      const mini = type === 'action'
        ? `<input class="input mini" data-f="assignee" placeholder="负责人" value="${a}">
           <input class="input mini-date" data-f="due_date" placeholder="截止日期" value="${d}" type="date">`
        : '';
      return `
      <div class="note-row ${type === 'action' || type === 'issue' ? 'st-' + (st || 'open') : ''}" data-id="${n ? n.id : `new-${++this.tempId}`}" data-type="${type}">
        ${ts}
        <input class="input" data-f="content" placeholder="${placeholderOf(type)}" value="${c}" ${type === 'note' ? '' : ''}>
        ${mini}${statusSel}
        <button class="row-del" data-del title="删除"><i class="ph ph-trash"></i></button>
      </div>`;
    };

    const section = (type, icon, title, items) => `
      <div class="notes-section" data-section="${type}">
        <div class="notes-title"><i class="${icon}"></i>${title}
          <span class="count">${items.length}</span></div>
        <div class="note-list">${items.map(n => row(n, type)).join('')}</div>
        <button class="add-row-btn" data-add="${type}"><i class="ph ph-plus"></i>添加${title}</button>
      </div>`;

    const recState = this.recorder ? this.recorder.state : 'idle';
    const recBtnIcon = recState === 'recording' ? 'ph ph-pause' : recState === 'paused' ? 'ph ph-play' : 'ph ph-microphone';
    const recBtnClass = recState === 'recording' ? 'recording' : recState === 'paused' ? 'paused' : '';
    const recStateTxt = recState === 'recording' ? '正在录音' : recState === 'paused' ? '已暂停' : '待机';
    const recStateCls = recState === 'recording' ? 'live' : recState === 'paused' ? 'paused-state' : '';

    return `
      ${App.pageHead(
        `<a class="back-link" href="#/task/${m.task_id}"><i class="ph ph-arrow-left"></i></a> ${esc(this.task.name || '任务')}`,
        `会议 · <span class="mono">${esc(m.date)}</span>`,
        `<button class="btn btn-danger" id="m-del"><i class="ph ph-trash"></i>删除会议</button>
         <span class="save-state" id="save-state">已保存</span>`)
      }

      <div class="card" style="padding-bottom:18px">
        <div class="form-grid">
          <div class="field span2"><label for="m-topic">会议主题</label>
            <input class="input" id="m-topic" placeholder="例如：冲刺评审：对比功能第一版" value="${esc(m.topic)}"></div>
          <div class="field"><label for="m-date">会议日期</label>
            <input class="input" id="m-date" type="date" value="${esc(m.date)}"></div>
          <div class="field"><label for="m-attendees">参会人员</label>
            <input class="input" id="m-attendees" placeholder="用顿号或逗号分隔，例如：陈默、林晚" value="${esc(m.attendees)}"></div>
          <div class="field span2"><label for="m-summary">一句话摘要</label>
            <input class="input" id="m-summary" placeholder="会议的核心结论，将展示在时间线卡片上" value="${esc(m.summary)}"></div>
        </div>
      </div>

      <div class="card">
        <h2 class="card-title"><i class="ph ph-microphone"></i>录音
          ${m.audio_file_path ? `<span class="badge ok" style="margin-left:auto"><i class="ph ph-check-circle"></i>已保存录音</span>` : ''}
        </h2>
        <div class="rec-head">
          <button class="rec-btn ${recBtnClass}" id="rec-btn" title="开始 / 暂停录音"><i class="${recBtnIcon}"></i></button>
          <div class="rec-info">
            <span class="rec-state ${recStateCls}"><span class="dot"></span>${recStateTxt}</span>
            <span class="rec-time" id="rec-time">${Utils.fmtTimecode(this.recElapsed)}</span>
          </div>
          <div class="rec-actions">
            <button class="btn btn-sm" id="rec-upload" title="上传已有的录音文件（WAV/MP3/M4A 等）"><i class="ph ph-upload-simple"></i>上传录音</button>
            <button class="btn btn-sm" id="rec-stop" ${recState === 'idle' ? 'disabled' : ''}><i class="ph ph-stop"></i>停止并转写</button>
            ${m.audio_file_path ? `<button class="btn btn-sm" id="rec-folder"><i class="ph ph-folder-open"></i>录音目录</button>` : ''}
          </div>
          <input type="file" id="rec-upload-input" accept="audio/*" style="display:none">
        </div>
        <div class="wave-wrap">
          <canvas id="waveform" height="64"></canvas>
          <div class="wave-ticks"><span>00:00</span><span id="wave-end">${Utils.fmtTimecode(m.audio_duration || 0)}</span></div>
        </div>
        <p class="rec-hint">支持连续录音 2 小时以上（边录边写入磁盘，不占内存）；停止后自动转写</p>
        <div class="rec-note-row">
          <input class="input" id="rec-note" placeholder="录音中随时记下要点，将自动绑定当前时间戳" ${recState === 'idle' ? 'disabled' : ''}>
          <button class="btn" id="rec-note-add" ${recState === 'idle' ? 'disabled' : ''}><i class="ph ph-push-pin"></i>添加笔记<span class="note-ts" id="rec-note-ts"></span></button>
        </div>
      </div>

      <div class="card">
        <h2 class="card-title"><i class="ph ph-chat-text"></i>转写文本
          <span class="spacer"></span>
          <button class="btn btn-sm" id="t-copy" ${!m.transcript ? 'disabled' : ''}><i class="ph ph-copy"></i>复制</button>
          <button class="btn btn-sm" id="t-rerun" ${!m.audio_file_path ? 'disabled' : ''}><i class="ph ph-arrows-clockwise"></i>重新转写</button>
        </h2>
        ${this.transcribing ? `
          <div class="progress-line"><i class="ph ph-circle-notch spin"></i>
            <span>正在本地转写（首次运行会自动下载 Whisper 模型，请耐心等待）…</span></div>` : ''}
        <div class="field transcript-box">
          <div class="tt-ctl" id="tt-ctl" ${!/\[(男|女)\d+\]/.test(m.transcript) ? 'style="display:none"' : ''}>
            <button class="btn btn-sm active" id="t-view" type="button"><i class="ph ph-palette"></i>说话人着色</button>
            <button class="btn btn-sm" id="t-edit" type="button"><i class="ph ph-pencil-simple"></i>编辑文本</button>
          </div>
          <p class="sp-edit-hint" id="sp-edit-hint" style="display:none">点击段落文字可直接修改，说话人标记自动保留</p>
          <div id="m-transcript-view" class="speaker-view" ${!/\[(男|女)\d+\]/.test(m.transcript) ? 'style="display:none"' : ''}></div>
          <textarea class="textarea" id="m-transcript" rows="8" ${/\[(男|女)\d+\]/.test(m.transcript) ? 'style="display:none"' : ''} placeholder="录音停止后会自动转写到这里，也可以手动粘贴会议记录">${esc(m.transcript)}</textarea>
          <div class="transcript-meta"><span>约 <b class="mono">${m.transcript.length}</b> 字</span>
            ${m.transcript ? `<span>·</span><span>转写文本用于 AI 生成结构化纪要</span>` : ''}</div>
        </div>
      </div>

      <div class="card ai-card">
        <div class="ai-banner">
          <div class="ai-orb"><i class="ph ph-sparkle"></i></div>
          <div class="ai-txt"><b>AI 结构化纪要</b>
            <span>一键整理：自动归类到核心议题 / 关键决策 / 待办事项 / 遗留问题，并生成会议纪要完整版</span></div>
          <button class="btn btn-primary" id="m-ai2" ${!m.transcript.trim() ? 'disabled' : ''}><i class="ph ph-sparkle"></i>AI 整理纪要</button>
        </div>
        <p style="margin:0;font-size:12.5px;color:var(--ink-3)">AI 服务：${{ ollama: `Ollama（${App.settings.ollamaModel}）`, deepseek: `DeepSeek（${App.settings.deepseekModel}）`, openai: `OpenAI（${App.settings.openaiModel}）` }[App.settings.aiProvider] || 'Ollama'} · 在设置中切换</p>
      </div>

      <div class="card">
        <h2 class="card-title"><i class="ph ph-file-text"></i>会议纪要完整版
          <span class="spacer"></span>
          <button class="btn btn-sm" id="m-min-copy" ${!m.minutes_full ? 'disabled' : ''}><i class="ph ph-copy"></i>复制</button>
        </h2>
        <div class="field">
          <textarea class="textarea" id="m-minutes" rows="10" placeholder="AI 整理纪要时会自动写入完整版纪要，也可以手动粘贴或撰写（支持 markdown 格式）">${esc(m.minutes_full)}</textarea>
          <div class="transcript-meta"><span>约 <b class="mono">${(m.minutes_full || '').length}</b> 字 · 可作为会议存档文档</span></div>
        </div>
      </div>

      <div class="card">
        <h2 class="card-title"><i class="ph ph-paperclip"></i>附件
          <span class="spacer"></span>
          <button class="btn btn-sm" id="att-upload"><i class="ph ph-upload-simple"></i>上传附件</button>
        </h2>
        <input type="file" id="att-upload-input" accept=".doc,.docx,.pdf,.txt,.md,.text,.wav,.mp3,.m4a,.webm,.ogg,.flac,.aac" multiple style="display:none">
        ${this.attachments.length === 0
          ? '<p style="margin:4px 0 0;font-size:13px;color:var(--ink-3)">支持语音 / Word / PDF 等文件，上传后可将内容提取到转写文本</p>'
          : `<div class="att-list">${this.attachments.map(a => this.attRow(a)).join('')}</div>`}
      </div>

      <div class="card">
        ${section('topic', 'ph ph-push-pin-simple', '核心议题', group('topic'))}
        ${section('decision', 'ph ph-git-branch', '关键决策', group('decision'))}
        ${section('action', 'ph ph-list-checks', '待办事项', group('action'))}
        ${section('issue', 'ph ph-question', '遗留问题', group('issue'))}
        ${section('note', 'ph ph-note-pencil', '自由笔记', group('note'))}
      </div>
    `;
  },

  /* ---------- 事件绑定 ---------- */
  bind() {
    const view = App.viewEl;
    const m = this.meeting;
    const saveState = (txt) => {
      const el = $('#save-state', view);
      if (el) { el.textContent = txt; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1500); }
    };
    const persist = Utils.debounce(async () => {
      const updated = await window.api.meetings.update({
        id: m.id,
        topic: $('#m-topic', view).value,
        attendees: $('#m-attendees', view).value,
        date: $('#m-date', view).value || m.date,
        summary: $('#m-summary', view).value,
        transcript: $('#m-transcript', view).value,
        minutes_full: $('#m-minutes', view).value,
      });
      this.meeting = { ...this.meeting, ...updated };
      saveState('已保存');
    }, 700);

    ['m-topic', 'm-attendees', 'm-date', 'm-summary', 'm-transcript', 'm-minutes'].forEach(id => {
      $('#' + id, view)?.addEventListener('input', () => { saveState('保存中…'); persist(); });
    });

    // 转写文本变化时实时启用/禁用 AI 整理按钮（不再需要退出重进）
    $('#m-transcript', view).addEventListener('input', () => {
      const btn = $('#m-ai2', view);
      if (btn) btn.disabled = !$('#m-transcript', view).value.trim();
    });

    // 说话人着色视图 / 编辑文本 切换
    $('#t-view', view)?.addEventListener('click', () => {
      $('#t-view', view).classList.add('active');
      $('#t-edit', view).classList.remove('active');
      this.refreshTranscriptView();
    });
    $('#t-edit', view)?.addEventListener('click', () => {
      $('#t-edit', view).classList.add('active');
      $('#t-view', view).classList.remove('active');
      this.refreshTranscriptView();
    });
    this.refreshTranscriptView();

    $('#m-del', view).addEventListener('click', async () => {
      const ok = await App.confirm({
        title: '删除这场会议？', danger: true, confirmLabel: '删除',
        sub: '该会议的纪要、转写与录音引用都会被删除，此操作不可撤销。',
      });
      if (!ok) return;
      await window.api.meetings.remove(m.id);
      App.toast('会议已删除');
      location.hash = `#/task/${m.task_id}`;
    });

    // 录音控制
    $('#rec-btn', view).addEventListener('click', () => this.toggleRec());
    $('#rec-stop', view).addEventListener('click', () => this.stopRec());
    $('#rec-folder', view)?.addEventListener('click', async () => {
      const dir = await window.api.paths.recordings();
      window.api.shell.showInFolder(m.audio_file_path || dir);
    });
    $('#rec-note-add', view).addEventListener('click', () => this.addTimedNote());
    $('#rec-note', view).addEventListener('keydown', e => { if (e.key === 'Enter') this.addTimedNote(); });

    $('#t-copy', view).addEventListener('click', async () => {
      try {
        await window.api.clipboard.write(m.transcript);
        App.toast('转写文本已复制');
      } catch (e) {
        App.toast('复制失败：' + e.message, 'err');
      }
    });
    $('#m-min-copy', view).addEventListener('click', async () => {
      try {
        await window.api.clipboard.write(m.minutes_full || '');
        App.toast('会议纪要完整版已复制');
      } catch (e) {
        App.toast('复制失败：' + e.message, 'err');
      }
    });
    $('#t-rerun', view).addEventListener('click', () => this.runTranscribe());

    // AI 生成
    const aiBtns = [$('#m-ai2', view)].filter(Boolean);
    aiBtns.forEach(btn => btn.addEventListener('click', () => this.aiGenerate()));

    // 纪要行：输入变更即保存；新增行保存后换真实 id
    $$('.note-row', view).forEach(row => {
      row.addEventListener('change', e => {
        const f = e.target.dataset.f;
        if (!f) return;
        this.applyStatusClass(row);
        const val = e.target.value;
        const idAttr = row.dataset.id;
        const isNew = idAttr.startsWith('new-');
        if (isNew) {
          window.api.notes.add({
            meetingId: m.id, type: row.dataset.type,
            content: this.rowVal(row, 'content'),
            assignee: this.rowVal(row, 'assignee'),
            dueDate: this.rowVal(row, 'due_date'),
            status: this.rowVal(row, 'status'),
            timestamp: null,
          }).then(saved => {
            row.dataset.id = saved.id;
            saveState('已保存');
            App.toast('已添加');
          });
        } else {
          window.api.notes.update({
            id: Number(idAttr),
            content: this.rowVal(row, 'content'),
            assignee: this.rowVal(row, 'assignee'),
            dueDate: this.rowVal(row, 'due_date'),
            status: this.rowVal(row, 'status'),
          }).then(() => saveState('已保存'));
        }
      });
    });
    $$('.row-del', view).forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.note-row');
        const idAttr = row.dataset.id;
        row.style.transition = 'opacity .15s'; row.style.opacity = '0';
        setTimeout(() => {
          row.remove();
          if (!idAttr.startsWith('new-')) window.api.notes.remove(Number(idAttr)).then(() => saveState('已保存'));
        }, 140);
      });
    });
    $$('.add-row-btn', view).forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.add;
        const list = btn.closest('.notes-section').querySelector('.note-list');
        const temp = document.createElement('template');
        const mk = (n, t) => {
          const ts = n && n.timestamp != null ? `<span class="note-ts-tag">@${Utils.fmtTimecode(n.timestamp)}</span>` : '';
          const statusSel = (t === 'action' || t === 'issue') ? `<select class="select status-sel st-open" data-f="status">${t === 'action' ? actionStatusOptions('') : issueStatusOptions('')}</select>` : '';
          const mini = t === 'action'
            ? `<input class="input mini" data-f="assignee" placeholder="负责人">
               <input class="input mini-date" data-f="due_date" type="date" placeholder="截止日期">` : '';
          return `<div class="note-row ${t === 'action' || t === 'issue' ? 'st-open' : ''}" data-id="new-${++this.tempId}" data-type="${t}">
            ${ts}<input class="input" data-f="content" placeholder="${placeholderOf(t)}">
            ${mini}${statusSel}
            <button class="row-del" data-del title="删除"><i class="ph ph-trash"></i></button></div>`;
        };
        temp.innerHTML = mk(null, type);
        const row = temp.content.firstChild;
        list.appendChild(row);
        this.applyStatusClass(row);
        const inp = row.querySelector('[data-f=content]');
        inp.focus();
        row.addEventListener('change', e => {
          const f = e.target.dataset.f;
          if (!f) return;
          this.applyStatusClass(row);
          window.api.notes.add({
            meetingId: m.id, type: row.dataset.type,
            content: this.rowVal(row, 'content'),
            assignee: this.rowVal(row, 'assignee'),
            dueDate: this.rowVal(row, 'due_date'),
            status: this.rowVal(row, 'status'),
            timestamp: null,
          }).then(saved => {
            row.dataset.id = saved.id;
            saveState('已保存');
            this.refreshCounts(view);
          });
        });
        row.querySelector('.row-del').addEventListener('click', () => {
          row.remove(); this.refreshCounts(view);
        });
        this.refreshCounts(view);
      });
    });

    // 录音上传（支持已有录音文件）
    $('#rec-upload', view).addEventListener('click', () => $('#rec-upload-input', view).click());
    $('#rec-upload-input', view).addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        await this.uploadAudioFile(f);
      } catch (err) {
        App.toast('上传失败：' + err.message, 'err');
      }
    });

    // 附件上传（语音 / Word / PDF 等）
    $('#att-upload', view).addEventListener('click', () => $('#att-upload-input', view).click());
    $('#att-upload-input', view).addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      for (const f of files) {
        try {
          const buf = new Uint8Array(await f.arrayBuffer());
          await window.api.attachments.add({ meetingId: this.meeting.id, name: f.name, buffer: Array.from(buf) });
        } catch (err) {
          App.toast(`上传 ${f.name} 失败：${err.message}`, 'err');
        }
      }
      App.toast(`已上传 ${files.length} 个附件，可点击「提取到转写」`);
      this.refreshAttachments();
    });
    this.bindAttachments();

    // 待办行状态着色（初始渲染）
    this.applyAllStatusClasses(view);
  },

  rowVal(row, f) {
    const el = row.querySelector(`[data-f="${f}"]`);
    return el ? el.value : '';
  },

  /* ---------- 附件 ---------- */
  attIcon(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    if (['wav', 'mp3', 'm4a', 'webm', 'ogg', 'flac', 'aac', 'amr', 'wma'].includes(ext)) return 'ph ph-file-audio';
    if (ext === 'pdf') return 'ph ph-file-pdf';
    if (['doc', 'docx'].includes(ext)) return 'ph ph-file-text';
    if (['txt', 'md', 'text'].includes(ext)) return 'ph ph-file-text';
    return 'ph ph-paperclip';
  },

  attRow(a) {
    const size = a.size > 1024 * 1024 ? `${(a.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(a.size / 1024))} KB`;
    return `
      <div class="att-row" data-id="${a.id}">
        <i class="${this.attIcon(a.name)}"></i>
        <div class="att-info"><span class="att-name">${esc(a.name)}</span><span class="att-size">${size}</span></div>
        <button class="btn btn-sm" data-att-extract title="提取内容到转写文本"><i class="ph ph-arrows-clockwise"></i>提取到转写</button>
        <button class="btn btn-sm" data-att-open title="打开文件"><i class="ph ph-folder-open"></i></button>
        <button class="btn btn-sm btn-danger" data-att-del title="删除附件"><i class="ph ph-trash"></i></button>
      </div>`;
  },

  async uploadAudioFile(file) {
    const ext = (file.name.split('.').pop() || 'wav').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'wav';
    const buf = new Uint8Array(await file.arrayBuffer());
    const saved = await window.api.audio.save(Array.from(buf), ext);
    // 尝试获取时长（解码失败则为 0）
    let duration = 0;
    try {
      const ctx = new AudioContext();
      const audioBuf = await ctx.decodeAudioData(buf.buffer.slice(0));
      duration = audioBuf.duration;
      ctx.close();
    } catch (_) {}
    const m = this.meeting;
    const updated = await window.api.meetings.update({
      id: m.id, topic: m.topic, attendees: m.attendees, date: m.date,
      summary: m.summary, transcript: m.transcript, minutes_full: m.minutes_full,
      audio_file_path: saved.path, audio_duration: duration,
    });
    this.meeting = { ...m, ...updated };
    $('#wave-end').textContent = Utils.fmtTimecode(duration);
    App.toast(`录音已上传（${file.name}）`);
    this.runTranscribe();
  },

  async extractAttachment(id) {
    const btn = $(`[data-att-extract][data-id="${id}"]`) || $(`.att-row[data-id="${id}"] [data-att-extract]`);
    if (btn) { btn.disabled = true; btn.innerHTML = `<i class="ph ph-circle-notch spin"></i>提取中…`; }
    try {
      const res = await window.api.attachments.extractToTranscript(id, this.meeting.id);
      const ta = $('#m-transcript');
      if (ta) ta.value = res.transcript;
      this.meeting.transcript = res.transcript;
      // 提取后若有说话人标记，自动切到着色视图
      $('#t-view', App.viewEl)?.classList.add('active');
      $('#t-edit', App.viewEl)?.classList.remove('active');
      this.refreshTranscriptView();
      const aiBtn = $('#m-ai2');
      if (aiBtn) aiBtn.disabled = !res.transcript.trim();
      App.toast(`已提取 ${res.appendedChars} 字到转写文本（${res.kind}）`);
    } catch (e) {
      App.toast('提取失败：' + e.message, 'err', 5200);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = `<i class="ph ph-arrows-clockwise"></i>提取到转写`; }
    }
  },

  refreshAttachments() {
    window.api.attachments.list(this.meeting.id).then(list => {
      this.attachments = list;
      const card = $('.card', App.viewEl);
      const attCard = Array.from($$('.card', App.viewEl)).find(c => c.querySelector('.card-title i.ph-paperclip'));
      if (!attCard) return;
      const listEl = attCard.querySelector('.att-list');
      const empty = attCard.querySelector('p');
      if (list.length) {
        if (empty) empty.remove();
        if (listEl) listEl.innerHTML = list.map(a => this.attRow(a)).join('');
        else {
          const div = document.createElement('div');
          div.className = 'att-list';
          div.innerHTML = list.map(a => this.attRow(a)).join('');
          attCard.insertBefore(div, attCard.querySelector('input'));
        }
        this.bindAttachments();
      } else {
        if (listEl) listEl.remove();
        if (!empty) {
          const p = document.createElement('p');
          p.style.cssText = 'margin:4px 0 0;font-size:13px;color:var(--ink-3)';
          p.textContent = '支持语音 / Word / PDF 等文件，上传后可将内容提取到转写文本';
          attCard.insertBefore(p, attCard.querySelector('input'));
        }
      }
    });
  },

  bindAttachments() {
    const view = App.viewEl;
    $$('[data-att-extract]', view).forEach(btn => {
      btn.addEventListener('click', () => this.extractAttachment(Number(btn.closest('.att-row').dataset.id)));
    });
    $$('[data-att-open]', view).forEach(btn => {
      btn.addEventListener('click', () => window.api.attachments.open(Number(btn.closest('.att-row').dataset.id)));
    });
    $$('[data-att-del]', view).forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.closest('.att-row').dataset.id);
        const ok = await App.confirm({ title: '删除附件？', sub: '文件将从磁盘删除。', danger: true, confirmLabel: '删除' });
        if (!ok) return;
        await window.api.attachments.remove(id);
        App.toast('附件已删除');
        this.refreshAttachments();
      });
    });
  },

  /** 待办状态 → 行色/选择器色（未开始灰 / 进行中蓝 / 已完成绿 / 暂停橙） */
  applyStatusClass(row) {
    const sel = row.querySelector('[data-f="status"]');
    if (!sel) return;
    const st = sel.value || 'open';
    sel.className = `select status-sel st-${st}`;
    ['st-done', 'st-in_progress', 'st-paused', 'st-open'].forEach(c => row.classList.remove(c));
    row.classList.add(`st-${st}`);
  },

  applyAllStatusClasses(view) {
    $$('.note-row[data-type="action"], .note-row[data-type="issue"]', view).forEach(r => this.applyStatusClass(r));
  },

  refreshCounts(view) {
    $$('.notes-section', view).forEach(sec => {
      const n = sec.querySelectorAll('.note-row').length;
      sec.querySelector('.count').textContent = n;
    });
  },

  /* ---------- 录音 ---------- */
  async toggleRec() {
    if (!this.recorder) this.recorder = new Recorder({
      onTick: (elapsed, levels) => {
        this.recElapsed = elapsed;
        this.recLevels = levels;
        const t = $('#rec-time'); if (t) t.textContent = Utils.fmtTimecode(elapsed);
        const ts = $('#rec-note-ts'); if (ts) ts.textContent = `@${Utils.fmtTimecode(elapsed)}`;
        this.renderWave();
      },
      onChunk: (chunk) => {
        // 边录边写盘（支持连续 2 小时以上录音，不占内存）
        chunk.arrayBuffer().then(buf => window.api.audio.appendChunk(new Uint8Array(buf)));
      },
      onState: (s) => {
        const btn = $('#rec-btn'), stop = $('#rec-stop'), note = $('#rec-note'), add = $('#rec-note-add');
        if (btn) {
          btn.className = `rec-btn ${s === 'recording' ? 'recording' : s === 'paused' ? 'paused' : ''}`;
          btn.innerHTML = `<i class="${s === 'recording' ? 'ph ph-pause' : s === 'paused' ? 'ph ph-play' : 'ph ph-microphone'}"></i>`;
        }
        if (stop) stop.disabled = s === 'idle';
        if (note) note.disabled = s === 'idle';
        if (add) add.disabled = s === 'idle';
        const st = $('.rec-state'); if (st) {
          st.className = `rec-state ${s === 'recording' ? 'live' : s === 'paused' ? 'paused-state' : ''}`;
          st.innerHTML = `<span class="dot"></span>${s === 'recording' ? '正在录音' : s === 'paused' ? '已暂停' : '待机'}`;
        }
      },
    });
    if (this.recorder.state === 'idle') {
      try {
        const s = await window.api.audio.startStream();
        this.streamPath = s.path;
        await this.recorder.start();
      }
      catch (e) {
        App.toast('无法访问麦克风：' + (e.message || e.name), 'err');
      }
    } else if (this.recorder.state === 'recording') {
      this.recorder.pause();
    } else {
      this.recorder.resume();
    }
  },

  async stopRec() {
    if (!this.recorder || this.recorder.state === 'idle') return;
    const stopBtn = $('#rec-stop'); if (stopBtn) stopBtn.disabled = true;
    try {
      const blob = await this.recorder.stop();
      await window.api.audio.endStream();
      if (!blob) return;
      const duration = this.recElapsed;
      App.toast('录音已停止，正在保存…');
      // 流式写盘的文件（webm）兜底路径
      let audioPath = this.streamPath || null;
      let ext = 'webm';
      // 短录音（≤30 分钟）仍转成 Whisper 友好的 WAV；长录音直接保留 webm（2 小时 WAV 会达 230MB）
      if (duration <= 1800) {
        try {
          const wavBuf = await blobToWav(blob);
          const wavPath = audioPath ? audioPath.replace(/\.webm$/, '.wav') : null;
          const saved = wavPath
            ? await window.api.audio.saveTo(wavPath, Array.from(new Uint8Array(wavBuf)))
            : await window.api.audio.save(Array.from(new Uint8Array(wavBuf)), 'wav');
          if (audioPath) await window.api.audio.delete(audioPath);
          audioPath = saved.path;
          ext = 'wav';
        } catch (e) {
          // 转码失败则保留 webm
        }
      }
      if (!audioPath) { App.toast('保存录音失败：没有可用文件', 'err'); return; }
      const m = this.meeting;
      const updated = await window.api.meetings.update({
        id: m.id, topic: m.topic, attendees: m.attendees, date: m.date,
        summary: m.summary, transcript: m.transcript,
        ...{ audio_file_path: audioPath, audio_duration: duration },
      });
      this.meeting = { ...m, ...updated };
      $('#wave-end').textContent = Utils.fmtTimecode(duration);
      App.toast(`录音已保存（${Utils.fmtTimecode(duration)}${duration > 1800 ? '，长录音保留 WebM' : ''}）`);
      this.runTranscribe();
    } catch (e) {
      App.toast('保存录音失败：' + e.message, 'err');
    }
  },

  async runTranscribe() {
    const m = this.meeting;
    if (!m.audio_file_path) { App.toast('还没有录音文件', 'err'); return; }
    this.transcribing = true;
    const view = App.viewEl;
    const wrap = $('.card', view);
    // 进度提示插入转写卡片顶部
    const progress = document.createElement('div');
    progress.className = 'progress-line';
    progress.style.marginBottom = '12px';
    progress.innerHTML = `<i class="ph ph-circle-notch spin"></i><span>正在本地转写…</span>`;
    const transcriptCard = $('#m-transcript', view)?.closest('.card');
    if (transcriptCard) transcriptCard.querySelector('.card-title').after(progress);
    try {
      const res = await window.api.transcribe.run(m.audio_file_path);
      const text = res.text || '';
      $('#m-transcript', view).value = text;
      const updated = await window.api.meetings.update({
        id: m.id, topic: m.topic, attendees: m.attendees, date: m.date,
        summary: m.summary, transcript: text,
      });
      this.meeting = { ...m, ...updated };
      // 转写完成后自动切换到说话人着色视图
      $('#t-view', view)?.classList.add('active');
      $('#t-edit', view)?.classList.remove('active');
      this.refreshTranscriptView();
      App.toast(`转写完成（${res.language || ''} · ${(res.segments || []).length} 段）`);
      const aiBtns = [$('#m-ai2', view)].filter(Boolean);
      aiBtns.forEach(b => { b.disabled = false; });
    } catch (e) {
      App.toast('转写失败：' + e.message, 'err', 5200);
    } finally {
      progress.remove();
      this.transcribing = false;
    }
  },

  /** 刷新说话人着色视图（根据当前文本与视图模式；v1.5.0 起段落可直接编辑） */
  refreshTranscriptView() {
    const view = App.viewEl;
    const ta = $('#m-transcript', view);
    const vw = $('#m-transcript-view', view);
    const ctl = $('#tt-ctl', view);
    const hint = $('#sp-edit-hint', view);
    if (!ta || !vw || !ctl) return;
    const text = ta.value || '';
    const hasSp = /\[(男|女)\d+\]/.test(text);
    vw.innerHTML = Utils.renderSpeakerView(text);
    if (hasSp) {
      ctl.style.display = '';
      const viewMode = $('#t-view', view)?.classList.contains('active');
      vw.style.display = viewMode ? '' : 'none';
      ta.style.display = viewMode ? 'none' : '';
      if (hint) hint.style.display = viewMode ? '' : 'none';
      // 着色视图段落可直接编辑：改动实时重组 [男1] 标记并保存
      if (viewMode) this.enableSpeakerEdit(vw, ta);
    } else {
      ctl.style.display = 'none';
      vw.style.display = 'none';
      ta.style.display = '';
      if (hint) hint.style.display = 'none';
    }
  },

  /** 让着色视图每段可编辑，编辑后按顺序重组 [男1] 标记写回 textarea 并触发保存 */
  enableSpeakerEdit(vw, ta) {
    $$('.sp-text', vw).forEach(el => {
      if (el.getAttribute('contenteditable') === 'true') return;
      el.setAttribute('contenteditable', 'true');
      el.addEventListener('input', () => this.rebuildTranscriptFromSpeaker(vw, ta));
    });
  },

  /** 从着色视图 DOM 重组带标记的全文 */
  rebuildTranscriptFromSpeaker(vw, ta) {
    let out = '';
    $$('.sp-row', vw).forEach(row => {
      const chip = row.querySelector('.sp-chip');
      const txt = row.querySelector('.sp-text');
      if (!txt) return;
      const t = txt.innerText.replace(/\s*\n\s*/g, '').trim();
      if (!t) return;
      out += (chip ? `[${chip.innerText.trim()}]` : '') + t;
    });
    ta.value = out;
    this.meeting.transcript = out;
    // 触发 textarea 的 input 监听（保存 + AI 按钮状态联动）
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  },

  addTimedNote() {
    const view = App.viewEl;
    const input = $('#rec-note', view);
    const text = input.value.trim();
    if (!text) return;
    if (!this.recorder || this.recorder.state === 'idle') { App.toast('请先开始录音', 'err'); return; }
    const ts = this.recElapsed;
    window.api.notes.add({ meetingId: this.meeting.id, type: 'note', content: text, timestamp: ts }).then(n => {
      input.value = '';
      App.toast(`笔记已添加 @${Utils.fmtTimecode(ts)}`);
      // 插入到自由笔记区
      const list = $(`[data-section="note"] .note-list`, view);
      if (list) {
        const temp = document.createElement('template');
        temp.innerHTML = `<div class="note-row" data-id="${n.id}" data-type="note">
          <span class="note-ts-tag">@${Utils.fmtTimecode(ts)}</span>
          <input class="input" data-f="content" value="${esc(text)}">
          <button class="row-del" data-del title="删除"><i class="ph ph-trash"></i></button></div>`;
        const row = temp.content.firstChild;
        list.appendChild(row);
        this.refreshCounts(view);
        row.addEventListener('change', e => {
          if (!e.target.dataset.f) return;
          window.api.notes.update({ id: n.id, content: row.querySelector('[data-f=content]').value, assignee: '', dueDate: '', status: '' });
        });
        row.querySelector('.row-del').addEventListener('click', () => { row.remove(); this.refreshCounts(view); window.api.notes.remove(n.id); });
      }
    });
  },

  renderWave() {
    const canvas = $('#waveform');
    if (!canvas) return;
    if (this.recorder && this.recorder.state !== 'idle') {
      window.drawWave(canvas, this.recLevels, { color: '#2e5e4e', activeIdx: this.recLevels.length - 1, history: 6 });
    } else {
      // 空闲态：静态示意波形（极淡）
      const idle = Array.from({ length: 48 }, (_, i) => 0.1 + 0.16 * Math.abs(Math.sin(i * 0.55)) * (1 - i / 96));
      window.drawWave(canvas, idle, { color: '#cfccc0' });
    }
  },

  /* ---------- AI 整理纪要（自动归类到各栏目 + 生成完整版） ---------- */
  async aiGenerate() {
    const view = App.viewEl;
    const btn = $('#m-ai2', view);
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-circle-notch spin"></i>整理中…`;
    try {
      const data = await window.api.ai.generateSummary(this.meeting.id);
      // 渲染层二次去重：与决策高度相似（≥0.75，近乎重复）的待办剔除；有区分度的保留（准确优先，不限制条数）
      const uniq = (arr) => { const out = []; for (const x of arr) if (!out.some(y => Utils.sim(x, y) >= 0.9)) out.push(x); return out; };
      const decisions = uniq(data.decisions || []);
      const actions = uniq((data.actions || []).map(a => a.content)).filter(c => !decisions.some(d => Utils.sim(c, d) >= 0.75));
      const actionMap = new Map((data.actions || []).map(a => [a.content, a]));
      const notes = [
        ...uniq(data.topics || []).map(c => ({ type: 'topic', content: c })),
        ...decisions.map(c => ({ type: 'decision', content: c })),
        ...actions.map(c => ({ type: 'action', content: c, assignee: (actionMap.get(c) || {}).assignee || '', due_date: (actionMap.get(c) || {}).due_date || '' })),
        ...uniq(data.issues || []).map(c => ({ type: 'issue', content: c })),
      ];
      await window.api.notes.replaceForMeeting({ meetingId: this.meeting.id, notes });
      const updated = await window.api.meetings.update({
        id: this.meeting.id,
        topic: this.meeting.topic, attendees: this.meeting.attendees,
        date: this.meeting.date, transcript: this.meeting.transcript,
        summary: data.summary || this.meeting.summary,
        minutes_full: data.minutes_full || this.meeting.minutes_full || '',
      });
      this.meeting = { ...this.meeting, ...updated };
      App.toast(`已自动归类：议题 ${notes.filter(n => n.type === 'topic').length} 条 · 决策 ${notes.filter(n => n.type === 'decision').length} 条 · 待办 ${notes.filter(n => n.type === 'action').length} 条 · 遗留 ${notes.filter(n => n.type === 'issue').length} 条`);
      this.render(this.meeting.id);
    } catch (e) {
      App.toast('AI 整理失败：' + e.message, 'err', 5200);
      btn.disabled = false;
      btn.innerHTML = original;
    }
  },
};

/* ---------- 状态选项 ---------- */
function actionStatusOptions(cur) {
  const opts = [['', '未开始'], ['in_progress', '进行中'], ['done', '已完成'], ['paused', '暂停']];
  return opts.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('');
}
function issueStatusOptions(cur) {
  const opts = [['', '开放'], ['resolved', '已解决']];
  return opts.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('');
}
function placeholderOf(type) {
  return { topic: '议题内容', decision: '决策结论', action: '待办事项', issue: '遗留问题', note: '自由笔记' }[type];
}
