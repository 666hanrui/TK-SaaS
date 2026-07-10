# TK-SaaS 浏览器自动化框架与统一验证计划

日期：2026-07-10
状态：框架已落地；真实平台验证待联合执行。

## 1. 目标

在没有平台 API 的前提下，浏览器自动化负责受控的页面 I/O；业务规则、权限、幂等、审计和状态转换不交给模型。

```text
业务任务 / 定时器
  -> Typed TaskSpec
  -> Policy Engine
  -> profile lease + idempotency claim
  -> Playwright recipe 或 Stagehand observe/extract
  -> ActionIntent
  -> Executor
  -> deterministic postcondition verification
  -> receipt / artifacts / CRM event
```

模型的职责：页面观察、视觉/语义提取、定位候选、页面改版后的候选修复。
代码的职责：允许访问的域名、业务动作、数据实体、发送限额、审批、重复执行、最终成功判定。

## 2. 当前框架

新 worker 位于 `apps/automation/`，与 React/Vite 前端和 n8n 分开运行。

| 组成 | 当前实现 | 作用 |
|---|---|---|
| 动作目录 | `src/catalog/taskCatalog.js` | 37 个业务动作，定义输入、风险、允许方法、证据、限额和后置条件 |
| 协议 | `src/protocol/` | `TaskSpec`、`ActionIntent`、`PolicyDecision`、`ExecutionReceipt` 等 Zod schema |
| 策略 | `src/policy/engine.js` | 域名白名单、`rehearsal/shadow/canary/live`、额度、审批授权 |
| 执行运行时 | `src/runtime/` | 状态机、文件幂等账本、崩溃后 `ambiguous_reconcile` |
| 浏览器会话 | `src/session/profileManager.js` | 每个店铺/profile 独占锁，禁止并发复用登录态 |
| Stagehand 适配器 | `src/adapters/stagehand/` | 本地/远端 OpenAI-compatible 多模态模型、动作候选、页面签名、截图和提取 |
| 审计证据 | `src/artifacts/artifactStore.js` | 追加式 `events.jsonl`、截图、页面快照、带 SHA-256 的 manifest |

所有写操作默认没有 recipe verifier，因此即便点击返回成功，也不能被标记为业务成功。

## 3. 可用浏览器能力清单

| 模块 | R0 内部计算 | R1 只读浏览器能力 | R2 可逆写入 | R3 敏感写入 |
|---|---|---|---|---|
| 订单 | 24h 倒计时、任务去重 | 同步订单、订单详情、物流/揽收复核 | 单条服务消息、真实体验邀请 | 提交发货/物流信息 |
| 售后 | 规则分类、证据缺口 | 工单、退货物流、证据采集 | 填写申诉不提交、单条售后消息 | 退款/拒绝/申诉提交 |
| 评价 | 分类、草稿合规检查 | 同步评价、关联会话和证据 | 单条评价回复 | 举报评价 |
| 库存 | SKU 映射、差异、备货量 | TikTok/惠程荣达库存与在途快照 | 填目标库存不保存 | 提交库存调整 |
| 达人 | 筛选打分、草稿、CRM 流转 | EchoTik UI 筛选、详情、公开联系方式、邮件回复同步 | 无；草稿只在本地 | 邮件/社媒建联和跟进 |
| 客服 | 意图分类、事实/草稿分离 | 待办会话与上下文同步 | 低风险 FAQ 回复 | 退款、赔偿、承诺类回复 |

R0/R1 是第一轮真实验证的范围。R2 只能在 `canary` 或已批准 `live` 策略中执行。R3 需要全局开关、匹配业务实体的短期授权和确定性的页面后置验证。

## 4. 四种运行模式

| 模式 | 允许的环境 | 读 | 写 |
|---|---|---|---|
| `rehearsal` | `localhost` / 本地夹具 | 允许 | 只生成候选，不执行 |
| `shadow` | 白名单真实后台 | 允许 | 只生成候选，不执行 |
| `canary` | 白名单真实后台 | 允许 | 仅授权的 R2 小流量动作 |
| `live` | 白名单真实后台 | 允许 | 策略授权的 R2；R3 需高风险开关与 scoped grant |

页面文本、模型回答和 Stagehand 原始 XPath 都不能改变运行模式或获得执行权限。

## 5. 多模态模型和图床

模型可以通过 FRP 提供 OpenAI-compatible 接口；视觉输入采用 `image_url`。worker 支持三种图片传输：

- `inline_data_url`：直接内嵌 base64，适用于模型服务器支持 data URL 的场景。
- `remote_url`：截图写入一个 Nginx/图床实际服务的目录，再向模型提供公网 URL。
- `http_upload`：通过可配置的上传接口发布截图，读取返回 JSON 中的 URL。

