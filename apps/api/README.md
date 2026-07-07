# TK-SaaS Execution API

发货全流程执行层：

```text
发现订单 → TikTok 安排发货 → 下载/重命名面单 → SKU 映射
→ 生成惠程荣达 Excel → 上传订单 → 验证订单 → 上传交接面单 → 完成
```

## 本地启动

```bash
cd apps/api
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

默认使用 `dry-run`，不会访问真实 TikTok 或惠程荣达：

```bash
curl -X POST http://127.0.0.1:8000/api/shipping/sweeps
curl http://127.0.0.1:8000/api/shipping/jobs
```

执行数据默认保存到 `apps/api/.automation-data/`，不会提交 Git。

## Playwright 模式

```text
TK_SAAS_AUTOMATION_MODE=playwright
TK_TIKTOK_ORDERS_URL=...
TK_TIKTOK_ORDER_CARD_SELECTOR=...
TK_SAAS_SKU_MAPPING=/absolute/path/product.xls
TK_SAAS_WMS_TEMPLATE=/absolute/path/template.xlsx
TK_WMS_LOGIN_URL=...
TK_WMS_UPLOAD_URL=...
TK_WMS_ORDERS_URL=...
TK_WMS_LABEL_UPLOAD_URL=...
TK_WMS_USERNAME=...
TK_WMS_PASSWORD=...
TK_WMS_PLACEHOLDER_VALUE=1
TK_WMS_DEFAULT_WEIGHT=0.1
TK_WMS_DECLARATION_CN=头套
TK_WMS_DECLARATION_EN=wig
TK_WMS_ITEM_SLOTS=10
TK_TIKTOK_LABEL_OPEN_MODE=popup
```

安装 Chromium：

```bash
.venv/bin/playwright install chromium
```

验证码或安全验证出现时，任务进入 `manual_intervention_required`；人工解锁后再次调用
`POST /api/shipping/jobs/{id}/run`，会从最后成功断点继续。

## 关键约束

- `platform_order_id` 全局唯一，重复扫描不会重复发货。
- 同一客户订单按所有商品行的 `quantity` 求和；总数量大于 5 时，运输方式强制使用 `HC-US`，刚好 5 件不触发。
- SKU 只接受平台 SKU、明确内部编号或完整产品名精确匹配，不做模糊猜测。
- `product.xls` 优先读取“产品总”，WMS `配货N` 写完整 `XCGLM-GLM…` SKU。
- 图片型 PDF 依赖下载上下文/文件名跟踪号，不依赖文本提取。
- 每个步骤完成后立即写 SQLite 事件日志。
- 浏览器和账号凭据不进入源码或前端环境变量。
