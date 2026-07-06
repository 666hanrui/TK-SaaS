# TikTok Shop 店铺运营自动化调研资料

> 日期：2026-07-06  
> 仓库：TK-SaaS  
> 目标：继续补充 TikTok Shop 自动化方向的资料，包括官方功能、政策边界、第三方工具、开源 SDK、低代码方案和落地建议。

---

## 1. 调研结论总览

当前 TK-SaaS 不应该一开始做“浏览器机器人硬点后台”。更稳的路线是：

```text
TikTok Shop 官方功能 / Open API / ERP / 惠程荣达导出
        ↓
数据同步与规则引擎
        ↓
订单、售后、评价、库存、达人线索看板
        ↓
AI 生成话术草稿
        ↓
人工确认执行
```

优先级建议：

1. **订单超时雷达**：24 小时揽收风险提醒。
2. **售后工单池**：待退货、已退货、争议/申诉分队列处理。
3. **库存核对表**：TikTok SKU 库存、惠程荣达库存、在途数量、安全库存对比。
4. **评价处理看板**：差评/中评/待回复评价跟踪，生成合规回复草稿。
5. **达人线索库**：马尾/发饰/美发类达人筛选、公开联系方式管理、邮件草稿。

暂不建议优先做：

- 浏览器自动私信达人
- 批量强触达客户
- 自动诱导好评
- 自动提交申诉且无人确认
- 高频爬取达人主页
- 自动化账号健康评分处理

---

## 2. 官方能力：TikTok Shop Seller Center / Academy

### 2.1 Customer Messages 客服工作台

TikTok Shop Seller Center 已经自带 Customer Messages 能力。它不是简单聊天框，而是一个客服工作台，具备：

- 售前、售中、售后沟通
- Inbox 分配：Assigned / Unassigned
- 状态筛选：All、Overdue、Due soon、Unreplied、Unread、Starred、Closed
- 类目标签：Pre-purchase、Logistics、Aftersales
- 支持文本、表情、商品卡、图片、视频
- 自动回复 FAQ
- No Response Needed 标记垃圾/无关消息
- Buyer Details：客户订单历史、物流、优惠券、客户洞察
- AI Reply Recommendations：系统实时推荐回复
- Chatbot：用于周末覆盖和常见问题处理
- Automated Updates：订单取消、派送中、已发货、延迟等节点的自动消息

### 对 TK-SaaS 的影响

不需要一开始重做完整客服 IM 系统。更适合做：

- 客服待办聚合
- 超时提醒
- 客服话术草稿库
- 售后/评价/订单节点的提醒看板
- 将现有话术整理成可复制模板

### 来源

- TikTok Shop Academy - How to use Customer Messages  
  https://seller-us.tiktok.com/university/essay?knowledge_id=7359788334565162

---

### 2.2 Saved Replies 话术模板

TikTok Shop 的 Saved Replies 支持管理员创建常用回复模板，客服可直接使用。官方说明：

- 可创建 reply group
- 每组最多 20 个模板
- 支持关键词搜索
- 支持 shortcut 快捷输入
- 适合 Shipping、Refunds、Logistics、Promotions 等分组

### 对 TK-SaaS 的影响

TK-SaaS 可以先做“话术库管理 + AI 草稿生成”，再把最终版本人工复制到 TikTok Shop Saved Replies。

第一阶段不用做自动发送，先做：

- 售后解释模板
- 退货提醒模板
- 差评回复模板
- 索要视频模板
- 真实评价邀请模板
- 达人建联模板

### 来源

- TikTok Shop Academy - How to Use Saved Replies  
  https://seller-us.tiktok.com/university/essay?knowledge_id=5816703566350126

---

### 2.3 24-Hour Response Rate 客服响应率

TikTok Shop 对客服响应速度有明确规则：

- 客户发起聊天后，24 小时内需要有效回复
- “Hi”“Hello”这类寒暄不算有效回复
- 24-Hour Response Rate 至少需要 90%
- 低于 90% 会收到 warning
- 低于 85% 可能触发进一步 enforcement
- 使用 Chatbot 时，周末消息可以排除，但需要在周一当地时间 12:00 前回复
- 自动回复本身不计入人工 24 小时响应率，但能减少需要人工处理的咨询量

