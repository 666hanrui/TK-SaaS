# TK-SaaS 应用层实际执行计划

> 日期：2026-07-06  
> 阶段：MVP 应用层落地  
> 目标：把前期调研转成可以开始开发的应用层方案。第一版只做数据中控、风险提醒、待办流、话术草稿和人工确认，不做高风险自动执行。

> **方向更新（2026-07-07）：** 当前目标已升级为正常路径全流程自动执行，提醒只服务于异常处理。本文件保留早期应用层设计；发货模块以 [shipping-execution-automation.md](./shipping-execution-automation.md) 为当前执行规格。

---

## 1. 应用层定位

TK-SaaS 第一版是一个 TikTok Shop 店铺运营中控台，不是完整 ERP，也不是浏览器自动操作工具。

第一版重点解决：

- 哪些订单接近 24 小时揽收风险
- M 店 ST&BW 订单是否当天联系客户
- 哪些订单已送达 3 天，可以生成真实体验反馈邀请待办
- 哪些售后需要解释、核查、整理证据或人工申诉
- 哪些差评/中评/好评待回复
- 哪些差评需要视频或图片证据
- 哪些 SKU 的 TikTok 库存和惠程荣达实际库存不一致
- 哪些 SKU 需要备货
- 哪些达人线索可以进入后续建联流程

核心原则：

```text
导入先行，API 后接
提醒先行，执行后置
草稿先行，人工确认
惠程荣达库存为准
高风险动作不自动执行
```

---

## 2. MVP 模块范围

| 模块 | 页面 | 第一版目标 |
|---|---|---|
| Dashboard | 首页仪表盘 | 展示今日风险、待办、关键指标 |
| Imports | 数据导入中心 | 支持 CSV/Excel 导入订单、库存、售后、评价数据 |
| Inventory | 库存核对 | 用惠程荣达库存校对 TikTok SKU 库存，生成差异和备货建议 |
| Orders | 订单超时雷达 | 识别 24h 揽收风险、M 店 ST&BW 联系待办、送达 3 天真实反馈邀请待办 |
| Aftersales | 售后工单池 | 退货、退款、争议、证据清单、人工申诉待办 |
| Reviews | 评价处理看板 | 差评、中评、待回复好评、视频证据跟进 |
| Templates | 话术模板库 | 管理售后、评价、证据索要、真实反馈邀请、达人建联模板 |
| Creators | 达人线索库 | 第一版只做线索记录和草稿，不做自动外联 |
| Settings | 设置 | 店铺、SKU、安全库存、状态映射、通知配置 |

---

## 3. 暂不做的能力

| 能力 | 暂不做原因 |
|---|---|
| 浏览器自动操作 TikTok 后台 | 平台风控和稳定性风险高 |
| 高风险消息自动发送 | 需要确认平台政策、接口权限和触达限制 |
| 退款申诉自动提交 | 必须人工确认，避免误操作 |
| 评价诱导类功能 | 不符合合规方向，统一改为真实体验反馈邀请 |
| 达人高频触达 | 第一版只做线索管理和草稿 |
| 账号健康评分自动处理 | 用户已说明任务 4 暂时不做 |
| 多租户计费系统 | MVP 先做内部工具 |

---

## 4. 推荐技术栈

### 4.1 推荐方案

```text
Frontend: React + Vite + TypeScript + Tailwind CSS
UI: shadcn/ui 或 Ant Design
Backend: FastAPI
Database: PostgreSQL
Task Jobs: APScheduler / Celery
File Import: pandas + openpyxl
AI Layer: 可插拔 LLM Provider
Notification: 飞书 / 企业微信 / 邮件，先预留接口
```

推荐原因：

- 库存表、备货表、CSV/Excel 处理较多，Python 更方便。
- FastAPI 轻量，适合快速做内部系统。
- 前端用 React + Vite 启动快，后续也方便扩展成 SaaS。

### 4.2 目录结构

```text
TK-SaaS/
  apps/
    web/
      src/
        pages/
          dashboard/
          imports/
          inventory/
          orders/
          aftersales/
          reviews/
          creators/
          templates/
          settings/
        components/
          layout/
          table/
          upload/
          drawer/
          badges/
        lib/
        types/
    api/
      app/
        main.py
        core/
        modules/
          dashboard/
          imports/
          inventory/
          orders/
          aftersales/
          reviews/
          creators/
          templates/
          tasks/
          ai/
        adapters/
          csv_import/
          tiktok_shop/
          hcrd/
          erp/
        jobs/
        tests/
  docs/
  scripts/
```

---

