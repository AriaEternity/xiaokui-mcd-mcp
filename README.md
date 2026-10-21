# 小葵 × 麦当劳中国 MCP

> **零基础用户从这里开始：[完整中文新手教程](docs/beginners-guide.md)**。现在提供独立的单主人运行模式，无需 KuiNest、Fastify 宿主或现成登录系统；仍需本人准备服务器、HTTPS 域名、官方 Token 和 ChatGPT 自定义 MCP 权限。[常见问题](docs/faq.md)

## 复制给 ChatGPT 的部署提示词

```text
我想部署 https://github.com/AriaEternity/xiaokui-mcd-mcp ，没有后端经验。
请先实际阅读最新 README、docs/beginners-guide.md、docs/DEPLOYMENT.md、docs/faq.md、SECURITY.md，以及 package.json、src/main.ts 和部署模板。不能读取时请说明，不要猜。
先问我使用电脑还是手机、ChatGPT是否能添加自定义MCP、有无本人合法麦当劳官方MCP Token资格、有无服务器/域名、系统和架构、费用预算。先确认条件再建议我付费。
引导使用本仓库的standalone模式，不要求我编写OWNER_AUTH_ADAPTER。使用Ubuntu24.04 x64、Node24.20.0与systemd/nginx，说明better-sqlite3需要在目标Linux安装。一次只教一个步骤，说明在哪里输入、成功结果和失败排查；等我确认后继续，不发明一键部署。
密码、Token、Cookie、验证码、私钥、主人文件和数据库只由我在自己环境处理，不能要求粘贴给你。本站主人、麦当劳账户、系统账号和ChatGPT账号要分清。与瑞幸同机时检查独立端口和目录，OAuth路径使用本仓库自己的/api/mcd/oauth/*。
先完成离线测试、HTTPS、owner:init和token:init、OAuth、真实门店/菜单/套餐查询、calculate-price及取餐方式核对。MCD_ORDER_CREATE_ENABLED保持false，不自动批准、创建、取消或支付。网页逐笔批准、持久化和UNKNOWN防重必须保留，付款由本人完成。
请阅读docs/order-status.md区分原宿主用户报告的真实交易、官方只读证据与公开standalone的未验收范围。配餐/完成不能当作独立支付核验；unverified不表示未付款。合成测试不能算交易成功。
现在只问准备条件并给出第一个小步骤。
```

把麦当劳中国官方 MCP 接到 ChatGPT，并在服务端强制执行**本人逐笔批准**的参考实现。

> **当前状态（2026-10-19）：真实查询与计价已验证；原宿主已有用户报告的真实创建、本人付款及收到餐品。状态与取餐修复已在原宿主生产部署，经现有ChatGPT OAuth连接对两笔已有订单各一次只读验收，正确返回中文完成状态与官方取餐码。独立支付证据仍不可用；公开standalone的真实交易闭环尚未验收。**
>
> 创建链路、安全边界与异常恢复已有实现和离线合成测试；不同部署与证据不能相互代签。状态/支付/取餐修复和边界见[订单状态说明](docs/order-status.md)。

2026-10-21本地追加批准恢复修复：明确区分未批准、过期及真正UNKNOWN；页面回读服务器保存状态，显示实际截止时间，并提供失败后重新核验。尚未部署或完成此次故障的真实现场验收，详见[逐笔批准与失败恢复](docs/approval-recovery.md)。

这份代码从 KuiNest 的实际接入中抽取，复用已经使用过的瑞幸 MCP v4 模式。公开版移除了私人宿主、生产环境、账号和聊天资料，保留麦当劳所需模块和单资源 OAuth。现在可选择内置单主人 standalone，或继续通过 `registerMcdGateway` 集成自己的登录系统。**仓库不是公共代下单服务，也不附带任何人的 Token**。

目标体验：

```text
ChatGPT 选店、选餐与套餐配置
  → 官方实际计价
  → 选择官方返回的取餐方式
  → 本人在受保护网页核对并批准本笔
  → ChatGPT 提交已批准的 intentId
  → 本人打开官方付款链接支付
  → ChatGPT 查询官方订单状态和取餐信息
```

## 已实现与已验证

| 能力 | 实现 | 真实验证范围 |
|---|---|---|
| ChatGPT OAuth、MCP 工具发现 | 有，8 个工具 | 原宿主部署与 ChatGPT 实际连接已验证 |
| 城市与关键词选店、菜单、套餐详情 | 有 | 官方接口及 ChatGPT 实际只读调用已验证 |
| 已持有优惠券查询 | 有 | 官方查询通过；当次没有可用券，未验证优惠券抵扣 |
| 单品特制、套餐替换、实际计价 | 有 | 官方非交易计价通过；价格与可售商品随时间变化 |
| 本人逐笔批准、授权绑定、重新计价 | 有 | 原宿主保护检查与公开抽取版合成测试 |
| 持久化 intent、一次提交、UNKNOWN 阻断 | 有 | 合成测试；原宿主用户报告真实创建，公开standalone未完成真实交易验收 |
| 官方付款链接校验、状态与取餐信息处理 | 有 | 原宿主用户报告本人付款/收到餐品；修复上线后经原ChatGPT连接，两笔已有订单正确返回中文状态及官方取餐码；**独立支付核验无可靠字段，公开standalone交易闭环未验收** |

