# 系统架构（草案）

```text
React Web
  | HTTP + Socket.IO
Node API / Realtime Server
  |-- game engine (pure shared rules)
  |-- room state machine
  |-- catalog/search API
  |-- sync jobs and admin API
  |
  |-- PostgreSQL: canonical catalog, source records, mappings, matches
  `-- Redis: rooms, presence, timers, locks, reconnect tokens

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

生产环境使用 Redis 锁保证同一房间事件串行化，Socket.IO Redis Adapter 支持多实例广播。PostgreSQL 只写持久战绩，不承担高频房间状态。

## 参考项目使用原则

`csgofriberg` 采用 React、Node、PostgreSQL、Redis 与 Socket.IO，房间快照、分布式锁、可恢复计时和战绩异步持久化值得借鉴。其源码为 AGPL-3.0；在许可证未确认前，本项目只借鉴公开架构思想，不复制源代码。
