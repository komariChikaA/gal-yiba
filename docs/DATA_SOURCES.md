# 数据来源、同步与许可边界

## VNDB

- 使用官方 HTTPS API v2（Kana），不抓取网页。
- API 面向非商业使用，当前公开限制为每 5 分钟 200 次请求及每分钟 1 秒执行时间；同步器必须限速、缓存、指数退避并处理 429。
- VNDB 数据受其 Data License 约束。部署前必须加入可见署名，并确认派生数据库的 ODbL/DbCL 义务。
- 计划使用：作品 ID、标题/别名、首发信息、语言、平台、时长、评分/票数、制作人员、标签及标签剧透等级。
- 年份读取官方 `complete` 发行版的最早日期，排除 `trial` 体验版与 `partial` 部分版。
- 年龄判断读取官方完整发行版的 `minage` 与 `has_ero`：有成人内容证据时归为限制级；没有成人内容且存在 `0–15` 岁分级时归到全年龄侧；只有 18+ 分级时归为限制级；证据不足保持未知。
- 动画化判断使用 VNDB 的 `has_anime` 关联条件，只表达“有/无动画条目关联”，不推断动画播出状态。
- 同步保留 VNDB 的标题别名，支持中文译名等别名搜索；部署时可按高票数分页扩库，也可按作品名或开发会社定向补录。
- 原始平台与标签完整保留在来源记录中；站内比较层会归并 PC/主机平台、在有主要平台时忽略小众平台、移动端与 Web。作品标签会按[标签与脚本家姓名规范](TAG_NORMALIZATION.md)归并为简短中文概念，过滤一般技术、成人内容和过细标签，再采用当前剧透等级下最重要的三个标签；乙女分类 `g542` 作为题池开关证据保留。
- 女主发色仅读取角色在该作品中的非剧透 `primary` 关系、表面女性性别和非剧透 Hair 颜色特征；保留命中角色与特征作为原始证据。
- 脚本家读取 VNDB 的 `scenario` 担当，优先显示 `original` 原文字段；缺失时保留 VNDB 登记名，不自动音译。API 不提供“最主要脚本家”的可靠排序，当前按登记集合比较。
- 乙游优先按 VNDB `Otome Game` 的稳定标签 ID `g542` 判定；它指女性主角与男性角色发展恋爱关系的作品，不把 BL 自动并入乙游。仅在作品没有 VNDB 记录时，才用 Bangumi 的“乙女游戏”“乙女向”“女性向”等明确标签作为后备证据。
- 同系列判断只使用 VNDB 的官方作品关系，并保存来源作品 ID；公司父子关系不在 VNDB API 中，必须走有来源的人工维护表。

## Bangumi

- 使用官方 `api.bgm.tv` API 或官方公共数据归档，不抓取页面。
- 请求使用可识别且带联系方式的 `User-Agent`；令牌仅由服务端读取。
- Bangumi 允许基于开发者平台的 API 与归档开发网站和服务，但限制爬虫、过量收集、用户数据转移及平台数据再提供。停止使用平台时还可能需要删除取得的数据。
- 第一阶段不读取用户收藏、评论或其他用户数据。
- 计划使用：游戏条目 ID、中文/日文名、发布日期、平台/分类、公开标签、评分与投票统计。

## 合并策略

来源记录永远保留，不直接覆盖：

```text
source_records(vndb:v17) ----\
                               > canonical_titles(internal id)
source_records(bangumi:237) --/
```

### 双路径映射：本地别名 + 网络搜索强制对齐

为解决纯别名重叠导致的漏配（日/中/英意译名、别名库未收录常用译名、年份/平台缺失），系统保留两条互补路径：

