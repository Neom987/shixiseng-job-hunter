// 实习僧求职 skill 公共库：HTTP 抓取、NUXT 数据解析、路径与参数工具
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export const BASE = 'https://www.shixiseng.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 本地时区的 ISO 风格时间戳（不带 Z）。toISOString() 是 UTC，会让"今日"统计错位。 */
export function nowLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function todayLocal(d = new Date()) {
  return nowLocal(d).slice(0, 10);
}

export function homeDir() {
  return process.env.JOBHUNT_HOME || path.resolve(process.cwd(), '.jobhunt');
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function readJson(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(p, v) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8');
}

export function readJsonl(p) {
  try {
    return fs
      .readFileSync(p, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function appendJsonl(p, obj) {
  ensureDir(path.dirname(p));
  fs.appendFileSync(p, JSON.stringify(obj) + '\n', 'utf8');
}

// ---------- 文本清洗 ----------

const PUA = /[\uE000-\uF8FF]/g; // 站点用私有区字符做图标字体（数字类字段不可恢复）

export function decodeEntities(s = '') {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function cleanText(s = '') {
  return decodeEntities(s)
    .replace(PUA, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function toNum(v) {
  const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

// ---------- NUXT 数据解析 ----------

/**
 * 解析 SSR 注入的 window.__NUXT__。
 * 该表达式是 IIFE（参数化压缩），必须在沙箱里求值，不能正则硬解。
 */
export function parseNuxt(html) {
  const i = html.indexOf('window.__NUXT__=');
  if (i < 0) return null;
  const end = html.indexOf('</script>', i);
  let expr = html.slice(i + 'window.__NUXT__='.length, end === -1 ? undefined : end).trim();
  if (expr.endsWith(';')) expr = expr.slice(0, -1);
  const ctx = vm.createContext(Object.create(null));
  try {
    return vm.runInContext('(' + expr + ')', ctx, { timeout: 8000 });
  } catch {
    return null;
  }
}

// ---------- 网络 ----------

export async function fetchHtml(url, { retries = 3, timeoutMs = 25000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Referer: BASE + '/interns',
        },
        signal: ctl.signal,
        redirect: 'follow',
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (attempt < retries - 1) await sleep(1200 * (attempt + 1) + Math.random() * 800);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`抓取失败 ${url} -> ${lastErr && lastErr.message}`);
}

// ---------- 归一化 ----------

export function normListJob(x) {
  return {
    uuid: x.uuid,
    title: cleanText(x.name),
    company: cleanText(x.cname),
    cUuid: x.c_uuid || '',
    city: cleanText(x.city),
    degree: cleanText(x.degree),
    salaryMin: toNum(x.minsalary),
    salaryMax: toNum(x.maxsalary),
    industry: cleanText(x.industry),
    scale: cleanText(x.scale),
    chance: cleanText(x.chance || ''),
    delivered: !!x.deliver,
    tags: (x.i_tags || []).map(cleanText).filter(Boolean),
    companyTags: (x.c_tags || []).map(cleanText).filter(Boolean),
    refresh: cleanText(x.refresh || ''),
    url: `${BASE}/intern/${x.uuid}`,
  };
}

export function normDetailJob(m, base = {}) {
  const jobLabel = m.job_label || {};
  return {
    ...base,
    uuid: base.uuid || m.uuid,
    title: cleanText(m.iname || base.title || ''),
    company: cleanText(m.cname || base.company || ''),
    city: cleanText(m.city || base.city || ''),
    address: cleanText(m.address || ''),
    degree: cleanText(m.degree || base.degree || ''),
    salaryMin: toNum(m.minsal) ?? base.salaryMin ?? null,
    salaryMax: toNum(m.maxsal) ?? base.salaryMax ?? null,
    salaryDesc: cleanText(m.salary_desc || ''),
    daysPerWeek: toNum(m.day),
    months: toNum(m.month),
    chance: cleanText(m.chance || base.chance || ''),
    industry: cleanText(m.industry || base.industry || ''),
    scale: cleanText(m.scale || base.scale || ''),
    endtime: cleanText(m.endtime || ''),
    refresh: cleanText(m.refresh || base.refresh || ''),
    deliveredNum: toNum(m.delivered_num),
    // 注意：该字段是字符串 "0"/"1"，不能直接 !! 判断
    deliveredFlag: m.delivered === true || Number(m.delivered) > 0,
    isPartJob: !!m.is_part_job,
    isHr: !!m.is_hr,
    jobLabel: {
      quick: !!jobLabel.is_quick,
      hirer: !!jobLabel.is_hirer,
      rpo: !!jobLabel.is_rpo,
      doubleSelection: !!jobLabel.is_double_selection,
    },
    skills: (m.skills || []).map((s) => (typeof s === 'string' ? cleanText(s) : cleanText(s.name || s.skill || ''))).filter(Boolean),
    jd: cleanText(m.info || ''),
    requirements: cleanText(m.job_requirements || ''),
    hope: (m.hope_you_v2 || m.hope_you || []).map(cleanText).filter(Boolean),
    riskWarning: cleanText(m.risk_warning || ''),
    url: `${BASE}/intern/${base.uuid || m.uuid}`,
    fetchedAt: nowLocal(),
  };
}

// ---------- CLI 参数 ----------

export function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

export function flag(name) {
  return process.argv.includes('--' + name);
}

export function log(...args) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}]`, ...args);
}

export function resolveHomePath(p, home) {
  if (!p) return null;
  if (path.isAbsolute(p)) return p;
  const fromHome = path.resolve(home, p);
  if (fs.existsSync(fromHome)) return fromHome;
  return path.resolve(process.cwd(), p);
}
