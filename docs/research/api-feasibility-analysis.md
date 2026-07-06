# TikTok Shop / 惠程荣达 API 可行性客观分析

> 日期：2026-07-06  
> 主题：对“TikTok Shop Affiliate API、Customer Service API、Order API、惠程荣达 WMS/ERP API 是否可直接用于自动化”的客观判断。  
> 结论先行：**方向可行，但原说法里有几处明显过度乐观，尤其是“完全免费”“可直接批量私信”“可直接自动催好评”“惠程荣达一定有公开库存 API”。第一阶段应按“API 优先、导出兜底、人工确认高风险动作”的方案设计。**

---

## 1. 总体判断

| 模块 | 原说法 | 客观判断 | 建议落地方式 |
|---|---|---|---|
| 惠程荣达 API | 惠程荣达有 WMS/ERP 开放平台 API，可索要文档和 API Key | **可能有，但公开资料暂不能确认库存 API。** 目前公开能确认的是 51Tracking 支持惠程荣达物流轨迹查询 API、批量导入导出、状态通知；不能等同于惠程荣达官方库存/WMS API。 | 先联系惠程荣达客服/技术确认；同时设计 Excel/CSV 导入兜底。实际库存以惠程荣达为准，用它校对 TikTok 库存。 |
| Affiliate API | TikTok 官方达人 API 完全免费，可 GetCreatorList / GetCreatorContactInfo | **方向可能可行，但“完全免费”和具体端点名需以 Partner Center 实际授权为准。** 公开页能确认 TikTok Shop Partner Center 存在 Affiliate Seller API 文档入口，但文档内容需要登录/JS 渲染，公开检索不能验证所有端点和权限。 | 做 API Spike：申请/登录 Partner Center，确认 app scope、地区、速率限制、端点和返回字段。 |
| 达人批量私信 | 利用 Affiliate Messaging API 自动批量发送邀约私信 | **高风险。** 即使存在官方消息/邀约接口，也不代表可以无限批量私信。需要确认是否是官方邀请、是否限制频率、是否需要达人授权、是否会被判 spam。 | 不做暴力群发。做“达人线索 + 草稿 + 队列 + 限频 + 人工确认/半自动发送”。 |
| Order API | 订单状态 DELIVERED 后记录时间，3 天后触发动作 | **技术上可行性高。** 但状态名、webhook 事件、字段名需按官方文档确认。 | 订单同步 + delivered_at 字段 + 定时任务。先 CSV/ERP 导入，后续接 API/Webhook。 |
| 送达 3 天后催评 | 通过客服 API 自动发好评邀约 | **表述必须改。** 不能“催好评”，只能邀请真实评价；不能返现、诱导五星、要求改评/删评、反复请求。客户消息政策也禁止未经同意的垃圾营销。 | 文案改为“欢迎分享真实使用体验”。建议人工确认或平台允许的合规触达，不做强营销式自动群发。 |
| Customer Service API 秒回 | Webhook 接收关键词，自动模板回复 | **部分可行。** 对入站客户问题做自动分类、推荐话术、草稿回复很适合；完全自动秒回要谨慎，因为 TikTok 的 24h Response Rate 对“有效回复”有要求，自动回复不一定计入人工响应率。 | AI/规则生成回复草稿 + 低风险 FAQ 可自动回复 + 高风险售后/退款/差评转人工。 |

---

## 2. 惠程荣达 API 可行性

### 2.1 目前能公开确认的信息

公开资料中，51Tracking 有“惠程荣达查询”页面，并明确写到：

- 支持全球物流一站查询
- 支持 API & Webhooks
- 支持表格导入、导出
- 支持设置物流状态通知
- 提供“惠程荣达物流 API 查询接口”

参考：

- https://www.51tracking.com/hcrd-tracking/

但这只能证明：

```text
惠程荣达物流轨迹 / 包裹状态查询 API 方向存在
```

不能直接证明：

```text
惠程荣达官方一定开放库存 API
惠程荣达一定开放 WMS 出入库 API
惠程荣达一定能给每个客户 API Key
惠程荣达的 API 能拿到 SKU 级实际库存 / 在途数量 / 批次 / 库位
```

### 2.2 客观结论

**惠程荣达库存 API：可能有，但不能直接假设一定有。**

