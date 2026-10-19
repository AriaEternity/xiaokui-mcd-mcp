# 常见问题与排障（麦当劳独立版）

先按症状定位，不为排错关闭认证或打印凭据。只向AI提供错误名、HTTP状态和脱敏的非秘密配置。

| 现象 | 原因与处理 |
|---|---|
| 没有KuiNest/不会写Fastify | 现在使用内置standalone：`owner:init`、`token:init`、构建后`npm start`。不再需要现成宿主；`registerMcdGateway`仍供高级用户集成 |
| 只有GitHub链接，如何安装 | 先读[新手教程](beginners-guide.md)。代码不是公共服务/安装按钮，先确认ChatGPT自定义MCP权限和官方账号资格，再由本人准备服务器、域名、费用 |
| `node`版本不对/找不到 | 用教程指定Node24.20.0及配套npm，重新打开服务器终端后重新设置PATH；systemd使用绝对路径 |
| `better-sqlite3` / `NODE_MODULE_VERSION` / 找不到`.node` | 在目标Linux和正确Node下运行`npm ci`，保留锁文件，不复制Windows依赖。当前13.0.3随包附带平台N-API构件且没有install脚本；先核对Node/架构/libc及包是否完整，不默认要求编译。确需重编译时让AI按该版本上游文档准备工具链，不反复运行npm ci碰运气 |
| `owner:init`或`token:init`失败 | 必须本人的交互终端，隐藏输入正常；私有父目录、目标不存在。主人密码至少16字符且两次一致，Token不带Bearer。不能把秘密作为命令行参数 |
| 忘了主人密码或想换主人 | 当前没有远程找回/重置功能。保留原主人文件与状态，联系维护者讨论受控恢复；不能删owner.json、改ownerId或把别人的凭据塞入旧实例 |
| `OWNER_AUTH_ADAPTER_REQUIRED` | 正在运行高级宿主入口`start:host`。新手应构建后运行`npm start`或独立systemd模板；不要找测试假会话代替 |
| `MCD_START_FAILED` | 通用启动失败，先查PUBLIC_ORIGIN、Node路径、owner.json和mcd-token元数据、DATA_ROOT和端口。日志不会包含具体秘密；不要导出环境全文 |
| systemd加载凭据失败 | 源文件应为root:0400、目录0700，模板同时LoadCredential两个文件。可能还没运行到Node，不要放宽安全读取器 |
| 文件权限错误 | 状态目录属于服务用户且0700，进程umask0077，文件私有。Windows本地测试不等于POSIX权限验证；教程正式环境是Linux。不要chmod777 |
| `MCD_OWNER_ID`怎么填 | standalone从owner.json读取，不必手填。该变量仅为兼容高级宿主；如果设置且不一致会失败关闭，不能凭空编造主人标识 |
| 根网址404 / 匿名MCP401 | 根目录没有首页，MCP要求OAuth，均可能正常。检查元数据200和内部`/health/ready`，不要为变成200移除鉴权 |
| DNS或证书错误 | 核对A、旧AAAA、安全组80/443与证书域名；先HTTP ACME验证再配置HTTPS。不能关闭Cookie的Secure，也不能跳过浏览器证书警告 |
| 端口4318冲突 | 同机瑞幸可能占用。为本实例选独立PORT，并同步nginx两处proxy_pass、健康检查；不要停止别的服务 |
| ChatGPT没有自定义MCP入口 | 账号、工作区权限和当前界面不同；查README的官方链接/管理员。不承诺任何套餐都能用，不能保证付费升级就能开通 |
| OAuth URL填什么 | 本项目是`/api/mcd/oauth/authorize`和`/api/mcd/oauth/token`，不是瑞幸的`/oauth/*`。精确参数见README；不要将官方Token填进Client Secret |
| `invalid_target` / `invalid_scope` | 使用`xiaokui-chatgpt-mcd`、`mcd:orders:create`和`/api/mcd/orders/mcp`。选择预注册客户端，不能虚构DCR/CIMD端点或放宽resource校验 |
| Scope含create会自动下单吗 | 不会。默认创建开关false；即使开启，OAuth仍不能代替本人逐笔页面批准，模型也不能传confirmed:true绕过 |
| 登录循环或批准403 | PUBLIC_ORIGIN必须精确HTTPS原点；检查Cookie、当前本人、Origin和CSRF。会话有效8小时，重启保留；过期或退出后重新登录 |
| 登录429或session_capacity | 登录每15分钟最多5次，最多32个有效会话；等待窗口或会话过期，已有会话可正常退出。不要靠重启或删除库规避 |
| 收藏门店失败 / `MCD_QUERY_FAILED` | 实际曾出现，原因未定。改用searchType=2并给city/keyword，beType=1；不要套经纬度或外送参数 |
| `MCD_BUSY` | 适配器最多2个并行调用；串行读取必要菜单详情。只读查询可减少并发后再查，创建不适用重试策略 |
| 套餐/去冰参数无效 | 重新读取官方rounds、choices与modification key；同code可能对应不同key，不猜测编码 |
| 菜单价和实际计价不一致 | 菜单仅供选品，实际应付来自calculate-price；单位由服务端处理，不手动改为菜单价 |
| 取餐方式怎么选 | 使用当前报价takeWayList中的code调用prepare-order，不硬编码堂食/外带数字，也不按其他品牌推断 |
| `MCD_REFRESH_STORE_REQUIRED` | 该授权链/本次进程需要先读取门店。重新只读选店，再计价，不猜门店详情 |
| `MCD_CREATE_DISABLED` / `MCD_APPROVAL_REQUIRED` | 前者是默认创建关闭，后者需网页逐笔批准。教程只做到查询/计价，不需要为了“成功”开启创建 |
| 报价变化/确认链接过期 | 报价5分钟，批准最多2分钟；重新计价并核对变化。不能沿用旧批准、改数据库或追加confirmed:true |
| 创建UNKNOWN / SUBMITTING /残留锁 | 停止创建，由本人核实官方账户。保留所有数据与锁，禁止重试、换intent或删记录解锁 |
| 没付款链接或实际金额异常 | 保留已知订单，让本人在官方App核实；不能再建一笔“替代”。付款由本人完成，不能编造支付/收餐证据 |
| 配餐/完成但paymentStatus=unverified | 当前query-order没有独立支付确认字段；这不代表用户未付款。履约状态与独立支付验证分开看，不能手动改为confirmed |
| 中文状态仍显示未知、取餐码被隐藏 | 核对程序是否包含2026-10-19状态修复；按pickupInformationStatus区分官方未提供、当前状态隐藏与字段不合格。不要重新建单，详见[订单状态说明](order-status.md) |

原宿主用户报告已有真实交易和收餐；公开standalone真实交易及本次修复上线后的ChatGPT回执仍未验收，接口缺少独立支付证据。离线测试里的虚构订单和状态只证明受测逻辑，不能当作真实交易证明。当前事实见[订单状态说明](order-status.md)；安全边界见[安全说明](../SECURITY.md)，首单前历史见[公开复盘](POSTMORTEM-2026-10-18.md)。
