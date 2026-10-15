import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const assignment = path.join(root, 'assignment');
const output = path.join(assignment, 'output');
const names = ['part-1-pipeline.md', 'part-2-ar-prototype.md', 'part-3-image-review.md'];
const documents = await Promise.all(names.map(name => fs.readFile(path.join(assignment, name), 'utf8')));
const evidence = JSON.parse(await fs.readFile(path.join(assignment, 'evidence/test-summary.json'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(assignment, 'image-manifest.json'), 'utf8'));
const scoreRows = documents[2].split('## 五、分项复核表')[1]?.split('## 六、')[0]
  .split('\n').filter(line => /^\| \d{2} \|/.test(line)).map(line => line.split('|').slice(1, -1).map(value => value.trim()));
if (scoreRows?.length !== 20 || manifest.images.length !== 20) throw new Error('The submission requires exactly 20 matched images and scores');
const retrospective = documents[1].split('## 五、Vibecoding 复盘（200 字以内）')[1]?.split('## 六、')[0]?.trim();
if (!retrospective || Array.from(retrospective).length > 200) throw new Error('Retrospective exceeds 200 characters');

const dataImage = async file => {
  const type = /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png';
  return `data:${type};base64,${(await fs.readFile(file)).toString('base64')}`;
};
const figures = [];
for (let index = 0; index < manifest.images.length; index++) {
  const image = manifest.images[index];
  if (image.id !== scoreRows[index][0]) throw new Error(`Image ID mismatch at ${index}`);
  figures.push(`<figure><div class="picture"><img alt="评测图 ${image.id}" src="${await dataImage(path.join(assignment, image.preview))}" /></div><figcaption><b>${image.id}</b><span>${scoreRows[index][7]} 分</span></figcaption></figure>`);
}
const galleries = [];
for (let index = 0; index < figures.length; index += 6) {
  galleries.push(`<section class="gallery-page"><p class="eyebrow">VISUAL EVIDENCE / 评分图集索引</p><h2>编号 ${String(index + 1).padStart(2, '0')}—${String(Math.min(index + 6, figures.length)).padStart(2, '0')}</h2><p class="small">编号绑定原始下载内容及校验和。等比例缩略图用于对照，不替代原图细节判断。</p><div class="gallery">${figures.slice(index, index + 6).join('')}</div></section>`);
}
const visualFiles = ['rain-dark.png', 'fireworks-dark.png'];
const visualEvidence = [];
for (const file of visualFiles) {
  const target = path.join(assignment, 'evidence', file);
  try {
    visualEvidence.push(`<figure class="effect"><img src="${await dataImage(target)}" alt="${file}" /><figcaption>${file.startsWith('rain') ? '分层雨幕 / 手动演示截图' : '升空、爆炸、拖尾与碰撞 / 手动演示截图'}</figcaption></figure>`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`Required effect evidence is missing: ${file}`);
  }
}
const content = documents.map((document, index) => `<section class="part" id="part-${index + 1}">${marked.parse(document)}</section>`).join('\n');
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>AI 生产管线与 MIMIC AR｜提交稿 v2</title><style>
@page{size:A4;margin:17mm 15mm 18mm}*{box-sizing:border-box}body{margin:0;color:#26364a;font:10pt/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif}
a{color:#30658c;text-decoration:none;overflow-wrap:anywhere}h1,h2,h3{color:#193149;break-after:avoid;line-height:1.45}h1{font-size:21pt;border-bottom:2px solid #abc9bc;padding-bottom:12px;margin:0 0 20px}h2{font-size:14pt;margin:23px 0 10px}h3{font-size:11.5pt;margin:16px 0 9px}p{margin:6px 0 10px}ul,ol{padding-left:20px}li{margin:4px 0}strong{color:#213952}
table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.1pt;line-height:1.62;margin:12px 0 17px}th,td{border:1px solid #d6e0e5;padding:6px 7px;vertical-align:top;overflow-wrap:anywhere}th{background:#e9f1ef;color:#244239}tr:nth-child(even) td{background:#f6f9fa}tr{break-inside:avoid}thead{display:table-header-group}table.scores th:nth-child(1),table.scores td:nth-child(1){width:7%;text-align:center}table.scores th:nth-child(2),table.scores td:nth-child(2){width:6%;text-align:center}table.scores th:nth-child(3){width:30%}table.scores th:nth-child(4){width:25%}table.scores th:nth-child(5){width:32%}
pre{background:#f2f5f7;border:1px solid #dee7eb;border-radius:5px;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere;font:8pt/1.65 Menlo,Consolas,"PingFang SC",monospace}code{font-family:Menlo,Consolas,"PingFang SC",monospace;font-size:.88em}pre code{font-size:inherit}pre.keep{break-inside:avoid}blockquote{border-left:3px solid #adc6b9;background:#f1f7f3;padding:10px 14px;margin:15px 0}
.cover{min-height:245mm;break-after:page;display:flex;flex-direction:column}.masthead{display:flex;justify-content:space-between;border-top:3px solid #274638;padding-top:14px;font-size:8pt;letter-spacing:1px;color:#72847d}.cover h1{font-size:32pt;margin:41px 0 20px;border:0}.cover h1 span{color:#658a76}.lead{font-size:12pt;color:#687b8b;line-height:1.9}.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:13px;margin:27px 0}.facts div{border-top:1px solid #cadbd5;padding-top:10px}.facts b{display:block;font-size:24pt;color:#2f5546}.facts span{font-size:8pt;color:#71837d}.delivery{background:#f1f7f4;border:1px solid #ccdcd4;padding:17px 19px;font-size:9pt}.note{font-size:9pt;color:#79878b;margin-top:15px}.toc{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:auto;padding-top:22px;border-top:1px solid #d5dfdf;font-size:9pt}.toc b{display:block;margin-bottom:7px}.part,.gallery-page,.effects-page{break-before:page}.eyebrow{font-size:8pt;color:#769085;letter-spacing:1px}.small{font-size:8pt;color:#788994}.gallery{display:grid;grid-template-columns:1fr 1fr;gap:6mm;margin-top:6mm}figure{margin:0;border:1px solid #dae3e7;padding:3mm;border-radius:3px;break-inside:avoid;height:71mm}.picture{height:59mm;display:flex;justify-content:center;align-items:center;background:#f2f4f6}.picture img{max-width:100%;max-height:100%;object-fit:contain}figcaption{display:flex;justify-content:space-between;font-size:8pt;color:#677c8e;margin-top:2mm}.effect{height:auto;display:inline-block;width:48%;vertical-align:top}.effect img{width:100%;height:145mm;object-fit:contain}.effect figcaption{font-size:8pt}
</style></head><body>
<section class="cover"><div class="masthead"><b>AI × PRODUCT ENGINEERING</b><span>2026.10.15 / V2</span></div><h1>不只会生成，<br><span>更要可靠地交付。</span></h1><p class="lead">50 个文化大区的可控资产管线<br>MIMIC：从表情到真实可见的交互反馈<br>20 张图像的证据化评测与复核</p>
<div class="facts"><div><b>3</b><span>独立 Agent 审阅</span></div><div><b>3</b><span>修改—验证迭代阶段</span></div><div><b>${evidence.unitTests + evidence.browserTests}</b><span>自动化测试通过</span></div><div><b>20</b><span>图像观察与评分</span></div></div>
<div class="delivery"><p><b>Live Demo</b><br><a href="https://xieyuh03.github.io/mimic-ar-playground/">https://xieyuh03.github.io/mimic-ar-playground/</a></p><p><b>Public 源码 / 全部文档 / 换电脑接续</b><br><a href="https://github.com/xieyuh03/mimic-ar-playground">https://github.com/xieyuh03/mimic-ar-playground</a></p></div><p class="note">本版区分用户实测反馈、合成回归、模型链路测试与尚待真人/真机验收的部分。<br>屏幕空间物理不冒充 3D；系数和准备进度不冒充情绪概率。</p>
<div class="toc"><a href="#part-1"><b>01 / PIPELINE</b>账本、强约束与有限重试</a><a href="#part-2"><b>02 / INTERACTION</b>识别修复、视觉效果与性能证据</a><a href="#part-3"><b>03 / EVALUATION</b>分项评分、用途边界与排序稳健性</a></div></section>
${content}<section class="effects-page"><p class="eyebrow">RENDERING EVIDENCE / 视觉迭代</p><h2>同一有界引擎，清楚可见的反馈</h2><p class="small">以下为手动演示模式截图，不作为摄像头表情识别准确率证明。亮背景、手机视口、切换清理与性能证据见仓库测试及记录。</p>${visualEvidence.join('')}</section>${galleries.join('\n')}</body></html>`;
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 680, height: 1000 } });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const table of document.querySelectorAll('table')) if (table.querySelector('th')?.textContent?.trim() === '图片编号') table.classList.add('scores');
    for (const block of document.querySelectorAll('pre')) if (block.getBoundingClientRect().height <= 850) block.classList.add('keep');
    for (const image of document.images) if (!image.complete || image.naturalWidth === 0) throw new Error(`Missing image: ${image.alt}`);
  });
  await fs.writeFile(path.join(output, 'submission-v2.html'), await page.content());
  await page.pdf({
    path: path.join(output, 'submission-v2.pdf'), format: 'A4', printBackground: true,
    preferCSSPageSize: true, tagged: true, outline: true, displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="font-family:Arial;font-size:8px;color:#81918c;width:100%;padding:0 55px;display:flex;justify-content:space-between"><span>AI PRODUCTION &amp; MIMIC AR / V2</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  });
} finally { await browser.close(); }
await fs.writeFile(path.join(output, 'submission-v2.md'), '# AI 生产管线、AR 原型与图像评测｜v2\n\n' + documents.join('\n\n---\n\n'));
const pdf = await fs.readFile(path.join(output, 'submission-v2.pdf'));
if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF');
console.log(JSON.stringify({ bytes: pdf.length, pages: (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length, images: 20, retrospectiveCharacters: Array.from(retrospective).length, output: 'assignment/output/submission-v2.pdf' }, null, 2));
