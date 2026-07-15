import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { loadAutomationConfig } from "../config.js";
import {
  clearTikTokVisualAuditView,
  prepareTikTokVisualAuditView,
} from "../adapters/stagehand/stagehandDriver.js";
import { ProfileLeaseManager } from "../session/profileManager.js";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${key}`);
    }
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
for (const key of ["profile", "url"]) {
  if (!args[key]) throw new Error(`--${key} is required`);
}
const target = new URL(args.url);
const output = path.resolve(
  args.output || path.join(process.env.USERPROFILE || os.homedir(), "Desktop", `tiktok-visual-audit-preview-${Date.now()}.jpg`),
);
const config = loadAutomationConfig();
const profileManager = new ProfileLeaseManager({ rootDirectory: config.profileDirectory });
const lease = await profileManager.acquire({
  profileId: args.profile,
  runId: `diagnose-tiktok-visual-audit:${Date.now()}`,
});

let context;
let page;
try {
  context = await chromium.launchPersistentContext(lease.directory, {
    headless: false,
    executablePath: config.browser.executablePath,
    locale: config.browser.locale,
    viewport: config.browser.viewport,
    args: ["--no-first-run", "--no-default-browser-check", "--restore-last-session"],
  });
  page = context.pages()[0] || (await context.newPage());
  await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 }).catch((error) => {
    if (!/timeout/i.test(error instanceof Error ? error.message : String(error))) throw error;
  });
  await page.waitForTimeout(8_000);
  const clip = await prepareTikTokVisualAuditView(page);
  await page.screenshot({ path: output, type: "jpeg", quality: 92, clip });
  console.log(JSON.stringify({ ok: true, output, clip }, null, 2));
} finally {
  if (page) await clearTikTokVisualAuditView(page);
  await context?.close().catch(() => {});
  await lease.release();
}