### 对 TK-SaaS 的影响

这里要和“订单 24 小时揽收”区分开：

- **客服 24 小时响应率**：客户发起聊天后 24 小时内有效回复。
- **订单 24 小时揽收**：订单履约节点，需要及时发货/揽收。

TK-SaaS 可以做两个独立倒计时：

1. 客服响应倒计时
2. 订单揽收倒计时

### 来源

- TikTok Shop Academy - Requirements for the 24-Hour Response Rate Metric  
  https://seller-us.tiktok.com/university/essay?knowledge_id=719928765302570

---

## 3. 官方政策：评价、客服、售后申诉

### 3.1 Review Policy 评价政策

TikTok Shop 对评价有明确限制：

禁止：

- 用金钱、礼品卡、免费产品、折扣、退款、返现等激励换评价
- 要求客户改评或删评
- 只向满意客户选择性索评
- 使用 review management services 操控评价
- 反复请求客户留下评价
- 把评价引导到站外渠道

允许方向：

- 邀请客户分享真实体验
- 通过官方 Incentivized Review 功能获取合规评价
- 对不正确、无效、滥用评价，通过 Product Ratings 页面报告平台

### 对 TK-SaaS 的影响

“送达 3 天后要好评”必须改成：

> 订单送达 3 天后，邀请客户分享真实使用体验。

系统里不能出现：

- 好评返现
- 五星好评
- 改好评
- 删差评
- 私下解决后再好评

### 来源

- TikTok Shop Academy - Review Policy  
  https://seller-us.tiktok.com/university/essay?knowledge_id=4451321470682882&lang=en

---

### 3.2 Product Ratings 商品评价功能

Product Ratings 页面支持：

- 查看买家评价
- 追踪 Negative Review Rate, NRR
- 回复负面/中性评价
- 按评价、回复状态、订单 ID、商品 ID、买家用户名、日期筛选
- 1-2 星属于 negative review
- 可追踪最近 7 天 / 30 天 NRR
- 对于 TikTok Logistics 导致的物流差评，特定场景会自动标记 Platform Issue 并排除影响
- 部分卖家可白名单导出 CSV

### 对 TK-SaaS 的影响

评价模块应做：

- 差评/中评/待回复好评筛选
- NRR 风险看板
- 差评原因分类：产品、物流、服务
- 差评回复草稿
- 需要视频证据的跟进待办
- CSV 导入兼容：如果当前账号支持导出 Product Ratings CSV，就优先走导入，不走爬虫

### 来源

- TikTok Shop Academy - Product Ratings  
  https://seller-us.tiktok.com/university/essay?knowledge_id=6599730126833451&lang=en

---

### 3.3 Customer Service Policy 客服政策

TikTok Shop 要求卖家：

- 通过 TikTok Shop Chat 提供专业、及时、准确的客服
- 不得骚扰、欺骗、操纵、施压或引导客户离开平台
- 不得索要额外费用
- 不得泄露或滥用客户个人信息
- 不得发送垃圾营销或未经同意的促销消息
- 不得用客服消息索要、诱导或奖励正面评价
- 退货退款必须按照 TikTok Shop 流程处理，不得私下转移
- 24-Hour Response Rate 至少 90%
- Satisfaction Rate 至少 75%

### 对 TK-SaaS 的影响

系统内所有客户话术都需要做合规审查：

- 不包含站外联系方式
- 不包含返现/好评诱导
- 不包含额外收费
- 不泄露客户信息
- 不引导客户站外交易或站外退款

### 来源

- TikTok Shop Academy - Customer Service Policy  
  https://seller-us.tiktok.com/university/essay?knowledge_id=7454760317110062

---

### 3.4 Requirements for Aftersales Dispute Escalations 售后争议规则

关键时间节点：

