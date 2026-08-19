'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/** 渲染进程唯一可用的 API 面。所有数据操作均经由此处。 */
contextBridge.exposeInMainWorld('api', {
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    create: (p) => ipcRenderer.invoke('tasks:create', p),
    update: (p) => ipcRenderer.invoke('tasks:update', p),
    remove: (id) => ipcRenderer.invoke('tasks:remove', id),
  },
  meetings: {
    listByTask: (taskId) => ipcRenderer.invoke('meetings:listByTask', taskId),
    get: (id) => ipcRenderer.invoke('meetings:get', id),
    create: (p) => ipcRenderer.invoke('meetings:create', p),
    update: (p) => ipcRenderer.invoke('meetings:update', p),
    remove: (id) => ipcRenderer.invoke('meetings:remove', id),
  },
  notes: {
    listForMeeting: (meetingId) => ipcRenderer.invoke('notes:listForMeeting', meetingId),
    replaceForMeeting: (p) => ipcRenderer.invoke('notes:replaceForMeeting', p),
    add: (p) => ipcRenderer.invoke('notes:add', p),
    update: (p) => ipcRenderer.invoke('notes:update', p),
    remove: (id) => ipcRenderer.invoke('notes:remove', id),
  },
  comparisons: {
    get: (p) => ipcRenderer.invoke('comparisons:get', p),
    save: (p) => ipcRenderer.invoke('comparisons:save', p),
  },
  audio: {
    save: (buffer, ext) => ipcRenderer.invoke('audio:save', { buffer, ext }),
    startStream: () => ipcRenderer.invoke('audio:startStream'),
    appendChunk: (buf) => ipcRenderer.invoke('audio:appendChunk', buf),
    endStream: () => ipcRenderer.invoke('audio:endStream'),
    saveTo: (path, buffer) => ipcRenderer.invoke('audio:saveTo', { path, buffer }),
    delete: (path) => ipcRenderer.invoke('audio:delete', path),
  },
  attachments: {
    list: (meetingId) => ipcRenderer.invoke('attachments:list', meetingId),
    add: (p) => ipcRenderer.invoke('attachments:add', p),
    remove: (id) => ipcRenderer.invoke('attachments:remove', id),
    open: (id) => ipcRenderer.invoke('attachments:open', id),
    extractToTranscript: (id, meetingId) => ipcRenderer.invoke('attachments:extractToTranscript', { id, meetingId }),
  },
  transcribe: {
    run: (audioPath) => ipcRenderer.invoke('transcribe:run', { audioPath }),
  },
  ai: {
    chat: (messages, temperature) => ipcRenderer.invoke('ai:chat', { messages, temperature }),
    generateSummary: (meetingId) => ipcRenderer.invoke('ai:generateSummary', meetingId),
    compareSummary: (a, b) => ipcRenderer.invoke('ai:compareSummary', { a, b }),
    test: () => ipcRenderer.invoke('ai:test'),
    listOllamaModels: () => ipcRenderer.invoke('ai:listOllamaModels'),
  },
  exportApi: {
    saveCompare: (md, defaultName) => ipcRenderer.invoke('export:saveCompare', { md, defaultName }),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  sensevoice: {
    status: () => ipcRenderer.invoke('sensevoice:status'),
  },
  model: {
    download: (opts) => ipcRenderer.invoke('model:download', opts),
    onProgress: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('sensevoice:progress', h);
      return () => ipcRenderer.removeListener('sensevoice:progress', h);
    },
  },
  clipboard: {
    write: (text) => ipcRenderer.invoke('clipboard:write', text),
  },
  paths: {
    recordings: () => ipcRenderer.invoke('paths:recordings'),
    transcripts: () => ipcRenderer.invoke('paths:transcripts'),
    pickDir: (opts) => ipcRenderer.invoke('dialog:pickDir', opts),
  },
  shell: {
    showInFolder: (p) => ipcRenderer.invoke('shell:showInFolder', p),
    openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
    openSetupScript: () => ipcRenderer.invoke('shell:openSetupScript'),
  },
});
