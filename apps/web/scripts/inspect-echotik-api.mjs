#!/usr/bin/env node
/**
 * Inspect EchoTik influencers page network traffic.
 * Captures XHR/Fetch requests and responses to find hidden API fields.
 */
import { chromium } from "playwright";
import fs from "fs/promises";
import path from "path";

const TARGET_URL = "https://echotik.live/influencers";
const OUTPUT_DIR = path.resolve(process.cwd(), "output", "inspect");
const REQUEST_LOG_PATH = path.join(OUTPUT_DIR, "echotik-requests.json");

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();
  const captured = [];

  page.on("request", (request) => {
    const url = request.url();
    if (
      url.includes("echotik") &&
      (request.resourceType() === "xhr" || request.resourceType() === "fetch")
    ) {
      console.log(`[REQUEST] ${request.method()} ${url}`);
      captured.push({
        type: "request",
        method: request.method(),
        url,
        headers: request.headers(),
        postData: request.postData(),
        time: new Date().toISOString(),
      });
    }
  });

  page.on("response", async (response) => {
    const request = response.request();
    const url = request.url();
    if (
      url.includes("echotik") &&
      (request.resourceType() === "xhr" || request.resourceType() === "fetch")
    ) {
      try {
        const contentType = response.headers()["content-type"] || "";
        let body = null;
        if (contentType.includes("application/json")) {
          body = await response.json().catch(() => null);
        } else if (contentType.includes("text")) {
          body = await response.text().catch(() => null);
        }

        console.log(`[RESPONSE] ${response.status()} ${url}`);
        captured.push({
          type: "response",
          status: response.status(),
          url,
          headers: response.headers(),
          body,
          time: new Date().toISOString(),
        });
      } catch (error) {
        console.log(`[RESPONSE ERROR] ${url}: ${error.message}`);
      }
    }
  });

  console.log(`Navigating to ${TARGET_URL}...`);
  await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: 120000 });

  console.log("Page loaded. Waiting a bit for dynamic requests...");
  await page.waitForTimeout(5000);

  // Scroll down to trigger pagination
  console.log("Scrolling to trigger more requests...");
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(3000);
  }

  // Try clicking on a filter to see if it triggers API calls
  console.log("Attempting to interact with filters...");
  try {
    const genderFilter = await page.locator("text=性别").first();
    if (await genderFilter.isVisible().catch(() => false)) {
      await genderFilter.click();
      await page.waitForTimeout(2000);
      // Click away to close
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);
    }
  } catch (error) {
    console.log("Filter interaction skipped:", error.message);
  }

  // Try clicking audience画像 filter
  try {
    const audienceFilter = await page.locator("text=粉丝画像").first();
    if (await audienceFilter.isVisible().catch(() => false)) {
      await audienceFilter.click();
      await page.waitForTimeout(2000);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);
    }
  } catch (error) {
    console.log("Audience filter interaction skipped:", error.message);
  }

  await fs.writeFile(REQUEST_LOG_PATH, JSON.stringify(captured, null, 2));
  console.log(`\nCaptured ${captured.length} requests/responses.`);
  console.log(`Saved to: ${REQUEST_LOG_PATH}`);

  // Print summary of unique API endpoints
  const endpoints = new Set(
    captured
      .filter((item) => item.type === "request")
      .map((item) => `${item.method} ${new URL(item.url).pathname}`),
  );
  console.log("\nUnique API endpoints:");
  for (const endpoint of endpoints) {
    console.log(`  ${endpoint}`);
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
