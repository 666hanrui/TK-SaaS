import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { loadAutomationConfig } from "../config.js";
import { ProfileLeaseManager } from "../session/profileManager.js";

function usage() {
  return `Usage:
  npm run diagnose:tiktok-inventory-api -- --profile <profile-id> --url <inventory-url> [--output <json-file>]

Opens the existing store profile, reloads the TikTok inventory page, clicks page 2 when present,
and writes a structural summary of fetch/XHR requests. Cookies and authorization headers are never written.`;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--help" || key === "-h") {
      args.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (!key.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${key}`);
    }
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

function scalar(value) {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return typeof value === "string" ? value.slice(0, 300) : value;
  }
  return undefined;
}

function summarizeRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return scalar(record);
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key, value]) =>
        /sku|stock|inventory|available|locked|product|title|variation|warehouse|quantity|qty|id/i.test(key)
        && scalar(value) !== undefined)
      .slice(0, 80)
      .map(([key, value]) => [key, scalar(value)]),
  );
}

function summarizePayload(payload) {
  const paginationFields = [];
  const recordCollections = [];
  const seen = new Set();

  const visit = (value, jsonPath, depth) => {
    if (!value || typeof value !== "object" || depth > 7 || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      const firstObject = value.find((item) => item && typeof item === "object" && !Array.isArray(item));
      if (firstObject) {
        const keys = Object.keys(firstObject);
        if (keys.some((key) => /sku|stock|inventory|available|locked|quantity|qty/i.test(key))) {
          recordCollections.push({
            path: jsonPath,
            length: value.length,
            keys,
            sample: summarizeRecord(firstObject),
          });
        }
      }
      value.slice(0, 2).forEach((item, index) => visit(item, `${jsonPath}[${index}]`, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (/^(page|pageNo|pageNum|pageNumber|pageSize|size|limit|offset|total|totalCount|count|hasMore|nextCursor|cursor)$/i.test(key)) {
        const valueScalar = scalar(child);
        if (valueScalar !== undefined) paginationFields.push({ path: `${jsonPath}.${key}`, value: valueScalar });
      }
      visit(child, `${jsonPath}.${key}`, depth + 1);
    }
  };

  visit(payload, "$", 0);
  return {
    topLevelKeys: payload && typeof payload === "object" && !Array.isArray(payload) ? Object.keys(payload) : [],
    paginationFields,
    recordCollections,
  };
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}
for (const key of ["profile", "url"]) {
  if (!args[key]) throw new Error(`--${key} is required\n\n${usage()}`);
}
const target = new URL(args.url);
if (!/^https?:$/.test(target.protocol)) throw new Error("--url must use http or https.");

const defaultOutput = path.join(
  process.env.USERPROFILE || path.join(os.homedir()),
  "Desktop",
  `tiktok-inventory-api-diagnostic-${Date.now()}.json`,
);
const output = path.resolve(args.output || defaultOutput);
await mkdir(path.dirname(output), { recursive: true });

const config = loadAutomationConfig();
const profileManager = new ProfileLeaseManager({ rootDirectory: config.profileDirectory });
const lease = await profileManager.acquire({
  profileId: args.profile,
  runId: `diagnose-tiktok-inventory-api:${Date.now()}`,
});

const captures = [];
const pending = new Set();
let context;
try {
  context = await chromium.launchPersistentContext(lease.directory, {
    headless: false,
    executablePath: config.browser.executablePath,
    locale: config.browser.locale,
    viewport: config.browser.viewport,
    args: ["--no-first-run", "--no-default-browser-check", "--restore-last-session"],
  });
  const page = context.pages()[0] || (await context.newPage());
  page.on("response", (response) => {
    const operation = (async () => {
      const request = response.request();
      if (!["xhr", "fetch"].includes(request.resourceType())) return;
      const contentType = String(response.headers()["content-type"] || "");
      if (!/json/i.test(contentType)) return;
      let payload;
      try {
        payload = JSON.parse(await response.text());
      } catch {
        return;
      }
      const summary = summarizePayload(payload);
      captures.push({
        url: response.url(),
        method: request.method(),
        status: response.status(),
        requestBody: request.postData() || null,
        ...summary,
      });
    })().finally(() => pending.delete(operation));
    pending.add(operation);
  });

  await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 }).catch((error) => {
    if (!/timeout/i.test(error instanceof Error ? error.message : String(error))) throw error;
  });
  await page.waitForTimeout(8_000);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch((error) => {
    if (!/timeout/i.test(error instanceof Error ? error.message : String(error))) throw error;
  });
  await page.waitForTimeout(8_000);

  const paginationItems = page.locator(".core-pagination li");
  const pageTwo = paginationItems.filter({ hasText: /^\s*2\s*$/ }).first();
  if (await pageTwo.count()) {
    const firstSku = await page.locator(".core-table-body tbody tr").first().innerText().catch(() => "");
    await pageTwo.click({ timeout: 10_000 });
    await page.waitForFunction(
      ({ selector, previous }) => {
        const row = document.querySelector(selector);
        return row && String(row.textContent || "").trim() !== previous.trim();
      },
      { selector: ".core-table-body tbody tr", previous: firstSku },
      { timeout: 15_000 },
    ).catch(() => {});
    await page.waitForTimeout(5_000);
  }

  await Promise.allSettled([...pending]);
  const usefulCaptures = captures.filter(
    (capture) => capture.recordCollections.length > 0 || capture.paginationFields.length > 0,
  );
  const report = {
    capturedAt: new Date().toISOString(),
    targetUrl: target.toString(),
    finalUrl: page.url(),
    totalJsonRequests: captures.length,
    usefulRequestCount: usefulCaptures.length,
    requests: usefulCaptures,
  };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ok: true, output, usefulRequestCount: usefulCaptures.length }, null, 2));
} finally {
  await context?.close().catch(() => {});
  await lease.release();
}
