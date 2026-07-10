# 店长 Windows 电脑：局域网浏览器执行节点部署

日期：2026-07-10
状态：可部署；首次店铺会话仍只允许 `shadow` 只读验证。

## 1. 正确拓扑

店长电脑不需要通过 FRP 接受浏览器控制。它只需能访问互联网中的模型地址；浏览器任务服务则只在局域网内被本机监控。

```text
本机（Codex / 编排 / 监控） -- LAN + Bearer token --> 店长 Windows 电脑
                                                |-- persistent Chrome profile（仅本机）
                                                |-- Stagehand / Playwright worker
                                                `-- FRP 出网 --> 模型电脑 :6081
                                                                  图床 :8080
```

禁止事项：不要经 FRP 暴露 Chrome remote-debugging port、浏览器 profile、Cookie、`storageState`、店铺后台或 worker 的数据目录。FRP 在此架构中只服务模型和经鉴权的图片传输，不服务店铺账号。

## 2. Windows 执行机准备

在店长电脑上安装 Node.js LTS、Git 和正常安装的 Google Chrome。将同一项目检出到例如 `C:\TK-SaaS`，然后在 PowerShell 执行：

```powershell
cd C:\TK-SaaS\apps\automation
npm ci
Copy-Item .env.example .env
notepad .env
```

`.env` 的首次真实验证最小配置如下；尖括号内容由你填写，不能照抄为真实配置：

```dotenv
AUTOMATION_MODE=shadow
AUTOMATION_EXTERNAL_READ=true
AUTOMATION_EXTERNAL_EXECUTION=false
AUTOMATION_HIGH_RISK_EXECUTION=false
AUTOMATION_ALLOWED_ORIGINS=https://<实际-seller-center-origin>
AUTOMATION_HEADLESS=false
AUTOMATION_CHROME_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe

# 店长电脑的固定局域网 IPv4，不是 0.0.0.0，也不是公网 IP。
AUTOMATION_SERVICE_HOST=<店长电脑-LAN-IP>
AUTOMATION_SERVICE_PORT=8010
AUTOMATION_SERVICE_REQUIRE_TOKEN=true
AUTOMATION_SERVICE_TOKEN=<用 openssl rand -hex 32 生成的随机值>

