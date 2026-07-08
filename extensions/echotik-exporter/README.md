# EchoTik 达人库导出助手（Edge 浏览器扩展）

在 EchoTik 达人库页面一键导出筛选后的达人列表，支持 JSON/CSV 格式。

## 功能

- 自动拦截 `https://echotik.live/api/v1/data/influencers` 响应
- 在页面右下角显示导出面板
- 翻页/筛选时自动累计数据，去重
- 一键导出 JSON（完整原始字段）
- 一键导出 CSV（与项目 CRM 导入模板对齐的字段）
- 所有数据只在本地浏览器处理，不上传服务器

## 安装步骤（Edge）

1. 打开 Edge 浏览器，地址栏输入 `edge://extensions/` 并回车
2. 左下角打开「开发人员模式」
3. 点击「加载解压缩的扩展」
4. 选择本文件夹 `extensions/echotik-exporter`
5. 扩展加载成功后，图标会出现在浏览器工具栏

## 使用方法

1. 登录 EchoTik 后，打开 `https://echotik.live/influencers`
2. 在页面右侧会出现「EchoTik 导出助手」面板
3. 在页面顶部设置筛选条件，例如：
   - 性别 = 女性
   - 是否有邮箱 = 有
   - 粉丝画像 = 女性居多
4. 翻页或滚动加载更多达人，面板计数会自动增加
5. 点击「自动采集 N 页」可自动抓取后续 N 页（无需手动翻页）
6. 点击「导出 CSV」或「导出 JSON」下载文件
7. 下载的 CSV 可直接导入本项目的「达人 CRM」

## 自动采集

- 设置好筛选条件后，点击面板里的「自动采集 N 页」
- 输入想要采集的页数（从当前页之后开始）
- 扩展会自动调用 EchoTik 内部 API 翻页，每页间隔 1.5~2.5 秒
- 采集过程中请勿关闭页面或切换标签

## 族裔/性别/年龄 Enrichment

导出的 JSON/CSV 可以用 `tools/creator-enrichment/enrich.py` 做二次 enrichment：

```bash
cd tools/creator-enrichment
python enrich.py --input ../../apps/web/output/inspect/echotik-web-xxx.json
```

详见 `tools/creator-enrichment/README.md`。

## 注意事项

- 必须先登录 EchoTik，否则 API 返回的所有字段都是 `"N/A"`
- 该扩展仅读取页面自身发起的网络请求，不会向 EchoTik 主动发送额外请求
- 大量翻页时建议控制速度，避免触发反爬
