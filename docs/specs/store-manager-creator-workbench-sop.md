# 店长电脑达人工作台：安装、使用与验收

日期：2026-07-15
目标：店长在 Windows 电脑上打开一个本地页面，完成达人导入/筛选、详情核查、联系方式、模型草稿、人工发送和跟进记录。达人数据不再依赖开发电脑浏览器的 `localStorage`。

## 1. 三台电脑的关系

| 位置 | 达人模块职责 | 数据边界 |
|---|---|---|
| 店长 Windows 电脑 | 运行达人工作台、保存达人 CRM、保留 EchoTik/TikTok 登录、人工确认并发送 | 唯一正式达人库在 `C:\TK-SaaS\apps\web\data\creator-crm\` |
| 模型电脑 | Qwen 生成个性化英文建联草稿 | 店长电脑通过 STCP visitor `127.0.0.1:16081/v1` 调用；模型电脑不保存店铺 Cookie |
| 开发/监控 Mac | 开发、更新代码、读取店长 Agent 的验收结果 | 不作为正式达人库，不承担日常启动 |

店长电脑上的浏览器自动化服务 `8010` 与达人工作台 `5173` 是两个独立服务。达人工作台即使不启动 worker 也能使用；只有要通过 EchoTik 页面采集时才需要浏览器 profile/worker。

## 2. 店长电脑现在要得到的能力

- 初次启动自动写入已确认的 188 个真实 EchoTik 达人；不使用 demo 数据。
- CSV、TSV、JSON、Excel 导入；重复导入只更新 EchoTik 证据，不覆盖店长填写的邮箱、备注、星标、CRM 状态或建联历史。
- 第一波规则固定为：粉丝大于 1000；最新 10 条中至少 6 条播放大于 1000；30 天内更新；有商品关联/带货证据；命中 drawstring ponytail、half wig、wig、crochet hair、braids、black girl 等关键词。
- 详情页展示真实视频证据和缺口；不能用平均播放量伪造十条视频明细。
- 公开邮箱、Instagram/Linktree、备注可人工补充。
- 默认通过模型电脑生成英文草稿；模型不可用时明确标记并使用本地模板兜底。
- 草稿可编辑，人工确认后可打开系统邮件草稿或复制到 Instagram；系统不会无人值守批量私信。
- 人工实际发送后点击“确认已发送并回写”，进入 `contacted` 并保留时间、渠道和历史。
- 每次修改自动写入店长电脑，自动保留最近 50 份 JSON 备份；页面也能手工导出完整备份。

## 3. 一次安装

前提：项目位于 `C:\TK-SaaS`，店长电脑已经安装 Node.js LTS。PowerShell 执行：

```powershell
cd C:\TK-SaaS
powershell -ExecutionPolicy Bypass -File .\apps\web\scripts\install-store-manager.ps1
```

脚本会创建 `apps\web\.env`、安装锁定依赖、构建生产页面并初始化达人库。`.env` 不提交 Git；如模型 visitor 不是 `127.0.0.1:16081`，只在店长电脑本地修改：

```dotenv
CREATOR_LLM_BASE_URL=http://127.0.0.1:16081/v1
```

EchoTik 账号不是启动必需条件。需要页面直接同步时再在本地 `.env` 填写 `ECHOTIK_USERNAME` / `ECHOTIK_PASSWORD`；否则使用 EchoTik 导出的 CSV/Excel。

如需让浏览器 worker 从 EchoTik 可见页面采集，首次只在店长电脑执行：

```powershell
cd C:\TK-SaaS\apps\automation
npm.cmd run profile:open -- --profile echotik-main --url https://echotik.live/influencers
```

店长手工登录并完成验证码。首轮任务模板为 `examples\shadow\echotik-creators-search.json` 和 `echotik-creator-detail.json`；只读采集，不发送消息。

开发电脑生成正式部署 ZIP 的命令是：

```bash
cd apps/web
npm run package:manager
```

产物位于项目根目录 `output/deploy/`，同时生成 `.sha256` 校验文件。部署 ZIP 明确排除 `.env`、账号凭据、浏览器 profile、达人正式数据和 `node_modules`；更新店长电脑时必须保留原 `apps\web\data\creator-crm` 与 `.env`。

## 4. 每天启动

双击项目根目录：

```text
店长电脑-启动达人工作台.cmd
```

脚本会复用已运行服务；未安装时自动安装；成功后打开：

```text
http://127.0.0.1:5173/?section=creators
```

命令行等价操作：

```powershell
cd C:\TK-SaaS
powershell -ExecutionPolicy Bypass -File .\apps\web\scripts\start-store-manager.ps1
```

## 5. 店长的完整操作顺序

1. 看页面顶部状态必须显示“本地已保存 N 人”，不能长期显示“服务未连接”。
2. 新数据点击“导入 CSV/Excel”；已有 188 人始终保留。需要从 EchoTik 直接拉取时点击顶部同步。
3. 用“粗筛通过/证据不足”、CRM 状态、关键词和搜索框筛选。
4. 打开达人详情，核对最近视频、发布时间、播放量和商品关联；缺证据就留在 `needs_contact` 或 `review`，不要猜。
5. 打开 TikTok 主页，填写公开邮箱/IG 和备注；推进到 `ready_to_contact`。
6. 点击“生成联系草稿”。“队列来源”为 `model-computer` 才表示本次确实由模型电脑生成；`local-template-fallback` 表示模型未通，需要排查 visitor，但仍可人工改稿。
7. 直接编辑草稿并点击“人工确认草稿”。
8. 邮箱联系人点击“打开邮件草稿”；IG 联系人打开主页并“复制 IG 草稿”。由店长检查收件人和内容后亲自发送。
9. 实际发送成功后点击“确认已发送并回写”。未发送不能点。
10. 回复、寄样、发布和复盘依次推进 CRM；每次回复或跟进写入备注。

CRM 固定顺序：

```text
imported -> qualified -> needs_contact -> ready_to_contact -> contacted
         -> replied -> sample_sent -> published -> review
