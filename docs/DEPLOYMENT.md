# 部署指南（第一版）

## 当前体验环境

- 服务器目录：`/opt/gal-yiba`
- 运行方式：Docker Compose 单应用实例
- 数据服务：独立 PostgreSQL 17 与 Redis 7 持久卷

服务器 IP、SSH 端口、凭据和未公开的预览地址不得写入仓库。正式访问地址通过部署环境的域名与反向代理配置。

## 服务器要求

- Linux x86_64 或 arm64
- Docker Engine 与 Docker Compose v2
- 一个指向服务器的域名（正式部署建议）
- 可从服务器访问 VNDB 与 Bangumi 官方 API

## 配置

复制 `.env.example` 为 `.env`，至少修改：

```dotenv
POSTGRES_PASSWORD=请生成高强度随机密码
WEB_ORIGIN=https://你的域名
BANGUMI_USER_AGENT=GalYiBa/0.1.0 (https://github.com/你的账号/仓库)
APP_PORT=3000
```

`BANGUMI_ACCESS_TOKEN` 暂时可留空；令牌只能放在服务器，不能写入前端或提交 Git。

## 启动

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3000/api/health
```

容器每次启动时会先幂等执行 PostgreSQL 迁移，再启动 API、Socket.IO 和前端静态站点。

## 首批数据同步

```bash
docker compose exec app node apps/server/dist/cli/sync-catalog.js vndb --page=1
docker compose exec app node apps/server/dist/cli/sync-catalog.js vndb --sort=votecount --reverse=true --page=1
docker compose exec app node apps/server/dist/cli/sync-catalog.js vndb --developer=Yuzusoft
docker compose exec app node apps/server/dist/cli/sync-catalog.js vndb --keyword="Senren Banka"
docker compose exec app node apps/server/dist/cli/sync-catalog.js bangumi --keyword=Ever17
docker compose exec app node apps/server/dist/cli/review-mappings.js rebuild
docker compose exec app node apps/server/dist/cli/review-mappings.js list
```

VNDB 支持按编号、高票数、评分或发行时间分页，也可以按 VNDB 可识别的作品名或开发会社定向补录。中文标题优先通过同步后的 VNDB 别名搜索；VNDB 官方远程全文检索本身不保证接受纯中文关键词。Bangumi 当前入口按关键词用于映射候选。批量映射队列和管理审核页仍在开发中。

查看映射候选：

```bash
docker compose exec app node apps/server/dist/cli/review-mappings.js list
```

人工核对标题、年份、平台和置信度后，批准或拒绝指定来源记录：

```bash
docker compose exec app node apps/server/dist/cli/review-mappings.js approve --source=bangumi --source-id=123
docker compose exec app node apps/server/dist/cli/review-mappings.js reject --source=bangumi --source-id=123
```

只有 `verified` 映射会把 Bangumi 评分、票数和标签合入可玩作品；`suggested` 候选不会参与比较结果。

## 反向代理

Nginx、Caddy 或面板代理必须同时支持 HTTP 和 WebSocket，并将 `/socket.io/` 原样转发到应用的 3000 端口。TLS 应在反向代理层终止。

## 当前扩展限制

房间状态当前保存在单进程内存中，适合单实例体验版。Compose 已包含 Redis，但在 Redis 房间快照、分布式锁和 Socket.IO Adapter 接入前，不应水平扩展 `app` 实例。

## 更新与验证

更新源码后，在服务器项目目录执行：

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health
docker compose logs --tail=100 app
```

部署环境的 `.env` 权限应保持为 `600`，不得提交到 Git。