因为很多仓储/货代系统会有内部 WMS/ERP，但它们的“开放能力”可能分三种：

1. **客户后台可导出 Excel/CSV**：最常见，技术门槛最低。
2. **对接 ERP 的私有接口**：需要商务/技术支持开通。
3. **标准开放平台 API**：有 API 文档、API Key、签名、回调、限流。

目前我们应该按“三层兜底”设计：

```text
第一层：惠程荣达官方 API / 私有接口
第二层：惠程荣达后台定时导出 Excel/CSV
第三层：人工下载库存表后上传 TK-SaaS
```

### 2.3 对当前项目的设计影响

用户补充：**实际库存信息以惠程荣达为准，用惠程荣达校对 TikTok 库存。**

因此库存模块的数据优先级应该是：

```text
惠程荣达实际库存 > TikTok Shop 前台/后台库存 > TK-SaaS 计算库存
```

也就是说：

- 惠程荣达是“真实库存源”
- TikTok Shop 是“销售平台库存”
- TK-SaaS 是“差异检测和提醒系统”

### 2.4 库存同步规则

建议规则：

```text
如果 惠程荣达实际库存 != TikTok SKU 库存：
    生成库存差异任务

如果 惠程荣达实际库存 < 安全库存：
    生成备货提醒

如果 TikTok SKU 库存 > 惠程荣达实际库存：
    标记为超卖风险

如果 惠程荣达实际库存 + 在途数量 < 安全库存：
    标记为补货风险
```

### 2.5 需要向惠程荣达确认的问题

联系惠程荣达客服/技术时，不要只问“有没有 API”，要直接问这些：

1. 是否支持 SKU 级库存查询 API？
2. 是否支持在途数量查询 API？
3. 是否支持入库单、出库单、调拨单、退货入库查询？
4. 是否支持按店铺/仓库/货主维度查询库存？
5. 是否支持 Webhook 通知库存变化？
6. 是否支持定时导出 Excel/CSV 到邮箱、FTP、OSS、SFTP？
7. API 鉴权方式是什么？API Key、签名、IP 白名单还是 OAuth？
8. 是否有调用频率限制？
9. 是否有测试环境？
10. 是否收费？按调用量、按店铺、按仓库，还是合同内免费？

---

## 3. TikTok Shop Affiliate API 可行性

### 3.1 关于“完全免费”

原说法：

> 官方达人 API 完全免费。

客观判断：

**不能直接这样写死。**

更准确的说法是：

```text
TikTok Shop Partner Center 存在开放 API / Affiliate Seller API 相关文档入口；API 本身通常不是按商业客服软件那样单独订阅收费，但实际能不能用、能用哪些 scope、是否限流、是否地区开放、是否需要服务商/商家身份审核，需要以 Partner Center 后台为准。
```

风险点：

- 需要 TikTok Shop Partner Center 账号
- 需要创建 App
- 需要店铺授权
- 需要申请对应 API scope
- 部分 API 可能只对服务商/特定区域/特定业务开放
- API 有 rate limit
- 某些能力可能会变更、下线或灰度开放
- “免费”不代表没有开发成本、审核成本、限流成本和违规成本

### 3.2 关于 GetCreatorList / GetCreatorContactInfo

原说法：

> 通过 GetCreatorList、GetCreatorContactInfo 批量筛选达人并拿公开联系方式。

客观判断：

**这个方向合理，但必须实测验证端点名、字段和权限。**

目前应该把它作为技术 Spike，而不是直接写入主流程。

Spike 验收标准：

```text
- 能登录 TikTok Shop Partner Center
- 能创建/绑定 App
- 能看到 Affiliate Seller API scope
- 能完成 OAuth 授权
- 能调用达人搜索/达人列表接口
- 能按类目或关键词筛选 Hair Extensions & Wigs / hair / beauty / ponytail 类达人
- 能确认是否返回公开邮箱 / WhatsApp / 联系方式
- 能确认联系方式字段是否允许存储和用于外联
- 能确认接口限流和分页规则
```

### 3.3 达人 API 的实际价值

如果能拿到官方达人接口，它的价值很高：

- 比爬达人主页更稳
- 可以按官方类目/标签筛选
- 可以拿到合作相关数据
- 可以减少人工搜达人
- 可以形成达人 CRM

