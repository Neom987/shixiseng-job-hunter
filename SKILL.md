---
name: shixiseng-job-hunter
description: 在实习僧（shixiseng.com）上跑通"检索岗位 → 匹配打分 → 自动投递 → 台账与日报"的全流程。岗位列表与完整 JD 从 SSR 数据直接结构化提取，无需登录；投递环节复用本机浏览器已登录会话自动完成。当用户提到实习僧、找实习、投暑期实习、批量投简历、自动投递、求职日报、帮我筛岗位时使用。
---

# 实习僧求职自动化

## 这个 skill 能做什么

五层能力，按需组合：

| 层 | 手段 | 是否需要登录 | 脚本 |
| --- | --- | --- | --- |
| 检索岗位 | 直取 SSR 数据（`window.__NUXT__`） | 否 | `search.mjs` |
| 抓完整 JD | 同上，详情页 | 否 | `detail.mjs` |
| 匹配打分 | 确定性规则，可复现 | 否 | `score.mjs` |
| 简历定制 | 按公司类型聚类 + 输出改写简报 | 否 | `tailor.mjs` |
| 自动投递 | 本机 Edge/Chrome + 持久化会话 | **是** | `apply.mjs` |
| 台账 / 日报 | 本地 JSONL + HTML | 否 | `track.mjs` / `report.mjs` |

核心事实（已实测，详见 `references/site-structure.md`）：列表页和详情页的数据全部内联在 `window.__NUXT__` 里，是参数化压缩的 IIFE，**必须用 `vm` 沙箱求值，不能正则硬解**；列表页里被图标字体加密的数字字段（每周天数、公司规模）在详情页是明文。

## 工作目录

所有产物落在 `<home>`：默认 `$JOBHUNT_HOME`，否则 `<当前目录>/.jobhunt`。建议在用户简历所在目录运行（如 `C:/Users/<user>/Desktop/求职`），产物结构：

```
.jobhunt/
├── profile.json          候选人画像（一次性生成，长期复用）
├── config.json           浏览器/上限/投递偏好
├── jobs.json             检索结果
├── jobs.detail.json      含完整 JD
├── ranked.json           打分排序结果
├── applications.jsonl    投递台账（append-only）
├── report-YYYY-MM-DD.md / .html   日报
├── browser-profile/      浏览器登录态
└── runs/<runId>/         每次投递的截图与弹窗 HTML
```

## 流程

### P0 环境自检

```bash
cd <简历所在目录>
export JOBHUNT_HOME="$(pwd)/.jobhunt"
mkdir -p "$JOBHUNT_HOME"
cp <skill>/assets/config.example.json "$JOBHUNT_HOME/config.json"
```

检查投递依赖（只在需要投递时才必须）：

```bash
NODE_DIR="C:/Users/<user>/.workbuddy-ai/binaries/node/workspace"
ls "$NODE_DIR/node_modules" | grep puppeteer-core   # 没有就 npm i puppeteer-core --prefix "$NODE_DIR"
# 运行时统一带上：--modules "$NODE_DIR/node_modules"
```

检索/打分/日报只需 node，无第三方依赖。

### P1 生成候选人画像

读用户最新简历（`.docx`/`.md`/`.pdf`/`.txt`），按 `references/profile-schema.md` 写出 `<home>/profile.json`。

铁律：**不编造**。专业、电话、邮箱、技能都必须能在简历里找到出处；找不到就留空。`skills` 写具体工具名（`Python`/`SQL`/`ComfyUI`），不要写"数据分析能力"这类无法匹配的词。

写完把 `targets.keywords` 和 `targets.cities` 念给用户确认——这两个字段决定搜什么岗，猜错整条流水线都白跑。

### P2 检索

```bash
node <skill>/scripts/search.mjs --keywords "数据分析,AI产品运营" --cities "深圳,广州" --pages 2
```

- `--keywords` 2–6 个，逗号分隔；`--cities` 用城市名或 `全国`。
- 每页 20 条，`--pages 2` 约 40 条/关键词/城市。**先小后大**：首次用 `--pages 1` 看分布，再放量。
- `--degree` `--salary` 已验证可生效（如 `--salary 150-400`）；`--days` `--sortType` 未验证，别依赖。
- 结果按 `uuid` 去重，记录 `matchedKeywords`。

看 `search-stats.json` 里的 `total`：某个关键词 `total` 过万说明词太泛，换更具体的岗位名。

### P3 抓详情 + 打分

```bash
node <skill>/scripts/detail.mjs --limit 60      # 抓完整 JD、已投人数、是否已投
node <skill>/scripts/score.mjs --top 30         # 打分排序
```

`score.mjs` 输出 `recommend` 三档：`apply`（≥62，可直接投）/ `review`（45–62，需复核）/ `skip`。

**必须做的复核**：读 `ranked.json` 里 `review` 档的 JD，按 `references/scoring.md` 的判据决定升到 `apply` 还是降到 `skip`。同时检查 `riskWarning` 有值的岗位——按 `references/compliance.md` 剔除可疑岗位。