## 5. 页面路由

| 路由 | 页面 | 说明 |
|---|---|---|
| `/` | Dashboard | 今日待办和风险总览 |
| `/imports` | 数据导入中心 | 上传和解析 CSV/Excel |
| `/inventory` | 库存核对 | 惠程荣达库存 vs TikTok 库存 |
| `/orders` | 订单超时雷达 | 揽收风险、客户联系、真实反馈邀请待办 |
| `/aftersales` | 售后工单池 | 售后状态、证据清单、申诉窗口 |
| `/reviews` | 评价处理看板 | 差评、中评、好评回复、证据跟进 |
| `/creators` | 达人线索库 | 线索记录、匹配度、草稿 |
| `/templates` | 话术模板库 | 模板增删改查和变量预览 |
| `/settings` | 设置 | 店铺、SKU、安全库存、状态映射 |

统一布局：

```text
左侧 Sidebar
顶部 Topbar
主内容区
右侧详情 Drawer
```

---

## 6. 统一待办系统

第一版最重要的是 `tasks` 统一待办表。订单、库存、售后、评价、达人模块都只负责生成待办，Dashboard 统一展示。

### 6.1 tasks 表字段

| 字段 | 说明 |
|---|---|
| id | 待办 ID |
| source_type | order / inventory / aftersales / review / creator |
| source_id | 来源记录 ID |
| title | 标题 |
| description | 描述 |
| priority | low / medium / high / urgent |
| status | open / processing / done / skipped |
| due_at | 截止时间 |
| suggested_action | 建议动作 |
| created_at | 创建时间 |
| updated_at | 更新时间 |

### 6.2 待办示例

```text
[紧急] 订单距离 24h 揽收截止还有 1 小时
[高] 售后争议需要在 24h 内整理证据
[中] TikTok 库存高于惠程荣达实际库存，存在超卖风险
[中] 订单已送达 3 天，可生成真实体验反馈邀请草稿
[低] 新增好评待回复
```

---

## 7. Imports 数据导入中心

### 7.1 第一版为什么先做导入

API 权限、惠程荣达接口、ERP 对接都需要验证。为了让项目先跑起来，第一版必须支持 CSV/Excel 导入。

支持导入：

- 订单表
- 惠程荣达库存表
- TikTok SKU 库存表
- 售后表
- 评价表
- 在途数量表

### 7.2 导入流程

```text
上传文件
  ↓
识别类型
  ↓
字段映射
  ↓
数据预览
  ↓
错误检查
  ↓
确认导入
  ↓
生成导入批次
  ↓
触发规则计算
```

### 7.3 import_batches 表

| 字段 | 说明 |
|---|---|
| id | 导入批次 ID |
| import_type | orders / hcrd_inventory / tiktok_inventory / aftersales / reviews |
| filename | 文件名 |
| total_rows | 总行数 |
| success_rows | 成功行数 |
| failed_rows | 失败行数 |
| error_report | 错误报告 |
| imported_at | 导入时间 |

### 7.4 验收标准

- 能上传 CSV/Excel
- 能做字段映射
- 能预览数据
- 能显示错误行
- 能保存导入批次
- 导入后能触发对应模块规则

---

## 8. Inventory 库存核对模块

### 8.1 业务原则

```text
惠程荣达库存 = 实际库存源
TikTok 库存 = 平台展示库存
TK-SaaS = 校对、预警、备货建议
```

### 8.2 第一版功能

- 上传惠程荣达库存表
- 上传 TikTok SKU 库存表
- 上传/录入在途数量
- SKU 映射
- 库存差异对比
- 超卖风险提醒
- 安全库存配置
- 备货建议
- 上班/下班库存快照
- 备货表导出

### 8.3 规则

```text
如果 TikTok 可售库存 > 惠程荣达实际库存：
    生成超卖风险待办
```

```text
如果 惠程荣达实际库存 < 安全库存：
    生成低库存待办
```

```text
如果 惠程荣达实际库存 + 在途数量 < 安全库存：
    生成备货待办
```

```text
建议备货量 = max(0, 安全库存 - 惠程荣达实际库存 - 在途数量)
```

### 8.4 页面字段

| 字段 | 说明 |
|---|---|
| sku | SKU |
| product_name | 商品名 |
| hcrd_stock | 惠程荣达实际库存 |
| tiktok_stock | TikTok 可售库存 |
| in_transit_stock | 在途数量 |
| safety_stock | 安全库存 |
| stock_diff | 库存差异 |
| risk_type | 风险类型 |
| suggested_restock_qty | 建议备货数量 |
| last_checked_at | 最近核对时间 |

