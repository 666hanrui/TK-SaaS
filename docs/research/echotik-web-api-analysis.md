# EchoTik Web 端达人库内部 API 分析

## 测试方法
使用 Playwright 打开 `https://echotik.live/influencers`，拦截所有 XHR/Fetch 请求，保存请求与响应。脚本位置：`apps/web/scripts/inspect-echotik-api.mjs`。

## 核心发现

### 1. 网页内部 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `https://echotik.live/api/v1/data/influencers` | GET | 达人列表数据 |
| `https://echotik.live/api/v1/data/influencers/filters` | GET | 所有可用筛选条件 |
| `https://echotik.live/api/v1/data/products/product-category` | GET | 商品类目 |

默认请求示例：

```
GET /api/v1/data/influencers?page=1&per_page=10
  &influencer_categories=
  &product_categories=
  &show_case=
  &is_email=
  &order=follower_30d_count
  &sort=desc
```

### 2. 响应字段（包含性别，但需登录才显示真实值）

未登录状态下，所有数值字段返回 `"N/A"`，但字段Schema完整：

```json
{
  "influencer_id": "6676194683532821509",
  "influencer_name": "Oliver Tree",
  "avatar_url": "https://cdn.echotik.live/...",
  "unique_id": "olivertree",
  "gender": "N/A",
  "region": "N/A",
  "category": "N/A",
  "follower_count": "N/A",
  "follower_30d_count": "N/A",
  "heart_count": "N/A",
  "video_count": "N/A",
  "live_count": "N/A",
  "total_product_cnt": "N/A",
  "engagement_rate": "N/A",
  "views_per_video_30d": "N/A",
  "sales": "N/A",
  "gmv": "N/A",
  "gmv_amt_30d": "N/A",
  ...
}
```

**关键结论**：网页内部 API 已经包含 `gender` 字段，可以通过参数 `gender=female` 直接筛选女性达人。不需要调用昂贵的官方 API。

### 3. 可用筛选条件（more_filters）

`/api/v1/data/influencers/filters` 返回的可用筛选项：

- `gender`：男性 / 女性 —— **创作者性别**
- `follower_genders`：男性居多 / 女性居多 —— **粉丝性别分布**
- `follower_ages`：18-24 / 25-34 / 35-44 / 45-54 / 55+ —— **粉丝年龄分布**
- `language`：en / es / id / th / vi / my / fil / zh / other
- `contact`：email / twitter / youtube / instagram
- `is_email`：是否有邮箱
- `is_seller`：个人达人 / 店铺达人
- `sales_flag`：不确定 / 视频带货 / 直播带货 / 视频&直播带货
- `show_case`：是否开通橱窗
- `followers_count`、`likes_count`、`gmv`、`gmv_amt_30d` 等数值区间
- `engagement_rate`：互动率区间
- `views_per_video*`：播放量区间
- `inlfuencer_type`：视频达人 / 直播达人

### 4. 缺失字段

**没有族裔/人种（ethnicity/race）筛选，也没有该字段。**
对于黑人女性发型类目，族裔无法通过 EchoTik 网页 API 直接获取，需要外部 enrichment：

- 头像/视频画面 AI 识别（FairFace / DeepFace）
- TikTok 主页 bio / hashtag / 内容分析
- 受众画像间接推断（女性 + 18-34 + 美国 + 美妆/生活方式类目）

## 下一步建议

### 短期：用网页内部 API 替代官方付费 API
1. 在登录态下（携带 Cookie）调用 `https://echotik.live/api/v1/data/influencers`。
2. 使用 `gender=female` 直接筛选女性达人。
3. 使用 `follower_genders=female` + `follower_ages=18-24,25-34` 筛选受众以女性为主的达人。
4. 使用 `contact=email` 或 `is_email=1` 筛选有联系方式的达人。

### 中期：族裔 enrichment
对通过上述筛选拿到的达人列表，用本地 AI 模型对头像/视频画面做族裔分类，作为粗筛补充。

## 注意事项
- 网页 API 依赖登录 Cookie，Token 会过期，需要定期更新。
- 大量请求可能触发 EchoTik 反爬，建议控制频率（如 1-2 秒/请求）。
- 该方式不属于官方 API，存在接口变更风险。