# 仅模型电脑不在 LAN；保留现有 FRP 模型 profile。
AUTOMATION_MODEL_PROFILE=frp_qwen_vision
```

`AUTOMATION_SERVICE_TOKEN` 只保存在店长电脑和这台监控电脑的各自 `.env`，不要粘贴进聊天、Git、n8n、截图或 job JSON。

先在 Windows 上执行离线检查：

```powershell
npm run preflight
```

如果浏览器路径不同，先调整 `AUTOMATION_CHROME_EXECUTABLE_PATH`。这一步不启动浏览器、不访问店铺、不调用模型。

## 3. 登录态只在店长电脑创建

使用框架提供的可见浏览器命令创建专用 profile：

```powershell
npm run profile:open -- --profile tiktok-shop-<店铺别名> --url https://<实际-seller-center-url>
```

店长在弹出的浏览器中手工完成登录、MFA 和任何安全挑战，确认进入后台后回到终端按 Enter。该 profile 位于 `data\profiles\`，worker 会复用它，但不会导出 Cookie 或 storage state。

仓库中已有的 `apps/automation/scripts/login-profile.mjs` 不用于正式店铺账号：它会导出 storage state，且含有不属于正式框架的浏览器参数。这里保留它的原样，不把它接入本流程。

## 4. LAN 服务与 worker 启动

第一次验证时开两个 PowerShell 窗口，保持可见日志，不要先设为开机自启。

窗口 A：

```powershell
cd C:\TK-SaaS\apps\automation
npm run service
```

窗口 B：

```powershell
cd C:\TK-SaaS\apps\automation
npm run worker -- --watch
```

服务只监听 `AUTOMATION_SERVICE_HOST` 指定的 LAN 地址。Windows 防火墙规则应只允许这台开发/监控电脑的 IPv4 访问 8010，例如在管理员 PowerShell 中：

```powershell
New-NetFirewallRule -DisplayName "TK-SaaS automation monitor" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8010 -RemoteAddress <本机-LAN-IP>
```

不要使用全网段或 `Any` 作为 `RemoteAddress`。若服务或 worker 关闭，浏览器 profile 中的登录态不会离开店长电脑。

## 5. 这台电脑如何监控与派发

在这台开发/监控电脑的 `apps/automation/.env` 中仅追加下列两项；不覆盖已有模型配置：

```dotenv
AUTOMATION_REMOTE_ENDPOINT=http://<店长电脑-LAN-IP>:8010
AUTOMATION_REMOTE_TOKEN=<与 Windows 完全相同的随机值>
```

然后从本机读取健康与队列：

```bash
npm run monitor -- --list
npm run monitor -- --run <run-id> --watch --download-screenshot
```

监控命令没有创建浏览器动作的能力；`--download-screenshot` 是显式选择，证据会下载到本机 `output/remote-monitor/<run-id>/`，其中可能含订单或客户信息，应按业务数据处理。

派发需要一个 JSON 文件，例如 `shadow-order-snapshot.json`：

```json
{
  "definitionId": "tiktok.orders.sync",
  "sourceTaskId": "joint-validation:orders-first-page",
  "entityId": "orders-first-page-2026-07-10",
  "requestedBy": "joint-validation",
  "target": {
    "url": "https://<实际-seller-center-url>",
    "accountId": "<店铺别名>",
    "shopId": "<店铺别名>",
    "profileId": "tiktok-shop-<店铺别名>"
  },
  "input": {
    "shopId": "<店铺别名>",
    "statusFilter": "all",
    "snapshotWindow": "first-page-only"
  }
}
```

从本机提交：

```bash
npm run dispatch -- --file shadow-order-snapshot.json
```

Windows service 会按自己的 `shadow`、域名白名单和只读策略重新判定。即使派发 JSON 被修改，`shadow` 也不会执行发送、保存、发货、退款或库存修改。

## 6. 模型和图床的跨网边界

`AUTOMATION_MODEL_PROFILE=frp_qwen_vision` 让 Windows worker 通过现有 FRP 地址访问模型电脑；店长电脑和模型电脑不在同一 LAN 并不影响这条出网请求。

真实 Seller Center 截图不进入 8080 公共图床，也不降级为纯 DOM。框架现在提供私有 ingress：worker 经 FRP STCP 上传，模型从模型电脑 loopback URL 读取，图片默认 5 分钟后清除。完整的双端配置与唯一合成图验证见 [private vision over FRP STCP](private-vision-over-frp-stcp.md)。

## 7. 宝贵验证机会的顺序

1. Windows `preflight` 成功；本机 `monitor -- --list` 可鉴权访问。
2. 店长手动登录专用 profile，关闭浏览器后由 worker 重新打开，确认仍是正确店铺。
3. 用私有 FRP STCP 通道完成一次合成图模型视觉 preflight；不允许以纯 DOM 替代。
4. 派发一项 `tiktok.orders.sync` 的 `shadow` 首页面读取；全程不允许写入。
5. 在本机查看状态、manifest、截图和日志；将证据脱敏后再固化 recipe。
6. 只有同一页面离线回放稳定，才安排下一次真实只读会话。R2/R3 不在本次账号验证范围内。

店长电脑的完整安装、任务模板、源数据记录、惠程荣达/TikTok 库存核对和停售条件见 [store-manager Windows operations SOP](store-manager-windows-operations-sop.md)。

## 8. 需要你在联合验证前提供的三个值

- 店长电脑的固定 LAN IPv4，以及这台电脑的 LAN IPv4（用于精确防火墙规则）。
- 实际 Seller Center 的 origin 与一个只读页面 URL。
- 图床是否已有经鉴权的上传接口；若有，上传 URL、字段名和返回 URL 的 JSON 字段路径可在本机私下填进 `.env`，不要提交仓库。
