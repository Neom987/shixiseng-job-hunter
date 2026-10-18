#!/usr/bin/env node
// 浏览器自动投递（puppeteer-core + 本机 Edge/Chrome，复用持久化登录态）
//
// 用法：
//   node scripts/apply.mjs --login                     # 首次：打开浏览器手动登录，保存会话
//   node scripts/apply.mjs --limit 1 --dry-run         # 演练：走到"确认投递"前停下并截图
//   node scripts/apply.mjs --limit 5                   # 真正投递前 5 个
//   node scripts/apply.mjs --uuid inn_xxx --inspect    # 改版排查：dump 投递弹窗 HTML
//
// 退出码：0 正常；3 需要登录；4 未找到可投岗位；5 配置/环境错误

import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, appendJsonl, readJsonl, arg, flag, log, homeDir, ensureDir, sleep, BASE, nowLocal, todayLocal } from './lib.mjs';

const home = homeDir();
ensureDir(home);
const cfg = readJson(path.resolve(home, 'config.json'), {}) || {};
const browserCfg = cfg.browser || {};

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

function findBrowser() {
  if (browserCfg.executablePath && fs.existsSync(browserCfg.executablePath)) return browserCfg.executablePath;
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  return null;
}

/**
 * 加载 puppeteer-core。
 * ESM 的 import() 不认 NODE_PATH，所以这里用 CJS 的 createRequire 逐个候选目录探测：
 * 1) --modules <dir> 显式指定  2) NODE_PATH 里的每个目录  3) 脚本自身所在目录
 */
import { createRequire } from 'node:module';

function loadPuppeteer() {
  const dirs = [];
  const explicit = arg('modules', '');
  if (typeof explicit === 'string' && explicit) dirs.push(explicit);
  for (const d of String(process.env.NODE_PATH || '').split(path.delimiter)) if (d) dirs.push(d);
  dirs.push(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));

  for (const dir of dirs) {
    try {
      const req = createRequire(path.join(dir, '__resolver__.cjs'));
      const mod = req('puppeteer-core');
      const p = mod?.default || mod;
      if (p && typeof p.launch === 'function') return { p, from: dir };
    } catch {
      /* 换下一个目录 */
    }
  }
  return null;
}

const loaded = loadPuppeteer();
if (!loaded) {
  console.error(
    '缺少 puppeteer-core。\n' +
      '  1) 找/建一个 node 工作目录：npm i puppeteer-core --prefix "<node-workspace>"\n' +
      '  2) 运行时指定：--modules "<node-workspace>/node_modules" 或设置 NODE_PATH\n' +
      '详见 references/apply-playbook.md'
  );
  process.exit(5);
}
const puppeteer = loaded.p;
log(`使用 puppeteer-core：${loaded.from}`);

const executablePath = findBrowser();
if (!executablePath) {
  console.error('未找到 Edge/Chrome 可执行文件，请在 config.json 的 browser.executablePath 指定');
  process.exit(5);
}

const profileDir = path.resolve(home, browserCfg.profileDir || 'browser-profile');
ensureDir(profileDir);
const headless = flag('headless') || browserCfg.headless === true;
const dryRun = flag('dry-run') || cfg.dryRun === true;
const inspect = flag('inspect');
const ledgerFile = path.resolve(home, 'applications.jsonl');
const runId = nowLocal().replace(/[:.]/g, '-').replace('T', '_');
const shotDir = ensureDir(path.resolve(home, 'runs', runId));

const caps = cfg.caps || {};
const dailyCap = Number(caps.dailyCap ?? 15);
const runCap = Number(arg('limit', caps.runCap ?? 8));
const minDelay = Number(cfg.delays?.minSec ?? 8);
const maxDelay = Number(cfg.delays?.maxSec ?? 22);
const prefs = cfg.deliverPrefs || {};

function todayApplied() {
  const today = todayLocal();
  const seen = new Set();
  for (const e of readJsonl(ledgerFile)) {
    if (e.status === 'applied' && String(e.appliedTs || e.ts || '').slice(0, 10) === today) seen.add(e.uuid);
  }
  return seen.size;
}

function record(entry) {
  appendJsonl(ledgerFile, { ts: nowLocal(), channel: 'browser-auto', ...entry });
}

// ---------- 浏览器 ----------
//
// 不用 puppeteer.launch()：新版 Edge 与 puppeteer 的 spawn/pipe 握手在部分 Windows
// 环境会直接失败（Code: 0，无 stderr）。改为自行 spawn 浏览器 + 打开调试端口，再 CDP 连接。
// 附带好处：浏览器是真实窗口，用户可在同一窗口里手动登录。

import { spawn } from 'node:child_process';

