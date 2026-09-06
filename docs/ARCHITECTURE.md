# 系统架构

```text
React Web
  | HTTP + Socket.IO
Node API / Realtime Server
  |-- game engine (pure shared rules)
  |-- room state machine
  |-- catalog/search API
  |-- sync jobs and command-line mapping review
  |
  |-- PostgreSQL: canonical catalog, source records, mappings, matches
  `-- Redis: 已部署的后续扩容预留，目前未接入房间状态

VNDB API ----> source adapter ----> normalization/mapping queue
Bangumi API -> source adapter ----> normalization/mapping queue
```

## 关键边界

- `packages/shared`：纯 TypeScript 契约与比较逻辑，前后端共用。
- `apps/server`：服务端掌握答案、计时和最终判定；客户端不接收答案全集。
- `apps/web`：只负责展示、输入和乐观状态，不拥有权威房间状态。
- 数据适配器只写入来源表；规范化和跨库映射是独立步骤。
- 房间开始时保存规则版本与题目快照，后续数据同步不会改变进行中的判定。

## 联机状态机

```text
lobby -> countdown -> active -> round_result -> active / finished
  ^          |           |
  `----------+-----------+ (允许在重连窗口内恢复)
```

当前生产环境是单应用实例：`RoomRegistry` 在进程内保存房间、在线状态、计时与重连令牌，Socket.IO 负责同实例广播；PostgreSQL 持久化题库，Redis 容器虽已部署但尚未接入业务。因此当前版本支持一台服务器上的在线房间对战，但不能水平扩展应用实例，应用进程重启也不会恢复未完成房间。

后续如需多实例扩容，再将房间快照、在线状态与重连令牌迁移到 Redis，引入按房间串行化的锁和 Socket.IO Redis Adapter；在这些代码与恢复测试完成前，不宣称已经具备分布式房间能力。

## 参考项目使用原则

`csgofriberg` 采用 React、Node、PostgreSQL、Redis 与 Socket.IO，房间快照、分布式锁、可恢复计时和战绩异步持久化值得借鉴。其源码为 AGPL-3.0；本项目以 MIT 独立实现，只借鉴公开架构思想，不复制其源代码。软件与数据许可边界见 [许可证说明](LICENSING.md)。
