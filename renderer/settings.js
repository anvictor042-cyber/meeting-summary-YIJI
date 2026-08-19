'use strict';
/* 议迹 · 设置视图：AI 服务 / 转写引擎 / 对比参数 / 存储 */

Views.settings = {
  s: null,

  async render() {
    this.s = { ...App.settings };
    const view = App.viewEl;

    view.innerHTML = `<div class="view-inner">
      ${App.pageHead('设置', 'AI 服务与本地转写配置，全部保存在本机')}

      <div class="set-group">
        <h2 class="set-group-title">AI 纪要服务</h2>
        <div class="card">
          <div class="set-row">
            <div class="set-main">
              <p class="set-name">服务提供方</p>
              <p class="set-desc">Ollama 本地免费离线；DeepSeek / OpenAI 为云端 API（密钥仅存本机）。</p>
            </div>
            <div class="set-ctl auto">
              <div class="seg">
                <button data-prov="ollama" class="${this.s.aiProvider === 'ollama' ? 'active' : ''}">Ollama（本地）</button>
                <button data-prov="deepseek" class="${this.s.aiProvider === 'deepseek' ? 'active' : ''}">DeepSeek</button>
                <button data-prov="openai" class="${this.s.aiProvider === 'openai' ? 'active' : ''}">OpenAI</button>
                <button data-prov="custom" class="${this.s.aiProvider === 'custom' ? 'active' : ''}">自定义</button>
              </div>
            </div>
          </div>

          <div id="ollama-fields" style="${this.s.aiProvider === 'deepseek' || this.s.aiProvider === 'openai' ? 'display:none' : ''}">
            <div class="set-row">
              <div class="set-main"><p class="set-name">Ollama 服务地址</p>
                <p class="set-desc">默认 localhost:11434。Ollama 需先运行：ollama serve</p></div>
              <div class="set-ctl"><input class="input" id="s-ollama-url" value="${esc(this.s.ollamaUrl)}"></div>
            </div>
            <div class="set-row">
              <div class="set-main"><p class="set-name">模型</p>
                <p class="set-desc">推荐 qwen2.5:7b 或 llama3.1。未安装的模型需先执行 ollama pull</p></div>
              <div class="set-ctl">
                <input class="input" id="s-ollama-model" list="ollama-models" value="${esc(this.s.ollamaModel)}">
                <datalist id="ollama-models"></datalist>
              </div>
            </div>
          </div>

          <div id="deepseek-fields" style="display:none">
            <div class="set-row">
              <div class="set-main"><p class="set-name">API Key</p>
                <p class="set-desc">DeepSeek 开放平台获取（platform.deepseek.com），仅保存在本机数据库</p></div>
              <div class="set-ctl key-ctl">
                <input class="input" id="s-ds-key" type="password" value="${esc(this.s.deepseekKey)}" placeholder="sk-..." autocomplete="new-password" spellcheck="false">
                <button class="btn btn-sm" id="s-ds-eye" title="显示/隐藏"><i class="ph ph-eye"></i></button>
                <button class="btn btn-sm" id="s-ds-copy" title="复制 API Key"><i class="ph ph-copy"></i></button>
                <span class="saved-chip" id="s-ds-saved" style="display:none">已保存</span>
              </div>
            </div>
            <div class="set-row">
              <div class="set-main"><p class="set-name">Base URL</p>
                <p class="set-desc">兼容 OpenAI 协议，一般无需修改</p></div>
              <div class="set-ctl"><input class="input" id="s-ds-url" value="${esc(this.s.deepseekBaseUrl)}"></div>
            </div>
            <div class="set-row">
              <div class="set-main"><p class="set-name">模型</p>
                <p class="set-desc">deepseek-chat（V3，默认）或 deepseek-reasoner（R1 推理）</p></div>
              <div class="set-ctl"><input class="input" id="s-ds-model" value="${esc(this.s.deepseekModel)}"></div>
            </div>
          </div>

          <div id="openai-fields" style="display:none">
            <div class="set-row">
              <div class="set-main"><p class="set-name">Base URL</p>
                <p class="set-desc">兼容 OpenAI 协议的地址，例如 https://api.openai.com/v1</p></div>
              <div class="set-ctl"><input class="input" id="s-oa-url" value="${esc(this.s.openaiBaseUrl)}"></div>
            </div>
            <div class="set-row">
              <div class="set-main"><p class="set-name">API Key</p>
                <p class="set-desc">仅保存在本机数据库，不会上传到任何地方</p></div>
              <div class="set-ctl key-ctl">
                <input class="input" id="s-oa-key" type="password" value="${esc(this.s.openaiKey)}" placeholder="sk-..." autocomplete="new-password" spellcheck="false">
                <button class="btn btn-sm" id="s-oa-eye" title="显示/隐藏"><i class="ph ph-eye"></i></button>
                <button class="btn btn-sm" id="s-oa-copy" title="复制 API Key"><i class="ph ph-copy"></i></button>
                <span class="saved-chip" id="s-oa-saved" style="display:none">已保存</span>
              </div>
            </div>
            <div class="set-row">
              <div class="set-main"><p class="set-name">模型</p></div>
              <div class="set-ctl"><input class="input" id="s-oa-model" value="${esc(this.s.openaiModel)}"></div>
            </div>
          </div>

          <div id="custom-fields" style="display:none">
            <div class="set-row">
              <div class="set-main"><p class="set-name">Base URL</p>
                <p class="set-desc">任意 OpenAI 兼容端点，不局限现有厂商。例如 Ollama：http://localhost:11434/v1 · LM Studio：http://localhost:1234/v1 · 通义：https://dashscope.aliyuncs.com/compatible-mode/v1 · Moonshot / 智谱 / vLLM 等均可</p></div>
              <div class="set-ctl"><input class="input" id="s-cu-url" value="${esc(this.s.customBaseUrl)}" placeholder="http://localhost:11434/v1"></div>
            </div>
            <div class="set-row">
              <div class="set-main"><p class="set-name">模型名称</p>
                <p class="set-desc">填写该服务提供的模型名，例如 qwen2.5:7b / gpt-4o-mini / deepseek-chat</p></div>
              <div class="set-ctl"><input class="input" id="s-cu-model" value="${esc(this.s.customModel)}" placeholder="qwen2.5:7b"></div>
            </div>
            <div class="set-row">
              <div class="set-main"><p class="set-name">API Key（可选）</p>
                <p class="set-desc">本地服务（Ollama / LM Studio）通常留空即可；云端服务填写对应密钥，仅保存在本机</p></div>
              <div class="set-ctl key-ctl">
                <input class="input" id="s-cu-key" type="password" value="${esc(this.s.customKey)}" placeholder="留空表示无需密钥" autocomplete="new-password" spellcheck="false">
                <button class="btn btn-sm" id="s-cu-eye" title="显示/隐藏"><i class="ph ph-eye"></i></button>
                <button class="btn btn-sm" id="s-cu-copy" title="复制 API Key"><i class="ph ph-copy"></i></button>
                <span class="saved-chip" id="s-cu-saved" style="display:none">已保存</span>
              </div>
            </div>
          </div>

          <div class="set-row">
            <div class="set-main">
              <p class="set-name">AI 提取精准度</p>
              <p class="set-desc">影响议题/决策/遗留问题的提取范围：全面=宁多勿漏；标准=只取明确内容；保守=仅收录毫无歧义的内容</p>
            </div>
            <div class="set-ctl">
              <select class="select" id="s-ai-precision">
                <option value="thorough" ${this.s.aiPrecision === 'thorough' ? 'selected' : ''}>全面（完整提取）</option>
                <option value="balanced" ${this.s.aiPrecision === 'balanced' ? 'selected' : ''}>标准</option>
                <option value="conservative" ${this.s.aiPrecision === 'conservative' ? 'selected' : ''}>保守</option>
              </select>
            </div>
          </div>

          <div class="set-row" style="border-bottom:none">
            <div class="set-main">
              <p class="set-name">连接测试</p>
              <p class="set-desc" id="s-test-desc">点击测试按钮验证当前配置可用</p>
            </div>
            <div class="set-ctl auto">
              <button class="btn" id="s-test"><i class="ph ph-lightning"></i>测试连接</button>
            </div>
          </div>
          <div id="s-test-result"></div>
        </div>
      </div>

      <div class="set-group">
        <h2 class="set-group-title">本地转写</h2>
        <div class="card">
          <div class="set-row">
            <div class="set-main"><p class="set-name">转写引擎</p>
              <p class="set-desc">SenseVoiceSmall 为默认（安装包已内置模型与运行时，装完即用）；auto 自动探测；也可切换到 faster-whisper / whisper.cpp / openai-whisper CLI</p></div>
            <div class="set-ctl">
              <select class="select" id="s-w-engine">
                ${['sensevoice', 'auto', 'faster-whisper', 'whisper-cpp', 'openai-whisper'].map(v =>
                  `<option value="${v}" ${this.s.whisperEngine === v ? 'selected' : ''}>${{ sensevoice: 'SenseVoiceSmall（默认·内置）', auto: '自动探测', 'faster-whisper': 'faster-whisper（Python）', 'whisper-cpp': 'whisper.cpp', 'openai-whisper': 'openai-whisper CLI' }[v]}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="set-row">
            <div class="set-main"><p class="set-name">说话人区分</p>
              <p class="set-desc">按音色自动标记 男1、男2…男n / 女1、女2…女n（不限人数），写入转写文本（基于音高与声纹聚类，纯本地）</p></div>
            <div class="set-ctl">
              <select class="select" id="s-w-diarize">
                <option value="on" ${this.s.whisperDiarize === 'on' ? 'selected' : ''}>开启</option>
                <option value="off" ${this.s.whisperDiarize !== 'on' ? 'selected' : ''}>关闭</option>
              </select>
            </div>
          </div>
          <div class="set-row" id="row-w-model" style="${['faster-whisper', 'whisper-cpp', 'openai-whisper'].includes(this.s.whisperEngine) ? '' : 'display:none'}">
            <div class="set-main"><p class="set-name">Whisper 模型</p>
              <p class="set-desc">small（默认，约 460MB）中文效果良好；medium 更准但更慢</p></div>
            <div class="set-ctl"><input class="input" id="s-w-model" value="${esc(this.s.whisperModel)}"></div>
          </div>
          <div class="set-row" id="row-w-python" style="${this.s.whisperEngine === 'whisper-cpp' ? 'display:none' : ''}">
            <div class="set-main"><p class="set-name">Python 路径（可选）</p>
              <p class="set-desc">SenseVoiceSmall 与 faster-whisper 共用；留空自动使用应用内置 Python（安装包已自带，无需手动安装）。如需指定，可填 venv 的 python.exe 路径</p></div>
            <div class="set-ctl"><input class="input" id="s-w-python" value="${esc(this.s.whisperPython)}" placeholder="留空自动使用内置 Python"></div>
          </div>
          <div class="set-row" id="row-w-cpp" style="${this.s.whisperEngine === 'whisper-cpp' ? '' : 'display:none'}">
            <div class="set-main"><p class="set-name">whisper.cpp 路径（可选）</p>
              <p class="set-desc">指向 whisper-cli.exe；使用 whisper.cpp 时需同时准备 GGML 模型文件</p></div>
            <div class="set-ctl"><input class="input" id="s-w-cpp" value="${esc(this.s.whisperCppPath)}" placeholder="C:\\...\\whisper-cli.exe"></div>
          </div>
        </div>
      </div>

      <div class="set-group">
        <h2 class="set-group-title">语音转录模型</h2>
        <div class="card">
          <div class="set-row">
            <div class="set-main"><p class="set-name">模型选择</p>
              <p class="set-desc">SenseVoiceSmall 为默认转录模型，安装包已内置（免下载、离线可用）；Whisper 模型不随安装包分发，选择后点击下方按钮按需下载。模型下载完成后会自动设置转录文本目录（默认 D:\ClawOutput\议迹转写文本）</p></div>
            <div class="set-ctl">
              <select class="select" id="m-model">
                <option value="sensevoice">SenseVoiceSmall（默认·内置）</option>
                <option value="whisper-small">Whisper small（约460MB）</option>
                <option value="whisper-base">Whisper base（约142MB）</option>
              </select>
            </div>
          </div>
          <div class="set-row">
            <div class="set-main">
              <p class="set-name">当前状态</p>
              <p class="set-desc" id="m-status">检测中…</p>
            </div>
            <div class="set-ctl auto" style="gap:8px">
              <button class="btn" id="m-open-dir" style="display:none"><i class="ph ph-folder-open"></i>打开模型目录</button>
              <button class="btn btn-primary" id="m-download"><i class="ph ph-download-simple"></i>一键下载安装</button>
            </div>
          </div>
          <div class="set-row" id="m-progress-row" style="display:none;border-bottom:none">
            <div class="set-main" style="width:100%">
              <div class="progress-track"><div class="progress-fill" id="m-progress-fill" style="width:0%"></div></div>
              <p class="set-desc" id="m-progress-text" style="margin-top:6px"></p>
            </div>
          </div>
        </div>
      </div>

      <div class="set-group">
        <h2 class="set-group-title">对比参数</h2>
        <div class="card">
          <div class="set-row" style="border-bottom:none">
            <div class="set-main">
              <p class="set-name">跨会议匹配相似度阈值</p>
              <p class="set-desc">越高匹配越严格（更少误判、更多“新增”）；越低合并越宽松（更多“保持不变”）</p>
            </div>
            <div class="set-ctl auto">
              <div class="slider-row">
                <input type="range" id="s-threshold" min="0.3" max="0.8" step="0.05" value="${this.s.matchThreshold || 0.55}">
                <span class="slider-val" id="s-threshold-val">${this.s.matchThreshold || 0.55}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="set-group">
        <h2 class="set-group-title">存储</h2>
        <div class="card">
          <div class="set-row">
            <div class="set-main"><p class="set-name">录音文件目录</p>
              <p class="set-desc">WAV 录音保存在此目录；留空时默认 D:\ClawOutput\议迹录音（D 盘不可用时回退到应用数据目录）</p></div>
            <div class="set-ctl dir-ctl">
              <input class="input" id="s-rec-dir" value="${esc(this.s.recordingsDir)}" placeholder="默认：D:\ClawOutput\议迹录音">
              <button class="btn btn-sm" id="s-rec-pick" title="选择目录"><i class="ph ph-folder-open"></i>选择</button>
            </div>
          </div>
          <div class="set-row">
            <div class="set-main"><p class="set-name">转写文本目录</p>
              <p class="set-desc">转写出的文字默认以 .txt 存档于此；留空默认 D:\ClawOutput\议迹转写文本（D 盘不可用时回退应用数据目录）</p></div>
            <div class="set-ctl dir-ctl">
              <input class="input" id="s-tt-dir" value="${esc(this.s.transcriptsDir)}" placeholder="默认：D:\ClawOutput\议迹转写文本">
              <button class="btn btn-sm" id="s-tt-pick" title="选择目录"><i class="ph ph-folder-open"></i>选择</button>
            </div>
          </div>
          <div class="set-row" style="border-bottom:none">
            <div class="set-main"><p class="set-name">打开目录</p>
              <p class="set-desc" id="s-data-desc">SQLite 数据库位于应用数据目录，备份时复制该文件即可</p></div>
            <div class="set-ctl auto" style="gap:8px">
              <button class="btn" id="s-open-rec"><i class="ph ph-folder-open"></i>打开录音目录</button>
              <button class="btn" id="s-open-tt"><i class="ph ph-folder-open"></i>打开转写文本目录</button>
            </div>
          </div>
        </div>
      </div>

      <div class="set-group">
        <h2 class="set-group-title">关于</h2>
        <div class="card">
          <div class="set-row" style="border-bottom:none">
            <div class="set-main"><p class="set-name">议迹 v1.7.0</p>
              <p class="set-desc">本地免登录桌面应用：任务会议追踪与自动对比。数据全部存储在本机 SQLite；默认转录模型 SenseVoiceSmall 已内置（模型 + Python 运行时随安装包分发，装完即用、完全离线）；AI 纪要支持 Ollama / DeepSeek / OpenAI / 任意自定义 OpenAI 兼容服务。</p></div>
          </div>
        </div>
      </div>
    </div>`;

    this.bind();
  },

  save(patch) {
    this.s = { ...this.s, ...patch };
    window.api.settings.set(patch);
    App.settings = { ...App.settings, ...patch };
  },

  bind() {
    const view = App.viewEl;
    const toggleProvider = (prov) => {
      this.save({ aiProvider: prov });
      $$('#ollama-fields, #openai-fields, #deepseek-fields, #custom-fields', view).forEach(el => el.style.display = 'none');
      if (prov === 'openai') $('#openai-fields', view).style.display = '';
      else if (prov === 'deepseek') $('#deepseek-fields', view).style.display = '';
      else if (prov === 'custom') $('#custom-fields', view).style.display = '';
      else $('#ollama-fields', view).style.display = '';
      $$('.seg button', view).forEach(b => b.classList.toggle('active', b.dataset.prov === prov));
    };
    $$('.seg button', view).forEach(btn => {
      btn.addEventListener('click', () => toggleProvider(btn.dataset.prov));
    });

    const bindInput = (id, key, type = 'text', flashSaved = false) => {
      // 输入即保存（不依赖失焦），保证 Key 填完立即生效且重启后保留
      $(`#${id}`, view).addEventListener(type === 'input' ? 'input' : 'change', (e) => {
        this.save({ [key]: e.target.value });
        if (flashSaved) {
          const chip = $(`#${id}-saved`, view);
          if (chip) {
            chip.style.display = '';
            clearTimeout(chip._t);
            chip._t = setTimeout(() => { chip.style.display = 'none'; }, 1600);
          }
        }
      });
    };
    bindInput('s-ollama-url', 'ollamaUrl', 'change');
    bindInput('s-ollama-model', 'ollamaModel', 'change');
    bindInput('s-ds-key', 'deepseekKey', 'input', true);
    bindInput('s-ds-url', 'deepseekBaseUrl', 'change');
    bindInput('s-ds-model', 'deepseekModel', 'change');
    bindInput('s-oa-url', 'openaiBaseUrl', 'change');
    bindInput('s-oa-key', 'openaiKey', 'input', true);
    bindInput('s-oa-model', 'openaiModel', 'change');
    bindInput('s-cu-url', 'customBaseUrl', 'change');
    bindInput('s-cu-model', 'customModel', 'change');
    bindInput('s-cu-key', 'customKey', 'input', true);
    bindInput('s-ai-precision', 'aiPrecision', 'change');

    // API Key 显隐切换
    const bindEye = (btnId, inputId) => {
      $('#' + btnId, view)?.addEventListener('click', () => {
        const inp = $('#' + inputId, view);
        const btn = $('#' + btnId, view);
        const show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        btn.innerHTML = `<i class="ph ${show ? 'ph-eye-slash' : 'ph-eye'}"></i>`;
      });
    };
    bindEye('s-ds-eye', 's-ds-key');
    bindEye('s-oa-eye', 's-oa-key');
    bindEye('s-cu-eye', 's-cu-key');

    // API Key 复制按钮
    const bindCopy = (btnId, inputId) => {
      $('#' + btnId, view)?.addEventListener('click', async () => {
        const val = $('#' + inputId, view).value;
        if (!val) { App.toast('还没有可复制的 Key', 'err'); return; }
        try {
          await window.api.clipboard.write(val);
          App.toast('API Key 已复制');
        } catch (e) {
          App.toast('复制失败：' + e.message, 'err');
        }
      });
    };
    bindCopy('s-ds-copy', 's-ds-key');
    bindCopy('s-oa-copy', 's-oa-key');
    bindCopy('s-cu-copy', 's-cu-key');
    bindInput('s-w-engine', 'whisperEngine', 'change');
    // 引擎联动：只有选 whisper 系引擎时才显示 Whisper 模型 / whisper.cpp 相关行
    const syncEngineRows = () => {
      const eng = this.s.whisperEngine || 'sensevoice';
      const whisperEng = ['faster-whisper', 'whisper-cpp', 'openai-whisper'];
      $('#row-w-model', view).style.display = whisperEng.includes(eng) ? '' : 'none';
      $('#row-w-python', view).style.display = eng === 'whisper-cpp' ? 'none' : '';
      $('#row-w-cpp', view).style.display = eng === 'whisper-cpp' ? '' : 'none';
    };
    $('#s-w-engine', view).addEventListener('change', syncEngineRows);
    bindInput('s-w-diarize', 'whisperDiarize', 'change');
    bindInput('s-w-model', 'whisperModel', 'change');
    bindInput('s-w-python', 'whisperPython', 'change');
    bindInput('s-w-cpp', 'whisperCppPath', 'change');
    bindInput('s-rec-dir', 'recordingsDir', 'change');
    bindInput('s-tt-dir', 'transcriptsDir', 'change');

    // 目录选择器：录音 / 转写文本目录
    const bindPickDir = (btnId, inputId, key, title) => {
      $('#' + btnId, view).addEventListener('click', async () => {
        try {
          const cur = $('#' + inputId, view).value;
          const res = await window.api.paths.pickDir({ title, defaultPath: cur || undefined });
          if (!res.canceled && res.path) {
            $('#' + inputId, view).value = res.path;
            this.save({ [key]: res.path });
            App.toast('目录已更新');
          }
        } catch (e) { App.toast('选择目录失败：' + e.message, 'err'); }
      });
    };
    bindPickDir('s-rec-pick', 's-rec-dir', 'recordingsDir', '选择录音文件目录');
    bindPickDir('s-tt-pick', 's-tt-dir', 'transcriptsDir', '选择转写文本目录');

    // 语音转录模型：状态与一键下载（统一入口，可选 SenseVoiceSmall / Whisper）
    const refreshModel = async () => {
      try {
        const st = await window.api.sensevoice.status();
        const el = $('#m-status', view);
        const openBtn = $('#m-open-dir', view);
        const sel = $('#m-model', view).value;
        if (sel === 'sensevoice') {
          if (st.asrInstalled) {
            const tag = st.bundled ? '（安装包内置）' : '';
            el.textContent = `已安装 ✓${tag} 识别模型 ${(st.asrSize / 1048576).toFixed(0)}MB${st.puncInstalled ? ` · 标点模型 ${(st.puncSize / 1048576).toFixed(0)}MB` : ''} · ${st.asrDir}`;
            openBtn.style.display = '';
            openBtn.onclick = () => window.api.shell.openPath(st.asrDir);
          } else {
            el.textContent = '未安装 · 免费 Apache 2.0 · ModelScope 官方源（安装包已内置，通常无需下载）';
            openBtn.style.display = 'none';
          }
        } else {
          if (st.whisperInstalled) {
            el.textContent = `已安装 ✓ Whisper ${sel === 'whisper-base' ? 'base' : 'small'} · ${st.whisperDir}`;
            openBtn.style.display = '';
            openBtn.onclick = () => window.api.shell.openPath(st.whisperDir);
          } else {
            el.textContent = '未安装 · HuggingFace 官方源（失败自动切 hf-mirror 镜像）';
            openBtn.style.display = 'none';
          }
        }
      } catch (e) {
        $('#m-status', view).textContent = '状态获取失败：' + e.message;
      }
    };
    $('#m-model', view).addEventListener('change', refreshModel);
    refreshModel();
    $('#m-download', view).addEventListener('click', async () => {
      const btn = $('#m-download', view);
      const row = $('#m-progress-row', view);
      const fill = $('#m-progress-fill', view);
      const txt = $('#m-progress-text', view);
      const type = $('#m-model', view).value;
      btn.disabled = true;
      row.style.display = '';
      fill.style.width = '0%';
      txt.textContent = '准备中…（将先询问安装目录）';
      const off = window.api.model.onProgress((d) => {
        fill.style.width = Math.round(d.percent * 100) + '%';
        txt.textContent = `${d.text || ''}（${Math.round(d.percent * 100)}%）`;
      });
      try {
        const res = await window.api.model.download({ type, withPunc: this.s.svPunc !== 'off' });
        if (res.canceled) { App.toast('已取消安装'); }
        else if (res.ok) {
          const patch = { transcriptsDir: res.transcriptsDir || this.s.transcriptsDir };
          if (type === 'sensevoice') patch.svModelDir = res.modelDir;
          else Object.assign(patch, { whisperModelDir: res.modelDir, whisperModel: type === 'whisper-base' ? 'base' : 'small', whisperEngine: 'faster-whisper' });
          this.save(patch);
          App.toast(`安装完成，转写已自动切换。转录文本目录：${res.transcriptsDir || 'D:\\ClawOutput\\议迹转写文本'}`);
        } else { App.toast('安装失败：' + (res.error || '未知错误'), 'err'); }
      } catch (e) { App.toast('安装失败：' + e.message, 'err'); }
      finally {
        off();
        btn.disabled = false;
        setTimeout(() => { row.style.display = 'none'; }, 800);
        refreshModel();
      }
    });

    // 阈值滑块
    const slider = $('#s-threshold', view);
    slider.addEventListener('input', () => {
      $('#s-threshold-val', view).textContent = slider.value;
      this.save({ matchThreshold: slider.value });
    });

    // 测试连接
    $('#s-test', view).addEventListener('click', async () => {
      const btn = $('#s-test', view);
      btn.disabled = true;
      btn.innerHTML = `<i class="ph ph-circle-notch spin"></i>测试中…`;
      const box = $('#s-test-result', view);
      try {
        const res = await window.api.ai.test();
        box.innerHTML = `<div class="test-result ok"><i class="ph ph-check-circle"></i><span>${esc(res.message)}</span></div>`;
        if (res.models) {
          const dl = $('#ollama-models', view);
          dl.innerHTML = res.models.map(m => `<option value="${esc(m)}">`).join('');
        }
      } catch (e) {
        box.innerHTML = `<div class="test-result err"><i class="ph ph-warning-circle"></i><span>${esc(e.message)}</span></div>`;
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ph ph-lightning"></i>测试连接`;
      }
    });

    // 拉取 Ollama 模型列表（datalist）
    (async () => {
      try {
        const models = await window.api.ai.listOllamaModels();
        $('#ollama-models', view).innerHTML = models.map(m => `<option value="${esc(m)}">`).join('');
      } catch (_) {}
    })();

    $('#s-open-rec', view).addEventListener('click', async () => {
      const dir = await window.api.paths.recordings();
      window.api.shell.showInFolder(dir);
    });
    $('#s-open-tt', view).addEventListener('click', async () => {
      const dir = await window.api.paths.transcripts();
      window.api.shell.openPath(dir);
    });
  },
};