async function launchBrowser() {
  const port = Number(browserCfg.debugPort || 9333 + Math.floor(Math.random() * 300));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--lang=zh-CN',
    'about:blank',
  ];
  if (headless) args.unshift('--headless=new');

  const child = spawn(executablePath, args, { stdio: 'ignore' });
  let exited = null;
  child.on('exit', (code) => (exited = code));

  let version = null;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    if (exited !== null && version === null && i > 10) break;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
      version = await res.json();
      break;
    } catch {
      /* 还没起来 */
    }
  }

  if (!version) {
    try {
      child.kill();
    } catch {}
    console.error(
      `浏览器启动失败（端口 ${port}）。常见原因：\n` +
        `  1) 已有同 profile 的浏览器窗口在运行 —— 先关掉所有 Edge 窗口再试；\n` +
        `  2) 杀软拦截 —— 把 ${executablePath} 加白；\n` +
        `  3) 在 config.json 里把 browser.debugPort 固定成 9333 后重试。`
    );
    process.exit(5);
  }

  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: { width: 1440, height: 900 },
  });
  return { browser, child, port, version: version.Browser };
}

const launched = await launchBrowser();
const browser = launched.browser;
const page = await browser.newPage();
await page.setUserAgent(
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
);
page.setDefaultTimeout(15000);
log(`浏览器就绪：${launched.version} · CDP ${launched.port} · ${headless ? '无头' : '有头'}`);

async function closeBrowser() {
  try {
    // 优雅关闭，确保 cookie / 会话落盘（child.kill 可能丢最后一次写入）
    await browser.close();
  } catch {}
  try {
    launched.child.kill();
  } catch {}
}

async function goto(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(1200);
}

async function isLoggedIn() {
  return page.evaluate(() => {
    const txt = document.body.innerText || '';
    // 未登录：右上角「登录/注册」+ 底部浮出「扫码登录/密码登录」
    const loggedOut = /登录\s*\/\s*注册|扫码登录|密码登录/.test(txt);
    // 已登录：导航出现个人入口
    const loggedIn = /我的简历|投递记录|退出登录|我的收藏/.test(txt);
    if (loggedIn) return true;
    return !loggedOut;
  });
}

/**
 * 按可见文本点击元素。texts 为字面量数组；exact=true 要求整段文本完全相等（忽略空白）。
 * 返回实际点击到的文本，未命中返回 null。
 */
async function clickByText(texts, { tags = ['button', 'a', 'div', 'span'], exact = false, root = null } = {}) {
  const list = Array.isArray(texts) ? texts : [texts];
  return page.evaluate(
    (want, tagList, isExact, rootSel) => {
      const scope = rootSel ? document.querySelector(rootSel) : document;
      if (!scope) return null;
      const nodes = Array.from(scope.querySelectorAll(tagList.join(',')));
      const visible = nodes.filter((el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        return r.width > 4 && r.height > 4 && st.visibility !== 'hidden' && st.display !== 'none' && st.pointerEvents !== 'none';
      });
      const cands = visible
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { el, t: (el.innerText || el.textContent || '').replace(/\s+/g, ''), area: r.width * r.height };
        })
        .filter(({ t }) => t && t.length <= 12 && want.some((w) => (isExact ? t === w.replace(/\s+/g, '') : t.includes(w))))
        // 同文案时取面积最小的那个：真正的按钮比包裹它的容器小得多
        .sort((a, b) => a.t.length - b.t.length || a.area - b.area);
      if (!cands.length) return null;
      const target = cands[0].el;
      target.scrollIntoView({ block: 'center' });
      target.click();
      return cands[0].t;
    },
    list,
    tags,
    exact,
    root
  );
}

async function hasText(re, timeout = 3000) {
  try {
    await page.waitForFunction((src) => new RegExp(src).test(document.body.innerText || ''), { timeout }, re.source);
    return true;
  } catch {
    return false;
  }
}

async function dialogHtml() {
  return page.evaluate(() => {
    const sels = ['.common-deliver', '.el-dialog__wrapper', '.el-message-box__wrapper', '[class*="deliver"]'];
    const out = [];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el) out.push(`<!-- ${s} -->\n` + el.outerHTML.slice(0, 6000));
    }
    return out.join('\n\n') || '（未找到投递弹窗节点）';
  });
}

