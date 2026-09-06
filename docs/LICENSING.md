# 许可证说明

本仓库同时包含**软件源码**和**运行时可能同步的第三方题库数据**。两者适用不同规则。贡献代码即按 [MIT License](../LICENSE) 授权给本项目。

## 软件：MIT

[`LICENSE`](../LICENSE) 覆盖本仓库中的源代码、文档、测试、Docker 配置与 GitHub Actions 工作流。

任何人都可以复制、修改、发布和再分发本软件，包括闭源或商业使用，只要保留版权声明和 MIT 许可文本。

本实现只参考了公开的交互与前后端分工，没有复制 `csgofriberg` 等 AGPL-3.0 项目的源代码。

## 数据：仍归原平台

MIT **不**覆盖从 VNDB 或 Bangumi 同步下来的条目数据。部署者若对外提供带完整题库的服务，需要同时遵守：

| 来源 | 约束 | 本项目的做法 |
| --- | --- | --- |
| [VNDB](https://vndb.org/d17) | 数据库为 [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)，内容为 [DbCL 1.0](https://opendatacommons.org/licenses/dbcl/1-0/) | 只通过官方 API 拉取结构化元数据；站点页脚给出 ODbL 署名；不镜像封面、截图或简介 |
| [Bangumi](https://bgm.tv/about/copyright) | 开发者平台使用协议与版权声明 | 只使用官方 API / 公共归档；不采集用户数据；停止使用平台时应删除已取得的 Bangumi 数据 |

更细的同步边界见 [数据来源与许可](DATA_SOURCES.md)。署名原文见仓库根目录 [`NOTICE`](../NOTICE)。

## 仓库里没有的内容

- 生产环境的域名、密码、`ADMIN_TOKEN`、Bangumi token 不属于本仓库，也不按 MIT 授权。
- `apps/web/public/music/` 下的音频文件被 Git 忽略，版权归原作者；部署时请自行确认使用权，不要把未授权音轨提交进公开仓库。