开源抽取使用离线测试；本次状态修复另完成原宿主生产部署及已有订单只读验收，没有为开发或测试创建、付款或取消真实订单。公开包相对原宿主调整了入口装配、OAuth 路径和客户端 ID；原宿主的验证记录不等于这个抽取包已经完成独立生产部署。当前边界见[订单状态说明](docs/order-status.md)，首单前历史见 [公开复盘](docs/POSTMORTEM-2026-10-18.md)。

当前公开代码已在本机 Ubuntu24.04/Node24.20.0 完成构建与24项定向合成测试，包含真实密码校验、会话重启恢复、Linux权限、订单保护和状态/取餐回归；当前证据见[订单状态说明](docs/order-status.md)，独立模式初次验收记录见[历史验证](docs/standalone-validation.md)。

## 工具与范围

| 工具 | 用途 |
|---|---|
| `query-nearby-stores` | 收藏门店，或城市与关键词查询 |
| `query-store-coupons` | 查询当前门店已持有的可用券 |
| `query-meals` | 当前门店菜单；菜单价只作参考 |
| `query-meal-detail` | 套餐轮次、子项、替换与特制 |
| `calculate-price` | 补齐明确的套餐配置，调用官方计价，生成 `quoteId` |
| `prepare-order` | 选择报价中的 `takeWayCode`，生成逐笔确认页 |
| `create-order` | 仅接收已批准的 `intentId`，服务端取回原快照并提交 |
| `query-order` | 仅查询本连接已知的订单，以官方结果说明状态 |

当前只开放**即时到店**：`orderType=1`、`beType=1`。堂食/打包以当次官方 `takeWayList` 为准。不开放外送、预约、团餐、免密支付、取消、积分、领券或营销工具；这只是本实现的范围，不代表官方不支持其他场景。

## 开始使用

