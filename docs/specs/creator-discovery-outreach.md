# 达人筛选与联系：技术实现方案

> 日期：2026-07-06  
> 模块：Creators / Affiliate / Outreach  
> 目标：实现“找马尾相关红人 → 评估匹配度 → 获取公开联系方式 → 生成建联草稿 → 人工确认跟进”的应用层能力。  
> 原则：先做线索库和任务流，不做高风险自动群发；优先官方 API、官方 Seller Center 和公开联系方式；所有外联动作可审计、可限频、可人工确认。

---

## 1. 结论先行

达人模块技术上可以做，但不能直接设计成“自动批量找人 + 自动批量私信”。更稳的实现路线是：

```text
达人数据源接入
  ↓
达人标准化入库
  ↓
类目 / 关键词 / 内容相关性筛选
  ↓
匹配度评分
  ↓
人工复核
  ↓
生成建联草稿
  ↓
人工确认发送
  ↓
跟进状态和合作结果复盘
```

第一版 MVP 应该做：

1. 达人线索表
2. 批量导入达人 CSV/Excel
3. 关键词和类目筛选
4. 匹配度评分
5. 联系方式管理
6. 建联草稿生成
7. 跟进状态管理
8. 限频和冷却规则
9. 人工确认流

第二阶段再接：

1. TikTok Shop Affiliate API
2. TikTok Shop Creator Marketplace / Seller Center 导出
3. 官方邀约接口或官方工作台跳转
4. 达人合作 GMV / ROI 复盘

---

## 2. 数据来源分层

### 2.1 第一层：手动录入 / CSV / Excel 导入

这是第一版最现实的数据源。

可导入字段：

| 字段 | 说明 |
|---|---|
| platform | TikTok / Instagram / YouTube |
| profile_url | 达人主页 |
| handle | 达人账号 |
| display_name | 昵称 |
| bio | 简介 |
| followers | 粉丝数 |
| avg_views | 平均播放 |
| avg_likes | 平均点赞 |
| avg_comments | 平均评论 |
| category | 类目 |
| region | 地区 |
| language | 语言 |
| contact_email | 公开邮箱 |
| contact_whatsapp | 公开 WhatsApp |
| source | 来源：手动 / Seller Center / API / 第三方 |
| notes | 备注 |

优点：

- 不依赖 API 权限
- 不碰平台风控
- 可以马上做 Demo
- 适合运营同学先把现有达人名单导进去

---

### 2.2 第二层：TikTok Shop Affiliate API / 官方 Seller Center

官方 Partner Center 确实有 Affiliate Seller API 文档入口，但页面内容需要登录和 JavaScript 渲染，公开页面只能确认文档入口存在，不能确认当前店铺一定有全部 scope、端点和字段权限。因此这层要做成 Adapter，而不是 MVP 的硬依赖。

需要验证：

- 是否能搜索达人列表
- 是否支持按类目筛选，例如 Hair Extensions & Wigs
- 是否支持按地区、粉丝量、GMV、内容类目筛选
- 是否返回公开联系方式
- 是否允许保存联系方式
- 是否有官方邀约或消息接口
- 是否有速率限制
- 是否需要服务商资质或特定国家/地区店铺

技术任务：

```text
spike: TikTok Shop Affiliate API 权限验证
```

验收标准：

- [ ] 能登录 Partner Center
- [ ] 能创建/绑定 App
- [ ] 能看到 Affiliate Seller API scope
- [ ] 能完成 OAuth 授权
- [ ] 能调用至少一个达人列表/搜索相关接口
- [ ] 能确认返回字段
- [ ] 能确认联系方式字段是否存在
- [ ] 能确认接口限流
- [ ] 能确认是否有官方邀约/消息接口

---

### 2.3 第三层：公开主页联系方式

如果达人主页公开留下邮箱、WhatsApp、Instagram、Linktree 等联系方式，可以作为线索记录。

但必须注意：

- 只记录公开可见的信息
- 不抓取非公开数据
- 不绕过登录权限
- 不高频爬取
- 不保存敏感私人信息
- 联系时保留来源字段和时间
- 对方拒绝后进入 suppression list，不再触达

---

## 3. 达人筛选逻辑

目标是找“马尾 / 假发 / 接发 / 发片 / 美发 / 发饰”相关达人，尤其是适合 ST&BW 产品线的内容创作者。

### 3.1 关键词词库

英文关键词：

```text
ponytail
hair extension
hair extensions
wig
wigs
drawstring ponytail
clip in ponytail
synthetic ponytail
hair piece
hair pieces
hair tutorial
hairstyle
hair styling
beauty
beauty creator
hair transformation
protective hairstyle
```

中文运营标签：

