import { describe, expect, it } from "vitest";
import {
  buildTikTokProfileUrl,
  calculateDashboardMetrics,
  calculateCreatorMetrics,
  evaluateCreatorLead,
  getNavigationItems,
  groupTasksByShift,
  mergeCreatorRecords,
  updateCreatorStatus,
} from "./operations";
import { tasks } from "./mockData";

const sampleTasks = [
  {
    id: "t1",
    module: "orders",
    category: "pickup_risk",
    shift: "morning",
    priority: "urgent",
    status: "open",
  },
  {
    id: "t2",
    module: "orders",
    category: "shipping_contact",
    shift: "afternoon",
    priority: "high",
    status: "open",
  },
  {
    id: "t3",
    module: "inventory",
    category: "stock_check",
    shift: "before_leave",
    priority: "medium",
    status: "processing",
  },
  {
    id: "t4",
    module: "reviews",
    category: "bad_review",
    shift: "afternoon",
    priority: "high",
    status: "done",
  },
];

describe("operations rules", () => {
  it("keeps script templates out of the left navigation", () => {
    const navItems = getNavigationItems();

    expect(navItems.map((item) => item.id)).toEqual([
      "dashboard",
      "orders",
      "aftersales",
      "reviews",
      "inventory",
      "creators",
      "settings",
    ]);
    expect(navItems.some((item) => item.id === "templates")).toBe(false);
  });

  it("groups daily tasks by manager shift", () => {
    const groups = groupTasksByShift(sampleTasks);

    expect(groups).toEqual([
      {
        id: "morning",
        title: "上午必做",
        tasks: [sampleTasks[0]],
      },
      {
        id: "afternoon",
        title: "下午必做",
        tasks: [sampleTasks[1], sampleTasks[3]],
      },
      {
        id: "before_leave",
        title: "下班前核对",
        tasks: [sampleTasks[2]],
      },
    ]);
  });

  it("counts order shipping as the primary daily workload", () => {
    const metrics = calculateDashboardMetrics(sampleTasks);

    expect(metrics.shippingWorkload).toBe(2);
    expect(metrics.pickupRisk).toBe(1);
    expect(metrics.urgentOpenTasks).toBe(1);
    expect(metrics.badReviewFollowUp).toBe(0);
  });

  it("models every task as an automation action instead of an off-platform instruction", () => {
    const offPlatformInstruction = /(复制|前往|打开|在 TikTok 商家后台|人工处理)/;

    expect(tasks.every((task) => task.automationAction)).toBe(true);
    expect(tasks.map((task) => task.automationAction).join("\n")).not.toMatch(offPlatformInstruction);
  });
});

describe("EchoTik creator CRM rules", () => {
  const now = new Date("2026-07-06T09:00:00+08:00");

  const qualifiedLead = {
    id: "creator-ari",
    handle: "arihairdaily",
    followers: 12400,
    crmStatus: "qualified",
    matchedKeywords: ["black girl", "braids"],
    productAssociatedVideos: ["video-1", "video-2", "video-3"],
    recentVideos: [
      { views: 8200, createDate: "2026-06-30" },
      { views: 6100, createDate: "2026-06-27" },
      { views: 2200, createDate: "2026-06-21" },
      { views: 1900, createDate: "2026-06-18" },
      { views: 1500, createDate: "2026-06-15" },
      { views: 1200, createDate: "2026-06-12" },
      { views: 980, createDate: "2026-06-08" },
      { views: 7600, createDate: "2026-06-03" },
      { views: 540, createDate: "2026-05-28" },
      { views: 1320, createDate: "2026-05-23" },
    ],
  };

  const missingProductLead = {
    ...qualifiedLead,
    id: "creator-nia",
    handle: "niawigs",
    crmStatus: "needs_contact",
    productAssociatedVideos: [],
  };

  const publishedLead = {
    ...qualifiedLead,
    id: "creator-zora",
    handle: "zorabraids",
    crmStatus: "published",
  };

  it("qualifies creators only when EchoTik evidence passes every first-wave rule", () => {
    const result = evaluateCreatorLead(qualifiedLead, now);

    expect(result.qualified).toBe(true);
    expect(result.stableVideoCount).toBe(8);
    expect(result.daysSinceLastPost).toBe(6);
    expect(result.gaps).toEqual([]);
    expect(result.scores).toMatchObject({
      audience: 100,
      activity: 80,
      commerce: 100,
      content: 100,
    });
  });

  it("keeps creators visible and records evidence gaps when EchoTik data is incomplete", () => {
    const result = evaluateCreatorLead(missingProductLead, now);

    expect(result.qualified).toBe(false);
    expect(result.gaps).toContain("带货迹象不足");
  });

  it("counts creator funnel metrics from evaluated leads", () => {
    const metrics = calculateCreatorMetrics([qualifiedLead, missingProductLead, publishedLead], now);

    expect(metrics.imported).toBe(3);
    expect(metrics.qualified).toBe(2);
    expect(metrics.needsContact).toBe(1);
    expect(metrics.published).toBe(1);
  });

  it("moves creators through the CRM funnel without mutating the original list", () => {
    const updated = updateCreatorStatus([qualifiedLead], "creator-ari", "needs_contact");

    expect(updated[0].crmStatus).toBe("needs_contact");
    expect(qualifiedLead.crmStatus).toBe("qualified");
  });

  it("builds editable TikTok profile URLs from handles or user ids", () => {
    expect(buildTikTokProfileUrl("arihairdaily")).toBe("https://www.tiktok.com/@arihairdaily");
    expect(buildTikTokProfileUrl("@zorabraids")).toBe("https://www.tiktok.com/@zorabraids");
  });

  it("refreshes EchoTik evidence without overwriting store-manager CRM work", () => {
    const current = {
      ...qualifiedLead,
      crmStatus: "contacted",
      starred: true,
      contact: { email: "owner@example.com", notes: "follow up Friday" },
      automation: { outreach: { status: "sent", draft: "edited draft" } },
      recentVideos: [],
    };
    const incoming = {
      ...qualifiedLead,
      displayName: "Fresh EchoTik Name",
      followers: 18000,
      crmStatus: "imported",
      contact: { email: "api@example.com", instagram: "fresh.ig" },
    };

    const [merged] = mergeCreatorRecords([current], [incoming]);

    expect(merged.displayName).toBe("Fresh EchoTik Name");
    expect(merged.followers).toBe(18000);
    expect(merged.crmStatus).toBe("contacted");
    expect(merged.starred).toBe(true);
    expect(merged.contact).toMatchObject({
      email: "owner@example.com",
      instagram: "fresh.ig",
      notes: "follow up Friday",
    });
    expect(merged.automation.outreach.draft).toBe("edited draft");
  });
});
