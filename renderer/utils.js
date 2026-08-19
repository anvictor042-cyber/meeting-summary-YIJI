'use strict';
/* 议迹 · 渲染层共享工具 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(String(d).length === 10 ? `${d}T00:00:00` : d);
  if (isNaN(dt)) return String(d);
  const p = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

/** 友好日期：今天/昨天/日期 */
function relDate(d) {
  const today = fmtDate(new Date());
  const yesterday = fmtDate(new Date(Date.now() - 864e5));
  if (d === today) return '今天';
  if (d === yesterday) return '昨天';
  return d;
}

function fmtTimecode(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ---------- 文本相似度（中英文混合） ---------- */
function normTxt(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '');
}

function grams(s) {
  const t = normTxt(s);
  if (!t) return new Set();
  const isCJK = /[\u4e00-\u9fff]/.test(t);
  const out = new Set();
  if (isCJK) {
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
    if (t.length === 1) out.add(t);
  } else {
    t.split(/[^a-z0-9]+/).filter(Boolean).forEach(w => out.add(w));
  }
  return out;
}

/** Dice 相似度 0-1 */
function sim(a, b) {
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/**
 * 字符级 LCS diff，返回 [{type:'same'|'add'|'del', text}]
 */
function charDiff(a, b) {
  a = String(a || ''); b = String(b || '');
  const m = a.length, n = b.length;
  if (!m && !n) return [];
  if (!m) return [{ type: 'add', text: b }];
  if (!n) return [{ type: 'del', text: a }];
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i++] });
    } else {
      out.push({ type: 'add', text: b[j++] });
    }
  }
  while (i < m) out.push({ type: 'del', text: a[i++] });
  while (j < n) out.push({ type: 'add', text: b[j++] });
  // 合并相邻同类型
  const merged = [];
  for (const seg of out) {
    const last = merged[merged.length - 1];
    if (last && last.type === seg.type) last.text += seg.text;
    else merged.push({ ...seg });
  }
  return merged;
}

function diffHtml(parts) {
  return parts.map(p => {
    if (p.type === 'same') return esc(p.text);
    if (p.type === 'add') return `<span class="hl-add">${esc(p.text)}</span>`;
    return `<span class="hl-del">${esc(p.text)}</span>`;
  }).join('');
}

/* ---------- 说话人着色标注 ---------- */
// 男声用冷色系，女声用暖色系；按编号循环取色，超出回绕
const SPEAKER_MALE = ['#2F5F8F', '#3E7C6F', '#5A4E9E', '#2E6E8F', '#3E6E8F'];
const SPEAKER_FEMALE = ['#B3402F', '#A63E7E', '#C96A3B', '#B3542F', '#9C3E5E'];

function speakerColor(speaker) {
  const m = /^(男|女)(\d+)$/.exec(String(speaker || ''));
  if (!m) return '#76736A';
  const arr = m[1] === '女' ? SPEAKER_FEMALE : SPEAKER_MALE;
  return arr[(parseInt(m[2], 10) - 1) % arr.length];
}

/** 解析转写文本：[男1]/[女1] 标记切分为带说话人标注的段落 */
function parseTranscript(text) {
  const out = [];
  const re = /\[(男|女)(\d+)\]/g;
  let last = 0, pending = null, m;
  while ((m = re.exec(text)) !== null) {
    const pre = text.slice(last, m.index);
    if (pending) { pending.text = pre; out.push(pending); pending = null; }
    else if (pre.trim()) out.push({ speaker: null, text: pre.trim() });
    pending = { speaker: m[1] + m[2], text: '' };
    last = re.lastIndex;
  }
  const tail = text.slice(last);
  if (pending) { pending.text = tail; out.push(pending); }
  else if (tail.trim()) out.push({ speaker: null, text: tail.trim() });
  return out;
}

/** 渲染说话人着色视图（每人一种颜色） */
function renderSpeakerView(text) {
  const segs = parseTranscript(String(text || ''));
  return segs.filter(s => s.text.trim()).map(s => {
    if (!s.speaker) return `<div class="sp-row"><span class="sp-text sp-plain">${esc(s.text.trim())}</span></div>`;
    const c = speakerColor(s.speaker);
    return `<div class="sp-row"><span class="sp-chip" style="color:${c};background:${c}1A;border-color:${c}40">${esc(s.speaker)}</span>`
      + `<span class="sp-text">${esc(s.text.trim())}</span></div>`;
  }).join('') || '<p class="empty-txt" style="margin:0">暂无转写内容</p>';
}

window.Utils = { $, $$, esc, fmtDate, relDate, fmtTimecode, debounce, sim, charDiff, diffHtml, speakerColor, parseTranscript, renderSpeakerView };