```text
马尾
假发
接发
发片
发包
美发
发型教程
发型变装
发饰
夹子马尾
高马尾
蓬松马尾
```

类目标签：

```text
Hair Extensions & Wigs
Beauty & Personal Care
Hair Care & Styling
Fashion Accessories
```

### 3.2 初筛条件

第一版建议用保守规则，不要太复杂：

```text
必须满足：
- 内容或类目和 hair / beauty / wig / ponytail 相关
- 最近 30-60 天有更新
- 主页或官方 API 中存在可联系渠道，或者可通过官方邀约触达

优先满足：
- 有 TikTok Shop affiliate 经验
- 有产品展示/开箱/教程类内容
- 平均播放稳定
- 评论区有真实互动
- 内容风格适合马尾产品
```

### 3.3 排除条件

```text
排除：
- 明显非美发/美妆/时尚内容
- 长期未更新
- 账号疑似搬运/低质内容
- 联系方式不可用
- 已明确拒绝合作
- 已进入黑名单/抑制名单
- 内容风险高，例如成人、违禁、争议类内容
```

---

## 4. 匹配度评分模型

第一版不用上机器学习，先用规则评分。后续数据量变大后，再训练模型或用 LLM 做辅助分类。

总分 100 分：

| 维度 | 分值 | 说明 |
|---|---:|---|
| 内容相关性 | 30 | bio、标题、标签、类目是否和马尾/假发/美发强相关 |
| 带货适配度 | 25 | 是否有 TikTok Shop / affiliate / product review / unboxing 经验 |
| 互动质量 | 15 | 播放、点赞、评论、近期活跃度 |
| 受众匹配 | 15 | 地区、语言、年龄层、内容风格是否适合目标产品 |
| 联系可行性 | 10 | 是否有公开邮箱/WhatsApp/官方邀约入口 |
| 风险扣分 | -20 到 0 | 低质、疑似刷量、争议内容、重复触达、拒绝合作等 |

### 4.1 评分公式

```text
match_score =
  content_relevance_score * 0.30
+ commerce_fit_score * 0.25
+ engagement_score * 0.15
+ audience_fit_score * 0.15
+ contactability_score * 0.10
- risk_penalty
```

### 4.2 分层结果

| 分数 | 分层 | 动作 |
|---:|---|---|
| 80-100 | A 级 | 优先人工复核，优先建联 |
| 60-79 | B 级 | 放入待观察池，可低频建联 |
| 40-59 | C 级 | 暂存，不主动联系 |
| <40 | D 级 | 不建议合作 |
| 任意分但命中黑名单 | Blocked | 禁止触达 |

### 4.3 内容相关性评分

示例规则：

```text
如果类目 = Hair Extensions & Wigs：+15
如果 bio 包含 hair / wig / ponytail / beauty：+5 到 +10
如果最近内容标题/标签多次出现 ponytail / wig / hairstyle：+5 到 +10
如果内容是教程/开箱/测评/变装：+5
如果内容和美发完全无关：0
```

### 4.4 带货适配度评分

```text
有 TikTok Shop Showcase / Affiliate 记录：+10
有 product review / try on / unboxing 内容：+5 到 +10
有直播带货内容：+5
曾合作过类似 beauty / hair 产品：+5
```

### 4.5 联系可行性评分

```text
官方 API 返回可邀约入口：+10
主页公开邮箱：+8
主页公开 WhatsApp：+6
只有 Instagram / Linktree：+4
无公开联系方式：0
```

---

## 5. 数据库设计

### 5.1 creators

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 达人 ID |
| platform | string | TikTok / Instagram / YouTube |
| profile_url | string | 主页链接 |
| handle | string | 账号 handle |
| display_name | string | 昵称 |
| bio | text | 简介 |
| avatar_url | string | 头像 |
| region | string | 地区 |
| language | string | 语言 |
| category | string | 类目 |
| source | string | 来源 |
| source_ref | string | 来源引用，例如导入批次/API ID |
| status | string | new / reviewed / shortlisted / contacted / replied / rejected / blocked |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 5.2 creator_metrics

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 指标 ID |
| creator_id | uuid | 达人 ID |
| followers | int | 粉丝数 |
| avg_views | int | 平均播放 |
| avg_likes | int | 平均点赞 |
| avg_comments | int | 平均评论 |
| engagement_rate | decimal | 互动率 |
| recent_post_count | int | 近期发布数量 |
| sample_window_days | int | 统计窗口 |
| collected_at | datetime | 采集/导入时间 |

### 5.3 creator_contacts

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 联系方式 ID |
| creator_id | uuid | 达人 ID |
| contact_type | string | email / whatsapp / official_invite / instagram / linktree |
| contact_value | string | 联系方式 |
| source | string | 来源：profile / api / manual |
| is_public | boolean | 是否公开来源 |
| verified_status | string | unknown / valid / invalid |
| last_verified_at | datetime | 最近验证时间 |

