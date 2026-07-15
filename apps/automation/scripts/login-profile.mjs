#!/usr/bin/env node
/**
 * Save a persistent browser profile with TikTok Shop Seller Center login state.
 *
 * Usage:
 *   node scripts/login-profile.mjs                    # default: tiktok-us
 *   node scripts/login-profile.mjs --profile tiktok-us
 *   node scripts/login-profile.mjs --profile tiktok-us --url https://seller-us.tiktok.com
 *
 * This creates a Chromium persistent context that stores cookies,
 * localStorage, and session tokens. The next Playwright/Stagehand
 * launch with the same userDataDir will be logged in.
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";

const CWD = process.cwd();

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    profile: "tiktok-us",
    url: "https://seller-us.tiktok.com",
    headless: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--profile":
        options.profile = args[++i];
        break;
      case "--url":
        options.url = args[++i];
        break;
      case "--headless":
        options.headless = true;
        break;
    }
  }

  return options;
}

function loadEnv() {
  const envFile = join(CWD, ".env");
  const env = { ...process.env };

  try {
    const content = readFileSync(envFile, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!env[key]) env[key] = value;
    }
  } catch (e) {
    // .env not found, use defaults
  }

  return env;
}

function validateProfileName(name) {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    console.error(`Invalid profile name: "${name}". Use only letters, numbers, dots, dashes, underscores.`);
    process.exit(1);
  }
}

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const options = parseArgs();
  const env = loadEnv();

  validateProfileName(options.profile);

  const profileDirName = options.profile;
  const profileBase = resolve(CWD, env.AUTOMATION_PROFILE_DIR || "./data/profiles");
  const userDataDir = join(profileBase, profileDirName);

  mkdirSync(userDataDir, { recursive: true });

  console.log("=".repeat(60));
  console.log("  TK-SaaS Browser Profile Login");
  console.log("=".repeat(60));
  console.log(`  Profile name: ${profileDirName}`);
  console.log(`  Profile dir:  ${userDataDir}`);
  console.log(`  Target URL:   ${options.url}`);
  console.log(`  Mode:         ${options.headless ? "headless" : "visible browser"}`);
  console.log("=".repeat(60));
  console.log();

  console.log("Launching Chromium with persistent profile...");
  console.log("A browser window will open. Please:");
  console.log("  1. Log in to TikTok Shop Seller Center");
  console.log("  2. Complete any 2FA / captcha challenges");
  console.log("  3. Verify you can see the seller dashboard");
  console.log("  4. Leave the browser OPEN and return to this terminal");
  console.log();

  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: options.headless,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    args: [
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const page = await browser.pages()[0] || await browser.newPage();

  try {
    console.log(`Navigating to ${options.url} ...`);
    await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 30000 });

    const title = await page.title().catch(() => "");
    console.log(`Page title: "${title}"`);
    console.log();

    await prompt("Press ENTER after you have logged in and verified the dashboard is visible...");

    console.log();
    console.log("Saving profile metadata...");

    const currentUrl = page.url();
    const cookies = await browser.cookies();
    const loginCookieCount = cookies.filter((c) =>
      ["sessionid", "session", "sid", "token", "auth"].some((k) =>
        c.name.toLowerCase().includes(k),
      ),
    ).length;

    const stateFile = join(userDataDir, "storage-state.json");
    const storageState = await browser.storageState();
    writeFileSync(stateFile, JSON.stringify(storageState, null, 2));

    const metadata = {
      profile: profileDirName,
      targetUrl: options.url,
      savedUrl: currentUrl,
      cookieCount: cookies.length,
      loginCookieCount,
      savedAt: new Date().toISOString(),
      userDataDir,
    };
    writeFileSync(join(userDataDir, "profile-metadata.json"), JSON.stringify(metadata, null, 2));

    console.log(`  Current URL:       ${currentUrl}`);
    console.log(`  Total cookies:     ${cookies.length}`);
    console.log(`  Login cookies:     ${loginCookieCount}`);
    console.log(`  storageState:      ${stateFile}`);
    console.log(`  metadata:          ${join(userDataDir, "profile-metadata.json")}`);
    console.log();
    console.log("Profile saved successfully.");
    console.log();

    if (loginCookieCount === 0) {
      console.warn("WARNING: No login-related cookies detected.");
      console.warn("The profile may not be logged in. Check your session.");
    } else {
      console.log("Login cookies detected. The profile should be usable for automation.");
    }
  } catch (error) {
    console.error("Error during profile setup:", error.message);
    process.exit(1);
  } finally {
    await browser.close();
    console.log("Browser closed.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