async function setPrefs() {
  const entries = Object.entries(prefs).filter(([, v]) => v);
  if (!entries.length) return [];
  const done = [];
  for (const [label, value] of entries) {
    try {
      const opened = await page.evaluate((lb) => {
        const items = Array.from(document.querySelectorAll('.complete-info__item, .el-form-item'));
        for (const it of items) {
          const title = (it.querySelector('.complete-info__item-title, .el-form-item__label')?.innerText || '').replace(/\s+/g, '');
          if (title.includes(lb)) {
            const input = it.querySelector('.el-input__inner, input');
            if (input) {
              input.click();
              input.focus();
              return true;
            }
          }
        }
        return false;
      }, label);
      if (!opened) continue;
      await sleep(400);
      const picked = await page.evaluate((val) => {
        const opts = Array.from(document.querySelectorAll('.el-select-dropdown__item, li.el-select-dropdown__item'));
        const hit = opts.find((o) => (o.innerText || '').replace(/\s+/g, '').includes(val));
        if (hit) {
          hit.click();
          return (hit.innerText || '').trim();
        }
        return null;
      }, String(value));
      if (picked) done.push(`${label}=${picked}`);
      await sleep(250);
    } catch {
      /* 偏好设置是尽力而为，失败不影响投递 */
    }
  }
  return done;
}

// ---------- 登录模式 ----------

if (flag('login')) {
  // 站点没有可直达的登录页（/user/login 返回 403），登录是首页的浮层/弹窗
  await goto(`${BASE}/`);
  log('浏览器已打开实习僧首页。请在窗口里点右上角「登录/注册」，用扫码或短信验证码完成登录。');
  log('登录成功后脚本会自动检测并保存会话，无需手动关闭窗口。');
  let ok = false;
  for (let i = 0; i < 100; i++) {
    await sleep(3000);
    if (await isLoggedIn()) {
      ok = true;
      break;
    }
    if (i % 10 === 9) log(`等待登录中… ${(i + 1) * 3}s`);
  }
  if (ok) {
    await sleep(2000); // 留时间让 cookie 落盘
    await closeBrowser();
    log(`✓ 登录态已保存到 ${profileDir}，后续投递会自动复用`);
    process.exit(0);
  }
  await closeBrowser();
  console.error('✗ 300 秒内未检测到登录成功');
  process.exit(3);
}

// ---------- 选岗 ----------

const inFile = path.resolve(home, String(arg('in', 'ranked.json')));
const singleUuid = arg('uuid', '');
let targets = [];

if (singleUuid && typeof singleUuid === 'string') {
  const pool = readJson(inFile, []) || [];
  const hit = pool.find((j) => j.uuid === singleUuid);
  targets = [hit || { uuid: singleUuid, title: '', company: '', url: `${BASE}/intern/${singleUuid}` }];
} else {
  const pool = readJson(inFile, []);
  if (!Array.isArray(pool) || !pool.length) {
    console.error(`没有候选岗位：${inFile}，请先运行 search.mjs / detail.mjs / score.mjs`);
    process.exit(4);
  }
  const applied = new Set(readJsonl(ledgerFile).filter((e) => e.status === 'applied').map((e) => e.uuid));
  targets = pool
    .filter((j) => (j.recommend ? j.recommend === 'apply' : true))
    .filter((j) => !applied.has(j.uuid))
    .slice(0, runCap);
}

const alreadyToday = todayApplied();
if (alreadyToday >= dailyCap) {
  log(`今日已投 ${alreadyToday} 个，达到上限 ${dailyCap}，停止。`);
  await closeBrowser();
  process.exit(0);
}
const budget = Math.min(targets.length, dailyCap - alreadyToday);
log(`本次计划投递 ${budget} 个（今日已投 ${alreadyToday}/${dailyCap}）${dryRun ? ' · 演练模式' : ''}`);

// ---------- 单个岗位投递 ----------