### 5.4 creator_scores

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 评分 ID |
| creator_id | uuid | 达人 ID |
| content_relevance_score | int | 内容相关性 |
| commerce_fit_score | int | 带货适配度 |
| engagement_score | int | 互动质量 |
| audience_fit_score | int | 受众匹配 |
| contactability_score | int | 联系可行性 |
| risk_penalty | int | 风险扣分 |
| match_score | int | 总分 |
| grade | string | A / B / C / D / Blocked |
| reason | text | 评分原因 |
| scored_at | datetime | 评分时间 |

### 5.5 creator_outreach_tasks

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 任务 ID |
| creator_id | uuid | 达人 ID |
| campaign_id | uuid | 活动 ID |
| channel | string | email / official_invite / whatsapp / other |
| status | string | draft / pending_review / approved / sent / replied / no_response / skipped |
| priority | string | low / medium / high |
| due_at | datetime | 建议处理时间 |
| cooldown_until | datetime | 冷却截止 |
| assigned_to | string | 负责人 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 5.6 outreach_messages

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 消息 ID |
| task_id | uuid | 外联任务 ID |
| creator_id | uuid | 达人 ID |
| channel | string | 联系渠道 |
| subject | string | 邮件标题 |
| body | text | 消息正文 |
| language | string | 语言 |
| risk_level | string | low / medium / high |
| compliance_status | string | passed / needs_review / blocked |
| reviewed_by | string | 审核人 |
| reviewed_at | datetime | 审核时间 |
| sent_at | datetime | 发送时间 |

### 5.7 suppression_list

用于防止重复触达和骚扰。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 记录 ID |
| creator_id | uuid | 达人 ID |
| contact_value | string | 联系方式 |
| reason | string | refused / bounced / invalid / blocked / duplicate |
| created_at | datetime | 创建时间 |

---

## 6. API 设计

### 6.1 导入和搜索

```text
POST /api/creators/import
GET  /api/creators
GET  /api/creators/{id}
PATCH /api/creators/{id}
```

### 6.2 评分

```text
POST /api/creators/{id}/score
POST /api/creators/batch-score
GET  /api/creators/{id}/score
```

### 6.3 联系方式

```text
POST /api/creators/{id}/contacts
PATCH /api/creator-contacts/{id}
POST /api/creator-contacts/{id}/verify
```

### 6.4 外联任务

```text
POST /api/creator-outreach/tasks
GET  /api/creator-outreach/tasks
PATCH /api/creator-outreach/tasks/{id}
POST /api/creator-outreach/tasks/{id}/generate-draft
POST /api/creator-outreach/tasks/{id}/approve
POST /api/creator-outreach/tasks/{id}/mark-sent
POST /api/creator-outreach/tasks/{id}/mark-replied
POST /api/creator-outreach/tasks/{id}/skip
```

注意：第一版不做自动发送接口，只做 `mark-sent`，由运营人工从官方工作台或邮箱发送后回填状态。

### 6.5 活动 Campaign

```text
POST /api/creator-campaigns
GET  /api/creator-campaigns
GET  /api/creator-campaigns/{id}
PATCH /api/creator-campaigns/{id}
```

---

## 7. 页面设计

### 7.1 Creators 列表页

筛选器：

- 平台
- 地区
- 语言
- 类目
- 关键词
- 粉丝数区间
- 平均播放区间
- 匹配度分数
- 等级 A/B/C/D
- 是否有联系方式
- 是否已联系
- 是否回复
- 是否在黑名单/抑制名单

列表字段：

- 达人昵称
- handle
- 平台
- 地区
- 粉丝数
- 平均播放
- 类目
- 匹配度
- 等级
- 联系方式状态
- 建联状态
- 负责人

### 7.2 Creator Detail 达人详情页

展示：

- 基础信息
- 内容标签
- 指标快照
- 评分拆解
- 联系方式
- 外联历史
- 合作记录
- AI 建联草稿
- 操作日志

### 7.3 Outreach Queue 外联队列

列：

```text
待生成草稿
待人工审核
待发送
已发送待回复
已回复
已跳过
已拒绝
```

### 7.4 Campaign 活动页

例如：

```text
Campaign: ST&BW Ponytail Creator Outreach - US
目标产品：ST / BW 马尾产品线
目标类目：Hair Extensions & Wigs
目标达人：A/B 级美发类达人
目标地区：US / UK / CA
```

---

## 8. AI 草稿生成

### 8.1 输入