1. **本地别名路径**（默认）：主标题和全部别名先统一宽度、大小写与标点后建立可检索键（`packages/data/src/matching.ts:5` 的 `normalizeTitle` / `source_records.title_keys`），再结合日期和平台计算置信度（`scoreSourceMatch`）。歧义项进入 `source_links.link_status='suggested'` 人工审核。
2. **网络搜索强制对齐路径**（可选，需 `WEB_SEARCH_ENABLED=true` + `WEB_SEARCH_API_URL`）：对每个 `canonical_visual_novels` 中已验证 VNDB 但缺 Bangumi 的作品（`CatalogRepository.listCanonicalsMissingBangumi()`），用标题/别名/开发商主动发起外部搜索（`packages/data/src/web-search.ts:18` 的 `WebSearchProvider` / `NetworkMappingAligner`），取搜索标题喂给 `BangumiClient.searchRawPaged`（每词 `20×2` 页聚合）并用 `scoreWithNetworkTitles` 二次打分；达到阈值（默认 `70`，原 `85`）则直接 `attachBangumiVerified`，否则落入 `suggested`。证据写入 `source_links.evidence.search`，失败不阻断主流程。

   **500+ 目标与认证完整性**：`docs/COMPARISON_RULES.md:40` 的 `9` 部是精确标题 `65` 分阈值下的历史快照；要拉到 `500+` 必须：① 使用 `packages/data/src/matching.ts:35` 的模糊相似度（bigram Dice + 编辑距离，`titleSimilarity` 对全部别名求最大值，`0.88/0.72/0.55` 分档给 `55/40/25` 分，配合年份/平台/开发商综合，替代旧的 `Math.min(25)` 一刀切）+ `2` 的分页扩大召回（每作品最多 `6` 个别名各 `40` 条）；② **配置 `BANGUMI_ACCESS_TOKEN`** — 未登录时 `api.bgm.tv` 会过滤 `nsfw` 条目（大量 Gal 为限制级），`BangumiClient.isAuthenticated` 为 `false` 时回填会告警且召回显著偏低（`apps/server/src/cli/sync-bangumi-backfill.ts:55`）。

CLI 开关：`BANGUMI_ACCESS_TOKEN=xxx BANGUMI_USER_AGENT="GalYiBa/0.1 (contact)" pnpm --filter @gal-yiba/server sync:bangumi-backfill --limit=1000 --verify-threshold=70 --delay-ms=220 --with-network`、`mappings:rebuild --with-network`；`CatalogSyncService.backfillMissingBangumiWithNetwork(aligner, limit, offset, 70)` 与 `searchRawPaged` 均支持注入 mock，已有 `packages/data/src/matching-scale.test.ts:12` 的 `600` 对模拟（`500` 可配对）验证 `verified+suggested >=500`。

VNDB 与 Bangumi 的评分和票数分别保留，不做平均。每个规范化字段记录 `source`、`source_id`、`synced_at` 与转换版本。

### 网络检索强制分类（乙游 / 国产 / 欧美）

本地标签存在系统性缺漏：`g542` 与 `bangumiOtomeTags` 覆盖不全、`languages` 字段缺失导致 `visualNovelRegion()` 误判。因此新增富化层：

- **乙游**：`packages/shared/src/enrichment.ts:58` 的 `classifyOtomeFromText` + `packages/data/src/catalog-enrichment.ts:33` 的 `CatalogEnricher.enrich()` 对标题/开发商发起搜索，命中“乙女/女性向/otome”等多证据时以 `confidence>=60` 覆盖 `isOtome`；已打 `g542` 的作品不被网络否定覆盖。
- **国产/欧美**：`classifyRegionFromText` 命中“国产/中国制作/中文原创”或“欧美/western visual novel”等证据时，以语言缺失时 `confidence>=60`、语言存在时 `confidence>=75` 覆盖 `languages`（`zh`/`en`/`ja`），从而修正 `visualNovelRegion()` 与 `filterAnswerPool()` 的 `includeChina/includeWest` 过滤。无法判定时维持 `japan` 默认。
- 持久化：`pnpm --filter @gal-yiba/server enrich:catalog [--dry-run] [--with-network]` 遍历 `source_records`，对命中项 `upsertSourceRecord(applyEnrichmentToRecord)` 并 `appendEnrichmentEvidence` 到 `source_links.evidence.enrichment`，供审计与人工复核；每次猜测不实时联网（`PRODUCT_SPEC` 约束）。

详见 `packages/shared/src/enrichment.ts`、`packages/data/src/web-search.ts`、`packages/data/src/network-matching.ts`、`apps/server/src/cli/enrich-catalog.ts`。

## 图片与文本

封面、截图、简介和评论的版权可能不同于结构化元数据。第一版只保存必要 URL 与署名信息，不批量镜像第三方媒体，也不把评论/简介作为题库内容。
