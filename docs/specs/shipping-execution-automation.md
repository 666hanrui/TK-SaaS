# TK-SaaS 全自动发货执行规格

> 日期：2026-07-07
>
> 状态：首个纵向切片已实现（dry-run），待真实账号和模板校准

## 1. 目标

正常订单不产生人工待办，系统自动完成：

```text
TikTok 待发货订单
→ 安排发货
→ 下载并按物流单号命名面单 PDF
→ 确定性 SKU 映射
→ 生成惠程荣达上传 Excel
→ 上传并验证 WMS 订单
→ 上传交接面单 PDF/ZIP
→ 标记完成
```

人工只处理以下异常：

- 验证码或账号安全验证
- SKU 无确定映射
- TikTok/WMS 页面结构变化
- 平台返回不可自动判断的业务错误
- 订单关键信息不完整

## 2. 执行状态机

```text
DISCOVERED
ARRANGED_ON_TIKTOK
LABEL_DOWNLOADED
SKU_MAPPED
EXCEL_GENERATED
WMS_ORDER_UPLOADED
WMS_ORDER_VERIFIED
LABEL_UPLOADED
COMPLETED
```

运行状态独立记录：

```text
queued
running
completed
failed_retryable
manual_intervention_required
```

失败时保留最后一个成功业务状态。再次执行同一任务会从断点继续，不重复完成之前的写操作。

## 3. 幂等规则

- `platform_order_id` 是发货任务唯一键。
- 已完成任务再次被扫描时直接返回完成结果。
- TikTok 安排发货成功后立即持久化物流单号。
- WMS 上传后必须按客户单号和物流单号查询确认。
- 面单上传成功后才允许进入 `COMPLETED`。

## 4. SKU 映射规则

匹配顺序：

1. 订单已经携带明确内部产品编号。
2. 平台 SKU 精确匹配 `product.xls/xlsx/csv`。
3. 变体名或产品名完整标准化后精确匹配。
4. 无结果时进入人工异常队列。

禁止使用模糊匹配或 AI 猜测产品编号完成真实发货。赠品也必须拥有独立映射。

## 5. 执行适配器

```text
TikTokShippingAdapter
├── API adapter（后续）
├── Playwright adapter
└── Dry-run adapter

WmsShippingAdapter
├── API adapter（后续）
├── Playwright adapter
└── Dry-run adapter
```

管理台和 n8n 不直接操作外部平台。所有外部写操作统一通过执行 API，以保证状态、重试、幂等和审计日志一致。

## 6. 当前实现

- FastAPI 执行 API
- SQLite 任务及事件日志
- CSV/XLS/XLSX SKU 映射读取
- 惠程荣达 Excel 生成器
- 面单 PDF 标准化命名
- TikTok/WMS dry-run adapter
- TikTok/WMS Playwright adapter 初版
- 每 5 分钟 n8n 自动扫描工作流
- 管理台“启动自动化”连接真实执行 API

## 7. 真实环境启用条件

- 一份脱敏后的真实 `product.xls`
- 惠程荣达标准导入模板 `.xlsx`
- TikTok 测试店铺或允许验证的订单
- 惠程荣达测试账号
- 两个平台的实际页面 URL
- 至少包含单商品、赠品、多个商品的测试订单

启用前先使用有界测试订单校准 DOM 定位器，完成后再逐步扩大到真实批量订单。

完整人工动作、真实面单和表格字段分析见 [full-shipping-operation-analysis.md](../research/full-shipping-operation-analysis.md)。
