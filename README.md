# shixiseng-job-hunter

在 [实习僧](https://www.shixiseng.com) 上跑通 **检索岗位 → 匹配打分 → 简历定制 → 自动投递 → 台账日报** 全流程的自动化技能包。

面向找实习 / 暑期实习的场景：把「每天手动刷岗位、逐个看 JD、复制粘贴投递」变成一条可复现的命令行流水线，产物全部落在本地 `.jobhunt/` 目录，随时可查、可导出日报。

> 核心思路：不爬 HTML，直接读页面内联的 SSR 数据。实习僧的列表页与详情页数据全部压缩在 `window.__NUXT__` 里，用 `vm` 沙箱求值即可拿到结构化 JSON —— 比解析 DOM 稳定得多，也不需要登录。

---

## 能力一览

| 层 | 手段 | 是否需要登录 | 脚本 |
| --- | --- | --- | --- |
| 检索岗位 | 直取 SSR 数据（`window.__NUXT__`） | 否 | `search.mjs` |
| 抓完整 JD | 同上，详情页 | 否 | `detail.mjs` |
| 匹配打分 | 确定性规则，结果可复现 | 否 | `score.mjs` |
| 简历定制 | 按公司类型聚类 + 输出改写简报 | 否 | `tailor.mjs` |
| 自动投递 | 本机 Edge / Chrome + 持久化会话 | **是** | `apply.mjs` |
| 台账 / 日报 | 本地 JSONL + Markdown / HTML | 否 | `track.mjs` / `report.mjs` |

除了投递环节，其余全部不需要账号、不需要 cookie、不依赖第三方库。

## 环境要求

- **Node.js ≥ 18**（检索、打分、日报零依赖）
- **puppeteer-core**（仅自动投递需要）
  ```bash
  npm i puppeteer-core
  ```
- 本机已安装 Edge 或 Chrome（投递时脚本会自动探测路径）

## 快速开始

### 方式一：作为 AI 技能（推荐）

把整个目录放进你的技能目录（例如 `~/.workbuddy-ai/skills/shixiseng-job-hunter/`），然后在对话里说「帮我找实习」「看看今天有什么新岗位」，AI 会按 `SKILL.md` 的流程逐步执行。

### 方式二：直接跑脚本

```bash
# 1. 准备画像与配置（在你的简历所在目录运行）
export JOBHUNT_HOME="$(pwd)/.jobhunt"
mkdir -p "$JOBHUNT_HOME"
cp assets/config.example.json  "$JOBHUNT_HOME/config.json"
cp assets/profile.example.json "$JOBHUNT_HOME/profile.json"   # 然后改成你自己的信息

# 2. 检索（关键词 2-6 个，逗号分隔）
node scripts/search.mjs --keywords "数据分析,AI产品运营" --cities "深圳,广州" --pages 1

# 3. 抓完整 JD + 打分
node scripts/detail.mjs --limit 60
node scripts/score.mjs --top 30

# 4. 简历定制简报
node scripts/tailor.mjs

# 5. 生成日报
node scripts/report.mjs --top 25
```

投递环节（会真的点「投递」按钮，请先 dry-run）：

```bash
node scripts/apply.mjs --login              # 打开首页，你自己扫码/验证码登录
node scripts/apply.mjs --uuid <uuid> --inspect   # 先 dump 弹窗 HTML，确认选择器
node scripts/apply.mjs --limit 1 --dry-run  # 走到提交前停下，看截图
node scripts/apply.mjs --limit 1            # 真投一个，看截图
node scripts/apply.mjs --limit 8            # 确认无误后放量
```

## 产物结构

```
.jobhunt/
├── profile.json          候选人画像（一次性生成，长期复用）
├── config.json           浏览器 / 上限 / 投递偏好
├── jobs.json             检索结果
├── jobs.detail.json      含完整 JD
├── ranked.json           打分排序结果
├── tailor-brief.md       简历定制简报
├── applications.jsonl    投递台账（append-only）
├── report-YYYY-MM-DD.md/.html   日报
├── browser-profile/      浏览器登录态
└── runs/<runId>/         每次投递的截图与弹窗 HTML
```

## 目录说明

```
.
├── SKILL.md                    技能主文档：完整工作流 P0–P5
├── assets/
│   ├── config.example.json     浏览器、投递上限、到岗偏好的模板
│   └── profile.example.json    候选人画像模板（示例数据已脱敏）
├── references/
│   ├── site-structure.md       站点数据结构、字段含义、改版应对
│   ├── profile-schema.md       profile.json 的字段规范
│   ├── scoring.md              打分权重与 review 档复核判据
│   ├── resume-tailoring.md     六类公司画像、改写公式、缺口处理
│   ├── apply-playbook.md       投递故障对照表、环境问题排查
│   └── compliance.md           岗位真实性判断、频率边界、数据处置
└── scripts/
    ├── lib.mjs                 公共库：SSR 求值、请求、文件读写
    ├── search.mjs              岗位检索
    ├── detail.mjs              JD 详情抓取
    ├── score.mjs               匹配打分与排序
    ├── tailor.mjs              按公司类型聚类 + 改写简报
    ├── apply.mjs               自动投递（puppeteer-core）
    ├── track.mjs               台账读写
    └── report.mjs              日报生成
```

## 设计要点

**为什么用 `vm` 求值而不是正则？** `window.__NUXT__` 是参数化压缩的 IIFE（形如 `(function(a,b,c){...})(1,2,3)`），字段名被压缩、值被编码。正则只能碰到表层，`vm` 沙箱里跑一遍拿到的才是完整对象。

**列表页被图标字体加密的字段**（每周天数、公司规模）在详情页是明文，所以打分用 `jobs.detail.json`，不要用列表页数据。

**打分是确定性规则**，同样的输入永远得到同样的输出，方便对比不同关键词、不同城市的召回质量。`score.mjs` 输出三档：`apply`（≥62，可直接投）/ `review`（45–62，需人工复核）/ `skip`。

**一份简历投所有公司是最大的浪费。** `tailor.mjs` 先按公司类型聚类，统计每类岗位最常要求的技能，给出「你已有 vs 缺口」对照，再一类一版地改写简历 —— 只改顺序、详略、措辞，不改事实。

## 使用须知

- **投递是有外部副作用的动作。** 脚本默认 `dryRun: true`；首次运行、以及每批新岗位，都建议先 dry-run 看截图再放量。不要在没确认的情况下直接 `--limit 20`。
- **不绕过任何验证。** 登录必须由本人扫码或输入验证码；脚本不复用他人会话、不处理验证码。频率上脚本自带 8–22 秒随机间隔与每日上限，请勿调至不合理的值。
- **数据只留在本地。** 画像、台账、截图全部写入 `.jobhunt/`，不上传任何服务器。`.gitignore` 已排除该目录。
- 站点结构随时可能改版。若抓取突然返回空数据，先读 `references/site-structure.md` 再动选择器。
- 本项目仅供个人求职效率提升使用，请遵守实习僧的用户协议与 robots 约定，控制请求频率。因使用不当造成的账号风险由使用者自行承担。

## 隐私

仓库内的 `profile.example.json` 与相关示例均已脱敏（姓名、学校为占位符）。请勿把你自己的 `profile.json`、简历、投递台账提交到公开仓库。
