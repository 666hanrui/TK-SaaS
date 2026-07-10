import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { loadAutomationConfig, publicConfigSummary } from "../config.js";
import { automationTaskCatalog, currentTaskBindings, getAutomationDefinition } from "../catalog/taskCatalog.js";
import { FileIdempotencyLedger } from "../runtime/idempotencyLedger.js";

const config = loadAutomationConfig();
const warnings = [];
const errors = [];

for (const directory of [
  config.dataDirectory,
  config.artifactDirectory,
  config.profileDirectory,
  config.recordDirectory,
  config.ledgerDirectory,
  config.recipeCacheDirectory,
  config.downloadDirectory,
]) {
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await access(directory, constants.W_OK);
  } catch (error) {
    errors.push(`Cannot write ${directory}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await new FileIdempotencyLedger({ directory: config.ledgerDirectory }).initialize().catch((error) => {
  errors.push(`Cannot initialize idempotency ledger: ${error.message}`);
});

for (const [taskKey, binding] of Object.entries(currentTaskBindings)) {
  for (const [operation, definitionId] of Object.entries(binding)) {
    if (!getAutomationDefinition(definitionId)) {
      errors.push(`Task binding ${taskKey}.${operation} references missing definition ${definitionId}`);
    }
  }
}

if (config.mode === "rehearsal" && config.externalWriteEnabled) {
  errors.push("Rehearsal mode must not enable external writes.");
}
if (config.mode !== "rehearsal" && !config.externalReadEnabled) {
  warnings.push("External mode is configured but external read access is disabled.");
}
if (config.llm.hasVision && config.llm.imageTransport === "remote_url" && !config.llm.imagePublishDirectory) {
  warnings.push(
    "Vision is enabled with remote_url transport, but AUTOMATION_IMAGE_PUBLISH_DIR is not set. DOM mode remains available; visual mode is intentionally not ready.",
  );
}
if (config.llm.hasVision && config.llm.imageTransport === "remote_url" && !config.llm.imagePublicBaseUrl) {
  errors.push("remote_url image transport requires AUTOMATION_IMAGE_PUBLIC_BASE_URL.");
}
if (!["inline_data_url", "remote_url", "http_upload"].includes(config.llm.imageTransport)) {
  errors.push("LOCAL_LLM_IMAGE_TRANSPORT must be inline_data_url, remote_url, or http_upload.");
}
if (config.llm.hasVision && config.llm.imageTransport === "http_upload" && !config.llm.imageUploadUrl) {
  errors.push("http_upload image transport requires AUTOMATION_IMAGE_UPLOAD_URL.");
}
if (config.llm.hasVision && config.llm.imageTransport === "http_upload" && !config.llm.imageUploadBearerToken) {
  errors.push("http_upload image transport requires AUTOMATION_IMAGE_UPLOAD_BEARER_TOKEN.");
}
if (config.externalWriteEnabled && config.allowedOrigins.length === 0) {
  errors.push("External writes require an explicit AUTOMATION_ALLOWED_ORIGINS allowlist.");
}
if (config.service.requireToken && !config.service.token) {
  errors.push("A non-loopback automation service requires AUTOMATION_SERVICE_TOKEN.");
}
if (!config.service.requireToken && !config.service.token && config.service.host !== "127.0.0.1") {
  warnings.push("The automation service has no bearer token. Bind it to 127.0.0.1 or configure AUTOMATION_SERVICE_TOKEN.");
}

const result = {
  ready: errors.length === 0,
  definitions: automationTaskCatalog.length,
  browserDefinitions: automationTaskCatalog.filter(({ executor }) => executor === "browser").length,
  config: publicConfigSummary(config),
  warnings,
  errors,
};

console.log(JSON.stringify(result, null, 2));
if (errors.length > 0) process.exitCode = 1;