### 8.5 第一版 Demo

最小可展示 Demo：

```text
上传惠程荣达库存表 + TikTok 库存表
        ↓
按 SKU 自动对齐
        ↓
生成库存差异表
        ↓
Dashboard 出现低库存/超卖风险待办
        ↓
导出备货表
```

---

## 9. Orders 订单超时雷达

### 9.1 第一版功能

- 订单表导入
- 订单状态映射
- M 店 ST&BW 识别
- 24 小时揽收风险
- 客户联系待办
- 送达 3 天真实体验反馈邀请待办
- 订单详情 Drawer

### 9.2 内部状态

```text
PAID
READY_TO_SHIP
SHIPPED
PICKED_UP
IN_TRANSIT
DELIVERED
COMPLETED
CANCELLED
UNKNOWN
```

### 9.3 规则

```text
如果订单已支付但未揽收：
- 付款后 16 小时：普通提醒
- 付款后 20 小时：高优先级提醒
- 付款后 23 小时：紧急提醒
- 超过 24 小时：标记为超时风险
```

```text
如果店铺 = M 店，且产品线 = ST 或 BW：
    下单当天生成客户联系待办
```

```text
如果订单状态 = DELIVERED：
    记录 delivered_at
    设置 feedback_invite_due_at = delivered_at + 3 天
```

```text
如果当前时间 >= feedback_invite_due_at：
    生成真实体验反馈邀请待办
    生成合规话术草稿
    默认人工确认
```

### 9.4 验收标准

- 能导入订单表并展示
- 能识别 M 店 ST&BW
- 能计算 24h 揽收风险
- 能在送达 3 天后生成真实体验反馈邀请待办
- 能生成合规草稿，不自动发送

---

## 10. Aftersales 售后工单池

### 10.1 第一版功能

- 售后数据导入
- 状态分类
- 待退货解释提醒
- 已退货核查提醒
- 争议证据倒计时
- 申诉窗口提醒
- 证据清单生成
- 售后话术草稿生成

### 10.2 看板列

```text
待解释
待买家退货
已退货待核查
疑似异常退款
争议证据待整理
申诉窗口内
已完成
```

### 10.3 规则

```text
如果售后状态 = 待退货：
    匹配退货解释模板
    生成客户提醒草稿
```

```text
如果售后状态 = 已退货：
    生成退货核查待办
```

```text
如果争议开启：
    生成 24h 证据整理倒计时
    生成证据清单
```

```text
如果仍在申诉窗口：
    生成申诉提醒
    生成申诉草稿
    必须人工确认
```

### 10.4 证据清单

- 订单信息
- 物流妥投证明
- 客户沟通记录
- 商品详情说明
- 出库记录
- 退货包裹照片/视频
- 仓库验货结果
- 平台判决信息

---

## 11. Reviews 评价处理看板

### 11.1 第一版功能

- 评价数据导入
- 差评/中评/好评分类
- 待回复评价列表
- 差评视频/图片证据跟进
- 回复草稿生成
- 合规敏感词检查

### 11.2 规则

```text
rating <= 2：差评，优先处理
rating = 3：中评，普通处理
rating >= 4 且未回复：待回复好评
```

```text
如果评价内容包含破损、坏了、掉发、颜色不对、尺寸不对、未收到等问题：
    生成证据跟进待办
```

### 11.3 合规检查

话术草稿需要检查：

- 是否诱导正面评价
- 是否要求客户修改评价
- 是否承诺额外利益
- 是否引导客户离开平台流程
- 是否包含不合规词汇

命中风险后：

```text
阻断草稿 → 显示原因 → 要求人工修改
```

---

## 12. Templates 话术模板库

### 12.1 模板类型

| 类型 | 用途 |
|---|---|
| return_explain | 退货解释 |
| return_reminder | 退货提醒 |
| refund_dispute | 退款争议说明 |
| review_negative_reply | 差评回复 |
| review_positive_reply | 好评回复 |
| request_evidence | 索要视频/图片证据 |
| honest_feedback_invite | 真实体验反馈邀请 |
| creator_outreach | 达人建联草稿 |

### 12.2 模板字段

| 字段 | 说明 |
|---|---|
| id | 模板 ID |
| type | 模板类型 |
| name | 模板名称 |
| language | zh / en |
| content | 内容 |
| variables | 变量 |
| risk_level | 风险等级 |
| enabled | 是否启用 |

---

## 13. 后端 API 草案

### Dashboard

```text
GET /api/dashboard/summary
GET /api/dashboard/tasks
```

### Imports