- 买家可在订单送达后 30 个自然日内提交退货/退款请求
- 卖家需要在 4 个工作日内响应初始请求
- 如果卖家不响应，可能自动批准
- 卖家拒绝后，客户可升级为争议
- 卖家收到 dispute notification 后，需要在 24 小时内提交证据
- 证据例子：妥投证明、商品状态、沟通记录、产品照片
- 如果卖家不满意判决，可在收到判决后 21 个自然日内通过 Help Center 提交申诉

### 对 TK-SaaS 的影响

售后模块必须有强提醒：

- 初始售后 4 个工作日倒计时
- 争议证据 24 小时倒计时
- 判决后 21 天申诉窗口
- 证据清单自动生成
- 申诉草稿自动生成，但最终提交必须人工确认

### 来源

- TikTok Shop Academy - Requirements for Aftersales Dispute Escalations  
  https://seller-us.tiktok.com/university/essay?knowledge_id=3985068541478658

---

## 4. Open API / SDK / 开发资料

### 4.1 TikTok 官方示例仓库：ttspc-server-sample

TikTok 官方 GitHub 上有 TikTok Shop API Sample Application and Middleware Server。它包含：

- React / TypeScript 前端示例
- ExpressJS / TypeScript middleware server
- 用户管理、授权、认证
- TikTok Shop data API 给前端使用
- TypeScript SDK
- 需要 TikTok Shop Partner Center 账号
- 需要 TikTok Shop App
- 需要 Development Shop 用于测试
- 需要配置 app key、app secret、shop id、redirect url 等

### 对 TK-SaaS 的影响

如果后续走官方 API，应优先研究这个仓库，而不是自己从零摸认证流程。

建议创建一个技术 Spike：

```text
Spike: TikTok Shop API 授权 Demo
目标：跑通官方 ttspc-server-sample
验收：可以完成开发店铺授权，并在本地拿到基础 shop/order 数据
```

### 来源

- tiktok/ttspc-server-sample  
  https://github.com/tiktok/ttspc-server-sample

---

### 4.2 Go SDK：ipfans/tiktok

第三方 Go SDK `ipfans/tiktok` 覆盖了不少 TikTok Shop Open Platform 能力，包括：

- Authentication
- Webhook
- Order API：GetOrderList、GetOrderDetail、ShipOrder
- Fulfillment API：SearchPackage、GetPackageDetail、UpdatePackageShippingInfo 等
- Logistics API：GetShippingInfo、GetWarehouseList、GetShippingProvider
- Product API：CreateProduct、EditProduct、GetProductList、UpdatePrice、UpdateStock 等
- Shop API
- Finance API
- Reverse Order API：ConfirmReverse、RejectReverse、GetReverseList、GetReverseReason

### 对 TK-SaaS 的影响

它能作为接口命名和业务范围参考，但不一定适合作为正式依赖。原因：

- 最后更新时间可能较老
- TikTok Shop API 版本变化快
- 最终仍应以官方 Partner Center 文档为准

适合用途：

- 快速理解 API 边界
- 参考订单、发货、售后、商品库存接口设计
- 不建议直接生产依赖，除非确认维护活跃和接口版本匹配

### 来源

- ipfans/tiktok  
  https://github.com/ipfans/tiktok

---

### 4.3 Laravel SDK：laraditz/tiktok

第三方 Laravel 包 `laraditz/tiktok` 提到支持：

- 完整认证流程
- 多店铺管理
- 商品管理
- 订单处理
- Return / Refund 管理
- Finance tracking
- Webhook Integration
- 数据库日志
- 自动刷新 Token

它的 README 里也列出需要在 TikTok Shop Partner Center 创建 app，并配置 redirect URL。

### 对 TK-SaaS 的影响

如果后端选 Laravel/PHP，可以参考；但当前项目更建议 Node.js/NestJS 或 Python/FastAPI。

适合用途：

- 研究 token 存储表结构
- 研究 webhook 处理结构
- 研究多店铺授权模型

### 来源

- laraditz/tiktok  
  https://github.com/laraditz/tiktok

---

## 5. ERP / 第三方运营工具调研

### 5.1 店小秘 ERP