但不能把它理解成“随便抓全网达人联系方式”。我们只能处理官方允许访问和使用的数据。

---

## 4. Affiliate Messaging API / 自动批量私信可行性

### 4.1 原说法风险

原说法：

> 利用 Affiliate Messaging API 写小脚本，直接向这些达人自动批量发送邀约私信，无需人工一个个点。

这句话的风险很大。

即使 TikTok Shop 存在达人邀约、联盟消息、建联相关 API，也不能推导出：

```text
可以无限量自动批量私信
可以无人工审核地批量邀约
可以绕过达人同意或平台限制
可以高频触达不被判 spam
```

### 4.2 客观判断

**可以做“自动化辅助建联”，不建议做“暴力批量私信机器人”。**

推荐分级：

| 级别 | 做法 | 风险 |
|---|---|---|
| L1 | 自动筛选达人、生成建联草稿、人工发送 | 低 |
| L2 | 自动生成发送队列，人工批量确认后发送 | 中低 |
| L3 | 低频、限额、可撤回的半自动发送 | 中 |
| L4 | 高频自动批量私信 | 高 |

### 4.3 建议设计

达人外联模块应设计成：

```text
达人筛选 → 达人入库 → AI 生成建联草稿 → 风险检查 → 人工确认 → 限频发送 → 记录状态 → 后续跟进
```

不要直接设计成：

```text
抓取达人 → 自动群发 → 等回复
```

### 4.4 必要的风控字段

达人表建议增加：

| 字段 | 说明 |
|---|---|
| contact_source | 联系方式来源：官方 API / 主页公开 / 手动录入 |
| contact_permission | 是否确认允许用于建联 |
| outreach_channel | 邮件 / TikTok 官方邀约 / WhatsApp / 其他 |
| outreach_status | 未联系 / 待确认 / 已发送 / 已回复 / 拒绝 / 无效 |
| last_contacted_at | 上次联系时间 |
| contact_count | 联系次数 |
| cooldown_until | 冷却截止时间 |
| risk_level | 低 / 中 / 高 |

---

## 5. Order API：M 店 ST&BW 订单跟踪可行性

### 5.1 原说法

> 通过 API 获取订单状态。当检测到订单状态变为 DELIVERED 时，脚本自动记录时间，3 天后触发下一个动作。

### 5.2 客观判断

**这部分是最靠谱、最适合优先做的。**

无论最终走哪种数据源，都可以实现：

1. TikTok Shop Order API / Webhook
2. ERP 订单同步
3. TikTok 后台导出订单表
4. 人工 CSV/Excel 上传

### 5.3 推荐实现

订单表增加字段：

| 字段 | 说明 |
|---|---|
| platform_order_id | TikTok 订单 ID |
| shop_code | 店铺代码，如 M 店 |
| product_line | 产品线，如 ST / BW |
| order_status | 订单状态 |
| paid_at | 支付时间 |
| shipped_at | 发货时间 |
| picked_up_at | 揽收时间 |
| delivered_at | 送达时间 |
| review_invite_due_at | 真实评价邀请触发时间 |
| review_invite_status | 未触发 / 待确认 / 已发送 / 跳过 |

规则：

```text
如果 shop_code = M，且 product_line in [ST, BW]：
    下单当天生成客户联系待办

如果 order_status = DELIVERED：
    delivered_at = 当前状态变更时间
    review_invite_due_at = delivered_at + 3 天

如果 当前时间 >= review_invite_due_at，且未发送过评价邀请：
    生成真实评价邀请待办
```

### 5.4 注意点

实际开发时不要写死 `DELIVERED`，要以 TikTok API 返回的真实枚举为准。不同 API 版本可能叫：

- DELIVERED
- COMPLETED
- PACKAGE_DELIVERED
- SIGNED
- RECEIVED

所以代码要做状态映射表：

```text
外部状态 → 内部标准状态
```

---

## 6. 送达 3 天后“催评”可行性

### 6.1 原说法

> 送达 3 天后自动向买家推送好评邀约话术。

### 6.2 客观判断

**技术上可能能做，合规上必须改。**

TikTok Shop Review Policy 明确禁止：

- 奖励换评价
- 诱导正面评价
- 要求改评/删评
- 只向满意客户索评
- 反复请求评价
- 将评价引导到站外渠道

