# 贡献指南

感谢你愿意给 [旮一把 / Gal Yi Ba](https://github.com/komariChikaA/gal-yiba) 提问题或发 Pull Request。提交代码即表示你同意以 [MIT License](LICENSE) 授权这些贡献，并遵守 [行为准则](CODE_OF_CONDUCT.md)。

## 开发环境

需要 **Node.js 22+** 与 **pnpm 9**。开发阶段可以先用内存房间；PostgreSQL 与 Redis 用于完整联机和生产部署。

```bash
pnpm install
pnpm dev
```

默认前端 `http://localhost:5173`，后端 `http://localhost:3000`。环境变量模板是 [`.env.example`](.env.example)。

提交前请跑完整检查：

```bash
pnpm check
```

该命令会依次做类型检查、测试和生产构建。有可用生产题库时，还可验证双客户端联机：

```bash
SERVER_URL=http://127.0.0.1:3000 pnpm --filter @gal-yiba/web smoke:game
```

## 建议的改动范围

- 游戏规则、比较项和题池逻辑优先改 `packages/shared`，并补测试。
- 数据同步、映射和 API 适配器放在 `packages/data` 与 `apps/server`。
- 展示、输入和乐观状态放在 `apps/web`；客户端不能成为答案或房间状态的权威来源。
- 产品边界见 [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md)，数据许可见 [`docs/LICENSING.md`](docs/LICENSING.md)。

请不要：

- 提交 `.env`、token、服务器地址或其它密钥
- 批量镜像第三方封面、截图、简介或评论
- 把未授权的音频、图片等二进制资源加入 Git
- 复制其它 AGPL 项目的源码

## Pull Request

1. 从默认分支开功能分支。
2. 保持改动聚焦：一个 PR 解决一类问题。
3. 行为变化请附测试或说明为何无法自动测。
4. 按 [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) 填写说明。

安全相关问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要发到公开 Issue。
