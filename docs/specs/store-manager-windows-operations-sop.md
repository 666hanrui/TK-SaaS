# 店长 Windows 电脑完整操作 SOP

日期：2026-07-10
适用范围：TikTok Shop 订单、投诉/退款/售后、SKU 库存、惠程荣达库存与在途、评价、客服消息，以及达人数据。
首轮模式：`shadow`，真实页面 + 多模态模型视觉，但所有外部写入均禁止。

## 0. 先明确三台电脑的职责

| 电脑 | 只负责什么 | 绝不放什么 |
|---|---|---|
| 模型电脑 | Qwen、私有图片入口、模型端 FRP proxy | 店铺账号、店铺 Chrome profile |
| 店长 Windows 电脑 | 店铺登录、Chrome profile、Stagehand worker、源数据快照 | Cookie/profile 的导出文件、公开调试端口 |
| 本机（开发/监控） | LAN 内派发、查看状态、读取已验证记录 | 店铺 Cookie、Chrome remote-debugging port |

先轮换已经出现在聊天中的 FRP auth token；新的 token、STCP secret、图片入口 token 都只写各电脑的本地 `.env` / `frpc.toml`，不要提交 Git 或发进聊天。

## 1. 模型电脑：先打通私有视觉通道

严格按 [私有视觉 FRP STCP 指南](private-vision-over-frp-stcp.md) 操作：

1. 在模型电脑安装本项目 `apps/automation` 依赖，填写 image ingress 的本地 `.env`。
2. 运行 `npm run image:ingress`，它只绑定 `127.0.0.1:8090`。
3. 保留原有的 `ai-service` TCP proxy；新增 `tk-saas-qwen`（模型本地端口是已确认的 `8081`）和 `tk-saas-image-ingress` 两条 STCP proxy。
4. 在店长电脑配置对应 visitor：`127.0.0.1:16081` 指向 Qwen，`127.0.0.1:18090` 指向图片入口。
5. 两端执行 `frpc verify -c .\frpc.toml` 后重启 `frpc`。

不要跳过这一步，也不要让真实后台截图落到公网 8080 图床。

## 2. 店长 Windows 电脑：安装与本地配置

安装 Node.js LTS、Git、Google Chrome 和与模型端匹配版本的 `frpc`。检出项目，例如 `C:\TK-SaaS`：

```powershell
cd C:\TK-SaaS\apps\automation
npm ci
Copy-Item .env.example .env
notepad .env
```

首次店铺验证填写下面这组关键值。所有 `<...>` 只在这台电脑本地替换：

```dotenv
AUTOMATION_MODE=shadow
AUTOMATION_EXTERNAL_READ=true
AUTOMATION_EXTERNAL_EXECUTION=false
AUTOMATION_HIGH_RISK_EXECUTION=false
AUTOMATION_HEADLESS=false

# 必须是准确 origin；TikTok 与惠程荣达分别填入，逗号分隔。
AUTOMATION_ALLOWED_ORIGINS=https://<TikTok-Seller-origin>,http://124.156.202.7:8888
TIKTOK_SELLER_BASE_URL=https://<TikTok-Seller-origin>
HCRD_BASE_URL=http://124.156.202.7:8888/wms-main
HCRD_INVENTORY_PATH=/inventory/inventory/listForClientAction.json
HCRD_INVENTORY_PAGE_SIZE=200
HCRD_INVENTORY_MAX_PAGES=100
HCRD_INVENTORY_VISUAL_AUDIT=true
HCRD_AUTH_WAIT_SECONDS=300
HCRD_USERNAME=<惠程荣达登录账号>
HCRD_PASSWORD=<惠程荣达登录密码>
AUTOMATION_CHROME_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe

# 模型和视觉：两条 URL 都是店长电脑 loopback，由 STCP visitor 提供。
AUTOMATION_MODEL_PROFILE=frp_qwen_vision
AUTOMATION_MODEL_BASE_URL_OVERRIDE=http://127.0.0.1:16081/v1
AUTOMATION_IMAGE_TRANSPORT_OVERRIDE=http_upload
AUTOMATION_IMAGE_UPLOAD_URL=http://127.0.0.1:18090/v1/images
AUTOMATION_IMAGE_UPLOAD_FIELD=file
AUTOMATION_IMAGE_UPLOAD_RESPONSE_PATH=url
AUTOMATION_IMAGE_UPLOAD_BEARER_TOKEN=<模型电脑-image-ingress-token>

# 本机 LAN 监控服务，绑定店长电脑固定 LAN IP；不要使用 0.0.0.0。
AUTOMATION_SERVICE_HOST=<店长电脑-LAN-IP>
AUTOMATION_SERVICE_PORT=8010
AUTOMATION_SERVICE_REQUIRE_TOKEN=true
AUTOMATION_SERVICE_TOKEN=<LAN-monitor-token>
```

