# 旮一把 / Gal Yi Ba

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/komariChikaA/gal-yiba/actions/workflows/ci.yml/badge.svg)](https://github.com/komariChikaA/gal-yiba/actions/workflows/ci.yml)

一个可自定义比较项、以 VNDB 与 Bangumi 为数据来源、支持在线房间对战的 Galgame 猜谜网站。

项目目前处于可联机体验的第一阶段。GitHub 项目地址：[komariChikaA/gal-yiba](https://github.com/komariChikaA/gal-yiba)。生产服务器地址与凭据不写入仓库；部署时通过环境变量和反向代理配置域名。产品决策与数据边界见：

- [产品范围](docs/PRODUCT_SPEC.md)
- [系统架构](docs/ARCHITECTURE.md)
- [数据来源与许可](docs/DATA_SOURCES.md)
- [软件与数据许可证](docs/LICENSING.md)
- [服务器部署](docs/DEPLOYMENT.md)
- [第一阶段验收](docs/ACCEPTANCE.md)
- [贡献指南](CONTRIBUTING.md)

## 已实现

- 单人、1v1 与 2–8 人多人竞技；房间加入、准备、同题同步开局、退出与短时断线重连；房主开局时自动移除离线且未准备的成员
- 首页把“创建/加入房间”与“1v1 段位匹配”拆成职责独立的两个区块，避免把自定义房间选项误当成匹配规则
- 1v1 快速匹配池按萌新/入门/标准难度和 BO1/BO3 分组并先到先配；即使池中无人也可点击加入，匹配房固定使用系统默认判定标准
- 段位匹配要求绑定至少 4 位特征码；服务端由规范化特征码派生唯一玩家 ID，同一码跨设备读取相同段位、PT 与战绩
- 首页实时显示在线连接人数和正在对战人数，服务端通过 Socket.IO 主动推送人数变化
- 开局后直接进入答题界面；1v1 采用左右对称布局，只公开双方星号答题进度，不泄露对手答案
- 默认每局 5 分钟，房主可选 3/5/10 分钟；答题界面实时倒计时，归零后由服务端自动结算
- 服务端保存隐藏答案，每名玩家有独立猜测历史，首位猜中者结束竞速
- 每日同题：全员同一天同一题，答案按日期确定并在当日首次生成后锁定
- 房主从 15 个比较项中自由组合（至少 3 项）
- 多人房主可选赛制：单局决胜、三局两胜、五局三胜或七局四胜；1v1 默认开启“平局不计有效局数”，必须有人达到胜场目标才结束
- 普通房由房主发起再来一局；段位匹配由双方申请并同意再战，重赛仍计入 PT
- 段位采用初心/旮士/旮杰/旮豪/旮圣各 3 星与魂天 Lv1–20；页面显示当前段位、PT、晋级进度和晋级表
- 对战记录持久化与排行榜：比赛结束后服务端写入 `match_records/match_players/match_rounds`；首页既保留普通分类榜，也提供按 PT 排序的匹配段位榜
- 映射审核管理页：导航「管理」进入，`ADMIN_TOKEN` 鉴权（未配置则接口禁用）；可浏览/通过/拒绝 Bangumi 跨库映射建议，或一键重建建议
- 默认启用开发会社、女主发色、VNDB/Bangumi 独立评分与票数、年份、时长、动画化、全年龄、平台和标签
- 答案题池包含/排除标签、全部/任一匹配、标签剧透等级、知名度档位、“只要全年龄游戏”和“乙游（女性向恋爱）”开关；默认包含所有年龄分类、默认排除乙游
- 知名度前 500 部优先按 Bangumi 票数排序，萌新/入门/标准题池均要求 Bangumi 评分与票数可用；后续档位再以综合分扩充并保持累进包含
- 作品名、别名模糊搜索；输入开发会社名可列出该会社作品，并显示命中原因
- VNDB/Bangumi 原始记录分表保存，VNDB 作为规范主干，跨库映射先进入审核状态
- 黄色判定、符号方向与双库热度分档见 [`docs/COMPARISON_RULES.md`](docs/COMPARISON_RULES.md)

## 尚未完成

- 批量同步调度（定时任务）
- 完整反作弊与 Redis 房间快照多实例扩容
- 域名、HTTPS 和正式监控告警

## 本地开发

要求 Node.js 22+ 与 pnpm。开发环境可先以内存房间运行；PostgreSQL 与 Redis 用于完整联机和生产部署。

```bash
pnpm install
pnpm dev
```

默认地址：前端 `http://localhost:5173`，后端 `http://localhost:3000`。

临时静态站（无服务器、仅单人/每日）会发布到 GitHub Pages：
[`https://komariChikaA.github.io/gal-yiba/`](https://komariChikaA.github.io/gal-yiba/)。仓库 Settings → Pages 选择 GitHub Actions 后，推送到 `main` 即可更新。

完整检查：

```bash
pnpm check
```

有可用生产题库时，可验证双客户端完整联机流程：

```bash
SERVER_URL=http://127.0.0.1:3000 pnpm --filter @gal-yiba/web smoke:game
```

Windows PowerShell 请先设置 `$env:SERVER_URL`，再运行同一条 `pnpm` 命令。

生产服务器可使用 `docker compose up -d --build`；部署前需按[部署指南](docs/DEPLOYMENT.md)配置数据库密码、域名和 Bangumi User-Agent。

## 许可证

软件源码以 [MIT License](LICENSE) 发布。贡献代码即按相同许可证授权，并请遵守 [行为准则](CODE_OF_CONDUCT.md)。

题库数据仍受原平台约束：VNDB 为 ODbL / DbCL，Bangumi 遵循其开发者平台协议。站点页脚会给出 VNDB 署名。完整边界见 [`docs/LICENSING.md`](docs/LICENSING.md) 与 [`NOTICE`](NOTICE)。

本实现只参考公开的交互和前后端分工，没有复制参考项目的 AGPL 源码。
