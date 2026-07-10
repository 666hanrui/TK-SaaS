# 私有多模态视觉链路：Windows Worker 到模型电脑

日期：2026-07-10
状态：已实现；首次真实店铺会话前必须先通过合成图片的端到端验证。

## 目标

真实店铺后台必须允许模型视觉参与，但截图不能进入公开图床。此方案使用两个 loopback 服务和 FRP STCP：Windows worker 上传图片时走加密隧道；模型读取图片时只访问模型电脑自己的 `127.0.0.1`。

```text
店长 Windows worker
  http://127.0.0.1:18090/v1/images
       | FRP STCP（加密、无公开上传端口）
       v
模型电脑 private image ingress :8090（只绑定 127.0.0.1）
       | 返回 http://127.0.0.1:8090/v1/images/<uuid>
       v
Qwen / llama.cpp 模型进程（同一台模型电脑读取该 URL）
```

`image_url` 仍然是模型 API 所需的 URL，但它不是公网 URL；只有模型电脑本机可读取。图片最多 6 MiB、默认保留 5 分钟，定时清理，不生成可浏览目录。

FRP 的 STCP 正是为“只让授权访问者连接内网服务”设计；它需要服务端和访问端都运行 `frpc`，并用相同 `secretKey`。官方示例和字段说明见 [FRP STCP 文档](https://gofrp.org/en/docs/examples/stcp/) 与 [visitor 配置参考](https://gofrp.org/en/docs/reference/visitor/)。

## 1. 模型电脑（根据现有模型路径，预计也是 Windows）

将 `apps/automation` 同步到模型电脑，安装依赖：

```powershell
cd C:\TK-SaaS\apps\automation
npm ci
Copy-Item .env.example .env
notepad .env
```

模型电脑的 `.env` 至少填入，`<...>` 一律本地填写，不能提交或发进聊天：

```dotenv
AUTOMATION_IMAGE_INGRESS_HOST=127.0.0.1
AUTOMATION_IMAGE_INGRESS_PORT=8090
AUTOMATION_IMAGE_INGRESS_DATA_DIR=./data/image-ingress
AUTOMATION_IMAGE_INGRESS_TTL_SECONDS=300
AUTOMATION_IMAGE_INGRESS_MAX_BYTES=6291456
AUTOMATION_IMAGE_INGRESS_MODEL_READ_BASE_URL=http://127.0.0.1:8090/v1/images
AUTOMATION_IMAGE_INGRESS_UPLOAD_TOKEN=<openssl-rand-hex-32>
```

启动私有入口：

```powershell
npm run image:ingress
```

它拒绝绑定 `0.0.0.0` 或公网地址；这是刻意的安全限制。若模型实际上运行在 Docker 容器内，将 `AUTOMATION_IMAGE_INGRESS_MODEL_READ_BASE_URL` 改成容器能访问到宿主机的地址，再用合成图片验证，不要猜测。

## 2. FRP：新增 image ingress 的 STCP 对

在模型电脑现有 `frpc.toml` 添加一个 proxy（保留已有公共 6081/8080 配置，不要改动）：

```toml
[[proxies]]
name = "tk-saas-image-ingress"
type = "stcp"
secretKey = "<单独生成的-stcp-secret>"
localIP = "127.0.0.1"
localPort = 8090

[proxies.transport]
useEncryption = true
```

在店长 Windows 电脑安装/运行同版本 `frpc`，其 `frpc.toml` 保留已有全局 `serverAddr`、`serverPort` 和认证配置，再添加 visitor：

```toml
[[visitors]]
name = "tk-saas-image-ingress-visitor"
type = "stcp"
serverName = "tk-saas-image-ingress"
secretKey = "<与模型电脑完全相同的-stcp-secret>"
bindAddr = "127.0.0.1"
bindPort = 18090

[visitors.transport]
useEncryption = true
```

如果模型端 `frpc` 配置了 `user`，proxy 的实际服务名会带上该 user 前缀；visitor 的 `serverName` 要填那个实际服务名。默认 STCP 只允许同一 FRP user 的 visitor；若两端使用不同 user，应将模型端 `allowUsers` 精确限制为店长电脑的 user，不要设为 `*`。每次改动后使用 `frpc verify -c .\frpc.toml` 验证配置语法。

启动两端 `frpc` 后，在店长电脑确认本地 visitor 已接通：

```powershell
Invoke-RestMethod http://127.0.0.1:18090/health
```

成功时只会看到 ingress 健康信息；此端口仅绑定在店长电脑 loopback，局域网和公网都不能访问。

## 3. 可选但推荐：把模型 API 也收回 STCP

现有 `http://49.235.153.151:6081/v1` 能用于安全合成图测试，但真实页面模型调用还会带上页面文本和 image URL。建议为模型电脑本地的 llama.cpp/OpenAI-compatible 服务再建一对 STCP proxy/visitor，模型端的 `localPort` 填它**实际**监听端口，店长端绑定到 `127.0.0.1:16081`。

店长 worker 的 `.env` 随后增加：

```dotenv
AUTOMATION_MODEL_BASE_URL_OVERRIDE=http://127.0.0.1:16081/v1
```

这只覆盖模型地址；模型名、温度和 Qwen 视觉 profile 保持不变。未完成这一步时，仍可保留你已有的 6081 映射做合成图预检，但不把它当作真实店铺数据的长期通道。

## 4. 店长 Windows worker 配置

在店长电脑的 `apps/automation/.env` 中加入：

```dotenv
AUTOMATION_MODEL_PROFILE=frp_qwen_vision
AUTOMATION_IMAGE_TRANSPORT_OVERRIDE=http_upload
AUTOMATION_IMAGE_UPLOAD_URL=http://127.0.0.1:18090/v1/images
AUTOMATION_IMAGE_UPLOAD_FIELD=file
AUTOMATION_IMAGE_UPLOAD_RESPONSE_PATH=url
AUTOMATION_IMAGE_UPLOAD_BEARER_TOKEN=<与模型电脑-ingress-token-相同>

# 完成模型 API 的 STCP visitor 后再启用：
# AUTOMATION_MODEL_BASE_URL_OVERRIDE=http://127.0.0.1:16081/v1
```

运行一次不接触店铺的配置检查：

```powershell
npm run frp:preflight
npm run vision:preflight -- --plan-only
```

这两项应显示 `imageTransport: http_upload`，且不应再出现 `AUTOMATION_IMAGE_PUBLISH_DIR` 的警告。

## 5. 唯一的端到端模型视觉预检

所有服务已就绪后，在店长电脑运行：

```powershell
npm run vision:preflight -- --synthetic-safe
```

它上传一个程序生成的红、绿、蓝三栏 PNG，不打开浏览器、不登录店铺。成功输出中应有：

- `ok: true`
- `imageTransport: http_upload`
- `modelImageOrigin: http://127.0.0.1:8090`
- Qwen 对三种色块排列的描述

这一次同时证明：worker 能上传、STCP 能传输、ingress 能保存、模型能从本机 URL 获取图片，以及 Qwen 真的进行了视觉回复。若失败，停止在这个阶段排查；不要消耗店铺账号会话。

通过后，第一项真实任务仍是 `shadow` 的 R1 页面读取，但它已经会使用这条视觉链路，不是纯 DOM。
