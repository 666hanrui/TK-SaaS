import { describe, expect, it } from "vitest";
import {
  applyCreatorAutomationResult,
  buildCreatorAutomationPayload,
  createLocalOutreachDraft,
} from "./creatorAutomation";

const creator = {
  id: "creator-house-of-foils",
  rawId: "7493171734211057669",
  displayName: "house of foils",
  handle: "houseoffoils",
  profileUrl: "https://www.tiktok.com/@houseoffoils",
  description: "Black girl braids and wig install videos",
  region: "US",
  category: "Beauty & Personal Care",
  followers: 12400,
  avgViews30d: 4800,
  er: 6.3,
  totalProductCnt: 3,
  matchedKeywords: ["black girl", "braids"],
  contact: {
    email: "pr@example.com",
    instagram: "houseoffoils",
  },
  recentVideos: [
    {
      id: "video-1",
      videoId: "7351000000000000001",
      title: "quick braid install",
      views: 9200,
      createDate: "2026-07-01",
      videoUrl: "https://www.tiktok.com/@houseoffoils/video/7351000000000000001",
      hasProducts: true,
    },
    {
      id: "video-2",
      title: "half wig review",
      views: 3800,
      createDate: "2026-06-29",
    },
  ],
};

describe("creator outreach automation", () => {
  it("builds a dry-run payload with real creator evidence and sending disabled", () => {
    const payload = buildCreatorAutomationPayload(creator, {
      requestedAt: "2026-07-07T10:00:00.000Z",
    });

    expect(payload).toMatchObject({
      action: "draft",
      allowSend: false,
      dryRun: true,
      requestedAt: "2026-07-07T10:00:00.000Z",
      source: "tk-saas-web",
      creator: {
        id: "creator-house-of-foils",
        rawId: "7493171734211057669",
        displayName: "house of foils",
        handle: "houseoffoils",
        profileUrl: "https://www.tiktok.com/@houseoffoils",
        contact: {
          email: "pr@example.com",
          instagram: "houseoffoils",
        },
        metrics: {
          followers: 12400,
          avgViews30d: 4800,
          er: 6.3,
          productVideoCount: 3,
          keywordCount: 2,
        },
      },
    });
    expect(payload.creator.evidence.recentVideos).toHaveLength(2);
    expect(payload.creator.evidence.recentVideos[0]).toMatchObject({
      videoId: "7351000000000000001",
      views: 9200,
    });
  });

  it("creates a local draft from the creator record without inventing contact data", () => {
    const draft = createLocalOutreachDraft(creator);

    expect(draft).toContain("house of foils");
    expect(draft).toContain("@houseoffoils");
    expect(draft).toContain("black girl / braids");
    expect(draft).toContain("TikTok Shop videos");
    expect(draft).not.toContain("WhatsApp");
  });

  it("stores automation results on the target creator without mutating the original list", () => {
    const originalList = [
      {
        ...creator,
        crmStatus: "needs_contact",
      },
    ];
    const updated = applyCreatorAutomationResult(originalList, creator.id, {
      ok: true,
      queueId: "queue-1",
      status: "draft_ready",
      source: "local-dry-run",
      draft: "Draft message",
      dryRun: true,
      allowSend: false,
      updatedAt: "2026-07-07T10:01:00.000Z",
    });

    expect(updated[0].automation.outreach).toMatchObject({
      queueId: "queue-1",
      status: "draft_ready",
      source: "local-dry-run",
      draft: "Draft message",
      dryRun: true,
      allowSend: false,
    });
    expect(updated[0].automation.outreach.history).toHaveLength(1);
    expect(originalList[0].automation).toBeUndefined();
  });
});
