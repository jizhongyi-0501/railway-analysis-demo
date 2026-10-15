// 这是按规则计算的第一课，不调用 AI，也不访问任何公司数据。
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('./', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');
const percent = (value) => value === null ? '无法计算（基数为 0）' : value.toFixed(1) + '%';
const change = (before, after) => before === 0 ? null : (after - before) / before * 100;
const ctr = (row) => row.impressions === 0 ? null : row.clicks / row.impressions * 100;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));

// 第一步：读取数据和规则。将来这里可以改成从 o-demo 查询。
const raw = await read('data.json');
const data = JSON.parse(raw);
const config = JSON.parse(await read('config.json'));
if (!Array.isArray(data.pages) || !data.pages.length) throw new Error('请在 data.json 中填写文章数据。');
const threshold = config.clickChangeThresholdPercent;
if (!Number.isFinite(threshold) || threshold <= 0) throw new Error('变化阈值必须是大于 0 的数字。');
const seen = new Set();
for (const page of data.pages) {
  if (!page.id || !page.title || seen.has(page.id)) throw new Error('每篇文章必须有不同的 id 和标题。');
  seen.add(page.id);
  for (const period of ['previous', 'current']) {
    const row = page[period];
    if (!row || !Number.isSafeInteger(row.impressions) || !Number.isSafeInteger(row.clicks)
      || row.impressions < 0 || row.clicks < 0 || row.clicks > row.impressions) {
      throw new Error(page.id + ' 的曝光、点击必须是非负整数，点击不能超过曝光；缺失值不能当作零。');
    }
  }
}

// 第二步：工具做计算。这里的结论来自明确规则，不来自语言模型。
const rows = data.pages.map(page => {
  const delta = change(page.previous.clicks, page.current.clicks);
  let observation = '点击变化未达到设定阈值。';
  if (delta === null) observation = '上一期点击为 0，不能计算相对增幅。';
  else if (delta >= threshold) observation = '点击明显增加，可进一步查看增长来自哪些搜索词。';
  else if (delta <= -threshold) observation = '点击明显减少，可进一步按搜索词和设备排查。';
  if (page.current.impressions > page.previous.impressions && page.current.clicks <= page.previous.clicks) {
    observation += ' 曝光增加但点击未增加；不能仅凭这些数据认定标题有问题。';
  }
  return { ...page, clickChangePercent: delta, previousCtr: ctr(page.previous), currentCtr: ctr(page.current), observation };
});
const totals = rows.reduce((sum, page) => {
  for (const period of ['previous', 'current']) {
    sum[period].impressions += page[period].impressions;
    sum[period].clicks += page[period].clicks;
  }
  return sum;
}, { previous: { impressions: 0, clicks: 0 }, current: { impressions: 0, clicks: 0 } });

// 第三步：形成报告。未来可在此加入“AI 阅读已计算的数据并解释”的步骤。
const report = {
  generatedAt: new Date().toISOString(),
  mode: '规则计算；未调用 AI',
  source: data.source,
  dataSha256: createHash('sha256').update(raw).digest('hex'),
  periods: { previous: data.previousPeriod, current: data.currentPeriod },
  thresholdPercent: threshold,
  totals,
  rows
};
const text = [
  config.reportTitle,
  '教学练习 · 模拟数据 · 未调用 AI',
  '',
  '数据来源：' + data.source,
  '比较范围：' + data.previousPeriod + ' → ' + data.currentPeriod,
  '提醒阈值：点击变化达到 ' + threshold + '%',
  '',
  '总曝光：' + totals.previous.impressions + ' → ' + totals.current.impressions,
  '总点击：' + totals.previous.clicks + ' → ' + totals.current.clicks,
  '总点击率：' + percent(ctr(totals.previous)) + ' → ' + percent(ctr(totals.current)),
  '',
  ...rows.flatMap(p => [
    p.title,
    '曝光：' + p.previous.impressions + ' → ' + p.current.impressions,
    '点击：' + p.previous.clicks + ' → ' + p.current.clicks + '；变化：' + percent(p.clickChangePercent),
    '点击率：' + percent(p.previousCtr) + ' → ' + percent(p.currentCtr),
    '观察：' + p.observation,
    ''
  ]),
  '这些数字说明变化，不证明原因。模拟数据未包含真实采集、历史进度或增量处理。',
  '生成时间：' + report.generatedAt,
  '输入数据校验值：' + report.dataSha256
].join('\n');

// 第四步：保存结果，同时打印到日志。Railway 上先通过日志看报告。
await mkdir(new URL('output/', root), { recursive: true });
await writeFile(new URL('output/report.json', root), JSON.stringify(report, null, 2) + '\n');
await writeFile(new URL('output/report.txt', root), text, 'utf8');
const cards = rows.map(p => `<article><h2>${escapeHtml(p.title)}</h2>
  <dl><div><dt>曝光</dt><dd>${p.previous.impressions} → ${p.current.impressions}</dd></div>
  <div><dt>点击</dt><dd>${p.previous.clicks} → ${p.current.clicks}</dd></div>
  <div><dt>点击变化</dt><dd>${escapeHtml(percent(p.clickChangePercent))}</dd></div>
  <div><dt>点击率</dt><dd>${escapeHtml(percent(p.previousCtr))} → ${escapeHtml(percent(p.currentCtr))}</dd></div></dl>
  <p>${escapeHtml(p.observation)}</p></article>`).join('');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(config.reportTitle)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f3ed;color:#252a29;font:16px/1.65 system-ui,sans-serif}
main{max-width:940px;margin:auto;padding:44px 22px}header{margin-bottom:28px}h1{font-size:32px;line-height:1.25}h2{font-size:20px}
.tag{color:#815000;font-weight:650}.summary{display:flex;gap:14px;flex-wrap:wrap;margin:25px 0}.summary div,article{background:white;border:1px solid #deded4;border-radius:14px;padding:20px}
.summary div{flex:1;min-width:150px}.summary b{display:block;font-size:28px}.grid{display:grid;gap:16px}dl{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}dt{color:#626c68;font-size:14px}dd{margin:4px 0;font-weight:650}article p{padding:12px;background:#f3f5ee;border-radius:8px}
footer{color:#626c68;font-size:13px;margin-top:28px;overflow-wrap:anywhere}@media(max-width:600px){dl{grid-template-columns:repeat(2,1fr)}h1{font-size:26px}}
</style><main><header><div class="tag">第一课 / 数据 → 计算 → 报告</div><h1>${escapeHtml(config.reportTitle)}</h1>
<p>模拟数据 · 按规则计算 · 未调用 AI</p><p>${escapeHtml(data.previousPeriod)} → ${escapeHtml(data.currentPeriod)}</p></header>
<section class="summary"><div>本期总曝光<b>${totals.current.impressions}</b>上期 ${totals.previous.impressions}</div>
<div>本期总点击<b>${totals.current.clicks}</b>上期 ${totals.previous.clicks}</div>
<div>本期总点击率<b>${escapeHtml(percent(ctr(totals.current)))}</b>上期 ${escapeHtml(percent(ctr(totals.previous)))}</div></section>
<section class="grid">${cards}</section><footer>数据来源：${escapeHtml(data.source)}<br>
这些数字说明变化，不证明原因。模拟数据未包含真实采集、历史进度或增量处理。<br>
生成时间：${escapeHtml(report.generatedAt)}<br>输入数据校验值：${report.dataSha256}</footer></main></html>`;
await writeFile(new URL('output/report.html', root), html, 'utf8');
console.log(text);
console.log('\n已保存 output/report.html。程序工作完成，现在退出。');

