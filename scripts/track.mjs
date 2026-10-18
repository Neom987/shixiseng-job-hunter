#!/usr/bin/env node
// 投递台账：去重、状态流转、统计、导出
//
// 用法：
//   node scripts/track.mjs add --uuid inn_xxx --title "数据分析" --company "京东" --status applied --note "首页推荐"
//   node scripts/track.mjs list --status applied
//   node scripts/track.mjs update --uuid inn_xxx --status replied --note "HR 约面"
//   node scripts/track.mjs stats
//   node scripts/track.mjs export --out applications.csv

import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, appendJsonl, readJson, writeJson, arg, log, homeDir, ensureDir, nowLocal, todayLocal } from './lib.mjs';

const home = homeDir();
ensureDir(home);
const ledger = path.resolve(home, 'applications.jsonl');
const cmd = process.argv[2] || 'list';
const STATUSES = ['queued', 'applied', 'replied', 'interview', 'offer', 'rejected', 'skipped', 'failed'];
const LABEL = {
  queued: '待投',
  applied: '已投递',
  replied: '已回复',
  interview: '面试中',
  offer: '已录用',
  rejected: '已拒绝',
  skipped: '已跳过',
  failed: '投递失败',
};

function latestByUuid() {
  const map = new Map();
  for (const e of readJsonl(ledger)) {
    if (!e.uuid) continue;
    const prev = map.get(e.uuid);
    if (!prev) map.set(e.uuid, { ...e });
    else map.set(e.uuid, { ...prev, ...e, firstTs: prev.firstTs || prev.ts, appliedTs: e.appliedTs || prev.appliedTs || (e.status === 'applied' ? e.ts : null) });
  }
  return Array.from(map.values());
}

function printRows(rows) {
  if (!rows.length) {
    console.log('（空）');
    return;
  }
  const pad = (s, n) => {
    const str = String(s ?? '');
    const w = [...str].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
    return str + ' '.repeat(Math.max(0, n - w));
  };
  console.log(pad('状态', 10) + pad('岗位', 26) + pad('公司', 18) + pad('城市', 12) + pad('分数', 6) + '更新时间');
  for (const r of rows) {
    console.log(
      pad(LABEL[r.status] || r.status, 10) +
        pad(String(r.title || '').slice(0, 12), 26) +
        pad(String(r.company || '').slice(0, 8), 18) +
        pad(r.city || '', 12) +
        pad(r.score ?? '', 6) +
        String(r.ts || '').slice(0, 16).replace('T', ' ')
    );
  }
}

if (cmd === 'add') {
  const uuid = arg('uuid', '');
  if (!uuid) {
    console.error('缺少 --uuid');
    process.exit(2);
  }
  const status = String(arg('status', 'queued'));
  if (!STATUSES.includes(status)) {
    console.error(`状态必须是：${STATUSES.join(' / ')}`);
    process.exit(2);
  }
  const exists = latestByUuid().find((r) => r.uuid === uuid);
  const entry = {
    ts: nowLocal(),
    uuid,
    title: String(arg('title', exists?.title || '')),
    company: String(arg('company', exists?.company || '')),
    city: String(arg('city', exists?.city || '')),
    score: arg('score', exists?.score ?? null),
    salaryMin: arg('salaryMin', exists?.salaryMin ?? null),
    salaryMax: arg('salaryMax', exists?.salaryMax ?? null),
    status,
    channel: String(arg('channel', exists?.channel || 'web')),
    note: String(arg('note', '')),
    url: String(arg('url', exists?.url || `https://www.shixiseng.com/intern/${uuid}`)),
  };
  if (status === 'applied') entry.appliedTs = entry.ts;
  appendJsonl(ledger, entry);
  log(`${exists ? '更新' : '新增'}台账：${entry.title} @ ${entry.company} -> ${LABEL[status]}`);
  process.exit(0);
}

if (cmd === 'update') {
  const uuid = arg('uuid', '');
  if (!uuid) {
    console.error('缺少 --uuid');
    process.exit(2);
  }
  const rows = latestByUuid();
  const prev = rows.find((r) => r.uuid === uuid);
  if (!prev) {
    console.error(`台账中没有 ${uuid}，请先用 add`);
    process.exit(2);
  }
  const status = String(arg('status', prev.status));
  if (!STATUSES.includes(status)) {
    console.error(`状态必须是：${STATUSES.join(' / ')}`);
    process.exit(2);
  }
  const entry = { ...prev, ts: nowLocal(), status, note: String(arg('note', prev.note || '')) };
  if (status === 'applied' && !entry.appliedTs) entry.appliedTs = entry.ts;
  appendJsonl(ledger, entry);
  log(`状态更新：${prev.title} @ ${prev.company}  ${LABEL[prev.status]} -> ${LABEL[status]}`);
  process.exit(0);
}

if (cmd === 'list') {
  let rows = latestByUuid();
  const st = arg('status', '');
  if (st) rows = rows.filter((r) => r.status === st);
  rows.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  printRows(rows);
  console.log(`\n共 ${rows.length} 条`);
  process.exit(0);
}

if (cmd === 'stats') {
  const rows = latestByUuid();
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  const today = todayLocal();
  const todayCount = rows.filter((r) => String(r.appliedTs || '').slice(0, 10) === today).length;
  console.log('台账统计');
  console.log('  总岗位数：' + rows.length);
  console.log('  今日已投：' + todayCount);
  for (const s of STATUSES) if (byStatus[s]) console.log(`  ${LABEL[s]}：${byStatus[s]}`);
  const applied = byStatus.applied || 0;
  const replied = (byStatus.replied || 0) + (byStatus.interview || 0) + (byStatus.offer || 0);
  if (applied) console.log(`  回复率：${((replied / applied) * 100).toFixed(1)}%（基于当前状态，非历史累计）`);
  process.exit(0);
}

if (cmd === 'export') {
  const rows = latestByUuid().sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  const outFile = path.resolve(home, String(arg('out', 'applications.csv')));
  const head = ['更新时间', '状态', '岗位', '公司', '城市', '匹配分', '日薪', '备注', '链接'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push(
      [
        String(r.ts || '').slice(0, 19).replace('T', ' '),
        LABEL[r.status] || r.status,
        r.title,
        r.company,
        r.city,
        r.score,
        r.salaryMin != null ? `${r.salaryMin}-${r.salaryMax}` : '',
        r.note,
        r.url,
      ]
        .map(esc)
        .join(',')
    );
  }
  fs.writeFileSync(outFile, '\uFEFF' + lines.join('\r\n'), 'utf8');
  log(`已导出 ${rows.length} 条 -> ${outFile}`);
  process.exit(0);
}

console.error(`未知命令：${cmd}\n可用：add / update / list / stats / export`);
process.exit(2);
