#!/usr/bin/env node
// 生成求职日报：Markdown + HTML 看板
//
// 用法：
//   node scripts/report.mjs --top 25

import fs from 'node:fs';
import path from 'node:path';
import { readJson, readJsonl, arg, log, homeDir, ensureDir, todayLocal } from './lib.mjs';

const home = homeDir();
ensureDir(home);
const top = parseInt(arg('top', '25'), 10) || 25;

const ranked = readJson(path.resolve(home, String(arg('in', 'ranked.json'))), []) || [];
const profile = readJson(path.resolve(home, 'profile.json'), {}) || {};

const latest = new Map();
for (const e of readJsonl(path.resolve(home, 'applications.jsonl'))) {
  if (!e.uuid) continue;
  const prev = latest.get(e.uuid) || {};
  latest.set(e.uuid, { ...prev, ...e, firstTs: prev.firstTs || prev.ts });
}
const apps = Array.from(latest.values());
const STATUS_LABEL = {
  queued: '待投',
  applied: '已投递',
  replied: '已回复',
  interview: '面试中',
  offer: '已录用',
  rejected: '已拒绝',
  skipped: '已跳过',
  failed: '投递失败',
};
const STATUS_COLOR = {
  queued: '#8b95a1',
  applied: '#2f6fed',
  replied: '#0f9d8f',
  interview: '#b25e09',
  offer: '#1a8f4a',
  rejected: '#98a2b3',
  skipped: '#98a2b3',
  failed: '#c0392b',
};

const today = todayLocal();
const counts = {
  total: ranked.length,
  apply: ranked.filter((j) => j.recommend === 'apply').length,
  review: ranked.filter((j) => j.recommend === 'review').length,
  applied: apps.filter((a) => a.status === 'applied').length,
  todayApplied: apps.filter((a) => String(a.appliedTs || a.ts || '').slice(0, 10) === today).length,
  replied: apps.filter((a) => ['replied', 'interview', 'offer'].includes(a.status)).length,
};
const replyRate = counts.applied ? ((counts.replied / counts.applied) * 100).toFixed(0) : '—';

const shortlist = ranked.filter((j) => j.recommend !== 'skip').slice(0, top);

const payText = (j) => {
  const lo = Number(j.salaryMin || 0);
  const hi = Number(j.salaryMax || 0);
  if (!lo && !hi) return '面议';
  if (lo === hi) return String(hi);
  return `${lo || '?'}–${hi || '?'}`;
};

// ---------- Markdown ----------
const md = [];
md.push(`# 实习僧求职日报 · ${today}`);
md.push('');
md.push(`**候选人**：${profile.name || '（未填）'}　**方向**：${(profile.targets?.keywords || []).join(' / ') || '（未填）'}`);
md.push('');
md.push('## 今日概览');
md.push('');
md.push('| 指标 | 数值 |');
md.push('| --- | --- |');
md.push(`| 候选岗位 | ${counts.total} |`);
md.push(`| 建议投递 | ${counts.apply} |`);
md.push(`| 待复核 | ${counts.review} |`);
md.push(`| 今日已投 | ${counts.todayApplied} |`);
md.push(`| 累计已投 | ${counts.applied} |`);
md.push(`| 有回复 | ${counts.replied}（回复率 ${replyRate}%） |`);
md.push('');
md.push('## 优先投递清单');
md.push('');
md.push('| # | 分数 | 岗位 | 公司 | 城市 | 日薪 | 已投人数 | 链接 |');
md.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
shortlist.forEach((j, i) => {
  md.push(
    `| ${i + 1} | ${j.score} | ${j.title} | ${j.company} | ${String(j.city || '').replace('省-', '')} | ${payText(j)} | ${j.deliveredNum ?? '—'} | [详情](${j.url}) |`
  );
});
md.push('');
if (apps.length) {
  md.push('## 投递台账');
  md.push('');
  md.push('| 状态 | 岗位 | 公司 | 分数 | 更新时间 | 备注 |');
  md.push('| --- | --- | --- | --- | --- | --- |');
  for (const a of apps.slice(0, 40)) {
    md.push(
      `| ${STATUS_LABEL[a.status] || a.status} | ${a.title || ''} | ${a.company || ''} | ${a.score ?? '—'} | ${String(a.ts || '').slice(0, 16).replace('T', ' ')} | ${a.note || ''} |`
    );
  }
  md.push('');
}
md.push('## 匹配理由摘录');
md.push('');
for (const j of shortlist.slice(0, 8)) {
  md.push(`### ${j.title} @ ${j.company}（${j.score} 分）`);
  md.push(`- 加分：${(j.reasons || []).join('；') || '—'}`);
  md.push(`- 风险：${(j.gaps || []).join('；') || '无'}`);
  md.push('');
}
const mdFile = path.resolve(home, `report-${today}.md`);
fs.writeFileSync(mdFile, md.join('\n'), 'utf8');

