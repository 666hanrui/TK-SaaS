import { describe, expect, it } from "vitest";
import {
  applyCreatorAutomationResult,
  buildCreatorAutomationPayload,
  createLocalOutreachDraft,
  getInstagramProfileUrl,
  normalizeCreatorAutomationState,
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

  it("falls back to a safe local draft when the AI draft is malformed", () => {
    const updated = applyCreatorAutomationResult([{ ...creator }], creator.id, {
      ok: true,
      queueId: "queue-bad-draft",
      status: "draft_ready",
      source: "n8n-webhook",
      draft: '{\n  "subject": "',
      dryRun: true,
      allowSend: false,
      updatedAt: "2026-07-07T10:01:00.000Z",
    });

    expect(updated[0].automation.outreach.draft).toContain("Hi house of foils,");
    expect(updated[0].automation.outreach.draft).toContain("@houseoffoils");
    expect(updated[0].automation.outreach.draft).not.toBe('{\n  "subject": "');
  });

  it("repairs malformed stored outreach drafts without dropping the creator", () => {
    const repaired = normalizeCreatorAutomationState({
      ...creator,
      automation: {
        outreach: {
          status: "draft_ready",
          draft: '{\n  "subject": "',
        },
      },
    });

    expect(repaired.id).toBe(creator.id);
    expect(repaired.automation.outreach.status).toBe("draft_ready");
    expect(repaired.automation.outreach.draft).toContain("@houseoffoils");
  });

  it("builds an explicit record-sent payload only after human confirmation", () => {
    const payload = buildCreatorAutomationPayload(creator, {
      action: "record_sent",
      allowSend: true,
      channel: "email",
      confirmedAt: "2026-07-07T10:05:00.000Z",
      confirmedBy: "operator",
      draft: "Approved draft",
      requestedAt: "2026-07-07T10:06:00.000Z",
      subject: "Collaboration with house of foils",
    });

    expect(payload).toMatchObject({
      action: "record_sent",
      allowSend: true,
      channel: "email",
      dryRun: false,
      confirmation: {
        confirmedAt: "2026-07-07T10:05:00.000Z",
        confirmedBy: "operator",
      },
      message: {
        draft: "Approved draft",
        subject: "Collaboration with house of foils",
      },
    });
  });

  it("uses instagram as the send channel when only a public social account is available", () => {
    const payload = buildCreatorAutomationPayload(
      {
        ...creator,
        contact: {
          email: "",
          instagram: "",
          socialAccount: "Instagram: https://www.instagram.com/houseof.foils",
        },
      },
      {
        action: "record_sent",
        allowSend: true,
        confirmedAt: "2026-07-07T10:05:00.000Z",
        confirmedBy: "operator",
        draft: "Approved IG draft",
      },
    );

    expect(payload.channel).toBe("instagram");
    expect(payload.creator.contact.instagramUrl).toBe("https://www.instagram.com/houseof.foils");
    expect(payload.allowSend).toBe(true);
  });

  it("does not treat youtube social accounts as instagram handles", () => {
    const payload = buildCreatorAutomationPayload({
      ...creator,
      contact: {
        email: "",
        instagram: "",
        socialAccount: "Youtube: https://www.youtube.com/channel/UCUPxVsYY-YOfF9IBptYC4Nw",
      },
    });

    expect(getInstagramProfileUrl(payload.creator)).toBe("");
    expect(payload.channel).toBe("manual");
    expect(payload.creator.contact.instagramUrl).toBeUndefined();
  });

  it("does not treat labeled youtube values in the instagram field as instagram handles", () => {
    expect(
      getInstagramProfileUrl({
        contact: {
          instagram: "Youtube: https://www.youtube.com/channel/UCUPxVsYY-YOfF9IBptYC4Nw",
        },
      }),
    ).toBe("");
  });

  it("normalizes public instagram handles into profile urls", () => {
    expect(
      getInstagramProfileUrl({
        contact: {
          instagram: "@niawigroom",
        },
      }),
    ).toBe("https://www.instagram.com/niawigroom");
  });

  it("records human confirmation and sent status in the creator CRM history", () => {
    const withDraft = applyCreatorAutomationResult([{ ...creator, crmStatus: "ready_to_contact" }], creator.id, {
      queueId: "queue-1",
      status: "draft_ready",
      source: "n8n-webhook",
      draft: "Draft message",
      updatedAt: "2026-07-07T10:01:00.000Z",
    });

    const confirmed = applyCreatorAutomationResult(withDraft, creator.id, {
      queueId: "queue-2",
      status: "confirmed",
      source: "manual-confirm",
      confirmedAt: "2026-07-07T10:05:00.000Z",
      confirmedBy: "operator",
      updatedAt: "2026-07-07T10:05:00.000Z",
    });

    const sent = applyCreatorAutomationResult(confirmed, creator.id, {
      queueId: "queue-3",
      status: "sent",
      source: "manual-send-record",
      crmStatus: "contacted",
      sentAt: "2026-07-07T10:08:00.000Z",
      updatedAt: "2026-07-07T10:08:00.000Z",
    });

    expect(sent[0].crmStatus).toBe("contacted");
    expect(sent[0].automation.outreach).toMatchObject({
      status: "sent",
      confirmedAt: "2026-07-07T10:05:00.000Z",
      confirmedBy: "operator",
      sentAt: "2026-07-07T10:08:00.000Z",
      draft: "Draft message",
    });
    expect(sent[0].automation.outreach.history.map((event) => event.status)).toEqual([
      "draft_ready",
      "confirmed",
      "sent",
    ]);
  });

  it("stores Chatwoot follow-up metadata from automation results", () => {
    const updated = applyCreatorAutomationResult([{ ...creator }], creator.id, {
      queueId: "queue-chatwoot",
      status: "sent",
      source: "manual-send-record",
      crmStatus: "contacted",
      chatwoot: {
        contactId: 42,
        labels: ["creator-outreach", "sample-pending"],
        nextStep: "sample_followup",
      },
      updatedAt: "2026-07-07T10:10:00.000Z",
    });

    expect(updated[0].automation.outreach.chatwoot).toEqual({
      contactId: 42,
      labels: ["creator-outreach", "sample-pending"],
      nextStep: "sample_followup",
    });
  });
});
