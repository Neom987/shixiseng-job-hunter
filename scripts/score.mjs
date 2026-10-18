#!/usr/bin/env node
// 岗位匹配打分与排序（确定性规则，可复现；不调用大模型）
//
// 用法：
//   node scripts/score.mjs --profile profile.json --in jobs.detail.json --top 30
//
// 输出：<home>/ranked.json

import path from 'node:path';
import { writeJson, readJson, arg, flag, log, homeDir, ensureDir } from './lib.mjs';

const home = homeDir();
ensureDir(home);

const profileFile = path.resolve(home, String(arg('profile', 'profile.json')));
const inFile = path.resolve(home, String(arg('in', 'jobs.detail.json')));
const outFile = path.resolve(home, String(arg('out', 'ranked.json')));
const top = parseInt(arg('top', '0'), 10) || 0;
const excludePart = flag('exclude-part');

const profile = readJson(profileFile, null);
if (!profile) {
  console.error(`找不到画像文件：${profileFile}\n先按 references/profile-schema.md 生成 profile.json`);
  process.exit(2);
}

const jobs = readJson(inFile, []);
if (!Array.isArray(jobs) || !jobs.length) {
  console.error(`没有可打分的岗位：${inFile}`);
  process.exit(2);
}

const t = profile.targets || {};
const keywords = (t.keywords || []).filter(Boolean);
const cities = (t.cities || []).filter(Boolean);
const skills = (profile.skills || []).filter(Boolean);
const avoid = (t.avoidKeywords || profile.avoidKeywords || []).filter(Boolean);
const blacklist = (t.blacklistCompanies || profile.blacklistCompanies || []).filter(Boolean);
const preferCos = (t.preferCompanies || profile.preferCompanies || []).filter(Boolean);
const majorWords = [profile.major, ...(profile.majorKeywords || [])].filter(Boolean);
const myDegree = profile.degree || '本科';
const salaryMin = Number(t.salaryMin || 0);

const DEGREE_RANK = { 不限: 0, 大专: 1, 本科: 2, 硕士: 3, 博士: 4 };

function degreeLevel(s) {
  const v = String(s || '');
  for (const k of Object.keys(DEGREE_RANK)) if (v.includes(k)) return DEGREE_RANK[k];
  return 0;
}

function hits(text, words) {
  const lower = String(text || '').toLowerCase();
  const found = [];
  for (const w of words) {
    if (!w) continue;
    if (lower.includes(String(w).toLowerCase())) found.push(w);
  }
  return found;
}

