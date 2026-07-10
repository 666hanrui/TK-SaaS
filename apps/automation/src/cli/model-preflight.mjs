import OpenAI from "openai";
import { loadAutomationConfig, publicConfigSummary } from "../config.js";

function parseArgs(argv) {
  const args = { imageUrl: "", prompt: "Describe this image in one concise sentence.", planOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--plan-only") {
      args.planOnly = true;
      continue;
    }
    const value = argv[index + 1];
    if (!key.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${key}`);
    }
    index += 1;
    if (key === "--image-url") args.imageUrl = value;
    else if (key === "--prompt") args.prompt = value;
    else throw new Error(`Unknown option: ${key}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const config = loadAutomationConfig();

if (!args.imageUrl && !args.planOnly) {
  throw new Error("Provide --image-url for a visual preflight, or use --plan-only to inspect the request configuration.");
}
if (args.imageUrl) {
  const parsed = new URL(args.imageUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Image URL must use HTTP or HTTPS.");
  }
}

const requestPlan = {
  endpoint: `${config.llm.baseUrl.replace(/\/$/, "")}/chat/completions`,
  model: config.llm.model,
  imageUrl: args.imageUrl || "[required for execution]",
  prompt: args.prompt,
  maxTokens: Math.min(config.llm.maxTokens, 256),
  temperature: config.llm.temperature,
};

if (args.planOnly) {
  console.log(JSON.stringify({ planOnly: true, config: publicConfigSummary(config), requestPlan }, null, 2));
  process.exit(0);
}

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
  max_tokens: requestPlan.maxTokens,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: args.prompt },
        { type: "image_url", image_url: { url: args.imageUrl } },
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
      endpoint: requestPlan.endpoint,
      model: config.llm.model,
      imageOrigin: new URL(args.imageUrl).origin,
      reply: response.choices[0]?.message?.content || "",
      usage: response.usage || null,
    },
    null,
    2,
  ),
);