店小秘帮助中心能看到其模块覆盖：

- 平台授权
- 产品模块
- 订单模块
- 发货模块
- 客服模块
- 采购模块
- 库存模块
- 海外仓库
- 物流设置
- 货代授权
- 数据模块
- 财务模块
- PDA 模块
- TikTok 常见问题分类

### 对 TK-SaaS 的影响

店小秘适合当作“是否已有成熟 ERP 覆盖”的候选。TK-SaaS 可以选择两种策略：

1. 如果店铺已使用店小秘：优先从店小秘导出/接口接入。
2. 如果没有 ERP：TK-SaaS 第一版先做轻量中控台。

### 来源

- 店小秘 ERP 帮助中心  
  https://help.dianxiaomi.com/search?searchValue=%E5%BA%97%E5%B0%8F%E7%A7%98ERP%E5%85%8D%E8%B4%B9%E5%8A%9F%E8%83%BD

---

### 5.2 妙手 ERP

妙手 ERP 相关文章里提到 TikTok 订单处理场景：

- 已授权平台订单会汇总到订单处理界面
- 可筛选 TikTok 平台和店铺
- TikTok 订单可添加筛选项，例如物流类型、是否样品订单、订单类型、发运类型
- 支持一键采购订单商品
- 采购单物流信息可自动同步
- 系统获取采购单物流信息后，自动录单至货代
- 后续可在“待打单发货”状态查看货代处理订单状态

另有资料宣传其 TikTok 链路覆盖：

- 货源采集
- 批量发布
- AI 达人建联
- 订单自动化处理
- 营销工具
- 数据统计
- 仓储管理

### 对 TK-SaaS 的影响

妙手可能已经覆盖了大量订单/发货/达人建联能力。TK-SaaS 的机会不是简单复制 ERP，而是做：

- 多来源数据看板
- 运营 SOP 规则引擎
- 售后/评价/库存的个性化提醒
- 话术与 AI 草稿
- 惠程荣达库存场景适配

### 来源

- 妙手 ERP - TikTok Shop 批量订单发货相关文章  
  https://erp.91miaoshou.com/blog/article_2931.html

---

### 5.3 易仓 ERP

易仓官网定位为跨境行业全生态链软件服务供应商，产品包括：

- 跨境电商 ERP
- 国际物流 TMS
- 海外仓 WMS
- 跨境分销 M2B
- 官网列出 TikTokERP 为热门产品之一

### 对 TK-SaaS 的影响

易仓偏中大型跨境团队，适合拿来对标“成熟系统长什么样”。如果目标是轻量 SaaS，不要一开始做成易仓那种大而全。

### 来源

- 易仓 ERP 官网  
  https://www.eccang.com/

---

## 6. 达人建联 / 红人 CRM 工具调研

### 6.1 Allymatic 阿力

Allymatic 定位为 TikTok Shop 团队的 AI 达人营销增长系统，覆盖：

- 达人筛选
- 达人管理
- 达人建联
- 达人分销
- 寄样跟进
- 内容追踪
- 销售归因
- ROI 复盘
- 达人 CRM
- AI 话术生成
- 寄样物流/内容交付提醒

### 对 TK-SaaS 的影响

达人模块如果要做，应该参考这类产品的结构：

- 达人线索
- 建联状态
- 寄样状态
- 内容状态
- GMV / ROI
- 复投建议

但第一阶段不一定自研完整达人系统。可以先做“马尾达人线索表 + 联系方式 + 建联草稿 + 跟进提醒”。

### 来源

- Allymatic 阿力  
  https://www.allymatic.com/

---

### 6.2 达秘 TikTok 达人建联工具

达秘相关页面宣传能力包括：

- TK 达人批量邀约
- 批量私信工具
- 多账号管理
- 自定义话术
- 达人挖掘、内容创意、效果追踪
- 800 万+达人库
- AI 生成话术
- 团队建联数据追踪

页面也宣传“每日可触达超 1 万带货达人”。

### 风险提醒

批量私信、超高频触达、自动群发这类能力非常容易踩 spam / 平台风控风险。TK-SaaS 不建议第一阶段做强自动化群发。

