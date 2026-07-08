import { describe, expect, it } from "vitest";
import { mapInfluencerToCreatorLead } from "./echotikApi";

describe("EchoTik Open API adapter", () => {
  it("keeps raw user ids so the drawer can fetch real videos on demand", () => {
    const lead = mapInfluencerToCreatorLead(
      {
        id: "echotik-7453864180253377582",
        rawId: "7453864180253377582",
        handle: "gorgeouswigs",
        uniqueId: "gorgeouswigs",
        displayName: "gorgeous wigs",
        followers: 4200,
        totalProductCnt: 3,
        totalDiggCnt: 1200,
        signature: "wig and braids finds",
        source: "EchoTik API",
      },
      { keywords: ["wig", "braids"] },
    );

    expect(lead.rawId).toBe("7453864180253377582");
    expect(lead.matchedKeywords).toEqual(["wig", "braids"]);
    expect(lead.totalProductCnt).toBe(3);
  });
});
