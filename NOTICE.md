# 来源与第三方边界

本仓库的网关、确认和状态机代码来自维护者自己的 KuiNest 实现，经选取与脱敏后独立开放。原私人项目其余部分不在本次许可范围内。公开包的共享 OAuth 已裁为单资源版本，客户端标识和端点与私人部署不同。后续独立登录/安全文件读取与主人初始化复用同一维护者已按MIT公开的 [xiaokui-luckin-mcp](https://github.com/AriaEternity/xiaokui-luckin-mcp)，按麦当劳原有端点适配并增加独立持久会话；两边业务参数和点单核心各自保留。

业务语义参考麦当劳官方平台文档和账号可用的实际 MCP 契约。本仓库没有镜像官方文档全文、完整工具发现结果、官方服务端程序、品牌图片或第三方代理代码。

- 官方平台与账号条款：[open.mcd.cn/mcp](https://open.mcd.cn/mcp)
- 官方接入说明：[M-China/mcd-mcp-server](https://github.com/M-China/mcd-mcp-server)
- 连接方式参考：[yoruuuchan/chatgpt-mcp-connect](https://github.com/yoruuuchan/chatgpt-mcp-connect/tree/main/recipes/mcdonalds)

麦当劳相关名称和商标属于各自权利人；OpenAI、ChatGPT 与 MCP SDK 名称也不表示本项目获得官方背书。使用本仓库的 MIT 代码不免除你遵守官方服务协议的责任。

以下直接依赖来自 npm 对应维护者的公开包，许可证均为 MIT；版本由 package-lock.json 固定。依赖许可仍以各自包内声明为准，不因本项目 MIT 许可而改变。

| 依赖 | 用途 | 公开包版本 |
|---|---|---|
| @modelcontextprotocol/sdk | MCP 与 OAuth 处理器 | 1.32.1 |
| Fastify | HTTP 宿主 | 5.12.5 |
| @fastify/rate-limit | 路由限流 | 10.3.0 |
| Express | SDK OAuth 处理器桥接 | 5.3.0 |
| better-sqlite3 | 授权摘要持久化 | 13.0.3 |
| TypeScript / @types | 构建与类型 | 见 package.json |

公开包采用 Fastify 5.12.5 并在该版本上运行定向测试；没有升级或修改私人生产服务。依赖来源、构建与测试检查不等于独立安全审计或零漏洞声明。