```text
达人信息：昵称、主页、类目、内容标签、公开简介
产品信息：ST/BW 产品卖点、适合人群、佣金/样品信息
合作方式：affiliate / sample / commission / official invite
语言：英文 / 中文
语气：专业、简洁、像真人，不要群发感
```

### 8.2 输出

```text
subject
body
personalization_points
risk_flags
```

### 8.3 草稿要求

必须包含：

- 为什么找他/她
- 产品和内容方向的匹配点
- 合作方式
- 简单清楚的下一步
- 不夸大收益
- 不要求虚假评价或虚假推荐
- 不要求隐瞒合作关系

禁止：

- 群发味太重
- 夸大收入承诺
- 虚假赞美
- 要求对方不披露合作
- 要求虚假测评
- 使用压迫式话术

---

## 9. 合规和风控

### 9.1 外联风控原则

```text
不高频触达
不重复触达
拒绝后不再触达
只用公开联系方式或官方渠道
发送前人工确认
保留操作日志
保留来源和时间
```

### 9.2 冷却规则

```text
同一达人 7 天内最多 1 次首次触达
无回复 5-7 天后最多 1 次跟进
最多跟进 2 次
拒绝后进入 suppression_list
联系方式无效后进入 suppression_list
```

### 9.3 审核规则

草稿进入人工审核前，检查：

- 是否包含夸大收益
- 是否要求不披露合作
- 是否包含敏感/违规承诺
- 是否包含不真实的个性化信息
- 是否联系过同一达人
- 是否在 suppression list

---

## 10. n8n / 工作流层设计

第一版可以不用 n8n 发送消息，但可以用 n8n 做定时任务和报告。

### 10.1 可做工作流

```text
WF-CREATOR-01：每日达人评分重算
WF-CREATOR-02：每日外联待办报告
WF-CREATOR-03：无回复跟进提醒
WF-CREATOR-04：联系方式验证结果汇总
WF-CREATOR-05：Campaign 周报
```

### 10.2 不建议第一版做的工作流

```text
自动批量发送达人私信
自动高频抓主页
自动绕过官方邀约限制
自动向未审核联系人发送消息
```

---

## 11. 第一版执行顺序

### Step 1：表结构

- [ ] creators
- [ ] creator_metrics
- [ ] creator_contacts
- [ ] creator_scores
- [ ] creator_campaigns
- [ ] creator_outreach_tasks
- [ ] outreach_messages
- [ ] suppression_list

### Step 2：导入中心支持达人表

- [ ] CSV/Excel 导入达人
- [ ] 字段映射
- [ ] 数据去重
- [ ] 联系方式格式校验

### Step 3：筛选和评分

- [ ] 关键词词库
- [ ] 类目标签词库
- [ ] 规则评分函数
- [ ] A/B/C/D 分层
- [ ] 评分原因解释

### Step 4：达人页面

- [ ] 达人列表
- [ ] 筛选器
- [ ] 匹配度排序
- [ ] 达人详情页
- [ ] 外联历史

### Step 5：外联任务流

- [ ] 生成外联任务
- [ ] 生成草稿
- [ ] 人工审核
- [ ] 标记已发送
- [ ] 标记已回复/拒绝/无效
- [ ] suppression list

### Step 6：Campaign

- [ ] 创建活动
- [ ] 选择目标产品线
- [ ] 批量加入 A/B 级达人
- [ ] 查看活动进度
- [ ] 输出活动日报/周报

---

## 12. 最小可展示 Demo

```text
上传一份达人 Excel
        ↓
系统识别 hair / ponytail / wig 相关达人
        ↓
给每个达人计算匹配度
        ↓
筛出 A 级达人
        ↓
生成建联草稿
        ↓
人工确认后标记为待发送
        ↓
Dashboard 出现达人外联待办
```

这个 Demo 不依赖 TikTok API，也不会触碰自动私信风险。

---

## 13. 后续接官方 API 的方式

后续如果 TikTok Shop Affiliate API 权限验证通过，新增 Adapter：

```text
apps/api/app/adapters/tiktok_shop_affiliate/
  client.py
  auth.py
  schemas.py
  creator_search.py
  creator_contact.py
  campaign.py
```

Adapter 只做数据同步和官方允许的动作。外联仍走任务流：

```text
官方 API 拉取达人
  ↓
标准化入库
  ↓
评分
  ↓
任务队列
  ↓
人工确认
  ↓
官方工作台 / 官方接口 / 邮件渠道处理
```

---

## 14. 关键判断

技术上最现实的方案不是“自动批量联系达人”，而是：

```text
达人 CRM + 筛选评分 + 草稿生成 + 人工确认 + 限频跟进 + 合作复盘
```

这样既能提高找红人的效率，又不把店铺账号和项目本身放到高风险区。