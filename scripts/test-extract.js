// 附件提取测试 v2：docx / pdf（pdfkit 生成，含压缩流）/ txt
const fs = require('fs');
const AdmZip = require('adm-zip');
const { extractText } = require('../src/extract');

async function main() {
  const zip = new AdmZip();
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:r><w:t>会议纪要测试文档：确认附件提取功能范围。</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>第二条：Word 与 PDF 提取到转写文本。</w:t></w:r></w:p>' +
    '</w:body></w:document>';
  zip.addFile('word/document.xml', Buffer.from(xml, 'utf8'));
  zip.writeZip('t.docx');

  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ compress: true }); // 默认压缩，验证解压能力
  doc.pipe(fs.createWriteStream('t.pdf'));
  doc.fontSize(12).text('会议纪要附件测试：本 PDF 包含需要提取的文字内容。');
  doc.text('第二行：附件提取功能验收通过。');
  doc.end();
  await new Promise(r => setTimeout(r, 600));

  fs.writeFileSync('t.txt', '纯文本附件：会议通知内容。');

  const d = await extractText('t.docx');
  console.log('DOCX:', JSON.stringify(d.text), '|', d.sourceType);
  const p = await extractText('scripts/test-sample.pdf');
  console.log('PDF :', JSON.stringify(p.text), '|', p.sourceType);
  const t = await extractText('t.txt');
  console.log('TXT :', JSON.stringify(t.text), '|', t.sourceType);

  fs.unlinkSync('t.docx'); fs.unlinkSync('t.pdf'); fs.unlinkSync('t.txt');
  console.log('ALL_EXTRACT_TESTS_PASSED');
}
main().catch(e => { console.error('TEST_FAIL', e.message); process.exit(1); });
