#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import OpenAI from "openai";
import { CustomOpenAIClient, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import {
  buildBrowserAgentRunConfig,
  isLocalBrowserAgentUrl,
  normalizeBrowserAgentJson,
} from "../src/lib/browserAgent.js";

const WEB_DIR = path.resolve(import.meta.dirname, "..");
const OUTPUT_ROOT = path.join(WEB_DIR, "output", "stagehand-runs");

class LocalStagehandOpenAIClient extends CustomOpenAIClient {
  constructor({ modelName, client, maxTokens, temperature }) {
    super({ modelName, client });
    this.client = client;
    this.modelName = modelName;
    this.hasVision = true;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
  }

  async createChatCompletion({ options, retries = 1, logger }) {
    const maxTokens = Math.max(Number(options.maxOutputTokens || 0), this.maxTokens);
    const messages = [...options.messages];
    if (options.image) {
      messages.push({
        role: "user",
        content: [
          ...(options.image.description ? [{ type: "text", text: options.image.description }] : []),
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${options.image.buffer.toString("base64")}` },
          },
        ],
      });
    }

    if (options.response_model) {
      messages.push({
        role: "user",
        content: `Respond with valid JSON matching this schema:\n${JSON.stringify(z.toJSONSchema(options.response_model.schema))}\n\nDo not include any other text, formatting, markdown, or code fences.`,
      });
    }

    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages,
      temperature: this.temperature,
      top_p: options.top_p,
      frequency_penalty: options.frequency_penalty,
      presence_penalty: options.presence_penalty,
      max_tokens: maxTokens,
      response_format: options.response_model ? { type: "json_object" } : undefined,
      stream: false,
      tools: options.tools?.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
    });

    const content = normalizeBrowserAgentJson(response.choices[0]?.message?.content);
    const usage = {
      prompt_tokens: response.usage?.prompt_tokens ?? 0,
      completion_tokens: response.usage?.completion_tokens ?? 0,
      total_tokens: response.usage?.total_tokens ?? 0,
    };

    if (!options.response_model) {
      return { data: content, usage };
    }

    try {
      const parsed = JSON.parse(content);
      options.response_model.schema.parse(parsed);
      return { data: parsed, usage };
    } catch (error) {
      logger({
        category: "local-openai",
        level: 0,
        message: "Local model response did not match the requested JSON schema",
      });
      if (retries > 0) {
        return this.createChatCompletion({ options, retries: retries - 1, logger });
      }
      throw error;
    }
  }
}

function parseArgs(argv) {
  const args = {
    url: "http://127.0.0.1:5173/",
    module: "reviews",
    goal: "观察当前 TK-SaaS 页面，识别可操作入口，并提取适合商品评分模块试点的信息；不要发送、提交、发货、退款或改库存。",
    headless: true,
    tryAct: false,
    skipExtract: true,
    replayActionReport: "",
    timeoutMs: 90_000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--try-act") {
      args.tryAct = true;
      continue;
    }
    if (key === "--skip-extract") {
      args.skipExtract = true;
      continue;
    }
    if (key === "--include-extract") {
      args.skipExtract = false;
      continue;
    }
    if (key === "--headed") {
      args.headless = false;
      continue;
    }
    if (!key.startsWith("--")) continue;
    if (value == null || value.startsWith("--")) {
      throw new Error(`Missing value for ${key}`);
    }
    i += 1;
    if (key === "--url") args.url = value;
    else if (key === "--module") args.module = value;
    else if (key === "--goal") args.goal = value;
    else if (key === "--replay-action-report") args.replayActionReport = path.resolve(WEB_DIR, value);
    else if (key === "--timeout-ms") args.timeoutMs = Number(value);
    else throw new Error(`Unknown option ${key}`);
  }

  return args;
}

function findChromeExecutable() {
  const candidates = [
    process.env.STAGEHAND_CHROME_EXECUTABLE_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) || undefined;
}

function clipText(value, maxLength = 4000) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

async function runStep(name, fn) {
  const startedAt = new Date().toISOString();
  try {
    const result = await fn();
    return {
      name,
      ok: true,
      startedAt,
      endedAt: new Date().toISOString(),
      result,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      startedAt,
      endedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function writeReport(report) {
  await writeFile(report.files.report, `${JSON.stringify(report, null, 2)}\n`);
}

function findProductRatingAction(actions = []) {
  return actions.find((action) => {
    const text = `${action.description || ""} ${action.selector || ""}`;
    return /商品评分|Product Rating|rating|button\[4\]/i.test(text);
  });
}

async function loadReplayAction(reportPath) {
  if (!reportPath) return null;
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const observeStep = report.steps?.find((step) => step.name === "observe.navigation" && step.ok);
  return findProductRatingAction(observeStep?.result || []);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = buildBrowserAgentRunConfig({
    env: process.env,
    module: args.module,
    goal: args.goal,
    url: args.url,
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.join(OUTPUT_ROOT, timestamp);
  await mkdir(outputDir, { recursive: true });

  const report = {
    startedAt: new Date().toISOString(),
    endedAt: null,
    args,
    config: {
      ...config,
      llm: {
        ...config.llm,
        apiKey: config.llm.apiKey ? "[set]" : "",
      },
    },
    steps: [],
    files: {
      outputDir,
      report: path.join(outputDir, "report.json"),
      screenshot: path.join(outputDir, "page.png"),
    },
  };

  if (!isLocalBrowserAgentUrl(args.url)) {
    report.endedAt = new Date().toISOString();
    report.stopReason = "non_local_url_blocked_for_first_trial";
    await writeReport(report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const openai = new OpenAI({
    apiKey: config.llm.apiKey,
    baseURL: config.llm.baseUrl,
    timeout: args.timeoutMs,
    maxRetries: 0,
  });

  const stagehand = new Stagehand({
    env: "LOCAL",
    disableAPI: true,
    disablePino: true,
    verbose: 0,
    selfHeal: false,
    domSettleTimeout: 1000,
    actTimeoutMs: args.timeoutMs,
    llmClient: new LocalStagehandOpenAIClient({
      modelName: config.llm.model,
      client: openai,
      maxTokens: config.llm.maxTokens,
      temperature: config.llm.temperature,
    }),
    systemPrompt:
      "You are a cautious browser automation assistant. Use only visible page evidence. Return structured outputs only. Never send, submit, ship, refund, delete, or change inventory unless a human explicitly confirms at action time.",
    localBrowserLaunchOptions: {
      headless: args.headless,
      viewport: { width: 1440, height: 900 },
      chromiumSandbox: false,
      executablePath: findChromeExecutable(),
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  try {
    report.steps.push(
      await runStep("stagehand.init", async () => {
        await stagehand.init();
        return { sessionId: stagehand.sessionId, connectUrl: stagehand.connectURL() };
      }),
    );
    await writeReport(report);

    const page = stagehand.context.pages()[0];
    report.steps.push(
      await runStep("page.goto", async () => {
        await page.goto(args.url, { waitUntil: "domcontentloaded", timeoutMs: 30_000 });
        await page.waitForTimeout(1500);
        return { url: page.url(), title: await page.title() };
      }),
    );
    await writeReport(report);

    report.steps.push(
      await runStep("page.screenshot", async () => {
        await page.screenshot({ path: report.files.screenshot, fullPage: false });
        return { path: report.files.screenshot };
      }),
    );
    await writeReport(report);

    report.steps.push(
      await runStep("extract.pageText.no_llm", async () => {
        const result = await stagehand.extract();
        return {
          pageTextPreview: clipText(result.pageText),
        };
      }),
    );
    await writeReport(report);

    const replayAction = await loadReplayAction(args.replayActionReport);
    const observeStep = replayAction
      ? {
          name: "observe.navigation",
          ok: true,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          result: [replayAction],
          source: args.replayActionReport,
        }
      : await runStep("observe.navigation", async () =>
          stagehand.observe("find the left navigation items and the safest module navigation action", {
            timeout: args.timeoutMs,
          }),
        );
    report.steps.push(observeStep);
    await writeReport(report);

    if (args.tryAct && observeStep.ok && config.safety.level === "safe_read_or_draft") {
      const action = findProductRatingAction(observeStep.result);
      report.steps.push(
        await runStep("act.open_reviews_from_observed_action", async () => {
          if (!action) throw new Error("No observed action matched 商品评分 / Product Rating");
          return stagehand.act(action, {
            timeout: args.timeoutMs,
          });
        }),
      );
      await writeReport(report);
      report.steps.push(
        await runStep("page.after_act", async () => ({
          url: page.url(),
          title: await page.title(),
          bodyPreview: clipText(
            await page.evaluate(() => document.body?.innerText || "", undefined),
            2500,
          ),
        })),
      );
      await writeReport(report);
    }

    if (!args.skipExtract) {
      report.steps.push(
        await runStep("extract.module_summary", async () =>
          stagehand.extract(
            "Summarize the current TK-SaaS page and identify whether 商品评分 / reviews, 售后工单 / aftersales, 库存核对 / inventory, and 订单发货 / orders are visible. Output only facts visible on the page.",
            z.object({
              pageTitle: z.string(),
              activeModule: z.string(),
              visibleModules: z.array(z.string()),
              safeTrialRecommendation: z.string(),
            }),
            { timeout: args.timeoutMs },
          ),
        ),
      );
      await writeReport(report);
    }

    if (args.tryAct && config.safety.level !== "safe_read_or_draft") {
      report.steps.push({
        name: "act.open_reviews_from_observed_action",
        ok: false,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        error: `Act skipped because safety level is ${config.safety.level}`,
      });
      await writeReport(report);
    }
  } finally {
    report.endedAt = new Date().toISOString();
    await stagehand.close({ force: true }).catch(() => {});
    await writeReport(report);
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
