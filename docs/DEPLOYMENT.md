# 部署指南（第一版）

## GitHub Pages 临时静态站

联机对战仍然需要 Node 服务、PostgreSQL 与 Redis。GitHub Pages 只能托管前端，因此 Pages 构建会打开 `VITE_STATIC_PLAY=true`，用内置 12 部演示作品在浏览器里跑单人房间和每日同题。

1. 仓库 Settings → Pages → Build and deployment → Source 选 **GitHub Actions**。
2. 合并本仓库的 Pages 工作流后访问 [`https://komariChikaA.github.io/gal-yiba/`](https://komariChikaA.github.io/gal-yiba/)。
3. 工作流在 `.github/workflows/github-pages.yml`，会以子路径 `/gal-yiba/` 打包 `apps/web`。

若以后要把这个静态前端接到真正的 API，设置 `VITE_API_BASE=https://你的域名` 并关闭 `VITE_STATIC_PLAY`，同时把 Pages 源加入服务器 `WEB_ORIGIN`（逗号分隔，例如 `https://你的域名,https://komariChikaA.github.io`）。

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

规则或字段转换升级后，可只刷新数据库中已存在的 VNDB 记录及已验证的 Bangumi 映射，不扩张题库：

```bash
pnpm refresh:vndb
pnpm refresh:bangumi
```

VNDB 刷新默认在每个 100 条批次之间等待 3 秒。若官方接口仍返回 `429`，读取最后一行的 `completed` 数字，等待限流窗口恢复后续跑，例如：

```bash
pnpm refresh:vndb -- --offset=1000 --pause-ms=5000
```

### Bangumi 数据全目录回填

让已有题库的每个作品都带上 Bangumi 数据（中文名、评分、票数、标签）。要求 `.env` 配置
`BANGUMI_USER_AGENT` 与 `BANGUMI_ACCESS_TOKEN`（[api.bgm.tv](https://bangumi.github.io/api/) 申请）。
回填会按标题搜索 Bangumi、用跨库匹配打分：高分（≥85）自动挂 verified 链接立即生效，
中分挂 suggested 待人工审核，低分跳过：

```bash
pnpm sync:bangumi-backfill -- --limit=2000 --delay-ms=200
# 可选：--offset 分页续跑、--verify-threshold 调整自动通过线（0-100）
```

可重复执行：已挂 verified 链接的作品会自动跳过，适合题库扩张后增量回填。
未被匹配到的作品大概率在 bgm.tv 上无对应条目，不影响 VNDB 数据使用。

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

## 定时同步（批量调度）

数据同步本身是 CLI（`sync-catalog`/`refresh-catalog`），服务器上用 cron 或 systemd timer 定期执行即可。
以下 cron 示例每天 UTC 04:00 增量刷新 VNDB，并在每周日 UTC 03:00 重建 Bangumi 映射建议（登录后执行 `crontab -e` 添加）：

```cron
0 4 * * * cd /opt/gal-yiba && docker compose exec -T app node apps/server/dist/cli/refresh-catalog.js vndb >> /var/log/gal-yiba-sync.log 2>&1
0 3 * * 0 cd /opt/gal-yiba && docker compose exec -T app node apps/server/dist/cli/review-mappings.js rebuild >> /var/log/gal-yiba-sync.log 2>&1
```

日志轮转（`/etc/logrotate.d/gal-yiba`）：

```text
/var/log/gal-yiba-sync.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
}
```

## 监控

- 存活探活：对 `https://galyiba.kajimi.cc/api/health` 做外部 HTTP 探测（UptimeRobot / cron curl），返回非 200 或超时即告警。
- 进程与资源：`docker compose ps` 定期检查容器健康状态；`docker stats` 观察内存（房间在单进程内存中）。
- 容器日志：`docker compose logs --tail=200 app` 排查启动或运行期错误。

## SSH 加固（强烈建议）

服务器近期被暴力爆破打满连接槽导致 SSH 间歇性不可用，建议：

```bash
apt-get install -y fail2ban
systemctl enable --now fail2ban
```

并改用密钥登录后关闭密码登录：

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
# 把本机公钥写入 ~/.ssh/authorized_keys 后：
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
```

> 关闭密码登录前务必确认密钥能登录，否则会把自己锁在外面。
