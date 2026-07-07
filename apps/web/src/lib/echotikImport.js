const defaultKeywords = [
  "drawstring ponytail",
  "half wig",
  "wig",
  "crochet hair",
  "braids",
  "black girl",
];

const missingTokens = new Set(["", "n/a", "na", "null", "undefined", "--", "-"]);

const emailPlaceholders = new Set(["企业版可导出", "enterprise only", "暂无", "无", "—", "--", "-"]);

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "");
}

function isMissingValue(value) {
  return missingTokens.has(String(value ?? "").trim().toLowerCase());
}

function getField(row, aliases) {
  const normalizedEntries = Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]);

  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    const match = normalizedEntries.find(([key]) => key === normalizedAlias);

    if (match && !isMissingValue(match[1])) {
      return match[1];
    }
  }

  return "";
}

function cleanHandle(value) {
  const rawValue = String(value ?? "").trim();

  if (!rawValue) {
    return "";
  }

  const urlMatch = rawValue.match(/tiktok\.com\/@([^/?\s]+)/i);
  const handle = urlMatch ? urlMatch[1] : rawValue;

  return handle.replace(/^@/, "").trim();
}

function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (isMissingValue(value)) {
    return null;
  }

  const text = String(value ?? "")
    .trim()
    .replace(/[$,]/g, "")
    .toLowerCase();
  const suffixMatch = text.match(/^(-?\d+(?:\.\d+)?)\s*([kmb万])?$/i);

  if (suffixMatch) {
    const number = Number(suffixMatch[1]);
    const suffix = suffixMatch[2];
    const multiplier =
      suffix === "k"
        ? 1000
        : suffix === "m"
          ? 1000000
          : suffix === "万"
            ? 10000
            : suffix === "b"
              ? 1000000000
              : 1;

    if (!Number.isFinite(number)) {
      return null;
    }

    const result = number * multiplier;
    return suffix ? Math.round(result) : result;
  }

  const fallback = Number(text.replace(/[^\d.-]/g, ""));

  return Number.isFinite(fallback) ? fallback : null;
}

function parseDelimitedRows(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/\t/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? "\t" : ",";
  const rows = [];
  let current = "";
  let row = [];
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === delimiter && !insideQuotes) {
      row.push(current.trim());
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(current.trim());
      current = "";
      if (row.some((cell) => cell !== "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    current += char;
  }

  row.push(current.trim());
  if (row.some((cell) => cell !== "")) {
    rows.push(row);
  }

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0];

  return rows.slice(1).map((cells) =>
    headers.reduce((record, header, index) => {
      record[header] = cells[index] ?? "";
      return record;
    }, {}),
  );
}

function parseStructuredRows(text) {
  const parsed = JSON.parse(text);

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (Array.isArray(parsed?.data)) {
    return parsed.data;
  }

  if (Array.isArray(parsed?.data?.data)) {
    return parsed.data.data;
  }

  return [];
}

function parseEmail(rowText) {
  const match = rowText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const email = match?.[0] ?? "";

  return emailPlaceholders.has(email) ? "" : email;
}

function parseExplicitKeywords(row, keywords) {
  const rawValue = getField(row, ["matchedKeywords", "matched_keywords", "keywords", "keyword", "hashtag"]);

  if (!rawValue) {
    return [];
  }

  const normalizedValue = String(rawValue).toLowerCase();

  return keywords.filter((keyword) => normalizedValue.includes(keyword.toLowerCase()));
}

function inferMatchedKeywords(row, keywords) {
  const explicitKeywords = parseExplicitKeywords(row, keywords);
  const rowText = Object.values(row).join(" ").toLowerCase();
  const inferredKeywords = keywords.filter((keyword) => rowText.includes(keyword.toLowerCase()));

  return [...new Set([...explicitKeywords, ...inferredKeywords])];
}

function getRowText(row) {
  return Object.values(row)
    .filter((value) => !isMissingValue(value))
    .join(" ");
}