因此 TK-SaaS 中不能使用：

```text
好评邀约
催好评
五星好评
好评返现
帮忙改好评
```

建议统一改成：

```text
真实评价邀请
使用体验反馈提醒
欢迎分享真实使用体验
```

### 6.3 推荐话术方向

合规一点的中文逻辑：

```text
您好，看到您的订单已经送达几天了。希望产品使用顺利。
如果您方便，欢迎在 TikTok Shop 分享真实的使用体验，您的反馈能帮助我们继续改进产品和服务。
如使用过程中有任何问题，也可以直接在订单页面联系我们。
```

英文逻辑：

```text
Hi, we noticed your order was delivered a few days ago. We hope everything is going well.
If convenient, you are welcome to share your honest experience on TikTok Shop. Your feedback helps us improve our products and service.
If you have any issue, please contact us through your order page.
```

### 6.4 是否能自动发送？

建议不要第一版直接自动发。

更稳的设计：

```text
系统生成“真实评价邀请待办”
        ↓
AI 生成合规话术
        ↓
合规检查器扫描敏感词
        ↓
人工确认发送
```

后续如果确认 TikTok 官方允许特定场景下的消息 API 发送，再做低频自动化。

---

## 7. Customer Service API / Webhook 自动模板回复可行性

### 7.1 原说法

> Webhook 接收客户消息。客户发来“退货、不合理退款、破损”等关键词时，脚本自动检索话术模板，通过 API 秒回客户。

### 7.2 客观判断

**入站消息自动分类和话术匹配非常可行；完全自动秒回要分场景。**

TikTok Shop Customer Messages 官方功能本身已经有：

- Chatbot
- AI Reply Recommendations
- Due soon / Overdue
- High Priority Folder
- Automated Updates
- Customer Insights

这说明“客服自动化”方向是被官方支持的，但它不等于所有消息都适合脚本自动回复。

### 7.3 为什么不能完全依赖自动回复？

TikTok 24-Hour Response Rate 规则里明确：

- 客户发起聊天后，24 小时内需要有效回复
- “Hi/Hello”不算有效回复
- 24h Response Rate 至少 90%
- 自动回复不一定计入人工 24 小时响应率
- 不能仅依赖 Chatbot，无法解决的问题仍要人工在 24 小时内处理

所以自动回复要分级：

| 场景 | 建议 |
|---|---|
| 物流查询、尺码说明、普通 FAQ | 可自动回复或半自动回复 |
| 退货流程说明 | 可自动生成模板，人工确认更稳 |
| 破损、质量问题 | 自动索要图片/视频证据，但转人工跟进 |
| 不合理退款 | 自动生成证据清单和申诉草稿，不自动提交 |
| 差评/情绪化投诉 | 不建议完全自动回复，应转人工 |
| 涉及退款金额、平台规则、争议判定 | 人工确认 |

### 7.4 推荐规则

```text
客户消息进入系统
        ↓
关键词 + AI 分类
        ↓
低风险 FAQ：自动建议 / 可自动回复
中风险售后：生成草稿 + 人工确认
高风险争议/差评：生成处理建议 + 人工处理
        ↓
24h 响应倒计时持续监控
```

---

## 8. 当前最真实的落地方案

### 8.1 不要把项目建立在“所有 API 都一定开放”的假设上

正确架构应该是：

```text
DataSource Adapter 数据源适配层
├── TikTok Shop API Adapter
├── ERP Adapter
├── 惠程荣达 API Adapter
├── CSV / Excel Import Adapter
└── Manual Input Adapter
```

这样即使 API 暂时拿不到，也能先通过导表跑起来。

### 8.2 第一阶段最稳的实现顺序

1. **库存模块**：以惠程荣达导出表为准，校对 TikTok SKU 库存。
2. **订单模块**：导入/同步订单，识别 M 店 ST&BW，计算送达 +3 天。
3. **售后模块**：入站售后分类，生成模板草稿和证据清单。
4. **评价模块**：只生成“真实评价邀请待办”和合规话术，不强制自动发送。
5. **达人模块**：先做线索库和建联草稿，不做全自动批量私信。

### 8.3 技术验证任务

#### Spike A：TikTok Shop API 权限验证