```

## 6. 数据与恢复

| 文件 | 用途 |
|---|---|
| `apps\web\data\creator-crm\creators.json` | 正式达人库 |
| `apps\web\data\creator-crm\backups\` | 最近 50 次变化备份 |
| `apps\web\data\creator-crm\events.jsonl` | 本地审计事件 |
| `apps\web\data\creator-crm\automation\queue.json` | 草稿、确认、发送回写队列 |

更新代码不能删除整个 `apps\web\data`。恢复时先停止工作台，把选定备份复制为 `creators.json`；或者在页面重新导入手工导出的 JSON。

## 7. 店长电脑 Agent 验收清单

让店长电脑 Agent 在本机执行以下动作，只回传状态、计数、路径和错误，不回传 `.env`、token、Cookie 或账号密码：

```powershell
cd C:\TK-SaaS
git rev-parse --short HEAD
git status --short
node --version
Test-Path .\apps\web\scripts\install-store-manager.ps1
Test-NetConnection 127.0.0.1 -Port 16081
powershell -ExecutionPolicy Bypass -File .\apps\web\scripts\install-store-manager.ps1
powershell -ExecutionPolicy Bypass -File .\apps\web\scripts\start-store-manager.ps1 -NoBrowser
Invoke-RestMethod http://127.0.0.1:5173/api/health
cd .\apps\web
npm.cmd run creator:check -- --require-model
```

然后在可见浏览器做一次不外发的真实验收：

1. 打开达人页，截图顶部计数与“本地已保存”。
2. 任取一位达人，填写临时备注并刷新页面，确认备注仍在；验收后可删掉临时备注。
3. 点击“生成联系草稿”，只在来源为 `model-computer` 后截图草稿状态。
4. 修改草稿一个词、人工确认；不要真的发送邮件或 IG。
5. 回传健康接口、达人数量、模型来源、持久化结果和截图路径。

通过条件：健康接口 `ok: true`、`creatorCount >= 188`；刷新不丢数据；模型实测来源 `model-computer`；页面无报错；没有发生任何外部发送。

## 8. 常见故障

- 页面显示“服务未连接”：不要用 `npm run dev` 代替正式启动；重新运行根目录 CMD，并检查 5173 端口。
- 模型来源为 `local-template-fallback`：先运行 `Test-NetConnection 127.0.0.1 -Port 16081`，再检查店长电脑 frpc visitor 和模型电脑 Qwen。
- 达人少于 188：停止操作，保留 `apps\web\data\creator-crm`，运行 `npm run creator:check` 并交给 Agent；不要点清空或手工删数据目录。
- EchoTik 同步失败：先用导出文件导入；不要因此阻塞本地筛选、草稿和跟进。
- 邮件/IG 没发出去：工作台只准备草稿并记录，发送仍由店长在邮件客户端/Instagram 中人工完成。
