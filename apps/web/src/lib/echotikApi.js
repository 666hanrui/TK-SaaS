const API_BASE = "/api/echotik";
const ECHOTIK_USER = import.meta.env.VITE_ECHOTIK_USERNAME || "";
const ECHOTIK_PASS = import.meta.env.VITE_ECHOTIK_PASSWORD || "";
const CREDENTIALS = typeof btoa !== "undefined" ? btoa(`${ECHOTIK_USER}:${ECHOTIK_PASS}`) : "";

async function callApi(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${CREDENTIALS}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`EchoTik API error: ${response.status}`);
  }

  const data = await response.json();
  if (data.code !== 0) {
    throw new Error(data.message || "EchoTik API returned error");
  }

  return data.data;
}

export const ECHOTIK_PAGE_SIZE = 10;

export async function fetchInfluencerList({
  region = "US",
  pageNum = 1,
  categoryId = "",
  minFollowers = 1000,
  keyword = "",
} = {}) {
  const params = {
    region,
    page_num: pageNum,
    page_size: ECHOTIK_PAGE_SIZE,
    sales_flag: 1,
  };

  if (categoryId) params.product_category_id = categoryId;
  if (minFollowers) params.min_total_followers_cnt = minFollowers;

  const data = await callApi("/influencer/list", params);

  let list = data.list || data || [];
  if (keyword) {
    const kw = keyword.toLowerCase();
    list = list.filter(
      (item) =>
        (item.nick_name || "").toLowerCase().includes(kw) ||
        (item.unique_id || "").toLowerCase().includes(kw) ||
        (item.signature || "").toLowerCase().includes(kw) ||
        (item.contact_email || "").toLowerCase().includes(kw),
    );
  }

  return {
    total: data.total || list.length,
    list: list.map(normalizeInfluencer),
  };
}

export async function fetchInfluencerDetail(userIds) {
  const ids = Array.isArray(userIds) ? userIds.join(",") : userIds;
  const data = await callApi("/influencer/detail", { user_ids: ids });
  const list = data.list || data || [];
  return list.map(normalizeInfluencer);
}

export async function fetchInfluencerVideos(userId, { pageNum = 1, sortField = 1, sortType = 1 } = {}) {
  const data = await callApi("/influencer/video/list", {
    user_id: userId,
    page_num: pageNum,
    page_size: ECHOTIK_PAGE_SIZE,
    influencer_video_sort_field: sortField,
    sort_type: sortType,
  });

  const list = data.list || [];
  return {
    total: data.total || 0,
    list: list.map(normalizeVideo),
  };
}

export async function fetchProductVideos(productId, { pageNum = 1, sortField = 1, sortType = 1 } = {}) {
  const data = await callApi("/product/video/list", {
    product_id: productId,
    page_num: pageNum,
    page_size: ECHOTIK_PAGE_SIZE,
    product_video_sort_field: sortField,
    sort_type: sortType,
  });

  const list = data.list || [];
  return {
    total: data.total || 0,
    list: list.map(normalizeVideo),
  };
}

const CDN_BASE = "https://echosell-images.tos-ap-southeast-1.volces.com";
const CDN_PROXY = "/api/echotik-cdn";

function proxyCdnUrl(url) {
  if (!url || typeof url !== "string") return "";
  if (url.startsWith(CDN_BASE)) {
    return CDN_PROXY + url.slice(CDN_BASE.length);
  }
  return url;
}

function normalizeInfluencer(raw) {
  const followers = raw.total_followers_cnt || 0;
  const productCount = raw.total_product_cnt || 0;
  const handle = raw.unique_id || "";

  return {
    id: `echotik-${raw.user_id || ""}`,
    rawId: raw.user_id || "",
    handle,
    uniqueId: handle,
    displayName: raw.nick_name || handle || "Unknown",
    avatar: proxyCdnUrl(raw.avatar) || "",
    followers,
    signature: raw.signature || "",
    bio: raw.signature || "",
    category: raw.category || "",
    language: raw.language || "",
    region: raw.region || "",
    ecScore: raw.ec_score || 0,
    ecScoreNumber: typeof raw.ec_score === "number" ? raw.ec_score : 0,
    interactionRate: raw.interaction_rate || 0,
    totalDiggCnt: raw.total_digg_cnt || 0,
    totalViewsCnt: raw.total_views_cnt || 0,
    totalVideoCnt: raw.total_post_video_cnt || 0,
    totalProductCnt: productCount,
    salesFlag: raw.sales_flag || 0,
    showCaseFlag: raw.show_case_flag || 0,
    totalSaleCnt: raw.total_sale_cnt || 0,
    totalSaleGmv: raw.total_sale_gmv_amt || 0,
    contactEmail: raw.contact_email || "",
    profileUrl: handle ? `https://www.tiktok.com/@${handle}` : "",
    source: "EchoTik API",
  };
}

function normalizeVideo(raw) {
  return {
    id: raw.video_id || "",
    description: raw.video_desc || "",
    coverUrl: proxyCdnUrl(raw.reflow_cover) || "",
    duration: raw.duration || 0,
    createTime: raw.create_time ? Number(raw.create_time) : 0,
    createDate: raw.create_time
      ? new Date(Number(raw.create_time) * 1000).toISOString().split("T")[0]
      : "",
    views: raw.total_views_cnt || 0,
    likes: raw.total_digg_cnt || 0,
    comments: raw.total_comments_cnt || 0,
    shares: raw.total_shares_cnt || 0,
    favorites: raw.total_favorites_cnt || 0,
    salesCount: raw.total_video_sale_cnt || 0,
    salesGmv: raw.total_video_sale_gmv_amt || 0,
    hasProducts: (raw.sales_flag || 0) === 1,
    productIds: parseProductIds(raw.video_products),
  };
}

function parseProductIds(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.replace(/[[\]"]/g, "").split(",").filter(Boolean);
    }
  }
  return [];
}

export function mapInfluencerToCreatorLead(inf) {
  const products = inf.totalProductCnt || 0;
  const followers = inf.followers || 0;
  const likesFollowerRatio = followers > 0 ? (inf.totalDiggCnt || 0) / followers : 0;
  return {
    id: inf.id,
    handle: inf.handle || inf.uniqueId,
    displayName: inf.displayName,
    followers,
    crmStatus: "imported",
    source: inf.source || "EchoTik API",
    description: inf.signature || inf.bio || `EchoTik 导入达人`,
    recommendedProducts: [],
    matchedKeywords: [],
    highPerformingCoverUrl: inf.avatar || "",
    productAssociatedVideos: [],
    contact: {
      email: inf.contactEmail || "",
      instagram: "",
      notes: inf.contactEmail
        ? "邮箱来自达人主页公开信息"
        : "待人工打开 TikTok 主页确认联系方式",
    },
    recentVideos: [],
    ecScore: inf.ecScoreNumber,
    totalDiggCnt: inf.totalDiggCnt,
    totalViewsCnt: inf.totalViewsCnt,
    totalProductCnt: products,
    salesFlag: inf.salesFlag,
    region: inf.region,
    category: inf.category,
    er: inf.interactionRate,
    totalVideoCount: inf.totalVideoCnt,
    likesFollowerRatio,
    followerGrowth30d: 0,
    avgViews30d: 0,
    gmv30d: 0,
    salesCount: inf.totalSaleCnt,
    salesGmv: inf.totalSaleGmv,
    videoSalesGmv: 0,
    liveSalesGmv: 0,
  };
}
