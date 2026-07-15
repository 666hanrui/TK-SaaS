import { buildTikTokProfileUrl, evaluateCreatorLead } from "./operations";

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanInstagramCandidate(value) {
  return cleanText(value).replace(/^[(@\s]+/, "").replace(/[)\],，;；\s]+$/g, "");
}

function toInstagramProfileUrl(handle) {
  const cleanHandle = cleanInstagramCandidate(handle).replace(/^@/, "");
  if (!/^[a-z0-9._]{1,30}$/i.test(cleanHandle)) return "";
  return `https://www.instagram.com/${cleanHandle}`;
}

function hasNonInstagramPlatformLabel(value) {
  return /^\s*(youtube|yt|tiktok|tik\s*tok|facebook|fb|twitter|x|snapchat|pinterest|website|site|email)\s*[:：]/i.test(
    value,
  );
}

function extractInstagramUrl(value, { allowBareHandle = false } = {}) {
  const text = cleanText(value);
  if (!text) return "";

  const urlMatch = text.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/[^\s,，;；)]+/i);
  if (urlMatch) {
    const withProtocol = urlMatch[0].startsWith("http") ? urlMatch[0] : `https://${urlMatch[0]}`;
    try {
      const url = new URL(cleanInstagramCandidate(withProtocol));
      if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return "";
      const [handle] = url.pathname.split("/").filter(Boolean);
      const reservedPaths = new Set([
        "about",
        "accounts",
        "developer",
        "direct",
        "explore",
        "p",
        "privacy",
        "reel",
        "reels",
        "stories",
        "terms",
        "tv",
      ]);
      if (!handle || reservedPaths.has(handle.toLowerCase())) return "";
      return toInstagramProfileUrl(decodeURIComponent(handle));
    } catch {
      return "";
    }
  }

  if (hasNonInstagramPlatformLabel(text)) return "";

  const handleMatch = text.match(/(?:^|[\s,;；，])(?:instagram|ig)\s*[:：]?\s*@?([a-z0-9._]{1,30})(?:\b|$)/i);
  if (handleMatch) return toInstagramProfileUrl(handleMatch[1]);

  if (allowBareHandle) return toInstagramProfileUrl(text);

  return "";
}

function extractInstagramSocialUrl(value) {
  const text = cleanText(value);
  if (!text) return "";

  const handleMatch = text.match(/(?:^|[\s,;；，])(?:instagram|ig)\s*[:：]?\s*@?([a-z0-9._]{1,30})(?:\b|$)/i);
  return handleMatch ? toInstagramProfileUrl(handleMatch[1]) : "";
}

export function getInstagramProfileUrl(creator) {
  return (
    extractInstagramUrl(creator?.contact?.instagram, { allowBareHandle: true }) ||
    extractInstagramUrl(creator?.contact?.socialAccount) ||
    extractInstagramSocialUrl(creator?.contact?.socialAccount)
  );
}

function compactObject(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== "";
    }),
  );
}

