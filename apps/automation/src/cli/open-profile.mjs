import { createInterface } from "node:readline";
import { chromium } from "playwright";
import { loadAutomationConfig } from "../config.js";
import { ProfileLeaseManager } from "../session/profileManager.js";

function usage() {
  return `Usage:
  npm run profile:open -- --profile <profile-id> --url <seller-center-url>

This opens a visible, dedicated persistent browser profile on the store-manager computer.
The store manager completes login, MFA, and any challenge manually. Cookies and profile files
remain on that computer; this command does not export storage state or expose a debug port.`;
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

function waitForEnter() {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    prompt.question("After confirming the dashboard is visible, press Enter to close the browser safely: ", () => {
      prompt.close();
      resolve();
    });
  });
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

const config = loadAutomationConfig();
const profileManager = new ProfileLeaseManager({ rootDirectory: config.profileDirectory });
const lease = await profileManager.acquire({
  profileId: args.profile,
  runId: `manual-profile-setup:${Date.now()}`,
});

let context;
try {
  context = await chromium.launchPersistentContext(lease.directory, {
    headless: false,
    executablePath: config.browser.executablePath,
    locale: config.browser.locale,
    viewport: config.browser.viewport,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
  console.log(`Dedicated profile ${args.profile} is open at ${new URL(page.url()).origin}.`);
  console.log("Complete account login manually. Do not copy cookies, storage state, or browser profile files off this computer.");
  await waitForEnter();
} finally {
  await context?.close().catch(() => {});
  await lease.release();
}
