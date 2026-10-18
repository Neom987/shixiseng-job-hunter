#!/usr/bin/env node
// 按公司类型拆分岗位，输出"简历定制简报"：该类公司在要什么、你命中什么、缺什么
//
// 用法：
//   node scripts/tailor.mjs                       # 全部候选按公司类型聚类 + 缺口汇总
//   node scripts/tailor.mjs --archetype 金融       # 单类型详细简报
//   node scripts/tailor.mjs --uuid inn_xxx        # 单岗位简报
//
// 输出：<home>/tailor-brief.md

import path from 'node:path';
import { readJson, writeJson, arg, log, homeDir, ensureDir } from './lib.mjs';

const home = homeDir();
ensureDir(home);
const inFile = path.resolve(home, String(arg('in', 'ranked.json')));
const jobs = readJson(inFile, []) || [];
const profile = readJson(path.resolve(home, 'profile.json'), {}) || {};
if (!jobs.length) {
  console.error(`没有候选岗位：${inFile}`);
  process.exit(2);
}

// ---------- 公司类型判定 ----------

const BIG_TECH = [
  '字节跳动', '腾讯', '阿里巴巴', '阿里', '百度', '美团', '快手', '京东', '小红书', '拼多多',
  '网易', '滴滴', 'OPPO', 'vivo', '华为', '小米', '哔哩哔哩', 'B站', '货拉拉', '美图',
  'Shopee', 'shopee', 'eBay', 'ebay', 'Shein', 'SHEIN', 'TikTok', '微软', '亚马逊', 'Google',
];
const FINANCE = ['证券', '基金', '银行', '保险', '中金', '中信', '国泰', '招商', '众安', '财富', '资管', '信托'];
const BIO = ['生物', '基因', '医药', '医疗', '临床', '制药', '诊断', '华大', '药明'];

function asciiRatio(s) {
  const t = String(s || '');
  if (!t.length) return 0;
  const ascii = (t.match(/[A-Za-z]/g) || []).length;
  return ascii / t.length;
}

export function archetypeOf(job) {
  const co = String(job.company || '');
  const ind = String(job.industry || '');
  const jd = String(job.jd || '') + String(job.requirements || '');

  if (FINANCE.some((k) => co.includes(k) || ind.includes(k)) || /固收|量化|金融工程|因子|估值模型|投研/.test(jd)) return '金融券商';
  if (BIO.some((k) => co.includes(k) || ind.includes(k)) || /基因|临床|生物信息|医学|表型/.test(jd)) return '生物医药';
  if (asciiRatio(jd) > 0.35) return '外企跨国';
  if (BIG_TECH.some((k) => co.includes(k))) return '互联网大厂';
  if (/零售|快消|服饰|鞋|食品|日化/.test(ind) || /商业分析|消费者洞察|品类管理|市场调研/.test(jd)) return '消费零售';
  return '创业AI';
}

// ---------- 技能词典 ----------

const SKILL_DICT = [
  'SQL', 'Python', 'R语言', 'Excel', 'Tableau', 'PowerBI', 'Power BI', 'SPSS', 'SAS',
  '机器学习', '深度学习', '大模型', 'AIGC', 'NLP', '数据可视化', '数据清洗', '数据建模',
  '统计分析', '回归分析', '因子分析', 'AB测试', 'ABTest', '埋点', '爬虫', 'ETL', 'Hive',
  '竞品分析', '行业研究', '用户研究', '问卷', '访谈', '焦点小组', '市场调研', '商业分析',
  '内容运营', '社群运营', '用户增长', '投放', 'ROI', '文案', '短视频', '小红书', '抖音',
  '文献检索', '英文文献', '实验设计', '生物信息', '基因组', '临床数据',
  '产品原型', 'Axure', 'Figma', '需求文档', 'PRD', '项目管理',
];

const CAP_SENTENCE = /(具备|熟悉|熟练|掌握|了解|要求|优先|加分)[^。；\n]{4,60}/g;

function extract(jd) {
  const text = String(jd || '');
  const skills = SKILL_DICT.filter((k) => new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text));
  const caps = Array.from(new Set((text.match(CAP_SENTENCE) || []).map((s) => s.trim()))).slice(0, 12);
  return { skills, caps };
}

const mySkills = (profile.skills || []).map((s) => String(s).toLowerCase());
function hitOf(skill) {
  const s = skill.toLowerCase();
  return mySkills.some((m) => m.includes(s) || s.includes(m));
}

// ---------- 各类型的改写要点 ----------

