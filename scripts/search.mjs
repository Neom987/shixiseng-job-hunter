#!/usr/bin/env node
// 检索实习僧岗位列表（纯 HTTP + SSR 数据解析，不需要登录、不需要浏览器）
//
// 用法：
//   node scripts/search.mjs --keywords "数据分析,内容运营" --cities "东京,上海" --pages 2
//   node scripts/search.mjs --keywords "生物材料" --cities 全国 --degree 本科 --salary 150-400
//
// 输出：<home>/jobs.json

import path from 'node:path';
import { BASE, fetchHtml, parseNuxt, normListJob, writeJson, readJson, sleep, arg, flag, log, homeDir, ensureDir, nowLocal } from './lib.mjs';

const home = homeDir();
ensureDir(home);

const keywords = String(arg('keywords', '')).split(/[,，;；]/).map((s) => s.trim()).filter(Boolean);
const cities = String(arg('cities', '全国')).split(/[,，;；]/).map((s) => s.trim()).filter(Boolean);
const degree = arg('degree', '');
const salary = arg('salary', ''); // 形如 200-300，已验证可生效
const pages = Math.max(1, parseInt(arg('pages', '1'), 10) || 1);
const delay = parseInt(arg('delay', '1200'), 10) || 1200;
const outFile = path.resolve(home, String(arg('out', 'jobs.json')));
const merge = flag('merge');

if (!keywords.length) {
  console.error('缺少 --keywords，例如：--keywords "数据分析,产品运营"');
  process.exit(2);
}

const queries = [];
for (const kw of keywords) for (const city of cities) for (let p = 1; p <= pages; p++) queries.push({ kw, city, page: p });

const jobs = new Map();
if (merge) {
  for (const j of readJson(outFile, []) || []) jobs.set(j.uuid, j);
}

const stats = [];
let seq = 0;

for (const q of queries) {
  seq++;
  const params = new URLSearchParams({ keyword: q.kw, city: q.city, page: String(q.page) });
  if (degree) params.set('degree', String(degree));
  if (salary) params.set('salary', String(salary));
  const url = `${BASE}/interns?${params.toString()}`;

  let html;
  try {
    html = await fetchHtml(url);
  } catch (e) {
    log(`✗ [${seq}/${queries.length}] ${q.kw} / ${q.city} / p${q.page} 抓取失败：${e.message}`);
    stats.push({ ...q, error: e.message });
    await sleep(delay);
    continue;
  }

  const nuxt = parseNuxt(html);
  const block = nuxt?.data?.[0]?.interns;
  if (!block || !Array.isArray(block.data)) {
    log(`✗ [${seq}/${queries.length}] ${q.kw} / ${q.city} / p${q.page} 解析失败（页面结构可能变更，见 references/site-structure.md）`);
    stats.push({ ...q, error: 'parse-failed' });
    await sleep(delay);
    continue;
  }

  let added = 0;
  for (const raw of block.data) {
    const job = normListJob(raw);
    if (!job.uuid) continue;
    const prev = jobs.get(job.uuid);
    if (prev) {
      prev.matchedKeywords = Array.from(new Set([...(prev.matchedKeywords || []), q.kw]));
      if (q.city !== '全国') prev.matchedCities = Array.from(new Set([...(prev.matchedCities || []), q.city]));
    } else {
      jobs.set(job.uuid, { ...job, matchedKeywords: [q.kw], matchedCities: q.city === '全国' ? [] : [q.city] });
      added++;
    }
  }

  log(`✓ [${seq}/${queries.length}] ${q.kw} / ${q.city} / p${q.page} 命中 ${block.total} 条，本页 ${block.data.length} 条，新增 ${added}`);
  stats.push({ ...q, total: block.total, pageCount: block.data.length, added });
  await sleep(delay + Math.random() * 600);
}

const list = Array.from(jobs.values()).sort((a, b) => (b.salaryMax || 0) - (a.salaryMax || 0));
writeJson(outFile, list);
writeJson(path.resolve(home, 'search-stats.json'), { at: nowLocal(), queries: stats });

log(`共 ${list.length} 个去重岗位 -> ${outFile}`);
if (list.length) {
  const byCity = {};
  for (const j of list) byCity[j.city] = (byCity[j.city] || 0) + 1;
  log('城市分布：' + Object.entries(byCity).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `${c}:${n}`).join('  '));
}