- [ ] 登录 Partner Center
- [ ] 创建 App
- [ ] 查看是否有 Order API scope
- [ ] 查看是否有 Customer Service API scope
- [ ] 查看是否有 Affiliate Seller API scope
- [ ] 查看是否有 Messaging / Invitation 类 API
- [ ] 确认是否收费
- [ ] 确认速率限制
- [ ] 确认地区限制
- [ ] 确认是否可以获取达人联系方式
- [ ] 确认是否可以向达人发送邀约
- [ ] 确认是否可以向买家主动发送消息

#### Spike B：惠程荣达数据源验证

- [ ] 联系惠程荣达客服/技术
- [ ] 索要 API 文档
- [ ] 确认是否支持库存查询
- [ ] 确认是否支持在途数量查询
- [ ] 确认是否支持 SKU 维度
- [ ] 确认是否支持定时导出
- [ ] 拿到一份真实库存 Excel 样例
- [ ] 设计库存字段映射

#### Spike C：合规消息验证

- [ ] 确认 TikTok Review Policy 最新要求
- [ ] 确认 Customer Service Policy 最新要求
- [ ] 确认是否允许订单送达后主动消息
- [ ] 确认评价邀请是否必须通过官方功能
- [ ] 确认哪些自动回复计入 24h Response Rate
- [ ] 设置敏感词拦截：好评、五星、返现、改评、删评、站外联系等

---

## 9. 对原补充信息的逐条修正版本

### 原说法 1

> 惠程荣达拥有自己的 WMS/ERP 开放平台 API。

修正：

> 惠程荣达作为仓储物流服务商，可能具备 WMS/ERP 对接能力，但公开资料暂不能确认其库存 API 文档。当前能公开确认的是惠程荣达物流轨迹可通过第三方 51Tracking 做 API 查询。库存 API 需要联系惠程荣达客服/技术确认；系统应同时支持 API 和 Excel/CSV 导入。

### 原说法 2

> TikTok 官方达人 API 完全免费。

修正：

> TikTok Shop Partner Center 存在 Affiliate Seller API 等官方开放接口方向，但是否免费、是否开放给当前店铺、是否有接口限流、是否需要 scope 审核，需要以 Partner Center 后台和官方协议为准。

### 原说法 3

> 可以通过 GetCreatorList、GetCreatorContactInfo 直接批量筛选并调取公开联系方式。

修正：

> 可以作为技术验证方向。需要确认接口是否存在、当前账号是否有权限、是否支持按类目筛选 Hair Extensions & Wigs、是否返回公开联系方式，以及这些联系方式是否允许用于外联和存储。

### 原说法 4

> 利用 Affiliate Messaging API 自动批量发送邀约私信。

修正：

> 自动邀约方向需要谨慎验证。即使存在官方邀约/消息接口，也应做限频、去重、冷却、人工确认和合规记录。不建议做高频自动批量私信。

### 原说法 5

> 送达 3 天后自动推送好评邀约话术。

修正：

> 可在送达 3 天后生成“真实评价邀请待办”，但文案必须中性，不能诱导好评、五星、返现、改评或删评。第一版建议人工确认发送。

### 原说法 6

> 客户说退货、不合理退款、破损时，自动模板秒回。

修正：

> 可做关键词/AI 分类和模板草稿。低风险 FAQ 可以自动回复，高风险售后、争议、退款、差评应人工确认。系统必须继续监控 24 小时有效回复率。

---

## 10. 最终结论

这套自动化整体方向是成立的，但要分清：

```text
能自动识别 ≠ 能自动发送
能拿到接口文档 ≠ 当前店铺一定有权限
公开联系方式 ≠ 可以无限批量触达
邀请评价 ≠ 催好评
物流 API ≠ 库存/WMS API
自动回复 ≠ 一定计入有效人工响应
```

最稳的项目路线：

```text
先做数据中控和提醒
再做 AI 草稿
再做人工确认流
最后在确认官方权限和政策允许后，再开放低风险自动执行
```

因此 TK-SaaS 的第一版应该继续坚持：

- 订单超时雷达
- 惠程荣达库存校对 TikTok 库存
- 售后工单池
- 评价处理看板
- 达人线索库
- 话术模板库
- 所有高风险发送动作人工确认
