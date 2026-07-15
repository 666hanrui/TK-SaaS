import path from "node:path";
import { readFileSync } from "node:fs";
import { RunModeSchema } from "./protocol/schemas.js";

function parseDotEnvFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");
    const parsed = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      parsed[key] = value;
    }
    return parsed;
  } catch {
    return {};
  }
}

function csv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolean(value, fallback = false) {
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function isLoopbackHost(host) {
  return ["127.0.0.1", "::1", "localhost"].includes(String(host).toLowerCase());
}

const modelProfiles = Object.freeze({
  frp_qwen_vision: {
    LOCAL_LLM_BASE_URL: "http://49.235.153.151:6081/v1",
    LOCAL_LLM_MODEL: "C:\\Users\\666\\Downloads\\Qwen3.5-9B.Q4_K_M.gguf",
    LOCAL_LLM_HAS_VISION: "true",
    LOCAL_LLM_IMAGE_TRANSPORT: "remote_url",
    AUTOMATION_IMAGE_PUBLIC_BASE_URL: "http://49.235.153.151:8080/automation",
  },
});

export function loadAutomationConfig({ env = process.env, cwd = process.cwd() } = {}) {
  const runtimeEnv = { ...parseDotEnvFile(path.join(cwd, ".env")), ...env };
  const profileName = runtimeEnv.AUTOMATION_MODEL_PROFILE || "";
  const modelProfile = profileName ? modelProfiles[profileName] : undefined;
  if (profileName && !modelProfile) throw new Error(`Unknown automation model profile: ${profileName}`);
  const selectedEnv = modelProfile
    ? {
        ...runtimeEnv,
        ...modelProfile,
        ...(runtimeEnv.AUTOMATION_MODEL_BASE_URL_OVERRIDE
          ? { LOCAL_LLM_BASE_URL: runtimeEnv.AUTOMATION_MODEL_BASE_URL_OVERRIDE }
          : {}),
        ...(runtimeEnv.AUTOMATION_IMAGE_TRANSPORT_OVERRIDE
          ? { LOCAL_LLM_IMAGE_TRANSPORT: runtimeEnv.AUTOMATION_IMAGE_TRANSPORT_OVERRIDE }
          : {}),
      }
    : runtimeEnv;
  const dataDirectory = path.resolve(cwd, selectedEnv.AUTOMATION_DATA_DIR || "data");
  const artifactDirectory = path.resolve(cwd, selectedEnv.AUTOMATION_ARTIFACT_DIR || "output/runs");
  const profileDirectory = path.resolve(cwd, selectedEnv.AUTOMATION_PROFILE_DIR || "data/profiles");
  const serviceHost = selectedEnv.AUTOMATION_SERVICE_HOST || "127.0.0.1";
  const serviceToken = selectedEnv.AUTOMATION_SERVICE_TOKEN || "";

  return {
    mode: RunModeSchema.parse(selectedEnv.AUTOMATION_MODE || "rehearsal"),
    modelProfile: profileName || "environment",
    dataDirectory,
    artifactDirectory,
    profileDirectory,
    ledgerDirectory: path.join(dataDirectory, "idempotency"),
    recordDirectory: path.join(dataDirectory, "records"),
    recipeCacheDirectory: path.join(dataDirectory, "recipe-cache"),
    downloadDirectory: path.join(dataDirectory, "downloads"),
    allowedOrigins: csv(selectedEnv.AUTOMATION_ALLOWED_ORIGINS),
    externalReadEnabled: boolean(selectedEnv.AUTOMATION_EXTERNAL_READ, false),
    externalWriteEnabled: boolean(selectedEnv.AUTOMATION_EXTERNAL_EXECUTION, false),
    highRiskAutomationEnabled: boolean(selectedEnv.AUTOMATION_HIGH_RISK_EXECUTION, false),
    autoApprovedDefinitionIds: csv(selectedEnv.AUTOMATION_AUTO_APPROVED_DEFINITIONS),
    service: {
      host: serviceHost,
      port: number(selectedEnv.AUTOMATION_SERVICE_PORT, 8010),
      token: serviceToken,
      requireToken:
        boolean(selectedEnv.AUTOMATION_SERVICE_REQUIRE_TOKEN, false) ||
        !isLoopbackHost(serviceHost),
      remoteEndpoint: selectedEnv.AUTOMATION_REMOTE_ENDPOINT || "",
    },
    worker: {
      pollMs: number(selectedEnv.AUTOMATION_WORKER_POLL_MS, 1_500),
      leaseMs: number(selectedEnv.AUTOMATION_WORKER_LEASE_MS, 15 * 60_000),
    },
    monitor: {
      remoteEndpoint: selectedEnv.AUTOMATION_REMOTE_ENDPOINT || "",
      remoteToken: selectedEnv.AUTOMATION_REMOTE_TOKEN || "",
      downloadDirectory: path.resolve(cwd, selectedEnv.AUTOMATION_MONITOR_DOWNLOAD_DIR || "output/remote-monitor"),
    },
    imageIngress: {
      host: selectedEnv.AUTOMATION_IMAGE_INGRESS_HOST || "127.0.0.1",
      port: number(selectedEnv.AUTOMATION_IMAGE_INGRESS_PORT, 8090),
      dataDirectory: path.resolve(cwd, selectedEnv.AUTOMATION_IMAGE_INGRESS_DATA_DIR || "data/image-ingress"),
      uploadToken: selectedEnv.AUTOMATION_IMAGE_INGRESS_UPLOAD_TOKEN || "",
      fieldName: selectedEnv.AUTOMATION_IMAGE_INGRESS_FIELD || "file",
      ttlMs: number(selectedEnv.AUTOMATION_IMAGE_INGRESS_TTL_SECONDS, 300) * 1_000,
      maxBytes: number(selectedEnv.AUTOMATION_IMAGE_INGRESS_MAX_BYTES, 6 * 1024 * 1024),
      modelReadBaseUrl:
        selectedEnv.AUTOMATION_IMAGE_INGRESS_MODEL_READ_BASE_URL ||
        `http://127.0.0.1:${number(selectedEnv.AUTOMATION_IMAGE_INGRESS_PORT, 8090)}/v1/images`,
    },
    llm: {
      baseUrl: selectedEnv.LOCAL_LLM_BASE_URL || "http://49.235.153.151:6081/v1",
      apiKey: selectedEnv.LOCAL_LLM_API_KEY || "local",
      model: selectedEnv.LOCAL_LLM_MODEL || "C:\\Users\\666\\Downloads\\Qwen3.5-9B.Q4_K_M.gguf",
      maxTokens: number(selectedEnv.LOCAL_LLM_MAX_TOKENS, 2048),
      temperature: number(selectedEnv.LOCAL_LLM_TEMPERATURE, 0),
      timeoutMs: number(selectedEnv.LOCAL_LLM_TIMEOUT_MS, 90_000),
      hasVision: boolean(selectedEnv.LOCAL_LLM_HAS_VISION, true),
      imageTransport: selectedEnv.LOCAL_LLM_IMAGE_TRANSPORT || "inline_data_url",
      imagePublicBaseUrl: selectedEnv.AUTOMATION_IMAGE_PUBLIC_BASE_URL || "",
      imagePublishDirectory: selectedEnv.AUTOMATION_IMAGE_PUBLISH_DIR
        ? path.resolve(cwd, selectedEnv.AUTOMATION_IMAGE_PUBLISH_DIR)
        : "",
      imageUploadUrl: selectedEnv.AUTOMATION_IMAGE_UPLOAD_URL || "",
      imageUploadField: selectedEnv.AUTOMATION_IMAGE_UPLOAD_FIELD || "file",
      imageUploadResponsePath: selectedEnv.AUTOMATION_IMAGE_UPLOAD_RESPONSE_PATH || "url",
      imageUploadBearerToken: selectedEnv.AUTOMATION_IMAGE_UPLOAD_BEARER_TOKEN || "",
    },
    browser: {
      executablePath: selectedEnv.AUTOMATION_CHROME_EXECUTABLE_PATH || undefined,
      headless: boolean(selectedEnv.AUTOMATION_HEADLESS, true),
      locale: selectedEnv.AUTOMATION_LOCALE || "en-US",
      viewport: {
        width: number(selectedEnv.AUTOMATION_VIEWPORT_WIDTH, 1440),
        height: number(selectedEnv.AUTOMATION_VIEWPORT_HEIGHT, 900),
      },
    },
    platformBaseUrls: {
      tiktokShop: selectedEnv.TIKTOK_SELLER_BASE_URL || "",
      hcrd: selectedEnv.HCRD_BASE_URL || "",
      echotik: selectedEnv.ECHOTIK_BASE_URL || "https://echotik.live",
      mail: selectedEnv.MAIL_BASE_URL || "https://mail.google.com",
    },
    hcrdInventory: {
      baseUrl: selectedEnv.HCRD_BASE_URL || "",
      path: selectedEnv.HCRD_INVENTORY_PATH || "/inventory/inventory/listForClientAction.json",
      pageSize: number(selectedEnv.HCRD_INVENTORY_PAGE_SIZE, 200),
      maxPages: number(selectedEnv.HCRD_INVENTORY_MAX_PAGES, 100),
      visualAudit: boolean(selectedEnv.HCRD_INVENTORY_VISUAL_AUDIT, true),
      authWaitMs: number(selectedEnv.HCRD_AUTH_WAIT_SECONDS, 300) * 1_000,
      username: selectedEnv.HCRD_USERNAME || "",
      password: selectedEnv.HCRD_PASSWORD || "",
    },
    tiktokInventory: {
      apiPath: selectedEnv.TIKTOK_INVENTORY_API_PATH || "/api/v1/product/stock/sku/list",
      pageSize: number(selectedEnv.TIKTOK_INVENTORY_PAGE_SIZE, 50),
      maxPages: number(selectedEnv.TIKTOK_INVENTORY_MAX_PAGES, 100),
      sessionApi: boolean(selectedEnv.TIKTOK_INVENTORY_SESSION_API, true),
      visualAudit: boolean(selectedEnv.TIKTOK_INVENTORY_VISUAL_AUDIT, true),
    },
  };
}

export function publicConfigSummary(config) {
  return {
    mode: config.mode,
    modelProfile: config.modelProfile,
    dataDirectory: config.dataDirectory,
    artifactDirectory: config.artifactDirectory,
    profileDirectory: config.profileDirectory,
    recordDirectory: config.recordDirectory,
    allowedOrigins: config.allowedOrigins,
    externalReadEnabled: config.externalReadEnabled,
    externalWriteEnabled: config.externalWriteEnabled,
    highRiskAutomationEnabled: config.highRiskAutomationEnabled,
    autoApprovedDefinitionIds: config.autoApprovedDefinitionIds,
    service: {
      host: config.service.host,
      port: config.service.port,
      tokenConfigured: Boolean(config.service.token),
      requireToken: config.service.requireToken,
      remoteEndpointConfigured: Boolean(config.service.remoteEndpoint),
    },
    worker: config.worker,
    monitor: {
      remoteEndpointConfigured: Boolean(config.monitor.remoteEndpoint),
      remoteTokenConfigured: Boolean(config.monitor.remoteToken),
      downloadDirectory: config.monitor.downloadDirectory,
    },
    imageIngress: {
      host: config.imageIngress.host,
      port: config.imageIngress.port,
      dataDirectory: config.imageIngress.dataDirectory,
      fieldName: config.imageIngress.fieldName,
      ttlMs: config.imageIngress.ttlMs,
      maxBytes: config.imageIngress.maxBytes,
      modelReadBaseUrl: config.imageIngress.modelReadBaseUrl,
      uploadTokenConfigured: Boolean(config.imageIngress.uploadToken),
    },
    llm: {
      baseUrl: config.llm.baseUrl,
      model: config.llm.model,
      maxTokens: config.llm.maxTokens,
      temperature: config.llm.temperature,
      timeoutMs: config.llm.timeoutMs,
      hasVision: config.llm.hasVision,
      imageTransport: config.llm.imageTransport,
      imagePublicBaseUrl: config.llm.imagePublicBaseUrl,
      imagePublishDirectory: config.llm.imagePublishDirectory,
      imageUploadUrl: config.llm.imageUploadUrl,
      imageUploadField: config.llm.imageUploadField,
      imageUploadResponsePath: config.llm.imageUploadResponsePath,
      apiKey: config.llm.apiKey ? "[set]" : "[missing]",
    },
    browser: config.browser,
    platformBaseUrls: config.platformBaseUrls,
    hcrdInventory: {
      baseUrl: config.hcrdInventory.baseUrl,
      path: config.hcrdInventory.path,
      pageSize: config.hcrdInventory.pageSize,
      maxPages: config.hcrdInventory.maxPages,
      visualAudit: config.hcrdInventory.visualAudit,
      authWaitMs: config.hcrdInventory.authWaitMs,
      credentialsConfigured: Boolean(config.hcrdInventory.username && config.hcrdInventory.password),
    },
    tiktokInventory: config.tiktokInventory,
  };
}