然后执行：

```powershell
npm run preflight
npm run frp:preflight
npm run vision:preflight -- --plan-only
```

最后一条必须显示 `imageTransport: http_upload` 与模型地址 `127.0.0.1:16081/v1`。若不一致，停止，不登录店铺。

## 3. 唯一模型视觉预检

先确认 STCP 图片 visitor 存活：

```powershell
Invoke-RestMethod http://127.0.0.1:18090/health
npm run vision:preflight -- --synthetic-safe
```

第二条只上传程序生成的红、绿、蓝色块，不会打开浏览器。成功条件：`ok: true`、`modelImageOrigin: http://127.0.0.1:8090`，且 Qwen 回答色块排列。失败就只排查 FRP/模型/入口，不消耗店铺账号会话。

## 4. 建立店铺专用浏览器 profile

每个实际平台账号一个 profile，不能复用日常 Chrome：

```powershell
# TikTok Shop
npm run profile:open -- --profile tiktok-shop-<店铺别名> --url https://<TikTok-Seller-实际入口>

# 惠程荣达：登录后必须能看到“库存列表”；JSESSIONID 只留在这个 profile 内。
npm run profile:open -- --profile hcrd-<账号别名> --url http://124.156.202.7:8888/wms-main/client.htm#
```

店长在可见浏览器中手工完成登录、MFA 与安全验证，确认正确店铺/仓库后按 Enter 退出。浏览器 profile 只保存在 `data\profiles\`；不要复制 Cookie、`storageState` 或整个 profile 目录。

## 5. 启动顺序与 LAN 监控

店长电脑开两个 PowerShell 窗口：

```powershell
cd C:\TK-SaaS\apps\automation
npm run service
```

```powershell
cd C:\TK-SaaS\apps\automation
npm run worker -- --watch
```

Windows 防火墙只允许本机开发电脑的单一 LAN IPv4 访问 8010。不要开放整个网段或公网。

在本机 `apps/automation/.env` 增加：

```dotenv
AUTOMATION_REMOTE_ENDPOINT=http://<店长电脑-LAN-IP>:8010
AUTOMATION_REMOTE_TOKEN=<LAN-monitor-token>
```

本机可用命令：

```bash
npm run monitor -- --list
npm run monitor -- --run <run-id> --watch --download-screenshot
npm run records -- --definition tiktok.aftersales.sync
```

截图下载是显式行为，文件会落到本机 `output/remote-monitor/`，按客户数据处理。

## 6. 首轮应记录的业务范围

每个 R1 任务在结构化提取和证据校验通过后，会写入店长电脑 `data/records/<definition-id>/<run-id>.json`。这是不可变的源数据快照，包含提取结果、来源证据、过滤条件和关联 artifact run；失败、登录挑战、未验证结果不会入库。

| 业务 | 首轮 R1 记录 | 后续只读细查 | 首轮禁止的写入 |
|---|---|---|---|
| TikTok 订单/发货风险 | `tiktok.orders.sync` | `read_detail`、`audit_fulfillment` | 发货提交、客户消息 |
| TikTok 投诉/退款/售后 | `tiktok.aftersales.sync` | `read_return_tracking`、`collect_evidence` | 退款、拒绝、申诉提交、消息发送 |
| TikTok SKU 库存 | `tiktok.inventory.sync` | 完整读取 `total_sku_count`，再指定 SKU 细查 | 保存库存调整 |
| 惠程荣达现货 | `hcrd.inventory.sync` | 用登录 profile 的 JSESSIONID 读取完整 API 分页，并由模型抽查可见行 | 任何库存修改 |
| 惠程荣达在途 | `hcrd.inventory.sync_in_transit` | 指定入库单据 | 任何单据修改 |
| TikTok 商品评价 | `tiktok.reviews.sync` | `read_context` | 回复、举报 |
| TikTok 客服 | `tiktok.messages.sync` | `read_context` | 任意消息发送 |
| 达人与邮件 | EchoTik/公开主页/邮件只读同步 | 达人详情、公开联系方式 | 邮件或社媒建联 |

达人模块现在有独立的本地工作台和持久化目录，不再只是“后续数据”。安装、一键启动、188 人种子保护、模型电脑生成草稿、人工发送和 Agent 验收步骤见 [店长电脑达人工作台 SOP](store-manager-creator-workbench-sop.md)。外联仍坚持“模型草稿 -> 人工修改 -> 人工确认 -> 人工发送 -> 回写”，不开放无人值守群发。

投诉、退款与申诉都属于高风险 R3，当前环境没有任何开关可让它们提交。worker 只会采集工单、金额、截止时间、原因、物流和证据缺口。

## 7. 首轮派发方式

模板在 `apps/automation/examples/shadow/`。从本机复制模板到安全工作目录，替换所有 `<...>`，再派发；不要直接修改版本库模板。

```bash
npm run dispatch -- --file <安全工作目录>/tiktok-orders-sync.json
npm run dispatch -- --file <安全工作目录>/tiktok-aftersales-sync.json
npm run dispatch -- --file <安全工作目录>/tiktok-inventory-sync.json
npm run dispatch -- --file <安全工作目录>/hcrd-inventory-sync.json
npm run dispatch -- --file <安全工作目录>/hcrd-in-transit-sync.json
```

首轮一次只派发一个模块，等待 `monitor` 显示 `queueStatus: completed`，再检查对应源数据快照。TikTok 库存任务监听页面自身的 `POST /api/v1/product/stock/sku/list` 响应并通过可见分页读取到 `total_sku_count`（2026-07-13 已验证基线为 346 条）；HCRD 现货任务通过 `POST /inventory/inventory/listForClientAction.json` 自动读取完整分页（2026-07-13 已验证基线为 303 条）。两者都只让模型抽查当前屏幕中最多 5 行。不要并行使用同一个 profile；worker 的 profile lease 会拒绝并发复用。

HCRD 没有独立开放 API Key。认证仅来自该 Chrome profile 中的 `JSESSIONID`；程序在同源页面内请求接口，不复制、不打印、不写入 `.env`。接口返回 HTML、分页总数不一致或视觉样本不一致时，任务失败且不会生成已验证快照。

## 8. 惠程荣达与 TikTok 库存核对

库存核对有三个安全步骤：

1. 分别完成 `hcrd.inventory.sync` 与 `tiktok.inventory.sync`，可选再完成 `hcrd.inventory.sync_in_transit`。
2. 从 `npm run records` 中取得这三个 snapshot run ID，填入 `examples/shadow/inventory-reconcile.json`；同时填写经过确认的 SKU 映射和安全库存。若 TikTok 接口的 `seller_sku` 为空，映射目标必须使用该行的 TikTok `sku_id`。`direct` 表示单个 HCRD SKU 对应一个 TikTok SKU；`bundle` 表示多个 HCRD 组件共同组成一个 TikTok SKU，组件的 `quantity` 是每套用量。
3. 从本机执行：

```bash
npm run inventory:reconcile -- --file <安全工作目录>/inventory-reconcile.json
```

它只在店长电脑本地比较已验证快照，输出：HCRD 可用库存、TikTok 可用库存、在途、差异、安全库存、补货建议，以及所有未映射 SKU。它不打开浏览器、不调用模型、不保存 TikTok 库存。核对报告也会进入 `internal.inventory.reconcile` 源数据快照。

组合 SKU 的 HCRD 可用量固定按 `min(floor(组件可用量 / 每套用量))` 计算，禁止相加。首批订单与物流单号双重匹配得到的三条普通映射，以及 `GLM801 + GLM802` 对应 TikTok Free Bonus 的组合规则，保存在 `apps/automation/examples/shadow/estrella-hcrd-sku-mapping-v1.json`。新增映射必须保留订单号、物流单号或人工确认记录，并递增版本；不要覆盖历史版本。

## 9. 每日运行节奏

```text
先确认 worker / STCP / profile 正常
  -> 订单、售后、TikTok 库存、惠程荣达现货与在途分别产生小范围 R1 快照
  -> 查 records 和异常清单
  -> 运行库存核对
  -> 针对异常订单/工单再派发单条 R1 detail / evidence 任务
  -> 人工决定后，才设计并联合验证某一个 R2 canary
```

不要把定时器直接连到 R2/R3。当前可以安全自动化的是“读取、记录、核对、生成待办证据”；对外发送、发货、退款、拒绝、申诉、库存保存都还没有授权。

## 10. 停止条件

以下任一情况立刻停止该 profile 的任务，不尝试绕过：

- 显示登录页、MFA、验证码或安全挑战；任务会记为 `auth_required`。
- 店长发现浏览器不是目标店铺/仓库。
- 页面 URL 不在 `AUTOMATION_ALLOWED_ORIGINS`。
- 模型视觉预检失败、图片入口无法清理、或模型输出无法满足结构化 schema。
- 记录快照的 `recordsValid` 为 false、页面总数不一致、SKU 未映射、或任务状态为 `ambiguous_reconcile`。

保留截图、`events.jsonl`、`summary.json` 和 manifest 供联合排查；不要通过重复点击或重复派发来“试试看”。
