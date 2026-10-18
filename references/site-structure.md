# 实习僧站点结构（2026-10 实测）

本文件记录**实际抓包验证过**的页面结构与字段。改版后请按文末「改版自查」重新校对，并把结论回写到这里。

## 1. 关键结论

1. 列表页与详情页都是 **Nuxt SSR**，全部结构化数据内联在 `window.__NUXT__=` 里。**不需要浏览器、不需要登录**即可拿到岗位列表、完整 JD、公司、薪资、学历要求、已投人数。
2. `window.__NUXT__` 是**参数化压缩的 IIFE**（`(function(a,b,c,...){return {...}})(...)`），重复值被提升为形参。因此**不能用正则硬解**，必须在沙箱里求值：`vm.runInContext('(' + expr + ')')`。
3. 详情页比列表页信息全得多，且**列表页里被图标字体加密的数字字段，在详情页是明文**（`day` / `month` 为数字）。
4. 投递必须登录，且走 Element UI 弹窗（`.common-deliver`），因此投递环节只能用浏览器自动化。

## 2. 列表页

```
https://www.shixiseng.com/interns?keyword=<关键词>&city=<城市>&page=<页码>
```

| 参数 | 状态 | 说明 |
| --- | --- | --- |
| `keyword` | ✅ 已验证 | URL 编码后的搜索词 |
| `city` | ✅ 已验证 | 城市名（`深圳`）或 `全国` |
| `page` | ✅ 已验证 | 从 1 开始，每页 20 条 |
| `degree` | ✅ 已验证 | 如 `本科`、`硕士`；会影响 `total` |
| `salary` | ✅ 已验证 | 如 `200-300`；会影响 `total` |
| `days` / `sortType` | ⚠️ 未验证 | 实测不改变 `total`，可能仅前端排序或参数名不同 |

数据位置：`__NUXT__.data[0].interns` → `{ data: [...], total: <命中总数>, pageNumber: 20 }`

`pageNumber` 是**每页条数**，不是当前页码，不要误用。

单条岗位字段：

| 字段 | 含义 | 备注 |
| --- | --- | --- |
| `uuid` | 岗位 ID | 详情页 URL = `/intern/{uuid}` |
| `name` | 岗位名 | 可能含私有区图标字符，需清洗 |
| `cname` / `c_uuid` | 公司名 / 公司 ID | |
| `city` | `省-市` | 如 `省-石家庄市` |
| `degree` | 学历要求 | `本科` / `硕士` / `不限` |
| `minsalary` / `maxsalary` | 日薪（数字） | 明文，可直接用 |
| `day` / `month_num` / `scale` | 每周天数 / 月数 / 公司规模 | **图标字体加密**，值为 `&#xe3ba` 一类私有区字符，不可恢复，一律丢弃 |
| `deliver` | 是否已投递 | 布尔，**投递前必须查这个** |
| `i_tags` / `c_tags` | 岗位标签 / 公司标签 | |
| `industry` | 行业 | |
| `refresh` | 刷新时间 | 有时为空字符串 |
| `job_label` | `is_quick` 急速、`is_hirer` HR 直招、`is_rpo` 代招等 | |

## 3. 详情页

```
https://www.shixiseng.com/intern/{uuid}
```

数据位置：`__NUXT__.data[0].msg`（注意不是 `interns`）

| 字段 | 含义 |
| --- | --- |
| `iname` | 岗位名（干净） |
| `cname` / `cuuid` | 公司 |
| `info` | **完整 JD 正文**（`info_is_html=false` 时为纯文本，含换行） |
| `job_requirements` | 任职要求（部分岗位为空，内容已并入 `info`） |
| `address` / `city` | 工作地点 |
| `degree` | 学历要求 |
| `day` / `month` | 每周出勤天数 / 实习月数（**数字**，列表页加密这里明文） |
| `minsal` / `maxsal` / `salary_desc` | 日薪区间与描述 |
| `delivered` | 是否已投递（0/1） |
| `delivered_num` | 已投递人数（竞争度） |
| `endtime` | 截止日期 |
| `refresh` | 刷新时间，如 `2026-08-12 09:07:53` |
| `chance` | 如 `可转正` |
| `skills` | 技能标签数组 |
| `job_label` | `is_quick` / `is_hirer` / `is_rpo` / `is_double_selection` |
| `risk_warning` | 风险提示（有值时应展示给用户） |
| `intern_status` / `overdue` | 岗位状态、是否过期 |

## 4. 投递弹窗

详情页右侧主按钮，**实测文案为「投个简历」**（2026-10 截图确认；旧版是「立即投递」，两种都要兼容）。按钮左侧还有「收藏」「扫码手机查看」。

未登录时页面右上角显示「登录/注册」，底部会浮出登录面板（扫码 / 短信验证码 / 密码 / 微信 / QQ）。**这个登录面板是自动浮出的，不代表你点错了按钮**。

前端 bundle 里的投递弹窗组件结构（Element UI）：

- 根节点：`.common-deliver`
- 内容区：`.common-deliver__content`，内部按 `.complete-info__item` 分项，每项标题在 `.complete-info__item-title`
- 底部按钮：`.common-deliver__footer .btn`，文案 **「确认投递」**
- 弹窗内三个下拉（`el-select`，选项在 `.el-select-dropdown__item`）：
  - **到岗时间**：默认 `一周内`（可选：随时到岗 / 一周内 / 一个月内 …）
  - **实习时长**：默认 `3个月以内`（可选 3/6/12 个月等）
  - **每周出勤**：默认 `1天`（可选 1–6 天）
- 简历选择：`group_uuid` + `stype` 取自账号下的在线简历列表，多份简历时需选第一份

已投过的岗位，主按钮文案会变化（「已投递」之类），`apply.mjs` 会先读详情页的 `delivered` 字段判断，再兜底看文案。

## 4.1 浏览器侧实测结论（2026-10）

- `puppeteer.launch()` 在新版 Edge（155.x）上会直接失败（`Code: 0`，无 stderr），**必须改成 `spawn` 浏览器 + `--remote-debugging-port` + `puppeteer.connect`**。`apply.mjs` 已按此实现。
- 用 `--headless=new` 可正常跑；有头模式便于用户手动登录。
- 未登录时 `document.body.innerText` 含「登录/注册」，登录后含「我的简历 / 投递记录」——这是登录态判断依据。

投递按钮在详情页，文案为「立即投递」/「投递简历」，未登录时点击会弹登录框。

## 5. 改版自查（每次投递失败时先做这一步）

```bash
# 1) 列表页是否还能解析出岗位
node scripts/search.mjs --keywords "数据分析" --cities 全国 --pages 1

# 2) 详情页字段是否齐全
node scripts/detail.mjs --uuid <某个uuid>

# 3) 投递弹窗结构是否变化（会 dump HTML + 截图）
node scripts/apply.mjs --uuid <某个uuid> --inspect
```

若 1/2 失败：检查 `window.__NUXT__` 是否还存在（可能换成 `__NEXT_DATA__` 或改成纯客户端渲染 → 转用浏览器抓取 `page.content()` 后再解析）。
若 3 失败：读 `runs/<runId>/<uuid>-dialog.html`，按实际 DOM 更新 `scripts/apply.mjs` 里的选择器与按钮文案，然后回写本节。
