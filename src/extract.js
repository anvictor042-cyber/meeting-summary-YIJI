'use strict';
/**
 * 附件内容提取：Word(.docx) / PDF / TXT / MD → 纯文本
 * 供「提取到转写文本」功能使用；音频由 Whisper 转写（见 transcribe.js）
 */
const fs = require('fs');
const path = require('path');

function stripXml(xml) {
  // 段落标签 → 换行
  let t = xml.replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  return t.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

function extractDocx(filePath) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('文档中没有 document.xml（可能不是标准 docx）');
  return stripXml(entry.getData().toString('utf8'));
}

async function extractPdf(filePath) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs');
  const { pathToFileURL } = require('url');
  const stdFontDir = path.join(path.dirname(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')), 'standard_fonts');
  const standardFontDataUrl = pathToFileURL(stdFontDir + path.sep).href;
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true, standardFontDataUrl }).promise;
  const parts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let lastY = null;
    for (const item of content.items) {
      if (item.str === undefined) continue;
      const y = item.transform ? item.transform[5] : 0;
      if (lastY !== null && Math.abs(y - lastY) > 3) parts.push('\n');
      parts.push(item.str);
      lastY = y;
    }
    parts.push('\n');
  }
  if (doc && typeof doc.destroy === 'function') await doc.destroy().catch(() => {});
  return String(parts.join('')).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 提取文本；返回 { text, sourceType }
 * sourceType: docx | pdf | txt | unsupported
 */
async function extractText(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.docx') {
    return { text: extractDocx(filePath), sourceType: 'docx' };
  }
  if (ext === '.pdf') {
    return { text: await extractPdf(filePath), sourceType: 'pdf' };
  }
  if (ext === '.txt' || ext === '.md' || ext === '.text') {
    return { text: fs.readFileSync(filePath, 'utf8').trim(), sourceType: 'txt' };
  }
  return { text: '', sourceType: 'unsupported' };
}

module.exports = { extractText };
