import { describe, expect, it } from "vitest";
import { creatorSearchKeywords } from "./mockData";
import { normalizeEchoTikCreatorRows, parseEchoTikCreatorImport } from "./echotikImport";

describe("EchoTik import adapter", () => {
  it("maps exported EchoTik creator rows into CRM leads with screening evidence", () => {
    const csv = [
      "UID,Influencer,TikTok ID,Followers,Views,Avg. views per video,No. of Products,Bio,Video 1 Views,Video 1 Date,Video 1 Cover,Video 2 Views,Video 2 Date",
      '7435688833042023466,CuidarteEsVida,cuidarteesvida,"12,400","58,000","5,800",3,"Drawstring ponytail and braids finds. brand@creator.test",8200,2026-07-01,https://cdn.example.com/video.jpg,900,2026-06-26',
    ].join("\n");

    const leads = parseEchoTikCreatorImport(csv, {
      keywords: creatorSearchKeywords,
      sourceName: "Influencer_list_20260706.csv",
    });

    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      id: "echotik-7435688833042023466",
      handle: "cuidarteesvida",
      displayName: "CuidarteEsVida",
      followers: 12400,
      source: "EchoTik export: Influencer_list_20260706.csv",
      profileUrl: "https://www.tiktok.com/@cuidarteesvida",
      highPerformingCoverUrl: "https://cdn.example.com/video.jpg",
      matchedKeywords: ["drawstring ponytail", "braids"],
      productAssociatedVideos: ["echotik-7435688833042023466-product-1", "echotik-7435688833042023466-product-2", "echotik-7435688833042023466-product-3"],
      contact: {
        email: "brand@creator.test",
      },
    });
    expect(leads[0].recentVideos).toEqual([
      {
        id: "echotik-7435688833042023466-video-1",
        views: 8200,
        createDate: "2026-07-01",
        coverUrl: "https://cdn.example.com/video.jpg",
      },
      {
        id: "echotik-7435688833042023466-video-2",
        views: 900,
        createDate: "2026-06-26",
      },
    ]);
  });

  it("keeps real EchoTik detail rows visible when visitor data is masked as N/A", () => {
    const rows = [
      {
        influencer_id: "7435688833042023466",
        influencer_name: "CuidarteEsVida",
        unique_id: "cuidarteesvida",
        avatar_url: "https://cdn.echotik.live/avatar.jpg",
        profile_url: "https://www.tiktok.com/@cuidarteesvida",
        bio: "Latinos sharing honest finds. yoesbrandcollab@gmail.com",
        followers_count: "N/A",
        total_product_cnt: "N/A",
        update_time: "2026-07-05 06:07",
      },
    ];

    const leads = normalizeEchoTikCreatorRows(rows, {
      keywords: creatorSearchKeywords,
      sourceName: "EchoTik public detail probe",
    });

    expect(leads[0]).toMatchObject({
      followers: 0,
      crmStatus: "imported",
      highPerformingCoverUrl: "https://cdn.echotik.live/avatar.jpg",
      contact: {
        email: "yoesbrandcollab@gmail.com",
      },
      sourceDataWarnings: ["粉丝字段缺失", "播放字段缺失", "商品关联字段缺失"],
    });
  });

  it("parses compact EchoTik number suffixes without shrinking large creators", () => {
    const leads = parseEchoTikCreatorImport("Influencer,TikTok ID,Followers\nMega Hair,megahair,1.2M", {
      sourceName: "compact.csv",
    });

    expect(leads[0].followers).toBe(1200000);
  });

  it("maps Chinese EchoTik export headers (达人列表) to CRM leads", () => {
    const csv = [
      "User Id,达人名称,Unique Id,地区,主打带货品类,联系邮箱,社交账号,粉丝数,30天涨粉数,点赞数/粉丝数,视频数,视频销售额($),平均播放量(近30天),直播数,直播销售额($),观看人数,带货商品数,ER互动率,销量,销售额($),近30天GMV($),近 30 天 播放量,近 30 天 点赞数,查看更多",
      '7227539319995712554,house of foils,@houseoffoils,US,美妆个护,企业版可导出,Instagram: https://www.instagram.com/houseof.foils,"24,001","4,539",11.79,"1,097","1,991",518.9,0,0,0,28,"4.00%",66,"1,991","1,936","87,219","43,882",view more',
    ].join("\n");

    const leads = parseEchoTikCreatorImport(csv, {
      keywords: creatorSearchKeywords,
      sourceName: "达人列表_20260706070034.xlsx",
    });

    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      id: "echotik-7227539319995712554",
      handle: "houseoffoils",
      displayName: "house of foils",
      followers: 24001,
      followerGrowth30d: 4539,
      likesFollowerRatio: 11.79,
      totalVideoCount: 1097,
      region: "US",
      category: "美妆个护",
      gmv30d: 1936,
      salesCount: 66,
      salesGmv: 1991,
      videoSalesGmv: 1991,
      liveSalesGmv: 0,
      er: 4,
      avgViews30d: 518.9,
      contact: {
        email: "",
        socialAccount: "Instagram: https://www.instagram.com/houseof.foils",
      },
    });
    expect(leads[0].recentVideos.length).toBeGreaterThan(0);
    expect(leads[0].sourceDataWarnings).toEqual([]);
  });
});