function extractRecentVideos(row, id) {
  const videoMap = new Map();

  Object.entries(row).forEach(([key, value]) => {
    if (isMissingValue(value)) {
      return;
    }

    const normalizedKey = normalizeHeader(key);
    const viewsMatch = normalizedKey.match(/video(\d+).*view/);
    const dateMatch = normalizedKey.match(/video(\d+).*(date|create|publish|time)/);
    const coverMatch = normalizedKey.match(/video(\d+).*(cover|thumb|image)/);
    const match = viewsMatch ?? dateMatch ?? coverMatch;

    if (!match) {
      return;
    }

    const videoIndex = Number(match[1]);
    const currentVideo = videoMap.get(videoIndex) ?? {
      id: `${id}-video-${videoIndex}`,
    };

    if (viewsMatch) {
      currentVideo.views = parseNumber(value) ?? 0;
    }

    if (dateMatch) {
      currentVideo.createDate = String(value).trim();
    }

    if (coverMatch) {
      currentVideo.coverUrl = String(value).trim();
    }

    videoMap.set(videoIndex, currentVideo);
  });

  const indexedVideos = [...videoMap.entries()]
    .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .map(([, video]) => video)
    .filter((video) => Number(video.views ?? 0) > 0 || video.createDate || video.coverUrl);

  if (indexedVideos.length > 0) {
    return indexedVideos;
  }

  const averageViews = parseNumber(
    getField(row, [
      "views_per_video_30d",
      "views_per_video",
      "Avg. views per video",
      "average views per video",
      "avg_views_per_video",
      "Views",
      "平均播放量(近30天)",
      "近30天播放量",
      "近 30 天 播放量",
    ]),
  );

  return averageViews
    ? [
        {
          id: `${id}-video-1`,
          views: averageViews,
        },
      ]
    : [];
}

function buildProductEvidence(id, productCount) {
  return Array.from({ length: Math.min(productCount, 12) }, (_, index) => `${id}-product-${index + 1}`);
}

