#!/usr/bin/env node
/**
 * Scrape contact info (email, Instagram, YouTube, Twitter) from EchoTik
 * influencer detail pages using a saved login state.
 *
 * Usage:
 *   1. Save login state first:
 *      node scripts/fetch-echotik-web.mjs --login
 *
 *   2. Run contact scraper:
 *      node scripts/fetch-echotik-contacts.mjs \
 *        --input output/inspect/echotik-web-xxx.json \
 *        --limit 50
 */
import { chromium } from "playwright";
import fs from "fs/promises";
import path from "path";

const STATE_DIR = path.resolve(process.cwd(), ".playwright-state");
const STATE_FILE = path.join(STATE_DIR, "echotik-auth.json");
const OUTPUT_DIR = path.resolve(process.cwd(), "output", "inspect");

const URL_PATTERNS = [
  "https://echotik.live/influencer/{id}",
  "https://echotik.live/influencers/{id}",
  "https://echotik.live/creator/{id}",
  "https://echotik.live/influencer-detail/{id}",
];

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    input: "",
    output: "",
    limit: 0,
    delay: 2000,
    discover: false,
  };

  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    const value = args[i + 1];
    switch (key) {
      case "--input":
        options.input = value;
        i++;
        break;
      case "--output":
        options.output = value;
        i++;
        break;
      case "--limit":
        options.limit = Number(value) || 0;
        i++;
        break;
      case "--delay":
        options.delay = Number(value) || 2000;
        i++;
        break;
      case "--discover":
        options.discover = true;
        break;
    }
  }

  return options;
}

function extractContacts(text) {
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const instagramMatch = text.match(/(?:instagram\.com|ig\b).*?([A-Za-z0-9._]{1,30})/i);
  const youtubeMatch = text.match(/(?:youtube\.com\/(@|c\/|channel\/)|youtu\.be\/)[A-Za-z0-9_-]+/i);
  const twitterMatch = text.match(/(?:twitter\.com|x\.com)\/[A-Za-z0-9_]+/i);
  const linktreeMatch = text.match(/linktr\.ee\/[A-Za-z0-9_-]+/i);

  return {
    email: emailMatch?.[0] || "",
    instagram: instagramMatch?.[0] || "",
    youtube: youtubeMatch?.[0] || "",
    twitter: twitterMatch?.[0] || "",
    linktree: linktreeMatch?.[0] || "",
  };
}

async function discoverUrlPattern(page, influencerId) {
  for (const pattern of URL_PATTERNS) {
    const url = pattern.replace("{id}", influencerId);
    try {
      console.log(`[discover] trying ${url}`);
      await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
      const currentUrl = page.url();
      if (currentUrl.includes("login") || currentUrl.includes("404")) continue;

      const title = await page.title().catch(() => "");
      const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
      if (bodyText.includes(influencerId) || bodyText.length > 500) {
        console.log(`[discover] matched: ${url} (title: ${title})`);
        return pattern;
      }
    } catch (e) {
      console.log(`[discover] failed: ${url} - ${e.message}`);
    }
  }
  return null;
}

async function scrapeDetailPage(page, influencerId, urlPattern) {
  const url = urlPattern.replace("{id}", influencerId);
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(1500);

    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const pageHtml = await page.content().catch(() => "");
    const allText = bodyText + " " + pageHtml;

    return extractContacts(allText);
  } catch (error) {
    console.log(`[scrape] error for ${influencerId}: ${error.message}`);
    return { email: "", instagram: "", youtube: "", twitter: "", linktree: "" };
  }
}

async function main() {
  const options = parseArgs();

  if (!options.input) {
    console.error("请提供 --input 参数，指向扩展导出的 JSON 文件");
    process.exit(1);
  }

  try {
    await fs.access(STATE_FILE);
  } catch {
    console.error(`未找到登录状态文件: ${STATE_FILE}`);
    console.error("请先运行: node scripts/fetch-echotik-web.mjs --login");
    process.exit(1);
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const raw = await fs.readFile(options.input, "utf-8");
  const influencers = JSON.parse(raw);
  console.log(`Loaded ${influencers.length} influencers`);

  let toProcess = influencers;
  if (options.limit > 0) {
    toProcess = influencers.slice(0, options.limit);
    console.log(`Limited to first ${toProcess.length} influencers`);
  }

  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({ storageState: STATE_FILE });
  const page = await context.newPage();

  let urlPattern = null;
  if (options.discover || !toProcess[0]?.influencer_id) {
    urlPattern = await discoverUrlPattern(page, toProcess[0]?.influencer_id || toProcess[0]?.id);
    if (!urlPattern) {
      console.error("无法发现详情页 URL 模式，请手动确认页面地址");
      await browser.close();
      process.exit(1);
    }
  } else {
    urlPattern = URL_PATTERNS[0];
    console.log(`Using default URL pattern: ${urlPattern}`);
  }

  const results = [];
  for (let i = 0; i < toProcess.length; i++) {
    const creator = toProcess[i];
    const id = creator.influencer_id || creator.id;
    const name = creator.influencer_name || creator.displayName || id;

    console.log(`[${i + 1}/${toProcess.length}] ${name}`);
    const contacts = await scrapeDetailPage(page, id, urlPattern);
    results.push({
      ...creator,
      detailUrl: urlPattern.replace("{id}", id),
      contactEmail: contacts.email,
      contactInstagram: contacts.instagram,
      contactYoutube: contacts.youtube,
      contactTwitter: contacts.twitter,
      contactLinktree: contacts.linktree,
    });

    if (i < toProcess.length - 1) {
      await page.waitForTimeout(options.delay + Math.random() * 1000);
    }
  }

  const outputPath = options.output
    ? path.resolve(options.output)
    : path.join(OUTPUT_DIR, `echotik-contacts-${results.length}-${Date.now()}.json`);

  await fs.writeFile(outputPath, JSON.stringify(results, null, 2));

  const csvPath = outputPath.replace(/\.json$/, ".csv");
  const csvHeaders = [
    "User Id",
    "达人名称",
    "Unique Id",
    "邮箱",
    "Instagram",
    "Youtube",
    "Twitter",
    "Linktree",
    "详情页",
  ];
  const csvRows = results.map((r) => [
    r.influencer_id || r.id,
    r.influencer_name || r.displayName,
    r.unique_id,
    r.contactEmail,
    r.contactInstagram,
    r.contactYoutube,
    r.contactTwitter,
    r.contactLinktree,
    r.detailUrl,
  ]);
  const csvContent = [csvHeaders, ...csvRows]
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell ?? "").replace(/"/g, '""');
          return text.includes(",") ? `"${text}"` : text;
        })
        .join(","),
    )
    .join("\n");
  await fs.writeFile(csvPath, "\ufeff" + csvContent);

  console.log(`\nDone. Processed ${results.length} influencers`);
  console.log(`JSON: ${outputPath}`);
  console.log(`CSV: ${csvPath}`);

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
