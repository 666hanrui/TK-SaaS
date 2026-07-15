import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_MODEL_BASE_URL = "http://127.0.0.1:16081/v1";
const DEFAULT_MODEL = "C:\\Users\\666\\Downloads\\Qwen3.5-9B.Q4_K_M.gguf";
const MAX_CREATOR_COUNT = 50000;
const MAX_BACKUPS = 50;

function cleanText(value) {
  return String(value ?? "").trim();
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const separator = trimmed.indexOf("=");
  if (separator < 1) return null;
  const key = trimmed.slice(0, separator).trim();
  let value = trimmed.slice(separator + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return key ? [key, value] : null;
}

async function loadEnvFile(filePath, target) {
  try {
    const content = await readFile(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      target[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicWriteJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function validateCreators(creators) {
  if (!Array.isArray(creators)) throw new Error("creators must be an array");
  if (creators.length > MAX_CREATOR_COUNT) {
    throw new Error(`creator count exceeds ${MAX_CREATOR_COUNT}`);
  }

  const ids = new Set();
  for (const creator of creators) {
    if (!creator || typeof creator !== "object" || !cleanText(creator.id)) {
      throw new Error("every creator must have a stable id");
    }
    if (ids.has(creator.id)) throw new Error(`duplicate creator id: ${creator.id}`);
    ids.add(creator.id);
  }
  return creators;
}

function compactCreatorContact(contact = {}) {
  return Object.fromEntries(
    Object.entries({
      email: contact.email,
      instagram: contact.instagram,
      instagramUrl: contact.instagramUrl,
      socialAccount: contact.socialAccount,
      notes: contact.notes,
    }).filter(([, value]) => value),
  );
}

export function createLocalCreatorDraft(creator) {
  const name = creator.displayName || creator.handle || "there";
  const handle = cleanText(creator.handle).replace(/^@/, "");
  const keywords = Array.isArray(creator.matchedKeywords)
    ? creator.matchedKeywords.slice(0, 4)
    : [];
  const nicheLine = keywords.length
    ? `Your content fits our ${keywords.join(" / ")} creator list.`
    : "Your beauty and hair content fits our creator list.";
  const profileLine = handle ? `I found your TikTok @${handle}` : "I found your TikTok profile";

  return [
    `Hi ${name},`,
    "",
    `${profileLine} and liked the way your hair content connects with your audience. ${nicheLine}`,
    "",
    "We are preparing a first collaboration wave for drawstring ponytail, half wig, crochet hair, and braids products. The starting offer is free product + paid collaboration + commission, with TikTok Shop videos as the main deliverable.",
    "",
    "Would you be open to reviewing the details if the product style matches your audience?",
    "",
    "Best regards",
    "TK-SaaS Creator Team",
  ].join("\n");
}

function normalizeModelContent(value) {
  const text = cleanText(value)
    .replace(/^<think>\s*[\s\S]*?<\/think>\s*/i, "")
    .replace(/^<\/think>\s*/i, "");
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return cleanText(fenced?.[1] || text);
}

function parseModelDraft(value) {
  const text = normalizeModelContent(value);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return {
      subject: cleanText(parsed.subject),
      draft: cleanText(parsed.draft || parsed.message || parsed.text),
    };
  } catch {
    return { draft: text.startsWith("{") ? "" : text };
  }
}

function creatorEvidenceSummary(creator) {
  const recentVideos = (creator.recentVideos || []).slice(0, 10).map((video) => ({
    title: video.title || video.description || "",
    views: Number(video.views || 0),
    createDate: video.createDate || "",
    hasProducts: Boolean(
      video.hasProducts || (video.productIds || []).length || Number(video.salesCount || 0) > 0,
    ),
  }));
  return {
    displayName: creator.displayName,
    handle: creator.handle,
    description: creator.description,
    category: creator.category,
    region: creator.region,
    followers: Number(creator.metrics?.followers || creator.followers || 0),
    avgViews30d: Number(creator.metrics?.avgViews30d || creator.avgViews30d || 0),
    matchedKeywords: creator.matchedKeywords || [],
    recentVideos,
  };
}

async function requestModelDraft({ env, fetchImpl, creator }) {
  const baseUrl = cleanText(
    env.CREATOR_LLM_BASE_URL || env.AUTOMATION_MODEL_BASE_URL_OVERRIDE || DEFAULT_MODEL_BASE_URL,
  ).replace(/\/$/, "");
  const model = cleanText(env.CREATOR_LLM_MODEL || env.LOCAL_LLM_MODEL || DEFAULT_MODEL);
  const apiKey = cleanText(env.CREATOR_LLM_API_KEY || env.LOCAL_LLM_API_KEY || "local");
  const controller = new AbortController();
  const timeoutMs = Number(env.CREATOR_LLM_TIMEOUT_MS || 90000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const requestBody = {
        model,
        temperature: 0,
        max_tokens: 1200,
        messages: [
          {
            role: "system",
            content:
              "You write concise, personalized creator outreach drafts for a TikTok Shop hair brand. Use only supplied evidence. Do not invent contact details, performance claims, pricing, guarantees, or exclusivity. Return JSON with subject and draft.",
          },
          {
            role: "user",
            content: [
              "Write one first-contact English outreach message.",
              "Offer facts: free product + paid collaboration + commission; main deliverable is TikTok Shop video content.",
              "Products: drawstring ponytail, half wig, crochet hair, braids.",
              `Creator evidence: ${JSON.stringify(creatorEvidenceSummary(creator))}`,
            ].join("\n"),
          },
        ],
      };
    let lastError;
    for (const useJsonMode of [true, false]) {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          ...requestBody,
          ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastError = new Error(
          body?.error?.message || body?.message || `model request failed (${response.status})`,
        );
        if (useJsonMode && response.status >= 400 && response.status < 500) continue;
        throw lastError;
      }
      const parsed = parseModelDraft(body?.choices?.[0]?.message?.content);
      if (!parsed.draft) throw new Error("model returned no usable draft");
      return { ...parsed, baseUrl };
    }
    throw lastError || new Error("model request failed");
  } finally {
    clearTimeout(timer);
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request, limitBytes = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > limitBytes) {
        reject(new Error("request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function hashCreators(creators) {
  return createHash("sha256").update(JSON.stringify(creators)).digest("hex");
}

export async function createCreatorRuntime({
  rootDirectory = process.cwd(),
  env: suppliedEnv = { ...process.env },
  fetchImpl = fetch,
  now = () => new Date(),
} = {}) {
  const env = {};
  await loadEnvFile(path.resolve(rootDirectory, "..", "automation", ".env"), env);
  await loadEnvFile(path.resolve(rootDirectory, ".env"), env);
  Object.assign(env, suppliedEnv);

  const dataDirectory = path.resolve(
    rootDirectory,
    env.CREATOR_DATA_DIR || path.join("data", "creator-crm"),
  );
  const stateFile = path.join(dataDirectory, "creators.json");
  const backupsDirectory = path.join(dataDirectory, "backups");
  const auditFile = path.join(dataDirectory, "events.jsonl");
  const automationDirectory = path.join(dataDirectory, "automation");
  const queueFile = path.join(automationDirectory, "queue.json");
  const seedFile = path.resolve(rootDirectory, "src", "lib", "echotikRealSeed.json");
  const legacyBackupFile = path.resolve(rootDirectory, "output", "creator-backups", "latest.json");
  let lastSavedHash = "";

  async function appendAudit(type, payload = {}) {
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(
      auditFile,
      `${JSON.stringify({ at: now().toISOString(), type, ...payload })}\n`,
      { flag: "a" },
    );
  }

  async function pruneBackups() {
    const files = (await readdir(backupsDirectory).catch(() => []))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .reverse();
    await Promise.all(files.slice(MAX_BACKUPS).map((name) => rm(path.join(backupsDirectory, name))));
  }

  async function initializeCreators() {
    const current = await readJson(stateFile, null);
    if (Array.isArray(current?.creators)) {
      validateCreators(current.creators);
      lastSavedHash = hashCreators(current.creators);
      return current;
    }

    const legacy = await readJson(legacyBackupFile, null);
    const seed = await readJson(seedFile, []);
    const creators = validateCreators(
      Array.isArray(legacy?.creators) && legacy.creators.length ? legacy.creators : seed,
    );
    const initialized = {
      schemaVersion: 1,
      savedAt: now().toISOString(),
      source: legacy?.creators?.length ? "legacy-backup" : "tracked-echotik-seed",
      count: creators.length,
      creators,
    };
    await atomicWriteJson(stateFile, initialized);
    lastSavedHash = hashCreators(creators);
    await appendAudit("creator_store_initialized", {
      count: creators.length,
      source: initialized.source,
    });
    return initialized;
  }

  async function getCreators() {
    return initializeCreators();
  }

  async function saveCreators(creatorsInput, { source = "creator-workbench", reason = "autosave" } = {}) {
    const creators = validateCreators(creatorsInput);
    const nextHash = hashCreators(creators);
    if (nextHash === lastSavedHash) return getCreators();

    const savedAt = now().toISOString();
    const payload = {
      schemaVersion: 1,
      savedAt,
      source,
      reason,
      count: creators.length,
      creators,
    };
    await atomicWriteJson(stateFile, payload);
    await mkdir(backupsDirectory, { recursive: true });
    await atomicWriteJson(
      path.join(backupsDirectory, `creators-${savedAt.replace(/[:.]/g, "-")}.json`),
      payload,
    );
    await pruneBackups();
    lastSavedHash = nextHash;
    await appendAudit("creator_store_saved", { count: creators.length, source, reason });
    return payload;
  }

  async function readQueue() {
    const queue = await readJson(queueFile, []);
    return Array.isArray(queue) ? queue : [];
  }

  async function writeQueue(queue) {
    await atomicWriteJson(queueFile, queue);
    await atomicWriteJson(path.join(automationDirectory, "latest.json"), {
      savedAt: now().toISOString(),
      count: queue.length,
      entries: queue,
    });
  }

  async function postJson(targetUrl, payload) {
    const response = await fetchImpl(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `webhook failed (${response.status})`);
    return body;
  }

  async function processAutomation(payload) {
    const creator = payload.creator || {};
    const action = payload.action || "draft";
    if (!cleanText(creator.id)) throw new Error("creator.id is required");
    if (!new Set(["draft", "confirm", "record_sent"]).has(action)) {
      throw new Error(`unsupported creator automation action: ${action}`);
    }
    if (action === "draft" && (payload.allowSend === true || payload.dryRun === false)) {
      throw new Error("automatic outreach sending is disabled; generate a draft first");
    }
    if (action === "record_sent" && !payload.confirmation?.confirmedAt) {
      throw new Error("human confirmation is required before recording outreach as sent");
    }

    const requestedAt = payload.requestedAt || now().toISOString();
    const queueId = `creator-outreach-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const queue = await readQueue();
    const entry = {
      id: queueId,
      requestedAt,
      updatedAt: requestedAt,
      action,
      status: "queued",
      creatorId: creator.id,
      creatorName: creator.displayName,
      creatorHandle: creator.handle,
      profileUrl: creator.profileUrl,
      channel: payload.channel || "manual",
      contact: compactCreatorContact(creator.contact),
      metrics: creator.metrics,
      matchedKeywords: creator.matchedKeywords || [],
      evidence: creator.evidence,
      confirmation: payload.confirmation,
      message: payload.message,
      payload: {
        ...payload,
        dryRun: action !== "record_sent",
        allowSend: Boolean(action === "record_sent" && payload.allowSend),
      },
    };
    queue.push(entry);
    await writeQueue(queue);

    const n8nDraftWebhook = cleanText(env.N8N_CREATOR_OUTREACH_WEBHOOK_URL);
    const n8nSendWebhook = cleanText(env.N8N_CREATOR_OUTREACH_SEND_WEBHOOK_URL);
    const chatwootWebhook = cleanText(env.N8N_CREATOR_CHATWOOT_WEBHOOK_URL);
    let result;

    if (action === "confirm") {
      result = {
        ok: true,
        queueId,
        status: "confirmed",
        source: "manual-confirm",
        confirmedAt: payload.confirmation?.confirmedAt || requestedAt,
        confirmedBy: payload.confirmation?.confirmedBy || "operator",
        draft: payload.message?.draft || "",
        dryRun: true,
        allowSend: false,
        updatedAt: now().toISOString(),
      };
    } else if (action === "record_sent") {
      if (n8nSendWebhook && payload.channel === "email") {
        const sent = await postJson(n8nSendWebhook, { ...payload, queueId });
        if (sent.ok === false) throw new Error(sent.message || sent.status || "email send failed");
        result = {
          ok: true,
          queueId,
          status: sent.status || "sent",
          source: "n8n-send-webhook",
          crmStatus: sent.crmStatus || "contacted",
          confirmedAt: payload.confirmation.confirmedAt,
          confirmedBy: payload.confirmation.confirmedBy,
          sentAt: sent.sentAt || now().toISOString(),
          draft: payload.message?.draft || "",
          message: sent.message || "Email send workflow completed.",
          dryRun: false,
          allowSend: true,
          updatedAt: now().toISOString(),
          n8nConfigured: true,
        };
      } else {
        result = {
          ok: true,
          queueId,
          status: "sent",
          source: "manual-send-record",
          crmStatus: "contacted",
          confirmedAt: payload.confirmation.confirmedAt,
          confirmedBy: payload.confirmation.confirmedBy,
          sentAt: now().toISOString(),
          draft: payload.message?.draft || "",
          message: `Human operator confirmed ${payload.channel || "manual"} outreach was sent.`,
          dryRun: false,
          allowSend: true,
          updatedAt: now().toISOString(),
          n8nConfigured: Boolean(n8nSendWebhook),
        };
      }
      if (chatwootWebhook) {
        try {
          result.chatwoot = await postJson(chatwootWebhook, {
            event: "outreach_sent",
            queueId,
            channel: payload.channel || "manual",
            creator,
            confirmation: payload.confirmation,
            message: payload.message,
            outreach: result,
          });
        } catch (error) {
          result.chatwoot = { status: "chatwoot_sync_failed", message: error.message };
        }
      }
    } else if (n8nDraftWebhook) {
      const response = await postJson(n8nDraftWebhook, {
        ...payload,
        queueId,
        dryRun: true,
        allowSend: false,
      });
      const parsed = parseModelDraft(
        response.draft || response.message || response.text || response.choices?.[0]?.message?.content,
      );
      result = {
        ok: true,
        queueId,
        status: "draft_ready",
        source: "n8n-webhook",
        subject: parsed.subject,
        draft: parsed.draft || createLocalCreatorDraft(creator),
        dryRun: true,
        allowSend: false,
        updatedAt: now().toISOString(),
        n8nConfigured: true,
      };
    } else {
      try {
        const modelDraft = await requestModelDraft({ env, fetchImpl, creator });
        result = {
          ok: true,
          queueId,
          status: "draft_ready",
          source: "model-computer",
          subject: modelDraft.subject,
          draft: modelDraft.draft,
          modelBaseUrl: modelDraft.baseUrl,
          dryRun: true,
          allowSend: false,
          updatedAt: now().toISOString(),
          n8nConfigured: false,
          modelConfigured: true,
        };
      } catch (error) {
        result = {
          ok: true,
          queueId,
          status: "draft_ready",
          source: "local-template-fallback",
          draft: createLocalCreatorDraft(creator),
          warning: error instanceof Error ? error.message : "model draft failed",
          dryRun: true,
          allowSend: false,
          updatedAt: now().toISOString(),
          n8nConfigured: false,
          modelConfigured: true,
        };
      }
    }

    const updatedQueue = queue.map((item) =>
      item.id === queueId ? { ...item, ...result, id: queueId } : item,
    );
    await writeQueue(updatedQueue);
    await appendAudit("creator_automation_event", {
      queueId,
      creatorId: creator.id,
      action,
      status: result.status,
      source: result.source,
    });
    return result;
  }

  async function health() {
    const state = await getCreators();
    return {
      ok: true,
      service: "tk-saas-creator-workbench",
      creatorCount: state.count,
      savedAt: state.savedAt,
      dataDirectory,
      modelBaseUrl: cleanText(
        env.CREATOR_LLM_BASE_URL || env.AUTOMATION_MODEL_BASE_URL_OVERRIDE || DEFAULT_MODEL_BASE_URL,
      ),
    };
  }

  async function handle(request, response) {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    try {
      if (request.method === "GET" && pathname === "/api/health") {
        sendJson(response, 200, await health());
        return true;
      }
      if (request.method === "GET" && pathname === "/api/local/creators") {
        sendJson(response, 200, { ok: true, ...(await getCreators()) });
        return true;
      }
      if (["PUT", "POST"].includes(request.method) && pathname === "/api/local/creators") {
        const body = JSON.parse((await readRequestBody(request)) || "{}");
        const saved = await saveCreators(body.creators, {
          source: body.source,
          reason: body.reason,
        });
        sendJson(response, 200, { ok: true, count: saved.count, savedAt: saved.savedAt });
        return true;
      }
      if (request.method === "POST" && pathname === "/api/local/creator-backup") {
        const body = JSON.parse((await readRequestBody(request)) || "{}");
        const saved = await saveCreators(body.creators, {
          source: body.source || "legacy-creator-backup",
          reason: "legacy-backup",
        });
        sendJson(response, 200, { ok: true, count: saved.count, savedAt: saved.savedAt });
        return true;
      }
      if (request.method === "GET" && pathname === "/api/local/creator-automation") {
        const queue = await readQueue();
        sendJson(response, 200, { ok: true, count: queue.length, entries: queue });
        return true;
      }
      if (request.method === "POST" && pathname === "/api/local/creator-automation") {
        const body = JSON.parse((await readRequestBody(request)) || "{}");
        sendJson(response, 200, await processAutomation(body));
        return true;
      }
      return false;
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
  }

  return {
    dataDirectory,
    env,
    getCreators,
    saveCreators,
    processAutomation,
    health,
    handle,
  };
}
