'use strict';
/**
 * AI 服务层：Ollama（默认）与 OpenAI 兼容 API
 * 能力：结构化纪要生成、对比改进总结、连接测试、模型列表
 */
const http = require('http');
const https = require('https');

function httpJson(url, { method = 'POST', headers = {}, body = null, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(data ? JSON.parse(data) : {}); }
          catch (e) { reject(new Error(`响应解析失败：${data.slice(0, 200)}`)); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}：${data.slice(0, 300)}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('请求超时（120s）。请确认 Ollama 已启动且模型已拉取。')); });
    req.on('error', (e) => reject(e));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function provider(s) {
  return s.aiProvider === 'openai' ? 'openai' : s.aiProvider === 'deepseek' ? 'deepseek' : s.aiProvider === 'custom' ? 'custom' : 'ollama';
}

/** 通用对话接口（messages: [{role, content}]） */
async function chat(messages, s, temperature = 0.3) {
  const p = provider(s);
  if (p === 'openai' || p === 'deepseek' || p === 'custom') {
    let base, key, model;
    if (p === 'custom') {
      // 自定义 OpenAI 兼容端点：不局限任何厂商，baseUrl 指向任意兼容 /chat/completions 的服务
      base = String(s.customBaseUrl || '').replace(/\/+$/, '');
      key = s.customKey || '';
      model = s.customModel || '';
      if (!base) throw new Error('未配置自定义服务 Base URL（例如 http://localhost:11434/v1 或 https://api.xxx.com/v1），请到设置中填写。');
      if (!model) throw new Error('未配置自定义服务模型名称，请到设置中填写。');
    } else {
      base = String(p === 'openai' ? s.openaiBaseUrl : s.deepseekBaseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
      key = p === 'openai' ? s.openaiKey : s.deepseekKey;
      if (!key) throw new Error(p === 'openai' ? '未配置 OpenAI API Key，请到设置中填写。' : '未配置 DeepSeek API Key，请到设置中填写。');
      model = (p === 'openai' ? s.openaiModel : s.deepseekModel) || (p === 'openai' ? 'gpt-4o-mini' : 'deepseek-chat');
    }
    const headers = {};
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await httpJson(`${base}/chat/completions`, {
      body: { model, messages, temperature, stream: false },
      headers,
    });
    return res.choices?.[0]?.message?.content ?? '';
  }
  const url = String(s.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
  const res = await httpJson(`${url}/api/chat`, {
    body: { model: s.ollamaModel || 'qwen2.5:7b', messages, stream: false, options: { temperature } },
  });
  return res.message?.content ?? '';
}

/** 从模型输出中稳妥提取 JSON */
function extractJson(text) {
  if (!text) throw new Error('模型返回为空');
  const cleaned = String(text).replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('模型未返回 JSON，请重试或更换模型。');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function buildMeetingContext(meeting, notes) {
  const group = (type) => notes.filter(n => n.type === type).map(n => n.content);
  return {
    date: meeting.date,
    topic: meeting.topic,
    attendees: meeting.attendees,
    topics: group('topic'),
    decisions: group('decision'),
    actions: notes.filter(n => n.type === 'action').map(n => ({
      content: n.content, assignee: n.assignee, due_date: n.due_date, status: n.status,
    })),
    issues: group('issue'),
  };
}

/** AI 生成结构化纪要 */
async function generateStructuredSummary({ meeting, notes, transcript }, s) {
  const ctx = buildMeetingContext(meeting, notes);
  const PRECISION = {
    conservative: '提取标准（保守）：只提取非常明确、毫无歧义的内容；模糊、存疑、泛泛而谈的一律不要',
    balanced: '提取标准（标准）：提取明确达成的内容，忽略泛泛而谈与过程性描述',
    thorough: '提取标准（全面）：完整提取所有相关内容，宁多勿漏，不遗漏任何实质信息',
  };
  const precisionRule = PRECISION[s.aiPrecision] || PRECISION.thorough;
  const prompt = `你是资深的会议纪要整理助手。请根据下面的会议转写文本，生成结构化纪要。

${precisionRule}

通用要求：
- 忠实于转写原意：保留关键数字、人名、时间、条件，不臆造、不合并
- 忽略寒暄问候、重复表述、闲聊客套；实质内容一律保留
- 同一条内容不要拆分重复；措辞精炼，去掉修饰词
- 条数不设上限，完整覆盖所有重要内容

要求：
1. 核心议题 topics：每条一句话概括一个讨论主题
2. 关键决策 decisions：提取会上形成的明确结论/方向，结论式措辞（如"采用 X，放弃 Y"）。只收录结论本身，不含执行细节
3. 待办事项 actions：具体可执行的任务，每条包含 content（动词开头的事项）、assignee（负责人姓名，无法确定则为空）、due_date（截止日期 YYYY-MM-DD，未提则为空）
4. 遗留问题 issues：所有未解决或有风险的问题
5. summary：40 字以内的一句话摘要，点出本次会议最重要的结论
6. minutes_full：完整会议纪要，用 markdown 风格成文。开头先用一段"**核心结论**"概括本次会议最重要的 1-2 件事，再用 ## 核心议题 / ## 关键决策 / ## 待办事项 / ## 遗留问题 分段展开，把议题讨论过程、决策理由、待办细节连贯叙述，字数不限、完整覆盖，可直接作为存档文档

去重规则：决策与待办不得重复。同一事项只归入一个分类——如果它已经作为决策写出，就不要在待办里重复出现（即使措辞略不同）；若某事项既有结论又有独立的执行动作，则决策里写结论，待办里写带负责人的执行动作。

只输出 JSON 对象，不要任何其他文字或 markdown 代码块，格式：
{"topics":["..."],"decisions":["..."],"actions":[{"content":"...","assignee":"","due_date":""}],"issues":["..."],"summary":"...","minutes_full":"..."}

会议主题：${ctx.topic || '（未填写）'}
参会人员：${ctx.attendees || '（未填写）'}

转写文本：
${transcript}`;
  const out = await chat([{ role: 'user', content: prompt }], s, 0.2);
  return extractJson(out);
}

/** AI 生成两次会议的改进总结 */
async function generateComparisonSummary(a, b, s) {
  const fmt = (m) => {
    const notes = m.notes || [];
    const g = (t) => notes.filter(n => n.type === t).map(n => `- ${n.content}`).join('\n') || '（无）';
    return `【${m.date} ${m.topic}】
议题：
${g('topic')}
决策：
${g('decision')}
待办：
${notes.filter(n => n.type === 'action').map(n => `- ${n.content}（负责人：${n.assignee || '未指定'}，状态：${n.status || '未开始'}）`).join('\n') || '（无）'}
遗留问题：
${g('issue')}`;
  };
  const prompt = `你是项目推进分析助手。下面是同一任务下两次会议的纪要（第一次为旧，第二次为新）。请生成"改进总结"，以**要点列表**形式输出（每条一行、以"- "开头，共 4-6 条），按顺序覆盖：
- 议题聚焦的变化
- 决策的演进与调整（方向性变化优先）
- 待办推进情况（突出关键路径上的事项）
- 遗留问题的解决情况
- 下一步建议

要求：每条一句话，抓重点、讲变化；不要输出标题、段落或多余解释。

第一次会议（旧）：
${fmt(a)}

第二次会议（新）：
${fmt(b)}`;
  return await chat([{ role: 'user', content: prompt }], s, 0.4);
}

/** 连接测试 */
async function test(s) {
  if (provider(s) === 'openai') {
    if (!s.openaiKey) return { ok: false, message: '未填写 OpenAI API Key' };
    const res = await chat([{ role: 'user', content: 'ping' }], s, 0);
    return { ok: true, message: `OpenAI 连接成功（${s.openaiModel}）` };
  }
  if (provider(s) === 'deepseek') {
    if (!s.deepseekKey) return { ok: false, message: '未填写 DeepSeek API Key' };
    const res = await chat([{ role: 'user', content: 'ping' }], s, 0);
    return { ok: true, message: `DeepSeek 连接成功（${s.deepseekModel}）` };
  }
  if (provider(s) === 'custom') {
    if (!s.customBaseUrl || !s.customModel) return { ok: false, message: '请先填写自定义服务的 Base URL 与模型名称' };
    const res = await chat([{ role: 'user', content: 'ping' }], s, 0);
    return { ok: true, message: `自定义服务连接成功（${s.customModel}）` };
  }
  const url = String(s.ollamaUrl || '').replace(/\/+$/, '');
  const res = await httpJson(`${url}/api/tags`, { method: 'GET', timeoutMs: 8000 });
  const models = (res.models || []).map(m => m.name);
  const wanted = s.ollamaModel;
  const found = models.includes(wanted);
  return {
    ok: true,
    message: found
      ? `Ollama 连接成功，模型 ${wanted} 已就绪`
      : `Ollama 连接成功，但未找到模型 ${wanted}。已安装：${models.join('、') || '（无）'}。请运行：ollama pull ${wanted}`,
    models,
  };
}

/** 列出 Ollama 模型 */
async function listOllamaModels(s) {
  const url = String(s.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
  const res = await httpJson(`${url}/api/tags`, { method: 'GET', timeoutMs: 8000 });
  return (res.models || []).map(m => m.name).sort();
}

module.exports = { chat, generateStructuredSummary, generateComparisonSummary, test, listOllamaModels };