function sanitizeId(value, fallback) {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeEchoTikCreatorRows(rows, options = {}) {
  const keywords = options.keywords ?? defaultKeywords;
  const sourceName = options.sourceName || "uploaded file";

  return rows
    .map((row, index) => {
      const influencerId = String(
        getField(row, [
          "influencer_id",
          "UID",
          "uid",
          "creator_id",
          "creator id",
          "user_id",
          "User Id",
          "user id",
          "用户ID",
          "达人ID",
        ]) || "",
      ).trim();
      const handle = cleanHandle(
        getField(row, [
          "unique_id",
          "Unique Id",
          "TikTok ID",
          "tiktok_id",
          "handle",
          "profile_url",
          "profile url",
          "TikTok profile",
          "tiktok profile",
          "TikTok账号",
          "达人账号",
        ]),
      );
      const safeId = `echotik-${sanitizeId(influencerId || handle, index + 1)}`;
      const displayName =
        String(
          getField(row, [
            "influencer_name",
            "Influencer",
            "nick_name",
            "nickname",
            "creator",
            "name",
            "达人名称",
            "达人昵称",
            "名称",
            "昵称",
            "主播名称",
            "创作者名称",
          ]) || "",
        ).trim() || handle || `EchoTik Creator ${index + 1}`;
      const rowText = getRowText(row);
      const followerCount = parseNumber(
        getField(row, [
          "follower_count",
          "followers_count",
          "Followers",
          "followers",
          "total_followers_cnt",
          "粉丝数",
        ]),
      );
      const followerGrowth30d = parseNumber(
        getField(row, ["30天涨粉数", "30天增粉", "follower_growth_30d", "follower_growth"]),
      );
      const likesFollowerRatio = parseNumber(
        getField(row, ["点赞数/粉丝数", "获赞数/粉丝数", "likes_follower_ratio", "digg_follower_ratio"]),
      );
      const totalVideoCount = parseNumber(
        getField(row, ["视频数", "total_video_cnt", "video_count", "videos"]),
      );
      const productCount = parseNumber(
        getField(row, [
          "total_product_cnt",
          "No. of Products",
          "products",
          "product_count",
          "product cnt",
          "带货商品数",
          "商品数",
        ]),
      );
      const recentVideos = extractRecentVideos(row, safeId);
      const profileUrl =
        String(getField(row, ["profile_url", "profile url", "TikTok profile", "tiktok profile"]) || "").trim() ||
        (handle ? `https://www.tiktok.com/@${handle}` : "");
      const bio = String(getField(row, ["bio", "description", "profile", "creator bio"]) || "").trim();
      const avatarUrl = String(getField(row, ["avatar_url", "avatar", "Avatar", "avatar url"]) || "").trim();
      const highPerformingCoverUrl =
        recentVideos.find((video) => video.coverUrl)?.coverUrl ||
        String(getField(row, ["cover_url", "cover", "video cover", "thumbnail", "thumb"]) || "").trim() ||
        avatarUrl;
      const email = parseEmail(
        [
          getField(row, ["email", "Email", "contact", "contact_way", "contact way", "联系邮箱"]),
          bio,
          rowText,
        ].join(" "),
      );
      const region = String(getField(row, ["region", "country", "地区", "国家"]) || "").trim();
      const category = String(
        getField(row, ["category", "categories", "product_category", "category_product", "主打带货品类", "品类", "类目"]) || "",
      ).trim();
      const gmv30d = parseNumber(getField(row, ["近30天GMV($)", "近30天GMV", "30天GMV", "gmv_30d", "gmv30d"]));
      const salesCount = parseNumber(getField(row, ["销量", "sales_count", "sale_count", "total_sale_cnt"]));
      const salesGmv = parseNumber(getField(row, ["销售额($)", "销售额", "sales_gmv", "total_sale_gmv_amt"]));
      const videoSalesGmv = parseNumber(getField(row, ["视频销售额($)", "视频销售额", "video_sales_gmv"]));
      const liveSalesGmv = parseNumber(getField(row, ["直播销售额($)", "直播销售额", "live_sales_gmv"]));
      const er = parseNumber(getField(row, ["ER互动率", "互动率", "interaction_rate", "engagement_rate", "ER"]));
      const avgViews30d = parseNumber(
        getField(row, ["平均播放量(近30天)", "近30天播放量", "近 30 天 播放量", "avg_views_30d", "avg views 30d"]),
      );
      const socialAccount = String(getField(row, ["社交账号", "social_account", "social", "socials"]) || "").trim();
      const sourceDataWarnings = [];

      if (followerCount === null) {
        sourceDataWarnings.push("粉丝字段缺失");
      }

      if (recentVideos.length === 0) {
        sourceDataWarnings.push("播放字段缺失");
      }

      if (productCount === null) {
        sourceDataWarnings.push("商品关联字段缺失");
      }

      return {
        id: safeId,
        handle,
        displayName,
        followers: followerCount ?? 0,
        crmStatus: "imported",
        source: `EchoTik export: ${sourceName}`,
        sourceDataWarnings,
        profileUrl,
        description:
          bio || category || "EchoTik 导入达人，等待补充视频封面、近期播放和联系方式。",
        recommendedProducts: [],
        matchedKeywords: inferMatchedKeywords(row, keywords),
        highPerformingCoverUrl,
        productAssociatedVideos: buildProductEvidence(safeId, productCount ?? 0),
        contact: {
          email,
          instagram: "",
          socialAccount,
          notes: sourceDataWarnings.length
            ? `EchoTik 字段待补：${sourceDataWarnings.join("、")}`
            : "EchoTik 导入，待人工打开 TikTok 主页二次确认联系方式。",
        },
        recentVideos,
        region,
        category,
        gmv30d: gmv30d ?? 0,
        salesCount: salesCount ?? 0,
        salesGmv: salesGmv ?? 0,
        videoSalesGmv: videoSalesGmv ?? 0,
        liveSalesGmv: liveSalesGmv ?? 0,
        er: er ?? 0,
        avgViews30d: avgViews30d ?? 0,
        followerGrowth30d: followerGrowth30d ?? 0,
        likesFollowerRatio: likesFollowerRatio ?? 0,
        totalVideoCount: totalVideoCount ?? 0,
      };
    })
    .filter((creator) => creator.handle || creator.displayName);
}

export function parseEchoTikCreatorImport(text, options = {}) {
  const trimmedText = String(text ?? "").trim();

  if (!trimmedText) {
    return [];
  }

  const rows = /^[{[]/.test(trimmedText) ? parseStructuredRows(trimmedText) : parseDelimitedRows(trimmedText);

  return normalizeEchoTikCreatorRows(rows, options);
}
