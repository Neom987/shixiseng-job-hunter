# 候选人画像 profile.json

`profile.json` 是整条流水线的输入。它由**大模型读简历后生成**（比正则解析准得多），不是脚本自动抽取的。生成一次即可长期复用，求职方向变了再改。

## 生成步骤

1. 读取工作区里的简历（`.docx` / `.md` / `.txt` / `.pdf`），取最新版本。
2. 按下方 schema 写 `<home>/profile.json`。
3. 找不到的字段留空字符串 `""`，**不要猜、不要编**。`major`（专业全称）和 `phone`/`email` 尤其不能猜。
4. 写完后打印给用户确认，特别是 `targets.keywords` 和 `targets.cities` 这两个直接决定搜什么岗。

## Schema

```jsonc
{
  "name": "张三",
  "school": "XX大学",
  "degree": "本科",              // 本科 / 硕士 / 博士 / 大专
  "major": "生物医学工程",        // 专业全称，必填，从简历取
  "grade": "大三",               // 用于判断可实习时长
  "gradYear": 2027,             // 毕业年份，数字
  "phone": "",
  "email": "",

  "targets": {
    "keywords": ["数据分析", "AI产品", "产品运营"],   // 搜索词，2-6 个，按优先级排序
    "cities": ["深圳", "广州"],                     // 空数组 = 不限城市（搜"全国"）
    "salaryMin": 150,                              // 日薪下限（元/天），0 = 不限
    "degreeAccept": ["本科", "硕士", "不限"],
    "daysPerWeek": 5,                              // 每周可出勤
    "months": 3,                                   // 可实习月数
    "avoidKeywords": ["电话销售", "地推"],          // 标题/JD 命中则重罚
    "blacklistCompanies": [],                      // 永不投递
    "preferCompanies": ["京东", "字节跳动"]         // 命中加分
  },

  "skills": ["Python", "SQL", "数据分析", "ComfyUI"],  // 用于算 JD 技能重合度，写具体工具/方法名
  "skillEvidence": {                                   // 每个技能必须有简历里的出处，否则删掉
    "Python": "计算机程序设计基础 93 分",
    "ComfyUI": "自学并持续产出图文内容"
  },
  "majorKeywords": ["生物", "材料"],                    // 专业相关词，命中 JD 加轻分
  "strengths": ["一句话一条，用于生成招呼语和报告"],
  "resumeFile": "C:/path/to/简历.pdf",                 // 投递时如需上传
  "notes": "只接受线下，深圳优先"
}
```

## 字段如何影响结果

| 字段 | 作用点 |
| --- | --- |
| `targets.keywords` | 决定 `search.mjs` 搜什么；也用于岗位名/JD 命中打分（最高 35 分） |
| `targets.cities` | 城市匹配（10 分）；为空则搜"全国"且不筛城市 |
| `targets.salaryMin` | 日薪达标（8 分） |
| `skills` | JD 技能重合（最高 25 分）——**写具体工具名比写"数据分析能力"有效得多** |
| `majorKeywords` | 专业相关性（4 分） |
| `targets.avoidKeywords` | 标题命中 −40，JD 命中 −15 |
| `targets.blacklistCompanies` | 直接判死（−999） |
| `targets.preferCompanies` | +4 |
| `degree` | 与岗位要求比较，要求高于你 −25；高两级直接跳过 |

## 质量检查

- **`skills` 里的每一项都必须在 `skillEvidence` 里有出处**，且出处能在简历原文里找到。没有出处的技能直接删掉——画像里多写一个 SQL，后面就会把 SQL 岗排到前面，等于自己骗自己。
- `keywords` 不要超过 6 个，否则搜出来的岗位会非常杂；优先用「岗位名」而不是「行业名」。
- 改完 `profile.json` 后必须重跑 `score.mjs`，否则排序还是旧画像的结果。