```text
POST /api/imports/upload
POST /api/imports/preview
POST /api/imports/confirm
GET /api/imports/batches
GET /api/imports/{id}/errors
```

### Inventory

```text
GET /api/inventory
POST /api/inventory/import-hcrd
POST /api/inventory/import-tiktok
POST /api/inventory/reconcile
GET /api/inventory/restock-sheet
PATCH /api/inventory/{sku}/safety-stock
```

### Orders

```text
GET /api/orders
GET /api/orders/{id}
POST /api/orders/import
POST /api/orders/{id}/generate-feedback-draft
PATCH /api/orders/{id}/feedback-status
```

### Aftersales

```text
GET /api/aftersales
GET /api/aftersales/{id}
POST /api/aftersales/import
POST /api/aftersales/{id}/generate-script
POST /api/aftersales/{id}/generate-evidence-checklist
PATCH /api/aftersales/{id}/status
```

### Reviews

```text
GET /api/reviews
POST /api/reviews/import
POST /api/reviews/{id}/generate-reply-draft
PATCH /api/reviews/{id}/status
```

### Templates

```text
GET /api/templates
POST /api/templates
PATCH /api/templates/{id}
DELETE /api/templates/{id}
POST /api/templates/{id}/preview
```

---

## 14. 数据表第一版

```text
shops
products
skus
orders
order_events
inventory_snapshots
inventory_reconcile_results
after_sales_cases
reviews
creators
message_templates
tasks
import_batches
ai_drafts
operation_logs
```

最重要的是：

- `tasks`：统一待办
- `import_batches`：导入批次
- `inventory_reconcile_results`：库存核对结果
- `ai_drafts`：AI 草稿和合规检查结果
- `operation_logs`：人工处理记录

---

## 15. 7 天执行计划

### Day 1：项目骨架

- 创建 React + Vite 前端
- 创建 FastAPI 后端
- 配置 PostgreSQL
- 创建基础 README 运行说明

### Day 2：应用壳

- 左侧导航
- 顶部栏
- Dashboard 空状态
- 表格组件
- 风险 Badge
- 详情 Drawer

### Day 3：导入中心

- 文件上传
- CSV/Excel 解析
- 字段映射
- 数据预览
- 导入批次记录

### Day 4：库存模块

- 惠程荣达库存导入
- TikTok 库存导入
- SKU 对齐
- 差异表
- 备货建议
- Dashboard 风险待办

### Day 5：订单模块

- 订单导入
- 状态映射
- 24h 揽收风险
- M 店 ST&BW 识别
- 送达 3 天真实体验反馈邀请待办

### Day 6：售后与评价初版

- 售后导入和分类
- 评价导入和分类
- 差评待办
- 售后证据清单

### Day 7：模板库和草稿

- 话术模板 CRUD
- 模板变量替换
- 草稿生成占位接口
- 合规检查占位
- 整理下一步任务

---

## 16. 第一版验收标准

- [ ] 能打开 Dashboard 看到今日待办和风险数量
- [ ] 能导入订单表
- [ ] 能识别 24h 揽收风险
- [ ] 能识别 M 店 ST&BW 订单
- [ ] 能生成送达 3 天真实体验反馈邀请待办
- [ ] 能导入惠程荣达库存表和 TikTok 库存表
- [ ] 能生成库存差异表
- [ ] 能识别超卖风险和低库存风险
- [ ] 能导出备货表
- [ ] 能导入售后表并分类
- [ ] 能导入评价表并分类
- [ ] 能生成评价/售后处理草稿
- [ ] 能配置话术模板
- [ ] 能做基础合规检查

---

## 17. 建议创建的 GitHub 任务

1. App Shell：创建前后端项目骨架和基础路由
2. Imports：实现 CSV/Excel 导入中心
3. Inventory：实现惠程荣达库存校对 TikTok 库存
4. Orders：实现 24h 揽收雷达和送达 3 天真实体验反馈待办
5. Aftersales：实现售后工单池和证据倒计时
6. Reviews：实现评价处理看板和证据跟进
7. Templates：实现话术模板库和合规检查
8. AI Drafts：实现草稿生成占位接口

---

## 18. 下一步执行建议

最小可展示 Demo：

```text
上传惠程荣达库存表 + TikTok 库存表
        ↓
系统按 SKU 自动对齐
        ↓
生成库存差异表
        ↓
Dashboard 出现低库存/超卖风险待办
        ↓
导出备货表
```

这个 Demo 最适合作为第一阶段突破口，因为它不依赖 TikTok API，也不涉及客户消息合规风险。
