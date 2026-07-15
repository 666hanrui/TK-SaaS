import { readFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { createImageResolver } from "../adapters/stagehand/imageResolver.js";
import { loadAutomationConfig, publicConfigSummary } from "../config.js";
import { createSyntheticColorBandsPng } from "../vision/syntheticTestImage.js";

function usage() {
  return `Usage:
  npm run vision:preflight -- --plan-only
  npm run vision:preflight -- --synthetic-safe
  npm run vision:preflight -- --image <safe-local-image-path>

This validates the complete model-driven path: worker upload -> FRP STCP -> private ingress ->
model-local image URL -> Qwen vision response. It never opens a browser or shop account.`;
}

function parseArgs(argv) {
  const args = { planOnly: false, syntheticSafe: false, prompt: "Describe the left-to-right color arrangement in this synthetic test image in one concise sentence." };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--plan-only" || key === "--synthetic-safe") {
      args[key === "--plan-only" ? "planOnly" : "syntheticSafe"] = true;
      continue;
    }
    if (key === "--help" || key === "-h") {
      args.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (!key.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${key}`);
    }
    if (key === "--image") args.image = value;
    else if (key === "--prompt") args.prompt = value;
    else throw new Error(`Unknown option: ${key}`);
    index += 1;
  }
  return args;
}

function mimeTypeFor(file) {
  switch (path.extname(file).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      throw new Error("--image must be a PNG, JPEG, or WebP file.");
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}
if (!args.planOnly && !args.syntheticSafe && !args.image) {
  throw new Error(`Choose --synthetic-safe or --image, or inspect with --plan-only.\n\n${usage()}`);
}
if (args.syntheticSafe && args.image) throw new Error("Choose either --synthetic-safe or --image, not both.");

const config = loadAutomationConfig();
const plan = {
  modelEndpoint: `${config.llm.baseUrl.replace(/\/$/, "")}/chat/completions`,
  model: config.llm.model,
  imageTransport: config.llm.imageTransport,
  uploadEndpoint: config.llm.imageUploadUrl,
  source: args.syntheticSafe ? "synthetic-safe-color-bands" : args.image || "[required]",
  maxTokens: Math.min(config.llm.maxTokens, 160),
};
if (args.planOnly) {
  console.log(JSON.stringify({ planOnly: true, config: publicConfigSummary(config), plan }, null, 2));
  process.exit(0);
}
if (config.llm.imageTransport !== "http_upload") {
  throw new Error("Vision preflight requires AUTOMATION_IMAGE_TRANSPORT_OVERRIDE=http_upload.");
}
if (!config.llm.imageUploadUrl || !config.llm.imageUploadBearerToken) {
  throw new Error("Vision preflight requires AUTOMATION_IMAGE_UPLOAD_URL and AUTOMATION_IMAGE_UPLOAD_BEARER_TOKEN.");
}

const source = args.syntheticSafe
  ? { buffer: createSyntheticColorBandsPng(), mimeType: "image/png", filenameHint: "synthetic-color-bands" }
  : { buffer: await readFile(args.image), mimeType: mimeTypeFor(args.image), filenameHint: path.basename(args.image) };
const imageUrl = await createImageResolver(config.llm).publish(source);
const client = new OpenAI({
  apiKey: config.llm.apiKey,
  baseURL: config.llm.baseUrl,
  timeout: config.llm.timeoutMs,
  maxRetries: 0,
});
const startedAt = new Date().toISOString();
const response = await client.chat.completions.create({
  model: config.llm.model,
  temperature: config.llm.temperature,
  max_tokens: plan.maxTokens,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: args.prompt },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    },
  ],
});

console.log(
  JSON.stringify(
    {
      ok: true,
      startedAt,
      endedAt: new Date().toISOString(),
      model: config.llm.model,
      imageTransport: config.llm.imageTransport,
      modelImageOrigin: new URL(imageUrl).origin,
      reply: response.choices[0]?.message?.content || "",
      usage: response.usage || null,
    },
    null,
    2,
  ),
);
