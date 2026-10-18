#!/usr/bin/env node
// 批量抓取岗位详情（完整 JD / 到岗要求 / 投递人数 / 是否已投递）
//
// 用法：
//   node scripts/detail.mjs                       # 读 jobs.json，全部抓取
//   node scripts/detail.mjs --limit 40 --in jobs.json
//   node scripts/detail.mjs --uuid inn_tedyoll2bytx   # 单个
//
// 输出：<home>/jobs.detail.json

import path from 'node:path';
import { BASE, fetchHtml, parseNuxt, normDetailJob, writeJson, readJson, sleep, arg, log, homeDir, ensureDir } from './lib.mjs';

const home = homeDir();
ensureDir(home);

const inFile = path.resolve(home, String(arg('in', 'jobs.json')));
const outFile = path.resolve(home, String(arg('out', 'jobs.detail.json')));
const limit = parseInt(arg('limit', '0'), 10) || 0;
const delay = parseInt(arg('delay', '900'), 10) || 900;
const singleUuid = arg('uuid', '');

async function fetchDetail(uuid, base = {}) {
  const url = `${BASE}/intern/${uuid}`;
  const html = await fetchHtml(url);
  const nuxt = parseNuxt(html);
  const msg = nuxt?.data?.[0]?.msg;
  if (!msg || typeof msg !== 'object') throw new Error('详情页结构无法解析（可能已下架或页面改版）');
  return normDetailJob(msg, base);
}

if (singleUuid && typeof singleUuid === 'string') {
  const job = await fetchDetail(singleUuid);
  console.log(JSON.stringify(job, null, 2));
  process.exit(0);
}

const jobs = readJson(inFile, []);
if (!Array.isArray(jobs) || !jobs.length) {
  console.error(`没有可用的岗位列表：${inFile}，请先运行 search.mjs`);
  process.exit(2);
}

const existing = new Map((readJson(outFile, []) || []).map((j) => [j.uuid, j]));
const queue = jobs.filter((j) => j.uuid).slice(0, limit || undefined);
log(`待抓取详情 ${queue.length} 条`);

const results = [];
let ok = 0;
let fail = 0;

for (let i = 0; i < queue.length; i++) {
  const base = queue[i];
  const cached = existing.get(base.uuid);
  if (cached && cached.jd) {
    results.push({ ...cached, ...base, matchedKeywords: base.matchedKeywords || cached.matchedKeywords });
    ok++;
    continue;
  }
  try {
    const job = await fetchDetail(base.uuid, base);
    results.push(job);
    ok++;
    log(`✓ [${i + 1}/${queue.length}] ${job.title} @ ${job.company} | ${job.city} | ${job.degree} | 已投${job.deliveredNum ?? '?'}人 | JD ${job.jd.length}字`);
  } catch (e) {
    fail++;
    results.push({ ...base, detailError: e.message });
    log(`✗ [${i + 1}/${queue.length}] ${base.title} @ ${base.company} -> ${e.message}`);
  }
  await sleep(delay + Math.random() * 500);
}

writeJson(outFile, results);
log(`完成：成功 ${ok}，失败 ${fail} -> ${outFile}`);
