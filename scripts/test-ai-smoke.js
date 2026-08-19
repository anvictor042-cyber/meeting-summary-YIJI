// AI 冒烟测试：Ollama 连接 + 模型列表 + 结构化纪要生成 + 自定义 OpenAI 兼容端点（真实调用）
const ai = require('../src/ai');
const { DEFAULTS } = require('../src/settings');

(async () => {
  try {
    const t = await ai.test({ ...DEFAULTS });
    console.log('AI_TEST:', JSON.stringify(t));
    const models = await ai.listOllamaModels({ ...DEFAULTS });
    console.log('MODELS:', models.join(','));
    const out = await ai.generateStructuredSummary({
      meeting: { date: '2026-08-05', topic: '回归测试会议', attendees: 'Vincent' },
      notes: [{ type: 'topic', content: '测试 AI 链路' }, { type: 'decision', content: '采用本地 Ollama' }],
      transcript: '我们今天讨论了回归测试，决定采用本地 Ollama 跑 AI，由 Vincent 负责跟进。',
    }, { ...DEFAULTS });
    console.log('SUMMARY_OK keys:', Object.keys(out).join(','));
    console.log('SUMMARY_SAMPLE:', (out.summary || '').slice(0, 40));

    // 自定义 OpenAI 兼容端点：指向本机 Ollama 的 /v1（验证 custom provider 分支）
    const custom = {
      ...DEFAULTS,
      aiProvider: 'custom',
      customBaseUrl: 'http://localhost:11434/v1',
      customModel: DEFAULTS.ollamaModel,
    };
    const ct = await ai.test(custom);
    console.log('CUSTOM_TEST:', JSON.stringify(ct));
    const cres = await ai.chat([{ role: 'user', content: '只回复两个字：好的' }], custom, 0);
    console.log('CUSTOM_CHAT:', (cres || '').slice(0, 30));
    console.log('AI_SMOKE_PASS');
    process.exit(0);
  } catch (e) {
    console.error('AI_SMOKE_FAIL:', e.message);
    process.exit(1);
  }
})();
