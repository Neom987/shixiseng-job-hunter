# 自动投递执行手册

## 环境准备（只需一次）

投递环节依赖 `puppeteer-core` + 本机 Edge/Chrome。浏览器**不需要下载**，直接用系统已装的。

```bash
# 1) 找一个有 puppeteer-core 的 node 工作目录（已装过就直接用）
NODE_DIR="C:/Users/<user>/.workbuddy-ai/binaries/node/workspace"
ls "$NODE_DIR/node_modules" | grep puppeteer-core

# 2) 没有就装（不下载浏览器）
npm i puppeteer-core --prefix "$NODE_DIR"

# 3) 运行时用 --modules 指定（ESM 不认 NODE_PATH，必须用这个参数）
node scripts/apply.mjs --login --modules "$NODE_DIR/node_modules"
```

浏览器路径按顺序自动探测：Edge（`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`）→ Chrome → macOS/Linux 常见路径。探测不到就在 `config.json` 的 `browser.executablePath` 里写死。

> 只用 `puppeteer-core`，不要用 `puppeteer`——后者会额外下载一份 Chromium，几百 MB 且在本机常常装不上。

> **不要用 `puppeteer.launch()`**。新版 Edge 155 上它会直接失败（`Code: 0`，stderr 为空）。脚本已改为 `spawn` 浏览器 + `--remote-debugging-port` + `puppeteer.connect`，浏览器是真实窗口，用户可以在同一窗口里手动登录。

## 登录

```bash
node scripts/apply.mjs --login
```

- 打开登录页，**由用户本人完成扫码或短信验证码**，脚本只负责等待并保存会话。
- 会话保存在 `<home>/browser-profile/`（持久化 user-data-dir），下次自动复用。
- 最长等 300 秒；成功后打印 `登录态已保存`。
- **不要把账号密码写进任何文件让脚本自动登录**：站点有验证码，自动登录既不可靠也容易触发风控。

登录态通常能撑数天到两周。`apply.mjs` 返回退出码 `3` 就是失效了，重跑 `--login` 即可。

## 三种运行模式

| 命令 | 行为 | 何时用 |
| --- | --- | --- |
| `--inspect` | 打开详情页、点开投递弹窗、dump HTML + 截图，不提交 | 第一次跑、或怀疑改版时 |
| `--dry-run` | 走到「确认投递」按钮前停下并截图，不提交 | 换新岗位批次后验证一遍 |
| 默认 | 真正提交 | 用户明确同意后 |

**首次使用必须按 `--inspect` → `--dry-run --limit 1` → `--limit 1` → `--limit N` 的顺序推进**，每一步都要让用户看截图确认。

## 一次投递的动作序列

1. 打开 `https://www.shixiseng.com/intern/{uuid}`
2. 检查登录态（页面有「我的简历/投递记录」且无「登录/注册」）
3. 检查是否已投（`deliveredFlag` 或页面文案「已投递过」）
4. 点击「投个简历」（旧版文案「立即投递」，脚本两种都兼容）
5. 等 `.common-deliver` 或 Element UI 弹窗出现
6. 按 `config.json` 的 `deliverPrefs` 设置到岗时间/实习时长/每周出勤（尽力而为，失败不阻断）
7. 点击 `.common-deliver__footer .btn`（文案「确认投递」）
8. 等「投递成功」文案，截图，写台账
9. 随机等待 8–22 秒再下一个

## 频率与上限

- 单次运行默认 8 个（`caps.runCap`），每日默认 15 个（`caps.dailyCap`）。脚本启动时会读台账算今日已投，超限直接退出。
- 每个岗位之间随机 8–22 秒，**不要改成 0**，也不要并发。批量高频提交是最容易被判定异常的行为。
- 平台侧也有每日投递上限，出现「今日投递次数已达上限」时立刻停止，不要重试。
- 同一天不要对同一家公司投超过 2 个岗位。

## 故障对照表

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 退出码 3 / 提示需要登录 | 会话过期 | `--login` 重新登录 |
| 「浏览器启动失败」 | 已有同 profile 的 Edge 窗口在跑，或杀软拦截 | 关掉所有 Edge 窗口；或把 `browser.debugPort` 固定为 9333 再试 |
| 「缺少 puppeteer-core」 | ESM 不认 `NODE_PATH` | 用 `--modules "<node_modules 路径>"` |
| 「未找到投递按钮」 | 按钮文案改了，或岗位已下线 | 看 `runs/<runId>/*-no-apply-button.png`；用 `--inspect` 重新校对文案 |
| 「投递弹窗未出现」 | 弹窗 DOM 变了，或点击命中了错误元素 | 读 `runs/<runId>/<uuid>-dialog.html`，更新 `apply.mjs` 的选择器 |
| 「未找到确认投递按钮」 | 弹窗是另一种实现（如 `el-message-box`） | 同上，优先按文案兜底点击 |
| 点了提交但没捕获成功提示 | 成功提示是 toast 且消失很快，或实际失败 | 看 `after-submit.png`，以截图为准；台账里该条是 `failed`，需人工确认后再改状态 |
| 弹窗要求上传简历 | 账号下没有在线简历 | 让用户先在网页端创建在线简历，或在 `config.json` 配 `resumeFile` 后用 `upload` 补 |
| 提示「简历不完整」 | 在线简历缺必填项 | 引导用户补齐在线简历，脚本无法代填 |

失败记录都会写进 `applications.jsonl`（`status: failed` + `note`），不会静默丢失。

## 投递后

```bash
node scripts/track.mjs list            # 看台账
node scripts/track.mjs stats           # 看今日/累计/回复率
node scripts/report.mjs                # 出日报
```

用户反馈「有 HR 回复了」「约面了」时，用 `track.mjs update --uuid ... --status replied` 更新，否则回复率统计不准。
