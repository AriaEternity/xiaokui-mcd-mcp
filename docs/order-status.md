# 订单状态、支付核验与取餐信息

2026-10-19状态修复已在原宿主生产部署，并经现有ChatGPT OAuth连接只读验收。部署者更新本版本之前，旧服务仍可能把中文订单状态显示为“未知状态”并隐藏取餐码。更新程序须保留原OAuth、会话、订单、UNKNOWN及锁记录；不需要重新建单或重新授权。

2026-10-21批准恢复修复也已在原宿主上线。维护者本人反馈，当天中午已在ChatGPT正常走完逐笔批准、下单、本人付款与取餐。此项记录是实际使用者的完整流程反馈；本次发布没有另外查询该笔新订单或公开其回执，不能据此声称独立支付字段、所有异常分支或公开standalone真实交易已获验收。[批准恢复规则](approval-recovery.md)

## 核实到的官方行为

2026-10-19调查通过[麦当劳官方MCP](https://mcp.mcd.cn/)的tools/list检查query-order，并只读查询两笔已有订单。该次调查没有创建、付款或取消订单，没有公开原始响应、订单号、付款链接或取餐码值。

- 当前outputSchema将orderStatus声明为string，说明仍列出1待支付、2配餐中-已支付、4配送中、6已完成、7已取消、8已评价、10配餐中-餐厅确认配餐中；没有限定这些值的enum。
- 两笔实际返回均为orderStatus="订单已完成"，另一个顶层status="40"。status的Schema仅写“订单状态”，不解释编码；不能套用orderStatus的数字说明。
- 两笔都返回非空的顶层pickupCode字符串。两笔当次都没有lockerCode、lockerQrCode；没有发现额外嵌套取餐字段。不能据此断言所有堂食/外带订单都不提供柜码。
- Schema及这两次返回没有独立支付确认状态或支付成功时间。payId是支付标识，realTotalAmount是金额，均不足以证明付款成功。

报告中较早的待支付/配餐状态只有适配层回执，无法回放当时原始上游内容，因此无法证明取餐码在哪个时间点首次出现。当前已完成阶段存在官方取餐码是直接只读核实的事实。

## 返回字段

| 字段 | 含义 |
|---|---|
| officialOrderStatus / officialOrderStatusType | 官方orderStatus原值与类型；有界字符串或小整数保留，缺失/异常值用null并保留类型 |
| officialStatus / officialStatusType | 官方status原值与类型，单独保留，不猜测“40”等编码 |
| normalizedOrderStatus | PENDING_PAYMENT、PREPARING、DELIVERING、COMPLETED、CANCELLED、REVIEWED、RESTAURANT_CONFIRMED或UNKNOWN |
| orderStatusName | 对应中文履约名称；未知格式安全回退“未知状态” |
| paymentStatus | 待支付订单为pending；其余当前为unverified。相对旧版，不再把2/4/6/8/10统一报告为confirmed |
| paymentVerification | 当前为{status:"unverified",source:"not_provided"}，明确缺少独立支付证据 |
| orderStatusPaymentHint | 官方说明明确含已支付的2/“配餐中-已支付”为paid，待支付为pending，其余为not_provided；不是独立支付核验 |
| pickupInformationStatus | available有合格字段；not_provided未提供非空字段；withheld当前状态不适合展示；invalid字段校验不通过 |
| pickupCode / lockerCode / lockerQrCode | 仅返回通过校验且允许展示的官方顶层字段；不自行生成 |
| notice | 解释本次证据、支付核验限制及取餐字段缺失/隐藏原因 |

unverified表示接口证据不足，不表示官方证明用户没付款，也不否认用户已支付或已收到餐品的陈述。订单完成、取餐码存在和用户陈述都不能转换成独立支付核验成功。未来官方若提供可靠的独立字段，应先核实契约再增加解析；不能直接信任未定义的paid或paymentStatus字段。

## 取餐信息何时返回

服务先验证成功业务封装、本人授权链绑定的已创建intent和完全匹配的官方orderId。随后仅在已识别的配餐、餐厅确认配餐、配送、完成、已评价状态下展示合格的官方取餐字段。是否展示取餐信息与是否获得独立支付证明分开判断；展示取餐信息不执行任何交易。

待支付、取消、未知或异常状态一律隐藏取餐字段。码值须为有界普通文字/数字；柜二维码沿用生产官方HTTPS域名校验，拒绝非官方域、测试环境、明文HTTP、凭据及异常端口。不扫描任意嵌套对象来猜取餐码，也不把照片中的号码、订单号或付款链接冒充取餐码。已完成订单的码只表示官方记录，不表示还有餐品待取。

## 排障和验证边界

- 出现中文“餐厅配餐中”“订单已完成”而名称仍为“未知状态”：核对运行的程序是否已更新到包含src/mcd/order-status.ts的版本。不要重建订单。
- 状态完成但paymentStatus仍为unverified：当前官方接口没有独立支付证据，这是如实的限制。本人可查看官方账户/支付记录；不要手动改为confirmed。
- pickupInformationStatus=not_provided：本次官方未给非空字段，稍后仍可只读查询同一intent；不能自动创建新订单。
- withheld或invalid：阅读notice，在官方App或门店核实；不要放宽校验或在公开issue粘贴原始回执。

10月19日状态版本在Ubuntu24.04 x64、Node24.20.0进行全新依赖安装、构建和24项定向合成测试，24通过、0失败、0跳过。用纯合成订单覆盖数字/中文/未知状态、两组报告中的状态序列、支付证据边界、字段缺失和安全展示，并在JSON/SSE集成流程中回归。10月21日批准恢复增量扩展到28项合成测试，相关场景验证及定向复测通过，包含状态回读保护、批准响应丢失、失败恢复和实际截止时间；原认证、逐笔批准与UNKNOWN保护继续保留。

修复在原宿主生产部署后，使用原ChatGPT OAuth连接对两笔已有订单各只读查询一次：均返回officialOrderStatus=订单已完成、normalizedOrderStatus=COMPLETED、正确中文名称、pickupInformationStatus=available及有效非空官方pickupCode。paymentStatus与paymentVerification.status继续为unverified，提示明确不代表用户未付款；两笔均没有柜密码或柜二维码。没有循环查询，也没有为本次修复创建、支付或取消订单；现有授权和订单状态保留。

原宿主较早已有真实创建、本人付款和收餐的用户报告；10月21日本人又反馈，批准恢复上线后正常完成了一次完整点餐流程。这些反馈与“接口独立支付核验”分开记录。**公开standalone的真实交易闭环仍未验收，当前接口仍无可用独立支付证据。** 生产只读验证和原宿主本人使用反馈均不等于为公开独立模式完成真实交易验收。历史首单前文档保留其记录时点，不作为当前状态的替代；本文不公开订单号、码值、付款链接或私人部署信息。