function daysSince(dateStr) {
  const s = String(dateStr || '').replace(/-/g, '/');
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function scoreOne(job) {
  const reasons = [];
  const gaps = [];
  let score = 0;
  let hardSkip = false;

  const titleHits = hits(job.title, keywords);
  const jdText = `${job.title}\n${job.jd}\n${job.requirements}\n${(job.skills || []).join(' ')}`;

  // 1) 岗位名称命中（35）
  if (titleHits.length) {
    score += Math.min(35, 22 + (titleHits.length - 1) * 8);
    reasons.push(`岗位名命中「${titleHits.join('、')}」`);
  } else {
    const jdHits = hits(jdText, keywords);
    if (jdHits.length) {
      score += 10;
      reasons.push(`JD 中出现「${jdHits.slice(0, 3).join('、')}」`);
    } else {
      gaps.push('岗位名与 JD 均未命中目标方向');
    }
  }

  // 2) 技能重合（25）
  const skillHits = hits(jdText, skills);
  if (skillHits.length) {
    score += Math.min(25, 8 + skillHits.length * 5);
    reasons.push(`技能重合 ${skillHits.length} 项：${skillHits.slice(0, 5).join('、')}`);
  } else {
    gaps.push('JD 中未体现你的核心技能');
  }

  // 3) 城市（10）
  const cityOk = cities.length === 0 || cities.some((c) => String(job.city).includes(c) || String(job.address).includes(c));
  if (cityOk) {
    score += 10;
    if (cities.length) reasons.push(`城市符合：${job.city}`);
  } else {
    gaps.push(`城市不在意向范围（${job.city}）`);
  }

  // 4) 学历（8）
  const need = degreeLevel(job.degree);
  const mine = degreeLevel(myDegree);
  if (need > mine) {
    score -= 25;
    gaps.push(`学历门槛高于你（要求 ${job.degree}）`);
    if (need - mine >= 2) hardSkip = true;
  } else {
    score += 8;
  }

  // 5) 日薪（8）
  const pay = Number(job.salaryMax || job.salaryMin || 0);
  if (salaryMin && pay) {
    if (pay >= salaryMin) {
      score += 8;
      reasons.push(`日薪 ${job.salaryMin}-${job.salaryMax} 达预期`);
    } else if (pay >= salaryMin * 0.8) {
      score += 4;
    } else {
      gaps.push(`日薪低于预期（${job.salaryMin}-${job.salaryMax}）`);
    }
  } else if (pay) {
    score += 5;
  }

  // 6) 新鲜度（6）
  const age = daysSince(job.refresh);
  if (age !== null) {
    if (age <= 3) {
      score += 6;
      reasons.push('近 3 天新发布');
    } else if (age <= 14) score += 4;
    else if (age <= 45) score += 2;
    else gaps.push(`岗位发布已 ${age} 天`);
  }

  // 7) 竞争度（±8）：投递人数越多，简历被看到的概率越低
  const dn = Number(job.deliveredNum || 0);
  if (dn > 0 && dn < 200) {
    score += 4;
    reasons.push(`已投 ${dn} 人，竞争较小`);
  } else if (dn >= 1000 && dn < 3000) {
    score -= 2;
    gaps.push(`已投 ${dn} 人`);
  } else if (dn >= 3000 && dn < 8000) {
    score -= 5;
    gaps.push(`已投 ${dn} 人，竞争激烈`);
  } else if (dn >= 8000) {
    score -= 8;
    gaps.push(`已投 ${dn} 人，极度内卷`);
  }

  // 8) 加分（4）
  if (/转正/.test(job.chance || '')) {
    score += 2;
    reasons.push('有转正机会');
  }
  if (preferCos.length && preferCos.some((c) => String(job.company).includes(c))) {
    score += 4;
    reasons.push('目标公司');
  }

  // 9) 专业相关（轻量加权）
  const majorHits = hits(jdText, majorWords);
  if (majorHits.length) {
    score += 4;
    reasons.push(`专业相关：${majorHits.slice(0, 3).join('、')}`);
  }

  // 惩罚项
  const badTitle = hits(`${job.title} ${job.company}`, avoid);
  const badJd = hits(job.jd, avoid);
  if (badTitle.length) {
    score -= 40;
    gaps.push(`标题含规避词「${badTitle.join('、')}」`);
  }
  if (badJd.length) {
    score -= 15;
    gaps.push(`JD 含规避词「${badJd.join('、')}」`);
  }
  if (blacklist.some((c) => String(job.company).includes(c))) {
    score = -999;
    gaps.push('公司在黑名单');
  }

  // 已投递 / 已下线
  if (job.deliveredFlag || job.delivered) {
    hardSkip = true;
    gaps.push('平台上已投递过');
  }
  if (job.endtime) {
    const d = new Date(String(job.endtime).replace(/-/g, '/'));
    if (!Number.isNaN(d.getTime()) && d.getTime() < Date.now()) {
      hardSkip = true;
      gaps.push('岗位已过期');
    }
  }
  if (job.detailError) {
    hardSkip = true;
    gaps.push('详情抓取失败：' + job.detailError);
  }

  score = Math.max(-100, Math.min(100, Math.round(score)));
  let recommend = 'skip';
  if (!hardSkip) {
    if (score >= 62) recommend = 'apply';
    else if (score >= 45) recommend = 'review';
  }

  return { score, recommend, reasons, gaps };
}

const scored = [];
for (const job of jobs) {
  if (excludePart && job.isPartJob) continue;
  const r = scoreOne(job);
  scored.push({ ...job, ...r });
}

scored.sort((a, b) => b.score - a.score || (b.salaryMax || 0) - (a.salaryMax || 0));
// 全量落盘，--top 只影响控制台预览；报告的截断由 report.mjs --top 控制
writeJson(outFile, scored);

const byRec = { apply: 0, review: 0, skip: 0 };
for (const j of scored) byRec[j.recommend]++;
log(`打分完成 ${scored.length} 条：建议投递 ${byRec.apply} / 待复核 ${byRec.review} / 跳过 ${byRec.skip} -> ${outFile}`);
log('Top 10：');
for (const j of scored.slice(0, 10)) {
  log(`  ${String(j.score).padStart(3)} ${j.recommend.padEnd(6)} ${j.title} @ ${j.company} | ${j.city} | ${j.salaryMin ?? '?'}-${j.salaryMax ?? '?'}元/天`);
}
