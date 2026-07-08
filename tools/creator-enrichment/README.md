# 达人头像族裔/性别/年龄 enrichment

对 EchoTik 导出助手的 JSON/CSV 结果做二次 enrichment：下载达人头像，用 DeepFace 预测性别、年龄、族裔。

## 安装

建议新建虚拟环境：

```bash
cd tools/creator-enrichment
python3 -m venv .venv
source .venv/bin/activate  # Windows 用 .venv\Scripts\activate
pip install -r requirements.txt
```

首次安装会下载 TensorFlow 和 DeepFace 模型，可能需要几分钟。

## 使用

### 从 JSON 导出文件 enrichment

```bash
python enrich.py --input ../../apps/web/output/inspect/echotik-web-female-xxx.json
```

### 从 CSV 文件 enrichment

```bash
python enrich.py --input creators.csv --output creators-enriched.csv
```

### 只处理前 50 条测试

```bash
python enrich.py --input echotik-web-female-xxx.json --limit 50
```

## 输出字段

在原有 CSV 基础上新增：

- `预测性别` —— Male / Female
- `预测年龄` —— 估算年龄
- `预测族裔` —— Asian / Black / Latino_Hispanic / Middle Eastern / White / Indian
- `性别可信度` —— 0~1 之间的置信度
- `族裔可信度` —— 0~1 之间的置信度
- `头像分析状态` —— 成功 / 下载失败 / 分析失败

## 注意事项

- 头像来自 `cdn.echotik.live`，下载成功率取决于 EchoTik 是否限制。
- 族裔预测仅供参考，建议对高价值达人人工复核 TikTok 主页内容。
- 模型对亚洲/白人/黑人区分较好，对戴头巾、滤镜重、侧脸的图片可能误判。