需要 Node.js 24.20+（24.x）、npm、HTTPS 域名，以及你自己从[麦当劳官方平台](https://open.mcd.cn/mcp)申请的 Token。官方使用远程 Streamable HTTP 与 Bearer Token，说明见[官方接入指南](https://github.com/M-China/mcd-mcp-server)。Token 只保存在服务端。

```sh
npm ci
npm test
umask 077
npm run owner:init
npm run token:init
```

测试只使用合成上游和合成账号，不读取你的 Token，不访问官方服务。`better-sqlite3` 是原生依赖，没有适用预编译包时需要本机编译工具。

首次初始化在本人交互终端隐藏输入，默认生成私有 `data/owner.json` 和 `credentials/mcd-token`，均不覆盖已有文件。配置自己的 HTTPS、私有绝对路径、`OWNER_FILE`/`MCD_CREDENTIAL_ROOT` 和数据目录后，`npm start` 运行内置单主人模式；真实创建默认关闭。完整 systemd 安装及安全凭据流程见[新手教程](docs/beginners-guide.md)。仅执行上述命令还没有配置公网 HTTPS 或 ChatGPT 连接。

主人口令仅存 scrypt 哈希，会话令牌仅存摘要；Secure/HttpOnly Cookie、Origin/CSRF、登录限流与8小时过期均保留。会话、OAuth和订单分别持久化。当前没有公共注册、远程密码找回或自动 UNKNOWN 解锁。

高级用户仍可通过原 Fastify 挂载函数复用现有登录，接口保持不变：

```ts
import {registerMcdGateway} from './dist/index.js';

// app 已注册你自己的可靠登录与会话端点。
registerMcdGateway(app, {
  dataRoot: '/var/lib/xiaokui-mcd',
  publicOrigin: 'https://mcd.example.com',
  ownerId: configuredOwnerId,
  token: tokenReadFromProtectedCredentialFile,
  inspectSession: inspectYourExistingOwnerSession,
  createEnabled: false,
});
```

`inspectSession(cookie)` 必须验证真实服务端会话，返回 `{ownerId, csrfToken}` 或 `undefined`。不能把 Cookie 中自报的用户、请求头或测试假会话直接当作身份。

授权页和订单页使用同源的 `/api/v1/auth/session` 与 `/api/v1/auth/login`。standalone已经提供真实端点；高级宿主集成时由宿主提供。原外部适配器启动入口改为 `npm run start:host`，原 `registerMcdGateway` API 不变。没有默认密码或测试后门。具体契约、Linux 凭据、启动、nginx 和回滚见 [部署说明](docs/DEPLOYMENT.md)。

## ChatGPT 连接参数

下面是**此公开包**的默认参数，域名替换为自己的 HTTPS 域名。实际界面可用性取决于你的 ChatGPT 账号和工作区。

| 参数 | 值 |
|---|---|
| MCP URL / OAuth Resource | `https://mcd.example.com/api/mcd/orders/mcp` |
| Client ID | `xiaokui-chatgpt-mcd` |
| Client Secret | 留空，公共客户端 |
| Scope | `mcd:orders:create` |
| Authorization URL | `https://mcd.example.com/api/mcd/oauth/authorize` |
| Token URL | `https://mcd.example.com/api/mcd/oauth/token` |
| Revocation URL | `https://mcd.example.com/api/mcd/oauth/revoke` |
| Issuer / Discovery | 域名原点；`/.well-known/oauth-authorization-server` |
| Protected Resource Metadata | `/.well-known/oauth-protected-resource/api/mcd/orders/mcp` |
| Redirect URI | `https://chatgpt.com/connector_platform_oauth_redirect` |
| PKCE | 必须 S256 |

客户端 ID 和 Scope 是公开协议标识，不是凭据。官方 Token 不填入 ChatGPT。公开包在独立域名上运行；若接入已有多资源 OAuth 宿主，应按原宿主的同一 issuer、资源策略及路由装配，不能注册第二个冲突的发现端点。

## 首单流程与保护

先保持 `createEnabled=false` 完成只读与计价。部署者核对本人登录、权限和确认页后，才显式启用创建。启用创建仍然不能跳过逐笔批准。

1. 让 ChatGPT 按城市与关键词选店，读取菜单、套餐及特制，不猜测商品编码。
2. 指定数量、餐具及配置，调用 `calculate-price`；从返回的取餐方式中选择，再调用 `prepare-order`。
3. 本人打开确认页登录，核对门店、全部套餐子项、数量、优惠、费用与实际应付，点击批准；等待页面回读并明确显示服务器已保存批准及实际截止时间。响应丢失先重新核验，不能仅凭点击或聊天确认判断成功。
4. 在批准有效期内回到 ChatGPT，提交同一个 `intentId`。服务端重新计价；快照或价格变化就要求重新确认。
5. 创建成功后，本人通过官方返回的付款链接支付；再查询官方订单状态。区分官方履约状态、独立支付证据与用户实际收餐陈述；**配餐/完成不等于独立支付核验，unverified也不代表未付款**。按[返回字段说明](docs/order-status.md)解读取餐信息。

OAuth 授权和聊天里的“确认”不能代替网页批准。`create-order` 不接收客户端重写的购物篮或 `confirmed:true`。批准绑定本人、客户端、资源和授权链；报价 5 分钟有效，批准最多 2 分钟。

本人反馈已点击后，先query-order核对approvalStatus与approvalExpiresAt；报价/批准到期需重新计价、预览和逐笔批准。未创建阶段追加creationStatus、quoteExpired和nextAction，过期链接不再返回。not_sent仅说明本次调用未发送，不是自动重试许可；UNKNOWN继续阻断重建。[字段及兼容说明](docs/approval-recovery.md)

提交前先持久化 `SUBMITTING`；本地锁、已创建结果复用和近期重复餐单检查减少重复建单。网络或结果不明确时进入 `UNKNOWN`，阻断该本人后续报价和提交，**不得自动重试、换 intent 重建或删除记录解锁**。服务端无法承诺外部系统绝对只创建一次，遇到未知结果必须由本人核实官方账户。见 [安全与恢复](SECURITY.md)。

已知实际现象：收藏门店查询可能失败，可改用城市与关键词；上游适配器最多并行 2 个调用，多个套餐详情并发会返回 `MCD_BUSY`，应减少并发。不要将这种只读重试策略用于创建订单。

## 目录

- `src/contracts`：受限公开工具 Schema。
- `src/mcp`：SDK 服务端、固定官方上游、传输及凭据清理。
- `src/oauth`：从既有实现抽取的单资源 OAuth、PKCE 与摘要令牌存储。
- `src/mcd`：报价、批准、提交、状态及磁盘持久化。
- `src/http/routes`：受保护的 MCP 入口和逐笔确认页。
- `deploy` / `examples`：凭据读取、通用部署样例和宿主启动入口。
- `test`：离线合成的协议与关键安全边界测试。

## 来源与许可

本仓库自有实现按 [MIT](LICENSE) 许可开放。麦当劳服务、商标、账号和接口使用受其自身条款约束；MIT 不授予对官方服务或资料的额外权利。本项目不由麦当劳或 OpenAI 提供、审核或背书。

业务契约优先依据[官方平台](https://open.mcd.cn/mcp)与[官方 GitHub](https://github.com/M-China/mcd-mcp-server)；[第三方 ChatGPT 代理示例](https://github.com/yoruuuchan/chatgpt-mcp-connect/tree/main/recipes/mcdonalds)仅作为连接思路参考，未复制其 Worker 架构或代码。依赖与资料边界见 [NOTICE](NOTICE.md)。

欢迎复用、反馈和改进。提交问题时请使用合成样例，移除 Token、Cookie、付款链接、订单号和个人门店/地址。
