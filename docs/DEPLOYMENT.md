# 自托管与宿主接入

公开版是抽取的单资源网关，需要你已有的本人登录。它不包含私人 KuiNest、聊天、手机状态或账号数据库。示例中所有域名和路径都是通用占位值。

## 1. 先完成宿主身份适配

推荐直接在现有 Fastify 宿主调用 `registerMcdGateway`，复用已有服务端会话。

`inspectSession(cookie)` 的接口：

```ts
type OwnerSession = { ownerId: string; csrfToken: string };
type SessionInspector = (cookie: string) => Promise<OwnerSession | undefined>;
```

必须真正验证 Cookie 对应的有效会话；`ownerId` 应与服务器配置的 `MCD_OWNER_ID` 完全一致。过期、撤销或错误会话返回 undefined。CSRF Token 应绑定当前会话，不能使用固定公开字符串。

授权与订单网页需要同源接口：

| 接口 | 所需行为 |
|---|---|
| `GET /api/v1/auth/session` | 已登录时返回 `{ownerId, csrfToken}`，否则 401/403；禁止缓存 |
| `POST /api/v1/auth/login` | 接受 `{username,password}`，真实认证成功后设置安全 Cookie；非 2xx 表示失败 |

Cookie 应为 Secure、HttpOnly，并使用适当的 SameSite、Path 与过期策略。登录接口应执行自己的同源检查、口令保护和限流。不要从 MCP Bearer Token 制造本人网页会话。两个接口可来自你的已有认证服务；如果修改路径，需要同步调整 `src/oauth/page.ts` 与 `src/http/routes/mcd-order-confirm.ts`。

若使用 `examples/host.mjs`，请在仓库外放置管理员编写的本地模块，并通过 `OWNER_AUTH_ADAPTER` 指向它。模块导出：

```ts
export async function registerOwnerAuth(app) {
  // 在 app 中注册上述真实登录、会话接口；复用你的现有认证系统。
}
export async function inspectSession(cookie) {
  // 调用同一认证系统验证会话，返回 OwnerSession 或 undefined。
}
```

这里的注释是接口要求，不是可用的登录实现。示例启动器会要求提供模块；它没有内置测试用户。不要复制 test/ 中的假会话实现到正式环境。

已有站点若占用 OAuth well-known 端点，应把麦当劳资源加入其共享 provider，并保留原 issuer、数据库和旧授权。公开版单资源 provider 适用于独立域名，不能直接覆盖现有 OAuth 或指向旧私人授权库。

## 2. 安装与配置

安装 Node.js 24.20+（24.x）后，在公开仓库目录执行：

```sh
npm ci
npm test
```

设置 `.env.example` 所列环境变量。文件本身不会自动加载；使用服务管理器配置。`DATA_ROOT` 必须为绝对路径，目录只允许服务用户访问；Linux 运行时使用 umask 0077。`MCD_ORDER_CREATE_ENABLED` 默认关闭。

本人前往[官方平台](https://open.mcd.cn/mcp)登录、申请 Token 并接受官方协议。通过自己的安全方式把 Token 写入仓库外的 `mcd-token` 文件，禁止粘贴到 issue、终端参数、环境变量正文或聊天。源凭据用 root 所有的 0400 文件，父目录仅 root 可访问。

Linux 生产优先用 systemd `LoadCredential`，将独立源凭据装入服务专属的只读挂载。读取器会核验挂载信息并接受 systemd 的 0440 运行副本；不是凭路径长得像 `/run/credentials/` 就放行。也支持服务用户私有目录中的 0400/0600 文件。Windows 本地调试还需自行限制 NTFS ACL。

先安装并配置 `deploy/xiaokui-mcd.service.example` 与 `deploy/nginx.conf.example`，再检查配置、启动。它们是需要适配的模板，不是自动部署脚本。Node 路径、认证模块、域名、证书、服务用户和数据路径都由部署者填写。

## 3. OAuth 与上线检查

使用 README 给出的公开包连接参数。Scope 不代表逐笔批准；没有批准时 create-order 必须被拒绝。

首次检查保持创建关闭：

1. 服务启动，OAuth 元数据可读；MCP 无 Token 访问返回 401。
2. 在 ChatGPT 走本人网页登录、PKCE 和授权同意，发现 8 个工具。
3. 错误 Resource/Scope、错误本人、跨站 Origin、错误 CSRF 不能使用确认。
4. 查询一个合适门店和菜单，串行读取所需详情，完成官方计价。
5. 打开确认页核对实际商品、金额和取餐方式；未经批准的创建必须失败。这个检查不需要真实建单。

不向代理访问日志输出 OAuth 请求参数、Cookie、Bearer、确认链接、付款链接或订单正文。模板为网关路由关闭访问日志；如果现有全站日志仍会捕获它们，需要同步处理。

创建开关只能由部署者显式开启。开启后仍要在 ChatGPT 中由本人发起首单，在网页批准、亲自支付并取餐，才能完成真实闭环验收。此仓库没有执行首单的自动脚本。

## 4. 更新与回滚

独立程序目录与持久化数据目录分离。更新前停止此网关，备份配置及一致的数据目录，再切换代码；不需要操作其他聊天服务。

若异常，先关闭创建开关并停止此网关，切回上一程序版本。保留当前 OAuth、订单 JSON、SUBMITTING/UNKNOWN 和锁记录；不要将旧数据快照覆盖回来。UNKNOWN 必须由本人核实官方账户，程序回滚不能撤销已经发生的外部交易。

公开仓库不包含私人生产部署包；模板没有在读者环境中执行过。原宿主部署和本公开版离线测试的范围见公开复盘。
