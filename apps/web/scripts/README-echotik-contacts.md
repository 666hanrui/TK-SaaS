# EchoTik 达人详情页联系方式抓取

从 EchoTik 达人详情页批量抓取邮箱、Instagram、YouTube、Twitter、Linktree。

## 前提

- EchoTik 专业版/企业版账号（且未过期）
- 已用 `fetch-echotik-web.mjs --login` 保存登录状态

## 使用步骤

### 1. 确保已登录并保存状态

```bash
cd /Users/hanrui/TK\ SAAS/apps/web
node scripts/fetch-echotik-web.mjs --login
```

登录后关闭浏览器。

### 2. 运行联系方式抓取

```bash
node scripts/fetch-echotik-contacts.mjs \
  --input output/inspect/echotik-web-xxx.json \
  --limit 20
```

参数：
- `--input`: 扩展导出的 JSON 文件路径
- `--limit`: 只处理前 N 条（建议先测 20 条）
- `--delay`: 每页间隔毫秒，默认 2000
- `--discover`: 自动探测详情页 URL 模式

### 3. 查看输出

会在 `output/inspect/` 下生成：
- `echotik-contacts-xxx.json` —— 完整数据
- `echotik-contacts-xxx.csv` —— 仅联系方式，方便查看

## 探测详情页 URL

如果不确定详情页地址，先跑：

```bash
node scripts/fetch-echotik-contacts.mjs \
  --input output/inspect/echotik-web-xxx.json \
  --limit 1 \
  --discover
```

脚本会尝试以下 URL 模式并输出匹配到的：
- `https://echotik.live/influencer/{id}`
- `https://echotik.live/influencers/{id}`
- `https://echotik.live/creator/{id}`
- `https://echotik.live/influencer-detail/{id}`

## 注意事项

- 速度不要太快，建议 delay 2000ms 以上，避免触发反爬
- 专业版 2 天后到期，到期后可能无法查看详情页联系方式
- 抓取成功率取决于 EchoTik 是否在详情页展示联系方式
- 抓到的邮箱建议人工抽样验证