`remote_url` 需要同时提供：

```text
LOCAL_LLM_BASE_URL=http://49.235.153.151:6081/v1
LOCAL_LLM_MODEL=C:\Users\666\Downloads\Qwen3.5-9B.Q4_K_M.gguf
LOCAL_LLM_IMAGE_TRANSPORT=remote_url
AUTOMATION_IMAGE_PUBLIC_BASE_URL=http://49.235.153.151:8080/<public-path>
AUTOMATION_IMAGE_PUBLISH_DIR=<the matching local/nginx served directory>
```

如果图床没有共享目录，则配置 `AUTOMATION_IMAGE_UPLOAD_URL`、上传字段名和返回 URL 的 JSON 路径。不得向公开图床上传未脱敏的订单、客户消息、邮箱或电话截图。

命令 `npm run model:preflight -- --image-url <public-safe-image-url>` 会验证的就是这条视觉请求合约；第一次联合验证时使用一张不含业务数据的测试图，不用真实 Seller Center 截图。

仓库里已有的本地 `.env` 可以继续保留旧模型配置；`npm run frp:preflight` 和 `npm run frp:model:preflight` 会在进程内选择 FRP Qwen profile，不会修改该文件。

## 6. 宝贵测试机会的使用顺序

### 阶段 A：完全离线

1. 运行动作目录、策略、幂等、状态机、图床解析测试。
2. 以无业务数据的公共图片运行一次模型视觉 preflight。
3. 准备专用浏览器 profile；不复用日常 Chrome profile。
4. 确认启动 n8n 前，发送/Chatwoot webhook 全部隔离；仓库与实际 n8n active 状态必须对齐。

### 阶段 B：第一次真实平台会话，只读采集

一次会话只执行 `NAVIGATE`、`OBSERVE`、`EXTRACT`、`DOWNLOAD`。建议按平台分批，而不是让 agent 自由探索：

1. EchoTik：筛选前/后、第一页/末页、达人详情、视频、公开联系方式、会员限制页。
2. TikTok Seller Center：Orders、Returns/Refunds、Product Ratings、Inventory、Customer Messages 各取一个列表页和一条详情。
3. 惠程荣达：库存、在途、导出入口和一个单据详情。

每个页面由 worker 保存：前后截图、可见/ARIA 文本、页面签名、URL、稳定 locator 候选、下载文件字段清单、正常态与失败态。Cookie、storage state、token 和客户 PII 不进入 fixture。

### 阶段 C：离线回放与 recipe 固化

使用第一轮证据脱敏后生成的 fixture，反复调试模型、结构化 schema、定位器和变体。只有下列条件都满足，才允许第二次真实只读会话：

- 页面签名变化时安全停止。
- 同一 fixture 输出的关键 ID、SKU、金额、状态稳定。
- 每个数据字段都有来源证据或明确缺失原因。
- 相同任务重跑不会生成重复 CRM 事件。

### 阶段 D：Canary 写入

单独挑一个已批准的 R2 低风险动作，例如一条已审核 FAQ 回复。写入前后必须验证目标实体、消息/状态唯一性、刷新后的最终状态和回执。R3 动作不进入这一轮。

## 7. 与现有资产的边界

- EchoTik 导入、字段归一化、达人筛选和 `draft_ready` 合约可以复用。
- 浏览器 worker 只回传观察、证据和受控 action intent；不直接把模型输出写入 CRM 或调用邮件/Chatwoot。
- n8n 只负责定时、触发和通知；它不是数据源、浏览器 worker 或高风险消息发送器。
- `MARK_SENT_EXTERNALLY` 与 `SEND_EMAIL_APPROVED` 必须是两个独立动作，前者永远不能触发邮件发送。
- 旧 Stagehand probe 保留作实验，不再作为正式执行入口。

## 8. 联合验证前的完成定义

```text
[x] 37 个动作已目录化
[x] 模式、域名、风险、限额、审批、幂等和 postcondition 框架已实现
[x] 本地离线测试覆盖正常、重复、shadow、敏感审批和写后验证失败
[ ] FRP 模型 + 图床视觉 preflight
[ ] 专用 profile 和平台白名单配置
[ ] 一次性只读证据采集
[ ] 离线 fixture / recipe 评测
[ ] 单一 R2 canary 写入
```

店铺账号必须留在店长 Windows 电脑时，采用局域网执行节点；FRP 只保留给模型和图床。具体部署、鉴权和验证顺序见 [Windows LAN worker deployment](windows-lan-worker-deployment.md)。