function parseJsonText(value) {
  const text = cleanText(value)
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function isUsableOutreachDraft(value) {
  const text = cleanText(value);
  if (!text) return false;
  if (/^\{\s*"[^"]*"\s*:\s*"[^"]*$/s.test(text)) return false;
  if (text.startsWith("{") && Object.keys(parseJsonText(text)).length === 0) return false;
  return true;
}

function normalizeOutreachDraft(value) {
  const text = cleanText(value);
  const parsed = parseJsonText(text);
  const parsedDraft = cleanText(parsed.draft || parsed.message || parsed.text);
  const draft = parsedDraft || text;

  return isUsableOutreachDraft(draft) ? draft : "";
}

function getVideoUrl(video, creator) {
  const handle = cleanText(video?.uniqueId || creator?.handle).replace(/^@/, "");
  const videoId = cleanText(video?.videoId || video?.id);

  return (
    video?.videoUrl ||
    video?.shareUrl ||
    (handle && videoId ? `https://www.tiktok.com/@${handle}/video/${videoId}` : "")
  );
}

function getCreatorProfileUrl(creator) {
  return buildTikTokProfileUrl(creator.profileUrl || creator.handle || creator.rawId);
}

export function buildCreatorAutomationPayload(creator, options = {}) {
  const evaluation = evaluateCreatorLead(creator, options.now ?? new Date());
  const action = options.action || "draft";
  const isRecordSentAction = action === "record_sent";
  const confirmedAt = options.confirmedAt || creator.automation?.outreach?.confirmedAt;
  const confirmedBy = options.confirmedBy || creator.automation?.outreach?.confirmedBy;
  const draft = options.draft || creator.automation?.outreach?.draft || "";
  const instagramUrl = getInstagramProfileUrl(creator);
  const channel =
    options.channel ||
    (creator.contact?.email ? "email" : instagramUrl ? "instagram" : "manual");
  const recentVideos = (creator.recentVideos ?? []).slice(0, 10).map((video) =>
    compactObject({
      id: video.id,
      videoId: video.videoId || video.id,
      title: video.title || video.description,
      views: asNumber(video.views),
      createDate: video.createDate,
      videoUrl: getVideoUrl(video, creator),
      coverUrl: video.coverUrl,
      hasProducts:
        Boolean(video.hasProducts) ||
        (video.productIds ?? []).length > 0 ||
        asNumber(video.salesCount) > 0,
    }),
  );

  return {
    action,
    allowSend: Boolean(isRecordSentAction && options.allowSend && confirmedAt),
    channel,
    dryRun: isRecordSentAction ? false : options.dryRun !== false,
    requestedAt: options.requestedAt || new Date().toISOString(),
    source: "tk-saas-web",
    confirmation: compactObject({
      confirmedAt,
      confirmedBy,
    }),
    message: compactObject({
      draft,
      subject: options.subject,
    }),
    creator: compactObject({
      id: creator.id,
      rawId: creator.rawId,
      displayName: creator.displayName,
      handle: cleanText(creator.handle).replace(/^@/, ""),
      profileUrl: getCreatorProfileUrl(creator),
      description: creator.description,
      region: creator.region,
      category: creator.category,
      source: creator.source,
      contact: compactObject({
        email: creator.contact?.email,
        instagram: creator.contact?.instagram,
        instagramUrl,
        socialAccount: creator.contact?.socialAccount,
        notes: creator.contact?.notes,
      }),
      matchedKeywords: creator.matchedKeywords ?? [],
      metrics: {
        followers: evaluation.followers,
        avgViews30d: asNumber(creator.avgViews30d),
        er: asNumber(creator.er),
        gmv30d: asNumber(creator.gmv30d),
        salesGmv: asNumber(creator.salesGmv),
        salesCount: asNumber(creator.salesCount),
        totalProductCnt: asNumber(creator.totalProductCnt),
        stableVideoCount: evaluation.stableVideoCount,
        daysSinceLastPost: evaluation.daysSinceLastPost,
        productVideoCount: evaluation.productVideoCount,
        keywordCount: evaluation.keywordCount,
      },
      evidence: {
        qualified: evaluation.qualified,
        gaps: evaluation.gaps,
        recentVideos,
      },
    }),
  };
}

export function createLocalOutreachDraft(creator) {
  const name = cleanText(creator.displayName) || cleanText(creator.handle) || "there";
  const handle = cleanText(creator.handle).replace(/^@/, "");
  const profileLine = handle ? `I found your TikTok @${handle}` : "I found your TikTok profile";
  const keywords = (creator.matchedKeywords ?? []).slice(0, 4);
  const nicheLine = keywords.length
    ? `Your content fits our ${keywords.join(" / ")} creator list.`
    : "Your beauty and hair content fits our creator list.";

  return [
    `Hi ${name},`,
    "",
    `${profileLine} and liked the way your hair content connects with your audience. ${nicheLine}`,
    "",
    "We are preparing a first collaboration wave for drawstring ponytail, half wig, crochet hair, and braids products. The starting offer is free product + paid collaboration + commission, with TikTok Shop videos as the main deliverable.",
    "",
    "Would you be open to reviewing the details if the product style matches your audience?",
    "",
    "Best regards",
    "TK-SaaS Creator Team",
  ].join("\n");
}

export function normalizeCreatorAutomationState(creator) {
  const outreach = creator?.automation?.outreach;
  if (!outreach?.draft) return creator;

  const normalizedDraft = normalizeOutreachDraft(outreach.draft);
  if (normalizedDraft === outreach.draft) return creator;

  return {
    ...creator,
    automation: {
      ...creator.automation,
      outreach: {
        ...outreach,
        draft: normalizedDraft || (outreach.status === "draft_ready" ? createLocalOutreachDraft(creator) : ""),
      },
    },
  };
}

export function applyCreatorAutomationResult(creators, creatorId, result) {
  return creators.map((creator) => {
    if (creator.id !== creatorId) {
      return creator;
    }

    const previousOutreach = creator.automation?.outreach ?? {};
    const status = result.status ?? previousOutreach.status ?? "queued";
    const normalizedDraft = normalizeOutreachDraft(result.draft ?? result.message);
    const draft =
      normalizedDraft ||
      (status === "draft_ready" ? createLocalOutreachDraft(creator) : previousOutreach.draft ?? "");
    const nextOutreach = {
      ...previousOutreach,
      queueId: result.queueId ?? previousOutreach.queueId,
      status,
      source: result.source ?? previousOutreach.source ?? "local",
      subject: result.subject ?? previousOutreach.subject,
      draft,
      error: result.error ?? (["failed", "blocked"].includes(status) ? result.message : "") ?? "",
      confirmedAt: result.confirmedAt ?? previousOutreach.confirmedAt,
      confirmedBy: result.confirmedBy ?? previousOutreach.confirmedBy,
      sentAt: result.sentAt ?? previousOutreach.sentAt,
      chatwoot: result.chatwoot ?? previousOutreach.chatwoot,
      requestedAt: result.requestedAt ?? previousOutreach.requestedAt,
      updatedAt: result.updatedAt ?? new Date().toISOString(),
      dryRun: result.dryRun !== false,
      allowSend: Boolean(result.allowSend),
      history: [
        ...(previousOutreach.history ?? []),
        compactObject({
          queueId: result.queueId,
          status: result.status ?? "queued",
          source: result.source,
          subject: result.subject,
          message: result.message,
          chatwoot: result.chatwoot,
          confirmedAt: result.confirmedAt,
          sentAt: result.sentAt,
          updatedAt: result.updatedAt ?? new Date().toISOString(),
        }),
      ],
    };

    return {
      ...creator,
      crmStatus: result.crmStatus ?? creator.crmStatus,
      automation: {
        ...creator.automation,
        outreach: nextOutreach,
      },
    };
  });
}
