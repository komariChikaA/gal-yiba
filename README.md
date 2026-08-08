# 旮一把 / Gal Yi Ba

一个可自定义比较项、以 VNDB 与 Bangumi 为数据来源、支持在线房间对战的 Galgame 猜谜网站。

项目目前处于可联机体验的第一阶段。生产服务器地址与凭据不写入仓库；部署时通过环境变量和反向代理配置域名。产品决策与数据边界见：

- [产品范围](docs/PRODUCT_SPEC.md)
- [系统架构](docs/ARCHITECTURE.md)
- [数据来源与许可](docs/DATA_SOURCES.md)
- [服务器部署](docs/DEPLOYMENT.md)
- [第一阶段验收](docs/ACCEPTANCE.md)

## 已实现

- 5 位房间码、2–8 人加入、准备、同题同步开局与短时断线重连
- 服务端保存隐藏答案，每名玩家有独立猜测历史，首位猜中者结束竞速
- 房主从 15 个比较项中自由组合（至少 3 项）
- 默认启用开发会社、女主发色、VNDB/Bangumi 独立评分与票数、年份、时长、动画化、全年龄、平台和标签
- 答案题池包含/排除标签、全部/任一匹配、标签剧透等级和“只要全年龄游戏”开关；默认包含所有年龄分类
- 作品名、别名模糊搜索；输入开发会社名可列出该会社作品，并显示命中原因
- VNDB/Bangumi 原始记录分表保存，VNDB 作为规范主干，跨库映射先进入审核状态
- 黄色判定、符号方向与双库热度分档见 [`docs/COMPARISON_RULES.md`](docs/COMPARISON_RULES.md)
- PostgreSQL 持久化题库，生产环境以 Docker Compose 运行应用、PostgreSQL 与 Redis

## 尚未完成

- 单人随机题与每日同题入口
- Bangumi 映射审核管理页和批量同步调度（命令行审核已可用）
- 多轮 BO3/BO5、排行榜、匹配与完整反作弊
- Redis 房间快照与多应用实例扩容
- 域名、HTTPS 和正式监控告警

## 本地开发

要求 Node.js 22+ 与 pnpm。开发环境可先以内存房间运行；PostgreSQL 与 Redis 用于完整联机和生产部署。

```bash
pnpm install
pnpm dev
```

默认地址：前端 `http://localhost:5173`，后端 `http://localhost:3000`。

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

> 本项目公开发布于 `komariChikaA/gal-yiba`。软件许可证仍待确认；当前实现只参考交互和前后端分工，没有复制参考项目的 AGPL 源码。
