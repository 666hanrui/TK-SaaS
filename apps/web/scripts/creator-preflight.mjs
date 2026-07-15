import { fileURLToPath } from "node:url";
import path from "node:path";
import { createCreatorRuntime } from "../server/creatorRuntime.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, "..");
const requireModel = process.argv.includes("--require-model");
const runtime = await createCreatorRuntime({ rootDirectory });
const health = await runtime.health();
const modelsUrl = `${health.modelBaseUrl.replace(/\/$/, "")}/models`;
let model = { ok: false, url: modelsUrl, message: "not checked" };

try {
  const response = await fetch(modelsUrl, {
    headers: { Authorization: `Bearer ${runtime.env.CREATOR_LLM_API_KEY || "local"}` },
    signal: AbortSignal.timeout(8000),
  });
  const body = await response.json().catch(() => ({}));
  model = {
    ok: response.ok,
    url: modelsUrl,
    count: Array.isArray(body.data) ? body.data.length : undefined,
    message: response.ok ? "model visitor reachable" : `HTTP ${response.status}`,
  };
} catch (error) {
  model = {
    ok: false,
    url: modelsUrl,
    message: error instanceof Error ? error.message : String(error),
  };
}

console.log(
  JSON.stringify(
    {
      ok: health.creatorCount >= 188 && (!requireModel || model.ok),
      creatorStore: health,
      model,
    },
    null,
    2,
  ),
);

if (health.creatorCount < 188 || (requireModel && !model.ok)) process.exitCode = 1;
