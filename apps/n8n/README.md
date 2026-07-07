# TK-SaaS n8n Workflows

n8n 工作流目录。全自动发货工作流负责定时触发执行 API；其他工作流仍用于数据同步、风险检查和通知。

## 前置条件

- n8n 已安装并运行（默认 `http://localhost:5678`）
- TK-SaaS 后端 API 已启动（默认 `http://localhost:8000`）

## 工作流列表

| 文件 | 名称 | 触发 | 优先级 | 说明 |
|---|---|---|---|---|
| `00-shipping-execution-sweep.json` | 全自动发货执行 | 每5分钟 | P0 | 扫描待发货订单并执行 TikTok → Excel → 惠程荣达 → 面单上传闭环 |
| `01-order-timeout-monitor.json` | 订单超时监控 | 每1小时 | P0 | 检查24h揽收截止时间，识别超时风险 |
| `02-morning-inventory-check.json` | 上班库存核对 | 09:00 每日 | P0 | 对比惠程荣达库存 ↔ TikTok 库存 |
| `03-aftersales-deadline-tracker.json` | 售后截止跟踪 | 每4小时 | P0 | 检查争议证据24h倒计时、申诉21天窗口 |
| `04-afternoon-review-check.json` | 下午评价检查 | 15:30 每日 | P1 | 分类新增差评/中评/好评，标记需证据的 |
| `05-evening-stock-reconciliation.json` | 下班库存复核 | 18:30 每日 | P0 | 生成库存差异表 + 备货建议 |

## 导入方式

### 方式一：n8n CLI（推荐）

```bash
n8n import:workflow --input=apps/n8n/workflows/00-shipping-execution-sweep.json
n8n import:workflow --input=apps/n8n/workflows/01-order-timeout-monitor.json
n8n import:workflow --input=apps/n8n/workflows/02-morning-inventory-check.json
n8n import:workflow --input=apps/n8n/workflows/03-aftersales-deadline-tracker.json
n8n import:workflow --input=apps/n8n/workflows/04-afternoon-review-check.json
n8n import:workflow --input=apps/n8n/workflows/05-evening-stock-reconciliation.json
```

### 方式二：Web UI 导入

1. 打开 `http://localhost:5678`
2. 点击 **Workflows**
3. 点击 **Import from File**
4. 选择对应的 JSON 文件
5. 保存并激活（Toggle Active）

## 设计原则

- n8n **不持有**主数据库、权限、任务状态
- 所有业务数据通过 HTTP Request 节点调用 TK-SaaS API
- Code 节点只做计算和分类，不做数据持久化
- n8n 只负责调度，TikTok/WMS 写操作由带状态机、幂等和审计日志的执行 API 完成
- 验证码、账号风控和不确定 SKU 会进入异常队列，不会盲目继续提交