更安全的做法：

- 只保存公开联系方式
- 生成邮件/私信草稿
- 控制发送频率
- 记录 consent 和沟通历史
- 人工确认后发送

### 来源

- 达秘 TikTok 达人网红建联工具  
  https://www.yun88.com/product/9188.html

---

## 7. 惠程荣达 / 物流轨迹 / 库存平台

当前能公开查到的信息偏物流轨迹查询，不是完整库存 API。

51Tracking 支持惠程荣达：

- 惠程荣达物流查询
- API 查询接口
- 包裹状态提醒
- 表格批量导入单号
- 导出快递查询数据
- 支持 API & Webhooks
- 状态通知

### 对 TK-SaaS 的影响

需要和惠程荣达确认：

1. 是否有库存 API
2. 是否有订单/包裹 API
3. 是否支持定时导出 Excel/CSV
4. 是否能导出在途数量
5. 是否能导出 SKU 级库存
6. 是否有仓库/库位/批次字段

如果没有库存 API，MVP 可以先做：

```text
惠程荣达导出 Excel / CSV
        ↓
TK-SaaS 手动上传或自动读取
        ↓
与 TikTok SKU 库存表比对
        ↓
生成库存差异和备货表
```

### 来源

- 51Tracking 惠程荣达查询  
  https://www.51tracking.com/hcrd-tracking/

---

## 8. 低代码 / 自动化工作流

### 8.1 n8n

n8n 的电商订单自动化模板展示了一个通用流程：

- 电商平台通过 webhook 发送订单数据
- 自动发送客户确认邮件
- 自动发送团队通知
- 对不完整订单做错误处理
- 可接 Google Sheets 记录订单
- 可接 Slack 通知团队
- 可接物流服务生成面单
- 可接会计软件记录财务
- 可扩展库存提醒、订单状态跟进、短信通知等

### 对 TK-SaaS 的影响

n8n 适合做第一版自动化验证：

- Webhook 接订单
- HTTP 请求 TikTok API / ERP API
- 定时任务拉订单/库存/售后
- 飞书/Slack/邮件提醒
- Google Sheets/飞书表格落地
- 调用 AI 生成草稿

但如果后续要做 SaaS 产品，n8n 应该是内部流程引擎或 MVP 验证工具，不是最终核心产品。

### 来源

- n8n e-commerce order processing template  
  https://n8n.io/workflows/7518-automate-e-commerce-order-processing-with-email-notifications-and-webhooks/

---

## 9. 功能机会点拆解

### 9.1 订单模块机会

可做功能：

- TikTok 订单同步
- 订单状态归类
- 24 小时揽收倒计时
- M 店 ST&BW 当天联系待办
- 已送达 +3 天真实评价邀请待办
- 物流状态异常提醒
- 订单备注/客服记录
- 超时风险导出

不可乱做：

- 不建议自动乱发客户消息
- 不建议绕过 TikTok 流程
- 不建议从后台高频爬页面

---

### 9.2 售后模块机会

可做功能：

- 待退货解释提醒
- 已退货状态核查
- 争议证据 24 小时倒计时
- 申诉 21 天倒计时
- 证据清单生成
- 售后话术匹配
- 不合理退款申诉草稿

重点字段：

- order_id
- return_id
- refund_id
- dispute_status
- reason
- evidence_deadline
- appeal_deadline
- evidence_files
- chat_records
- suggested_action

---

### 9.3 评价模块机会

可做功能：

- 差评/中评/好评分类
- 待回复评价列表
- NRR 风险监控
- 差评原因分类：产品、物流、服务
- 回复草稿生成
- 客户视频证据跟进
- 上午：历史差评跟进
- 下午：新增评价处理

合规提醒：

- 不诱导好评
- 不返现换评
- 不要求改评/删评
- 不转移站外评价

---

### 9.4 库存模块机会

可做功能：

- 惠程荣达库存导入
- TikTok SKU 库存导入/同步
- 在途数量导入
- 安全库存配置
- 备货建议
- 上班/下班库存快照
- 库存差异提醒
- 备货表导出