### P3.5 简历定制（投递前必做）

**一份简历投所有公司是最大的浪费。** 先按公司类型聚类，再一类一版：

```bash
node <skill>/scripts/tailor.mjs                    # 全部候选按类型聚类 + 缺口汇总
node <skill>/scripts/tailor.mjs --archetype 金融    # 单类型详细简报
node <skill>/scripts/tailor.mjs --uuid <uuid>      # 单岗位简报
```

产出 `<home>/tailor-brief.md`，含：各类型岗位数/平均分、该类最常要求的技能、你已有 vs 缺口、改写要点、语气、自检项。

然后按 `references/resume-tailoring.md` 的六类画像，每类产出一版简历（`简历_<类型>_<方向>.md`）。**只改顺序、详略、措辞，不改事实**：没有的技能不写，没有的数字留 `【待填】`。

`tailor.mjs` 底部的「跨类型共性缺口」表要直接告诉用户：出现在最多 JD 里的缺口，值得花两周补一个真项目再写进简历。

### P4 投递（有登录态才做）

首次必须按这个顺序，每一步让用户看结果：

```bash
M="--modules C:/Users/<user>/.workbuddy-ai/binaries/node/workspace/node_modules"
node <skill>/scripts/apply.mjs --login $M                   # 用户本人扫码/验证码
node <skill>/scripts/apply.mjs --uuid <uuid> --inspect $M   # dump 弹窗 HTML，确认选择器
node <skill>/scripts/apply.mjs --limit 1 --dry-run $M       # 走到提交前停下，看截图
node <skill>/scripts/apply.mjs --limit 1 $M                 # 真投 1 个，看截图
node <skill>/scripts/apply.mjs --limit 8 $M                 # 放量
```

- 投递前先改 `config.json`：`dryRun: false`、`caps.runCap`、`caps.dailyCap`、`deliverPrefs`（到岗时间/实习时长/每周出勤）。
- `--login` 会打开实习僧首页，由用户自己点右上角「登录/注册」完成扫码或验证码——**站点没有可直达的登录页**，不要让脚本去猜登录 URL。
- 脚本自己会跳过已投岗位、按台账算今日额度、每单随机等 8–22 秒。
- 退出码 `3` = 登录态失效，回 `--login`；`4` = 没有候选；`5` = 环境问题。
- 任何失败都会留下截图 + 台账 `failed` 记录，按 `references/apply-playbook.md` 的故障对照表处理。

**投递是有外部副作用的动作**：第一次运行、以及每次换新一批岗位时，先 `--dry-run` 并把截图给用户看；用户确认后再真投。不要在用户没同意的情况下直接跑 `--limit 20`。

### P5 台账与日报

```bash
node <skill>/scripts/track.mjs list
node <skill>/scripts/track.mjs stats
node <skill>/scripts/report.mjs --top 25
```

`report.mjs` 生成 Markdown + HTML 日报（含优先投递清单、匹配理由、投递台账、回复率），用 `present_files` 展示 HTML。

用户说"HR 回我了""约面了"时立刻更新：

```bash
node <skill>/scripts/track.mjs update --uuid <uuid> --status replied --note "HR 约面"
```

## 日常节奏

用户说"帮我看看今天有什么新岗位"时的最短路径：

```bash
node scripts/search.mjs --keywords ... --cities ... --pages 1 --merge   # 合并进已有 jobs.json
node scripts/detail.mjs                                                 # 只抓没抓过的
node scripts/score.mjs --top 20
node scripts/report.mjs
```

`--merge` 会保留历史岗位，`detail.mjs` 命中缓存不重复抓，所以日常跑一次大约 1–2 分钟。

## 打招呼语（弹窗里有留言框时）

实习僧多数岗位的投递弹窗没有留言框，**不要硬找**；只有确实存在「求职留言/自我介绍」输入框时才填。填的话两句话，不要客套：

> 我是 XX 大学 XX 专业大三学生，做过 <与 JD 第一条职责直接对应的一件事>（<可量化结果>）。每周可到岗 5 天，能连续实习 3 个月以上，随时可面试。

第一句证明匹配，第二句解决 HR 最关心的可用性。禁止出现"贵司平台广阔""我非常热爱"这类空话，也禁止写简历上没有的经历。

## 参考文件

| 文件 | 何时读 |
| --- | --- |
| `references/site-structure.md` | 抓取失败、怀疑改版、要改选择器时 |
| `references/profile-schema.md` | 生成/修改 `profile.json` 时 |
| `references/scoring.md` | 复核 `review` 档、调权重时 |
| `references/resume-tailoring.md` | 写/改某一版简历时（六类公司画像、改写公式、缺口处理） |
| `references/apply-playbook.md` | 投递报错、环境装不上、登录态问题 |
| `references/compliance.md` | 判断岗位真实性、频率边界、数据处置 |
