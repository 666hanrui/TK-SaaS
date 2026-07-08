#!/usr/bin/env node
/**
 * Fetch EchoTik influencer list via web internal API using saved browser state.
 *
 * Usage:
 *   1. First run with --login to open browser and let you log in:
 *      node scripts/fetch-echotik-web.mjs --login
 *
 *   2. Then run queries with saved state:
 *      node scripts/fetch-echotik-web.mjs --gender female --contact email --pages 3
 *
 *   3. Include real creator video details when the account can access them:
 *      node scripts/fetch-echotik-web.mjs --keyword braids --include-videos --max-video-creators 30
 */
import { chromium } from "playwright";
import fs from "fs/promises";
import path from "path";

const STATE_DIR = path.resolve(process.cwd(), ".playwright-state");
const STATE_FILE = path.join(STATE_DIR, "echotik-auth.json");
const OUTPUT_DIR = path.resolve(process.cwd(), "output", "inspect");

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    login: false,
    gender: "",
    contact: "",
    isEmail: "",
    followerGenders: "",
    followerAges: "",
    language: "",
    influencerCategories: "",
    productCategories: "",
    order: "follower_30d_count",
    sort: "desc",
    keyword: "",
    pages: 1,
    perPage: 50,
    includeVideos: false,
    maxVideoCreators: 30,
  };

  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    const value = args[i + 1];
    switch (key) {
      case "--login":
        options.login = true;
        break;
      case "--gender":
        options.gender = value;
        i++;
        break;
      case "--contact":
        options.contact = value;
        i++;
        break;
      case "--is-email":
        options.isEmail = value;
        i++;
        break;
      case "--follower-genders":
        options.followerGenders = value;
        i++;
        break;
      case "--follower-ages":
        options.followerAges = value;
        i++;
        break;
      case "--language":
        options.language = value;
        i++;
        break;
      case "--influencer-categories":
        options.influencerCategories = value;
        i++;
        break;
      case "--product-categories":
        options.productCategories = value;
        i++;
        break;
      case "--order":
        options.order = value;
        i++;
        break;
      case "--sort":
        options.sort = value;
        i++;
        break;
      case "--keyword":
        options.keyword = value;
        i++;
        break;
      case "--pages":
        options.pages = Number(value) || 1;
        i++;
        break;
      case "--per-page":
        options.perPage = Number(value) || 50;
        i++;
        break;
      case "--include-videos":
        options.includeVideos = true;
        break;
      case "--max-video-creators":
        options.maxVideoCreators = Number(value) || 30;
        i++;
        break;
    }
  }

  return options;
}

async function fetchJsonWithBrowser(page, url) {
  return page.evaluate(async (fetchUrl) => {
    const res = await fetch(fetchUrl, {
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
        "x-region": "US",
        "x-lang": "zh-CN",
        "x-currency": "USD",
        "x-secondary-currency": "CNY",
      },
      credentials: "include",
    });
    return res.json();
  }, url);
}

async function login() {
  await fs.mkdir(STATE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  console.log("请登录 EchoTik，登录后关闭浏览器窗口即可保存状态。");
  await page.goto("https://echotik.live/influencers", { waitUntil: "networkidle" });

  // Wait for user to close browser
  await new Promise((resolve) => {
    browser.on("disconnected", resolve);
  });

  await context.storageState({ path: STATE_FILE });
  console.log(`登录状态已保存: ${STATE_FILE}`);
}

async function fetchList(options) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: STATE_FILE,
  });
  const page = await context.newPage();

  const params = new URLSearchParams();
  params.set("page", "1");
  params.set("per_page", String(options.perPage));
  params.set("influencer_categories", options.influencerCategories);
  params.set("product_categories", options.productCategories);
  params.set("show_case", "");
  params.set("is_email", options.isEmail);
  params.set("order", options.order);
  params.set("sort", options.sort);

  if (options.keyword) params.set("keyword", options.keyword);
  if (options.gender) params.set("gender", options.gender);
  if (options.contact) params.set("contact", options.contact);
  if (options.followerGenders) params.set("follower_genders", options.followerGenders);
  if (options.followerAges) params.set("follower_ages", options.followerAges);
  if (options.language) params.set("language", options.language);

  const allResults = [];

  for (let pageNum = 1; pageNum <= options.pages; pageNum++) {
    params.set("page", String(pageNum));
    const url = `https://echotik.live/api/v1/data/influencers?${params.toString()}`;

    console.log(`Fetching page ${pageNum}: ${url}`);
    const response = await fetchJsonWithBrowser(page, url);

    if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
      console.log("No more data.");
      break;
    }

    allResults.push(...response.data);
    console.log(`  Got ${response.data.length} influencers`);

    if (pageNum < options.pages) {
      await page.waitForTimeout(1500 + Math.random() * 1000);
    }
  }

  if (options.includeVideos) {
    const targets = allResults.slice(0, options.maxVideoCreators);
    console.log(`\nFetching videos for ${targets.length} influencers...`);

    for (let index = 0; index < targets.length; index += 1) {
      const influencer = targets[index];
      const influencerId = influencer.influencer_id || influencer.user_id || influencer.id;

      if (!influencerId) {
        influencer.videos = [];
        influencer.video_fetch_status = "missing influencer id";
        continue;
      }

      const videoUrl = `https://echotik.live/api/v1/data/influencers/${influencerId}/videos?page=1&per_page=10`;

      try {
        const response = await fetchJsonWithBrowser(page, videoUrl);
        const videos = Array.isArray(response.data)
          ? response.data
          : Array.isArray(response.data?.data)
            ? response.data.data
            : [];

        influencer.videos = videos;
        influencer.video_fetch_status = response.code === 0 ? "ok" : response.msg || response.message || "not ok";
        console.log(`  [${index + 1}/${targets.length}] ${influencer.unique_id || influencerId}: ${videos.length} videos`);
      } catch (error) {
        influencer.videos = [];
        influencer.video_fetch_status = error instanceof Error ? error.message : "video fetch failed";
        console.log(`  [${index + 1}/${targets.length}] ${influencer.unique_id || influencerId}: failed`);
      }

      await page.waitForTimeout(1200 + Math.random() * 800);
    }
  }

  const outputPath = path.join(
    OUTPUT_DIR,
    `echotik-web-${options.keyword || options.gender || "all"}-${Date.now()}.json`,
  );
  await fs.writeFile(outputPath, JSON.stringify(allResults, null, 2));

  console.log(`\nTotal: ${allResults.length} influencers`);
  console.log(`Saved to: ${outputPath}`);

  await browser.close();
}

async function main() {
  const options = parseArgs();

  if (options.login) {
    await login();
    return;
  }

  try {
    await fs.access(STATE_FILE);
  } catch {
    console.error(`未找到登录状态文件: ${STATE_FILE}`);
    console.error("请先运行: node scripts/fetch-echotik-web.mjs --login");
    process.exit(1);
  }

  await fetchList(options);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