关键公式：

```text
建议备货量 = max(0, 安全库存 + 近 N 日销量预测 - 当前可售库存 - 在途数量)
```

第一阶段可以不用复杂预测，先按固定安全库存：

```text
如果 当前可售库存 + 在途数量 < 安全库存
则 触发备货提醒
```

---

### 9.5 达人模块机会

可做功能：

- 马尾相关达人线索库
- 公开联系方式记录
- 达人分类：hair / beauty / ponytail / wig / extension / lifestyle
- 粉丝数、互动率、内容匹配度
- 建联状态
- 邮件/私信草稿
- 跟进提醒
- 寄样状态
- 内容发布状态
- GMV / ROI 复盘

风险控制：

- 不做高频批量私信
- 不自动从非公开来源抓隐私信息
- 不暴力访问主页
- 控制外联频率
- 人工确认后发送

---

## 10. 推荐落地路线更新版

### Phase 0：接口与数据源确认

- [ ] TikTok Shop 是否能申请 Open API 权限
- [ ] 是否已有 TikTok Shop App / Partner Center 账号
- [ ] 是否能使用官方 ttspc-server-sample 跑通授权
- [ ] 是否有 ERP：店小秘 / 妙手 / 易仓 / 其他
- [ ] 惠程荣达是否支持 API 或 CSV/Excel 导出
- [ ] Product Ratings 是否支持 CSV 导出
- [ ] 售后话术模板是否已整理
- [ ] 客服是否已设置 Saved Replies
- [ ] Customer Messages 是否已启用 Chatbot

### Phase 1：不依赖 API 的轻量 MVP

目标：哪怕没有 TikTok API 权限，也能先跑起来。

- [ ] 支持订单表导入
- [ ] 支持售后表导入
- [ ] 支持评价表导入
- [ ] 支持惠程荣达库存表导入
- [ ] 生成订单超时看板
- [ ] 生成售后工单看板
- [ ] 生成库存差异表
- [ ] 生成评价处理清单
- [ ] 支持话术模板库

### Phase 2：API/ERP 接入版

目标：减少人工导表。

- [ ] TikTok Shop 授权
- [ ] 同步订单
- [ ] 同步商品/SKU
- [ ] 同步库存
- [ ] 同步售后/退货
- [ ] 同步物流状态
- [ ] 接入 ERP 数据
- [ ] 接入飞书/企微/邮件通知

### Phase 3：AI 运营助手

目标：AI 不直接执行高风险动作，而是生成草稿和建议。

- [ ] AI 生成客服回复草稿
- [ ] AI 生成差评回复草稿
- [ ] AI 生成售后解释草稿
- [ ] AI 生成申诉证据清单
- [ ] AI 生成达人建联邮件
- [ ] AI 给达人匹配度评分
- [ ] AI 生成每日运营日报

### Phase 4：达人增长模块

- [ ] 达人线索库
- [ ] 马尾相关关键词规则
- [ ] 联系方式管理
- [ ] 建联状态跟踪
- [ ] 寄样状态跟踪
- [ ] 内容发布状态
- [ ] GMV / ROI 复盘

---

## 11. 建议新增文档

后续仓库可以继续拆：

```text
docs/
  research/
    tiktok-shop-automation-research.md
  specs/
    orders.md
    aftersales.md
    reviews.md
    inventory.md
    creators.md
  compliance/
    review-policy-checklist.md
    customer-message-checklist.md
  templates/
    customer-service-scripts.md
    creator-outreach-scripts.md
  api/
    tiktok-shop-api-spike.md
    hcrd-integration-spike.md
```

---

## 12. 当前最推荐的下一步

优先写 4 个 PRD / Spec：

1. `docs/specs/orders.md`：订单超时雷达
2. `docs/specs/aftersales.md`：售后工单池
3. `docs/specs/inventory.md`：库存核对与备货表
4. `docs/specs/reviews.md`：评价处理看板

然后再开始搭前端页面，不然很容易一边写代码一边改需求。