const PLAYBOOK = {
  互联网大厂: {
    keys: ['数据量级与业务影响', 'SQL/Python 硬技能', '跨团队推进', '可量化结果', '实习时长稳定性'],
    emphasize: ['把"9个月0→1200粉"写成增长数据（留存/爆款率/单篇最高阅读）', '把遗迹调查写成"数据采集+结论输出"而不是"挖现场"', '明确每周5天、可连续6个月'],
    downplay: ['与数据无关的社团/爱好叙事（保留"统筹/协调"动作即可）', '与数据无关的课程罗列'],
    tone: '动词开头、数字结尾，每条一行写完；不写形容词',
    check: '每条经历能否回答"所以业务上发生了什么变化"',
  },
  金融券商: {
    keys: ['数理统计功底', 'Python 建模/回测', '报告撰写', '严谨与合规意识', '专业术语准确'],
    emphasize: ['把怪兽学概论92、超古代语87 单独成行放到显眼位置', '把遗迹调查的采样设计写成"变量控制+过程记录+误差处理"', '强调文献检索与英文材料处理能力'],
    downplay: ['内容运营的"涨粉"叙事（改为"数据驱动的选题与效果归因"）', '社团活动的娱乐性描述'],
    tone: '克制、精确，不夸大；用"参与/协助/负责"区分贡献度',
    check: '有没有出现无法自证的量化承诺（如"提升收益X%"）',
  },
  生物医药: {
    keys: ['专业对口', '实验技能', '英文文献', '科研项目完整度', '数据敏感性'],
    emphasize: ['科研项目放在第一段，写清「课题→采样→鉴定→结论」的完整链路与你的具体分工', '实验课分数（怪兽解剖88 / 超古代材料化学85）要露出来', '英文文献阅读能力直接对应 JD 第2条'],
    downplay: ['AI 绘图 / 自动化脚本（可保留一句作为"工具能力"，不要展开）'],
    tone: '学术化，名词准确（菌株、培养基、无菌操作、表型）',
    check: '专业名词是否写错（写错一个就出局）',
  },
  外企跨国: {
    keys: ['英文读写', 'SQL 与结构化分析', '商业洞察表达', '跨文化沟通', '结果导向'],
    emphasize: ['准备中英双语版，英文版用 action verb + metric 句式', '把语言成绩写成分项成绩（如六级 620 / 阅读 245）', '把内容运营写成 growth experiment，而不是"发帖"'],
    downplay: ['中式荣誉表述（"积极分子"直译会失效，改为 selected as outstanding member）'],
    tone: '简洁、无形容词堆砌；英文避免中式长句',
    check: '英文版能否被 native 一眼看懂，有没有拼写/时态错误',
  },
  消费零售: {
    keys: ['调研方法（问卷/访谈/桌面研究）', '行业洞察', '结论呈现', '执行力', '双一流背景'],
    emphasize: ['把遗迹调查里的"问卷/样本采集"往用户研究上靠（仅限真做过的部分）', '内容运营写成"受众洞察→选题→验证"的闭环', '突出院校背景（双一流/专业排名）'],
    downplay: ['纯技术细节（SQL 窗口函数这类可一句带过）'],
    tone: '结论先行，先给判断再给依据',
    check: '有没有一个属于你自己的"洞察结论"',
  },
  创业AI: {
    keys: ['上手速度', 'AI 工具实操', '一人多岗', '细心与耐性', '自驱'],
    emphasize: ['ComfyUI + 大模型工作流是最大差异化，放最前面', '自动化脚本证明"能自己解决问题"，要写清解决什么问题', '明确能接受重复性质检/标注类工作'],
    downplay: ['社团管理（创业公司不看层级，看产出）'],
    tone: '直接、具体，少用"负责/参与"，多用"我做了X，结果是Y"',
    check: '有没有展示"没人教也能自己搞出来"的证据',
  },
};

// ---------- 聚类 ----------

const groups = new Map();
for (const j of jobs) {
  const a = archetypeOf(j);
  if (!groups.has(a)) groups.set(a, []);
  groups.get(a).push(j);
}

const uuid = arg('uuid', '');
const onlyType = arg('archetype', '');
const md = [];
md.push('# 简历定制简报');
md.push('');
md.push(`生成时间：${new Date().toLocaleString('zh-CN')}　候选人：${profile.name || '—'}`);
md.push('');

