export const shiftConfig = [
  { id: "morning", title: "上午必做" },
  { id: "afternoon", title: "下午必做" },
  { id: "before_leave", title: "下班前核对" },
];

export function getNavigationItems() {
  return [
    { id: "dashboard", label: "今日总览" },
    { id: "orders", label: "订单发货" },
    { id: "aftersales", label: "售后工单" },
    { id: "reviews", label: "商品评分" },
    { id: "inventory", label: "库存核对" },
    { id: "creators", label: "达人线索" },
    { id: "settings", label: "设置" },
  ];
}

export function groupTasksByShift(tasks) {
  return shiftConfig.map((shift) => ({
    ...shift,
    tasks: tasks.filter((task) => task.shift === shift.id),
  }));
}

export function calculateDashboardMetrics(tasks) {
  const activeTasks = tasks.filter((task) => task.status !== "done");
  const shippingTasks = activeTasks.filter((task) => task.module === "orders");

  return {
    urgentOpenTasks: activeTasks.filter((task) => task.priority === "urgent").length,
    pickupRisk: activeTasks.filter((task) => task.category === "pickup_risk").length,
    shippingWorkload: shippingTasks.filter((task) =>
      ["pickup_risk", "shipping_contact", "delivery_review_invite", "shipping_audit"].includes(
        task.category,
      ),
    ).length,
    aftersalesOpen: activeTasks.filter((task) => task.module === "aftersales").length,
    inventoryExceptions: activeTasks.filter((task) => task.module === "inventory").length,
    badReviewFollowUp: activeTasks.filter((task) => task.category === "bad_review").length,
  };
}

export function sortTasksForManager(tasks) {
  const priorityWeight = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  return [...tasks].sort((left, right) => {
    const priorityDiff = priorityWeight[left.priority] - priorityWeight[right.priority];

    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    if (left.module === "orders" && right.module !== "orders") {
      return -1;
    }

    if (left.module !== "orders" && right.module === "orders") {
      return 1;
    }

    return left.dueTime.localeCompare(right.dueTime);
  });
}

export function filterTasks(tasks, filters) {
  return sortTasksForManager(
    tasks.filter((task) => {
      const matchesModule = filters.module === "all" || task.module === filters.module;
      const matchesPriority = filters.priority === "all" || task.priority === filters.priority;
      const matchesStatus = filters.status === "all" || task.status === filters.status;

      return matchesModule && matchesPriority && matchesStatus;
    }),
  );
}

export function getStatusLabel(status) {
  return (
    {
      open: "待处理",
      processing: "处理中",
      done: "已完成",
      skipped: "已跳过",
    }[status] ?? status
  );
}

export function getPriorityLabel(priority) {
  return (
    {
      urgent: "紧急",
      high: "高",
      medium: "中",
      low: "低",
    }[priority] ?? priority
  );
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseVideoDate(video) {
  const rawDate = video?.createDate ?? video?.publishedAt ?? video?.date;
  const parsed = new Date(rawDate);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getLatestVideos(videos) {
  return [...(videos ?? [])]
    .sort((left, right) => {
      const leftDate = parseVideoDate(left)?.getTime() ?? 0;
      const rightDate = parseVideoDate(right)?.getTime() ?? 0;

      return rightDate - leftDate;
    })
    .slice(0, 10);
}

function getDaysSinceLastPost(videos, now) {
  const latestDate = getLatestVideos(videos)
    .map(parseVideoDate)
    .filter(Boolean)[0];

  if (!latestDate) {
    return null;
  }

  const millisecondsPerDay = 24 * 60 * 60 * 1000;

  return Math.max(0, Math.floor((now.getTime() - latestDate.getTime()) / millisecondsPerDay));
}

export function buildTikTokProfileUrl(handleOrId) {
  const value = String(handleOrId ?? "").trim();

  if (!value) {
    return "";
  }

  if (/^https?:\/\//.test(value)) {
    return value;
  }

  return `https://www.tiktok.com/@${value.replace(/^@/, "")}`;
}

export function evaluateCreatorLead(lead, now = new Date()) {
  const followers = Number(lead.followers ?? lead.followerCount ?? 0);
  const latestVideos = getLatestVideos(lead.recentVideos);
  const stableVideoCount = latestVideos.filter((video) => Number(video.views ?? 0) > 1000).length;
  const daysSinceLastPost = getDaysSinceLastPost(latestVideos, now);
  const productVideoCount = Math.max(
    (lead.productAssociatedVideos ?? []).length,
    Number(lead.totalProductCnt ?? 0),
    (lead.recentVideos ?? []).filter(
      (video) => video?.hasProducts || (video?.productIds ?? []).length > 0 || Number(video?.salesCount ?? 0) > 0,
    ).length,
    lead.salesFlag ? 1 : 0,
  );
  const keywordCount = (lead.matchedKeywords ?? []).length;
  const gaps = [];

  if (followers <= 1000) {
    gaps.push("粉丝不足1000");
  }

  if (stableVideoCount < 6) {
    gaps.push("播放稳定性不足");
  }

  if (daysSinceLastPost === null) {
    gaps.push("发布时间缺失");
  } else if (daysSinceLastPost > 30) {
    gaps.push("断更超过30天");
  }

  if (productVideoCount < 1) {
    gaps.push("带货迹象不足");
  }

  if (keywordCount < 1) {
    gaps.push("关键词未命中");
  }

  return {
    qualified: gaps.length === 0,
    followers,
    stableVideoCount,
    daysSinceLastPost,
    productVideoCount,
    keywordCount,
    gaps,
    scores: {
      audience: clampScore((followers / 10000) * 100),
      activity: clampScore((stableVideoCount / 10) * 100),
      commerce: productVideoCount > 0 ? 100 : 0,
      content: keywordCount > 0 ? 100 : 0,
    },
  };
}

export function calculateCreatorMetrics(leads, now = new Date()) {
  const evaluatedLeads = leads.map((lead) => ({
    lead,
    evaluation: evaluateCreatorLead(lead, now),
  }));

  return {
    imported: leads.length,
    qualified: evaluatedLeads.filter(({ evaluation }) => evaluation.qualified).length,
    needsContact: leads.filter((lead) => lead.crmStatus === "needs_contact").length,
    readyToContact: leads.filter((lead) => lead.crmStatus === "ready_to_contact").length,
    contacted: leads.filter((lead) => lead.crmStatus === "contacted").length,
    published: leads.filter((lead) => lead.crmStatus === "published").length,
  };
}

export function updateCreatorStatus(leads, leadId, nextStatus) {
  return leads.map((lead) => (lead.id === leadId ? { ...lead, crmStatus: nextStatus } : lead));
}

export function filterCreatorLeads(leads, filters = {}, now = new Date()) {
  const status = filters.status ?? "all";
  const keyword = filters.keyword ?? "all";
  const search = (filters.search ?? "").trim().toLowerCase();
  const qualification = filters.qualification ?? "all";

  return leads.filter((lead) => {
    const evaluation = evaluateCreatorLead(lead, now);
    const matchesStatus = status === "all" || lead.crmStatus === status;
    const matchesKeyword = keyword === "all" || (lead.matchedKeywords ?? []).includes(keyword);
    const matchesSearch =
      !search ||
      [lead.displayName, lead.handle, lead.description]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(search));
    const matchesQualification =
      qualification === "all" ||
      (qualification === "qualified" && evaluation.qualified) ||
      (qualification === "needs_review" && !evaluation.qualified);

    return matchesStatus && matchesKeyword && matchesSearch && matchesQualification;
  });
}