// ---------- HTML ----------
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const rowsHtml = shortlist
  .map((j, i) => {
    const city = String(j.city || '').replace('省-', '');
    const scoreColor = j.score >= 70 ? '#1a8f4a' : j.score >= 55 ? '#2f6fed' : '#b25e09';
    return `<tr>
      <td class="idx">${i + 1}</td>
      <td><div class="score"><b style="color:${scoreColor}">${j.score}</b><span class="bar"><i style="width:${Math.max(4, Math.min(100, j.score))}%;background:${scoreColor}"></i></span></div></td>
      <td class="title"><a href="${esc(j.url)}" target="_blank">${esc(j.title)}</a><div class="meta">${esc((j.reasons || []).slice(0, 2).join(' · '))}</div></td>
      <td>${esc(j.company)}</td>
      <td class="nowrap">${esc(city)}</td>
      <td class="num">${payText(j)}</td>
      <td class="num">${j.deliveredNum ?? '—'}</td>
      <td class="nowrap">${esc(j.degree || '')}</td>
      <td>${j.recommend === 'apply' ? '<span class="pill ok">建议投递</span>' : '<span class="pill warn">待复核</span>'}</td>
    </tr>`;
  })
  .join('\n');

const appsHtml = apps.length
  ? apps
      .slice(0, 60)
      .map(
        (a) => `<tr>
      <td><span class="pill" style="background:${(STATUS_COLOR[a.status] || '#8b95a1')}1a;color:${STATUS_COLOR[a.status] || '#8b95a1'}">${esc(STATUS_LABEL[a.status] || a.status)}</span></td>
      <td class="title"><a href="${esc(a.url || '#')}" target="_blank">${esc(a.title || '')}</a></td>
      <td>${esc(a.company || '')}</td>
      <td class="num">${a.score ?? '—'}</td>
      <td class="muted">${esc(String(a.ts || '').slice(0, 16).replace('T', ' '))}</td>
      <td class="muted">${esc(a.note || '')}</td>
    </tr>`
      )
      .join('\n')
  : '<tr><td colspan="6" class="empty">暂无投递记录，运行 apply.mjs 后自动生成</td></tr>';

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>实习僧求职日报 · ${today}</title>
<style>
  :root{--ink:#101828;--sub:#667085;--line:#e4e7ec;--bg:#f7f8fa;--card:#fff;--brand:#2f6fed}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:1180px;margin:0 auto;padding:32px 24px 64px}
  header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:24px}
  h1{font-size:24px;margin:0 0 6px;letter-spacing:-.2px}
  .sub{color:var(--sub);font-size:13px}
  .badge{background:#eef4ff;color:var(--brand);padding:4px 10px;border-radius:99px;font-size:12px;font-weight:600}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:28px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
  .card .k{color:var(--sub);font-size:12px;letter-spacing:.4px}
  .card .v{font-size:26px;font-weight:700;margin-top:4px;letter-spacing:-.5px}
  section{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-bottom:24px}
  .sec-h{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--line)}
  .sec-h h2{font-size:15px;margin:0}
  .sec-h .hint{color:var(--sub);font-size:12px}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;font-size:12px;color:var(--sub);font-weight:600;padding:10px 14px;background:#fbfcfd;border-bottom:1px solid var(--line);white-space:nowrap}
  td{padding:12px 14px;border-bottom:1px solid #f2f4f7;vertical-align:middle}
  tr:last-child td{border-bottom:none}
  tbody tr:hover{background:#fbfcff}
  .idx{color:#98a2b3;font-variant-numeric:tabular-nums;width:36px}
  .title a{color:var(--ink);font-weight:600;text-decoration:none}
  .title a:hover{color:var(--brand)}
  .meta{color:var(--sub);font-size:12px;margin-top:2px;max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .num{font-variant-numeric:tabular-nums;color:#344054;white-space:nowrap}
  .nowrap{white-space:nowrap}
  .muted{color:var(--sub);font-size:12px}
  .score{display:flex;align-items:center;gap:8px;min-width:96px}
  .score b{font-size:15px;font-variant-numeric:tabular-nums;min-width:26px}
  .bar{flex:1;height:5px;background:#eef1f5;border-radius:99px;overflow:hidden}
  .bar i{display:block;height:100%;border-radius:99px}
  .pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;font-weight:600;white-space:nowrap}
  .pill.ok{background:#e9f7ef;color:#1a8f4a}
  .pill.warn{background:#fef4e6;color:#b25e09}
  .empty{text-align:center;color:var(--sub);padding:32px}
  footer{color:var(--sub);font-size:12px;text-align:center;margin-top:8px}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>实习僧求职日报</h1>
      <div class="sub">${esc(profile.name || '候选人')} · 方向：${esc((profile.targets?.keywords || []).join(' / ') || '未设置')} · ${today}</div>
    </div>
    <span class="badge">自动生成</span>
  </header>

  <div class="cards">
    <div class="card"><div class="k">候选岗位</div><div class="v">${counts.total}</div></div>
    <div class="card"><div class="k">建议投递</div><div class="v" style="color:#1a8f4a">${counts.apply}</div></div>
    <div class="card"><div class="k">待复核</div><div class="v" style="color:#b25e09">${counts.review}</div></div>
    <div class="card"><div class="k">今日已投</div><div class="v" style="color:var(--brand)">${counts.todayApplied}</div></div>
    <div class="card"><div class="k">累计已投</div><div class="v">${counts.applied}</div></div>
    <div class="card"><div class="k">回复率</div><div class="v">${replyRate}<span style="font-size:14px">%</span></div></div>
  </div>

  <section>
    <div class="sec-h"><h2>优先投递清单</h2><span class="hint">按匹配分排序 · 点击岗位名查看原帖</span></div>
    <table>
      <thead><tr><th>#</th><th>匹配分</th><th>岗位</th><th>公司</th><th>城市</th><th>日薪</th><th>已投</th><th>学历</th><th>建议</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </section>

  <section>
    <div class="sec-h"><h2>投递台账</h2><span class="hint">状态可在对话中更新</span></div>
    <table>
      <thead><tr><th>状态</th><th>岗位</th><th>公司</th><th>分数</th><th>时间</th><th>备注</th></tr></thead>
      <tbody>${appsHtml}</tbody>
    </table>
  </section>

  <footer>由实习僧求职 skill 生成 · 数据来自公开岗位页 · 请自行核对岗位真实性</footer>
</div>
</body>
</html>`;

const htmlFile = path.resolve(home, `report-${today}.html`);
fs.writeFileSync(htmlFile, html, 'utf8');

log(`已生成：\n  ${mdFile}\n  ${htmlFile}`);
log(`候选 ${counts.total}，建议投递 ${counts.apply}，已投 ${counts.applied}，回复率 ${replyRate}%`);