if (typeof uuid === 'string' && uuid) {
  const job = jobs.find((j) => j.uuid === uuid);
  if (!job) {
    console.error(`找不到岗位 ${uuid}`);
    process.exit(2);
  }
  const a = archetypeOf(job);
  const { skills, caps } = extract(`${job.jd}\n${job.requirements}`);
  md.push(`## ${job.title} @ ${job.company}（${a}）`);
  md.push('');
  md.push(`- 城市 ${job.city}｜学历 ${job.degree}｜日薪 ${job.salaryMin ?? '?'}-${job.salaryMax ?? '?'}｜已投 ${job.deliveredNum ?? '?'} 人`);
  md.push(`- JD 技能词：${skills.join('、') || '（无命中）'}`);
  md.push(`- 你已具备：${skills.filter(hitOf).join('、') || '（无）'}`);
  md.push(`- **缺口**：${skills.filter((s) => !hitOf(s)).join('、') || '（无）'}`);
  md.push('');
  md.push('### 该类型公司看重');
  md.push(PLAYBOOK[a].keys.map((k) => `- ${k}`).join('\n'));
  md.push('');
  md.push('### JD 原话（改简历时逐条对齐）');
  md.push(caps.map((c) => `- ${c}`).join('\n') || '- （无）');
  md.push('');
  md.push('### 改写动作');
  md.push(PLAYBOOK[a].emphasize.map((k) => `- ${k}`).join('\n'));
} else {
  const rows = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  md.push('## 一、岗位按公司类型分布');
  md.push('');
  md.push('| 类型 | 岗位数 | 平均分 | 代表公司 | 平均已投人数 |');
  md.push('| --- | --- | --- | --- | --- |');
  for (const [a, list] of rows) {
    if (typeof onlyType === 'string' && onlyType && a !== onlyType) continue;
    const avg = Math.round(list.reduce((s, j) => s + (j.score || 0), 0) / list.length);
    const dn = Math.round(list.reduce((s, j) => s + (j.deliveredNum || 0), 0) / list.length);
    const cos = Array.from(new Set(list.map((j) => j.company))).slice(0, 3).join('、');
    md.push(`| ${a} | ${list.length} | ${avg} | ${cos} | ${dn} |`);
  }
  md.push('');

  for (const [a, list] of rows) {
    if (typeof onlyType === 'string' && onlyType && a !== onlyType) continue;
    const all = list.flatMap((j) => extract(`${j.jd}\n${j.requirements}`).skills);
    const freq = {};
    for (const s of all) freq[s] = (freq[s] || 0) + 1;
    const rankedSkills = Object.entries(freq).sort((x, y) => y[1] - x[1]);
    const have = rankedSkills.filter(([s]) => hitOf(s));
    const miss = rankedSkills.filter(([s]) => !hitOf(s));

    md.push(`## ${a}（${list.length} 个岗位）`);
    md.push('');
    md.push('**该类最常要求的技能**：' + rankedSkills.slice(0, 8).map(([s, n]) => `${s}(${n})`).join('、'));
    md.push('');
    md.push('**你已有**：' + (have.map(([s]) => s).join('、') || '（无）'));
    md.push('');
    md.push('**缺口**：' + (miss.slice(0, 8).map(([s]) => s).join('、') || '（无）'));
    md.push('');
    md.push('**改写要点**：');
    md.push(PLAYBOOK[a].emphasize.map((k) => `- ${k}`).join('\n'));
    md.push('');
    md.push(`**语气**：${PLAYBOOK[a].tone}`);
    md.push('');
    md.push(`**自检**：${PLAYBOOK[a].check}`);
    md.push('');
  }

  // 全局缺口
  const allFreq = {};
  for (const j of jobs) for (const s of extract(`${j.jd}\n${j.requirements}`).skills) allFreq[s] = (allFreq[s] || 0) + 1;
  const topMiss = Object.entries(allFreq)
    .filter(([s]) => !hitOf(s))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  md.push('## 二、跨类型共性缺口（补这些收益最大）');
  md.push('');
  md.push('| 技能 | 出现在多少个 JD | 建议动作 |');
  md.push('| --- | --- | --- |');
  const ACTION = {
    SQL: '两周内做一个真实小项目（公开数据集 → 建表 → 窗口函数查询 → 结论），写进简历',
    Python: '已有基础课程，补一个 pandas 清洗+可视化的完整 notebook',
    Excel: '做一份数据透视表+VLOOKUP 的分析模板，可展示',
    Tableau: '用公开数据做 1 个 dashboard，截图放作品集',
    PowerBI: '同 Tableau，二选一即可',
    问卷: '把做过的问卷整理成方法说明',
    竞品分析: '选 2 个产品写一份 3 页竞品对比',
    行业研究: '选目标行业写一份 5 页行业速览',
  };
  for (const [s, n] of topMiss) {
    md.push(`| ${s} | ${n} | ${ACTION[s] || '在简历里找一段真实经历重新表述，或补一个小项目'} |`);
  }
  md.push('');
}

const outFile = path.resolve(home, 'tailor-brief.md');
import('node:fs').then((fs) => fs.writeFileSync(outFile, md.join('\n'), 'utf8'));

const summary = Array.from(groups.entries()).map(([a, l]) => `${a}:${l.length}`).join('  ');
log(`公司类型分布：${summary}`);
log(`简报 -> ${outFile}`);
