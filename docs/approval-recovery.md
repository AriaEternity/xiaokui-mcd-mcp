# 本人逐笔批准与失败恢复

本页描述2026-10-21的本地修复；本轮仅做离线合成验证，尚未部署或完成这次确认页故障的真实现场验收。原宿主的既有订单和支付/取餐证据见[订单状态说明](order-status.md)，不据此宣称本次修复或公开standalone真实交易已经验收。

## 用户怎样操作

1. 在ChatGPT完成最新计价、选择当次官方取餐方式，并生成确认页。
2. 本人打开确认页登录，核对餐厅、套餐子项、数量、配置、费用与应付后点击批准。
3. 页面向服务器提交批准，然后重新读取服务器保存的状态。只有明确显示“服务器已保存本笔批准”及实际截止时间，才表示成功。单纯点击按钮或在聊天回复“确认”不能代替。
4. 回到ChatGPT先query-order核实approvalStatus及approvalExpiresAt；有效时才提交同一个intent。报价只有五分钟，批准最多两分钟，临近报价截止时实际批准时间会更短。
5. 网络失败先点“重新核验本笔状态”。已批准则显示实际期限；仍未批准且未过期则重新显示核对内容，由本人再次点击；登录失效则重新登录；已过期则回到ChatGPT重新计价、预览和批准。任何核验都不会自动创建订单。

创建UNKNOWN、提交中或已有订单均不能靠新报价“恢复”。必须保留状态/锁并核实官方账户。`not_sent`只说明当前调用没有发送创建，不代表账户没有其他订单，也不允许AI自动重试创建。更新程序后，原先已打开的旧确认页应刷新再使用。

## 返回字段及兼容性

报价、预览和未创建的query-order保留原state，并追加：

| 字段 | 含义 |
| --- | --- |
| serverTime | 服务器用于判断的时间，ISO 8601 |
| quoteExpired | 原报价是否已经到期；不是官方订单失效或支付状态 |
| approvalStatus | not_requested / required / approved / expired / consumed |
| approvalExpiresAt | 已保存的真实批准截止时间（如有） |
| creationStatus | not_submitted / unknown / created，本地提交阶段 |
| officialOrderKnown | 记录中是否存在官方订单号 |
| nextAction | prepare / approve / submit / recalculate / query_official_order / owner_reconciliation |

state不会因查询过期而改写；SUBMITTING继续对外视为UNKNOWN。过期PREVIEWED返回nextAction=recalculate，不再返回旧confirmationUrl。确认链接只在有效PREVIEWED需要批准时返回；APPROVED应读取实际期限。已创建后的官方状态/支付/取餐查询保持原格式，按order-status.md解释。

新GET `/api/mcd/orders/confirm/:intentId/status`只接受真实本人会话，并核对原授权仍有效、本人一致。返回上述阶段信息及提示，不含nonce、商品、订单号或付款链接。原details仅在有效PREVIEWED返回受保护快照与nonce；approve仍要求Origin、CSRF、私有nonce，成功响应从仅state扩展为阶段信息，不自动创建或支付。原只读取state的宿主客户端兼容。

MCP输入Schema、OAuth客户端/Scope/Resource、持久化格式均未改变，不需要数据库迁移。新增明确错误码可能需要自定义客户端更新分支：

| 错误 | 含义 |
| --- | --- |
| MCD_APPROVAL_REQUIRED | 本次创建尚无有效的服务器逐笔批准，未发送 |
| MCD_QUOTE_EXPIRED | 报价到期，本次未发送创建；重新报价及逐笔批准 |
| MCD_APPROVAL_EXPIRED | 批准到期，本次未发送创建；重新报价及逐笔批准 |
| MCD_INTENT_ALREADY_PREPARED | 已进入后续阶段，不可重复prepare；先查询原intent |
| MCD_SUBMISSION_CANCELLED | 本次在创建发送前取消或超时；先查询状态 |
| MCD_BUSY | 本地最多两个在途上游调用；减少只读并发 |
| MCD_RESULT_UNKNOWN_DO_NOT_RETRY | 创建可能已受理，结果无法核实，禁止重建 |

明确未发送的错误体可含creationRequestStatus=not_sent；真正未知或该本人存在未知记录时为unknown。未标记时不要推断提交结果。错误仍使用原isError与text JSON封装。

## 维护者怎样查问题

确认路由只记录固定事件`mcd_approval`、intentRef和固定结果码。intentRef是原UUID的SHA-256前24个十六进制字符，供已知intent关联；不是授权凭据。结果包括approved、origin_denied、session_required、session_unavailable、csrf_denied、nonce_invalid、quote_expired、authorization_revoked、busy_or_uncertain和通用confirmation_not_completed。HTTP解析或请求限流发生在处理器之前时，不一定有批准事件；缺少事件不能证明用户没有点击。

standalone启用安全日志器并关闭请求日志；不会记录路径、原始intent、主人身份、Cookie、CSRF、nonce、Token、商品/金额或异常正文。高级宿主使用其Fastify日志器；如宿主关闭logger，此事件也不落盘。宿主必须自行关闭原始请求和代理访问日志，不能为排障打开秘密全文。

本轮可复现并修复了状态/提示与页面恢复问题，但过去首次批准失败的准确HTTP原因没有历史记录可以还原。新增结果记录用于以后定位，不能反推过去发生了某种身份或网络故障。
