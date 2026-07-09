import { buildTikTokProfileUrl, evaluateCreatorLead } from "./operations";

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function compactObject(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== "";
    }),
  );
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
  const socialAccount = cleanText(creator.contact?.socialAccount).toLowerCase();
  const channel =
    options.channel ||
    (creator.contact?.email
      ? "email"
      : creator.contact?.instagram || socialAccount.includes("instagram")
        ? "instagram"
        : "manual");
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

export function applyCreatorAutomationResult(creators, creatorId, result) {
  return creators.map((creator) => {
    if (creator.id !== creatorId) {
      return creator;
    }

    const previousOutreach = creator.automation?.outreach ?? {};
    const status = result.status ?? previousOutreach.status ?? "queued";
    const nextOutreach = {
      ...previousOutreach,
      queueId: result.queueId ?? previousOutreach.queueId,
      status,
      source: result.source ?? previousOutreach.source ?? "local",
      draft: result.draft ?? result.message ?? previousOutreach.draft ?? "",
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