async function applyOne(job, idx) {
  const uuid = job.uuid;
  const label = `${job.title || uuid} @ ${job.company || ''}`;
  const shot = (tag) => page.screenshot({ path: path.join(shotDir, `${String(idx).padStart(2, '0')}-${uuid}-${tag}.png`), fullPage: false }).catch(() => {});

  await goto(job.url || `${BASE}/intern/${uuid}`);

  if (!(await isLoggedIn())) {
    await shot('need-login');
    return { uuid, title: job.title, company: job.company, status: 'failed', note: '需要登录', needLogin: true };
  }

  const bodyText = await page.evaluate(() => document.body.innerText || '');
  if (job.deliveredFlag === true || /已投递过|您已投递|已投递该职位|投递成功/.test(bodyText.slice(0, 2000))) {
    return { uuid, title: job.title, company: job.company, status: 'skipped', note: '平台显示已投递过' };
  }

  // 打开投递弹窗。实测详情页主按钮文案是「投个简历」（2026-10 抓图确认）
  let clicked = await clickByText(['投个简历', '立即投递', '投递简历', '立即申请', '申请职位', '投递'], { exact: true });
  if (!clicked) clicked = await clickByText(['投个简历', '投递'], { tags: ['button', 'a', 'div'], exact: false });
  if (!clicked) {
    await shot('no-apply-button');
    const html = await dialogHtml();
    fs.writeFileSync(path.join(shotDir, `${uuid}-page.html`), await page.content(), 'utf8');
    return { uuid, title: job.title, company: job.company, status: 'failed', note: `未找到投递按钮（点击文本：${clicked || '无'}）；页面已存 ${shotDir}` };
  }
  log(`  · 点击「${clicked}」`);

  // 等待弹窗
  let dialogReady = false;
  try {
    await page.waitForSelector('.common-deliver, .el-dialog__wrapper, .el-message-box__wrapper', { visible: true, timeout: 10000 });
    dialogReady = true;
  } catch {
    dialogReady = await hasText(/确认投递|投递简历|选择简历/, 3000);
  }

  if (!dialogReady) {
    const html = await dialogHtml();
    fs.writeFileSync(path.join(shotDir, `${uuid}-dialog.html`), html, 'utf8');
    await shot('no-dialog');
    if (/登录/.test(await page.evaluate(() => document.body.innerText || ''))) {
      return { uuid, title: job.title, company: job.company, status: 'failed', note: '需要登录', needLogin: true };
    }
    return { uuid, title: job.title, company: job.company, status: 'failed', note: `投递弹窗未出现，HTML 已存 ${shotDir}/${uuid}-dialog.html` };
  }

  if (inspect) {
    const html = await dialogHtml();
    fs.writeFileSync(path.join(shotDir, `${uuid}-dialog.html`), html, 'utf8');
    await shot('dialog');
    log(`  · 已 dump 弹窗 HTML -> ${path.join(shotDir, `${uuid}-dialog.html`)}`);
    return { uuid, title: job.title, company: job.company, status: 'skipped', note: 'inspect 模式' };
  }

  const setDone = await setPrefs();
  if (setDone.length) log(`  · 投递偏好：${setDone.join('  ')}`);

  await shot('before-submit');

  if (dryRun) {
    return { uuid, title: job.title, company: job.company, status: 'skipped', note: '演练模式，未提交' };
  }

  // 提交
  let submitted = await page.evaluate(() => {
    const btn = document.querySelector('.common-deliver__footer .btn');
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  if (!submitted) submitted = !!(await clickByText(['确认投递', '确认'], { tags: ['button', 'div', 'span'], exact: true }));
  if (!submitted) {
    await shot('no-submit-button');
    return { uuid, title: job.title, company: job.company, status: 'failed', note: '未找到「确认投递」按钮' };
  }

  const success = await hasText(/投递成功|已投递|投递完成|简历已送达/, 12000);
  await sleep(800);
  await shot(success ? 'success' : 'after-submit');

  if (success) return { uuid, title: job.title, company: job.company, status: 'applied', note: '自动投递成功' };
  return { uuid, title: job.title, company: job.company, status: 'failed', note: '点击提交后未捕获成功提示，请查看截图人工确认' };
}

const results = [];
let needLogin = false;

for (let i = 0; i < budget; i++) {
  const job = targets[i];
  log(`[${i + 1}/${budget}] ${job.title || job.uuid} @ ${job.company || ''}`);
  let r;
  try {
    r = await applyOne(job, i + 1);
  } catch (e) {
    r = { uuid: job.uuid, title: job.title, company: job.company, status: 'failed', note: '异常：' + e.message };
  }
  results.push(r);
  record({
    uuid: r.uuid,
    title: r.title,
    company: r.company,
    city: job.city || '',
    score: job.score ?? null,
    salaryMin: job.salaryMin ?? null,
    salaryMax: job.salaryMax ?? null,
    status: r.status,
    note: r.note,
    url: job.url || `${BASE}/intern/${r.uuid}`,
  });
  log(`  -> ${r.status} ${r.note ? '· ' + r.note : ''}`);
  if (r.needLogin) {
    needLogin = true;
    break;
  }
  if (i < budget - 1) {
    const wait = minDelay + Math.random() * Math.max(1, maxDelay - minDelay);
    log(`  · 等待 ${wait.toFixed(0)}s`);
    await sleep(wait * 1000);
  }
}

writeJson(path.join(home, 'runs', runId, 'result.json'), { at: nowLocal(), dryRun, results });
await closeBrowser();

const okCount = results.filter((r) => r.status === 'applied').length;
const failCount = results.filter((r) => r.status === 'failed').length;
log(`本次完成：成功 ${okCount}，失败 ${failCount}，跳过 ${results.length - okCount - failCount}；截图 ${shotDir}`);

if (needLogin) {
  console.error('\n⚠ 登录态失效，请先运行：node scripts/apply.mjs --login');
  process.exit(3);
}
process.exit(0);
