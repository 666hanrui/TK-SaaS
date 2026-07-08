import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import http from "http";
import https from "https";
import fs from "fs/promises";
import path from "path";

function echotikCdnProxy() {
  return {
    name: "echotik-cdn-proxy",
    configureServer(server) {
      server.middlewares.use("/api/echotik-cdn", (req, res) => {
        const cdnPath = req.url.replace(/^\/api\/echotik-cdn/, "");
        const targetUrl = `https://echosell-images.tos-ap-southeast-1.volces.com${cdnPath}`;

        const client = https;
        client.get(
          targetUrl,
          {
            headers: {
              Referer: "https://www.tiktok.com/",
              Origin: "https://www.tiktok.com",
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
          },
          (cdnRes) => {
            if (cdnRes.statusCode >= 400) {
              cdnRes.resume();
              res.writeHead(cdnRes.statusCode);
              res.end();
              return;
            }
            res.writeHead(cdnRes.statusCode, {
              "Content-Type": cdnRes.headers["content-type"] || "image/jpeg",
              "Cache-Control": "public, max-age=86400",
            });
            cdnRes.pipe(res);
          },
        ).on("error", () => {
          res.writeHead(502);
          res.end();
        });
      });
    },
  };
}

function creatorBackupPlugin() {
  return {
    name: "creator-backup",
    configureServer(server) {
      server.middlewares.use("/api/local/creator-backup", (req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, message: "Method not allowed" }));
          return;
        }

        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => {
          body += chunk;
          if (body.length > 50 * 1024 * 1024) {
            req.destroy();
          }
        });
        req.on("end", async () => {
          try {
            const payload = JSON.parse(body || "{}");
            const creators = Array.isArray(payload.creators) ? payload.creators : [];
            const backupDir = path.resolve(process.cwd(), "output", "creator-backups");
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const backupPayload = {
              savedAt: new Date().toISOString(),
              count: creators.length,
              source: payload.source || "creator-workbench",
              creators,
            };

            await fs.mkdir(backupDir, { recursive: true });
            await fs.writeFile(
              path.join(backupDir, `creators-${creators.length}-${timestamp}.json`),
              JSON.stringify(backupPayload, null, 2),
            );
            await fs.writeFile(path.join(backupDir, "latest.json"), JSON.stringify(backupPayload, null, 2));

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, count: creators.length }));
          } catch (error) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : "backup failed" }));
          }
        });
      });
    },
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req, limitBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limitBytes) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function postJson(targetUrl, payload) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const body = JSON.stringify(payload);
    const client = parsedUrl.protocol === "https:" ? https : http;
    const request = client.request(
      parsedUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          let parsedBody = {};
          try {
            parsedBody = responseBody ? JSON.parse(responseBody) : {};
          } catch {
            parsedBody = { message: responseBody };
          }

          if (response.statusCode >= 400) {
            reject(new Error(parsedBody.message || `n8n webhook failed: ${response.statusCode}`));
            return;
          }

          resolve(parsedBody);
        });
      },
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function compactCreatorContact(contact = {}) {
  return Object.fromEntries(
    Object.entries({
      email: contact.email,
      instagram: contact.instagram,
      socialAccount: contact.socialAccount,
      notes: contact.notes,
    }).filter(([, value]) => value),
  );
}

function createLocalCreatorDraft(creator) {
  const name = creator.displayName || creator.handle || "there";
  const handle = String(creator.handle || "").replace(/^@/, "");
  const keywords = Array.isArray(creator.matchedKeywords) ? creator.matchedKeywords.slice(0, 4) : [];
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

async function readAutomationQueue(queueFile) {
  try {
    const parsed = JSON.parse(await fs.readFile(queueFile, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeAutomationQueue(automationDir, queue) {
  await fs.mkdir(automationDir, { recursive: true });
  await fs.writeFile(path.join(automationDir, "queue.json"), JSON.stringify(queue, null, 2));
  await fs.writeFile(
    path.join(automationDir, "latest.json"),
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        count: queue.length,
        entries: queue,
      },
      null,
      2,
    ),
  );
}

function creatorAutomationPlugin() {
  return {
    name: "creator-automation",
    configureServer(server) {
      server.middlewares.use("/api/local/creator-automation", async (req, res) => {
        const automationDir = path.resolve(process.cwd(), "output", "creator-automation");
        const queueFile = path.join(automationDir, "queue.json");

        if (req.method === "GET") {
          try {
            const queue = await readAutomationQueue(queueFile);
            sendJson(res, 200, { ok: true, count: queue.length, entries: queue });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              message: error instanceof Error ? error.message : "read queue failed",
            });
          }
          return;
        }

        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, message: "Method not allowed" });
          return;
        }

        try {
          const payload = JSON.parse((await readRequestBody(req)) || "{}");
          const creator = payload.creator ?? {};
          const action = payload.action || "draft";
          const allowedActions = new Set(["draft", "confirm", "record_sent"]);

          if (!creator.id) {
            sendJson(res, 400, { ok: false, message: "creator.id is required" });
            return;
          }

          if (!allowedActions.has(action)) {
            sendJson(res, 400, { ok: false, message: `Unsupported creator automation action: ${action}` });
            return;
          }

          if (action === "draft" && (payload.allowSend === true || payload.dryRun === false)) {
            sendJson(res, 409, {
              ok: false,
              status: "blocked",
              allowSend: false,
              dryRun: true,
              message: "Automatic outreach sending is disabled. Generate a draft first.",
            });
            return;
          }

          if (action === "record_sent" && !payload.confirmation?.confirmedAt) {
            sendJson(res, 409, {
              ok: false,
              status: "blocked",
              allowSend: false,
              dryRun: true,
              message: "Human confirmation is required before recording outreach as sent.",
            });
            return;
          }

          const now = new Date().toISOString();
          const queueId = `creator-outreach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const queue = await readAutomationQueue(queueFile);
          const entry = {
            id: queueId,
            requestedAt: payload.requestedAt || now,
            updatedAt: now,
            action,
            status: "queued",
            dryRun: action === "record_sent" ? false : true,
            allowSend: Boolean(action === "record_sent" && payload.allowSend),
            creatorId: creator.id,
            creatorName: creator.displayName,
            creatorHandle: creator.handle,
            profileUrl: creator.profileUrl,
            contact: compactCreatorContact(creator.contact),
            metrics: creator.metrics,
            matchedKeywords: creator.matchedKeywords ?? [],
            evidence: creator.evidence,
            confirmation: payload.confirmation,
            message: payload.message,
            payload: {
              ...payload,
              dryRun: action === "record_sent" ? false : true,
              allowSend: Boolean(action === "record_sent" && payload.allowSend),
            },
          };

          queue.push(entry);
          await writeAutomationQueue(automationDir, queue);

          const n8nWebhookUrl = process.env.N8N_CREATOR_OUTREACH_WEBHOOK_URL;
          const n8nSendWebhookUrl = process.env.N8N_CREATOR_OUTREACH_SEND_WEBHOOK_URL;
          let result;

          if (action === "confirm") {
            result = {
              ok: true,
              queueId,
              status: "confirmed",
              source: "manual-confirm",
              confirmedAt: payload.confirmation?.confirmedAt || now,
              confirmedBy: payload.confirmation?.confirmedBy || "operator",
              draft: payload.message?.draft || "",
              dryRun: true,
              allowSend: false,
              updatedAt: now,
            };
          } else if (action === "record_sent") {
            if (n8nSendWebhookUrl) {
              const n8nResult = await postJson(n8nSendWebhookUrl, {
                ...payload,
                queueId,
                dryRun: false,
                allowSend: true,
              });

              result = {
                ok: true,
                queueId,
                status: n8nResult.status || "sent",
                source: "n8n-send-webhook",
                crmStatus: n8nResult.crmStatus || "contacted",
                confirmedAt: payload.confirmation?.confirmedAt,
                confirmedBy: payload.confirmation?.confirmedBy,
                sentAt: n8nResult.sentAt || new Date().toISOString(),
                draft: payload.message?.draft || "",
                message: n8nResult.message || "Outreach send webhook completed.",
                dryRun: false,
                allowSend: true,
                updatedAt: new Date().toISOString(),
                n8nConfigured: true,
              };
            } else {
              result = {
                ok: true,
                queueId,
                status: "sent",
                source: "manual-send-record",
                crmStatus: "contacted",
                confirmedAt: payload.confirmation?.confirmedAt,
                confirmedBy: payload.confirmation?.confirmedBy,
                sentAt: new Date().toISOString(),
                draft: payload.message?.draft || "",
                message: "Human operator confirmed outreach was sent; CRM status recorded.",
                dryRun: false,
                allowSend: true,
                updatedAt: new Date().toISOString(),
                n8nConfigured: false,
              };
            }
          } else if (n8nWebhookUrl) {
            const n8nResult = await postJson(n8nWebhookUrl, {
              ...payload,
              queueId,
              dryRun: true,
              allowSend: false,
            });
            const draft =
              n8nResult.draft ||
              n8nResult.message ||
              n8nResult.text ||
              n8nResult?.choices?.[0]?.message?.content ||
              "";

            result = {
              ok: true,
              queueId,
              status: draft ? "draft_ready" : "queued",
              source: "n8n-webhook",
              draft,
              dryRun: true,
              allowSend: false,
              updatedAt: new Date().toISOString(),
              n8nConfigured: true,
            };
          } else {
            result = {
              ok: true,
              queueId,
              status: "draft_ready",
              source: "local-dry-run",
              draft: createLocalCreatorDraft(creator),
              dryRun: true,
              allowSend: false,
              updatedAt: new Date().toISOString(),
              n8nConfigured: false,
            };
          }

          const updatedQueue = queue.map((queueEntry) =>
            queueEntry.id === queueId
              ? {
                  ...queueEntry,
                  status: result.status,
                  updatedAt: result.updatedAt,
                  source: result.source,
                  draft: result.draft,
                  message: result.message,
                  confirmedAt: result.confirmedAt,
                  confirmedBy: result.confirmedBy,
                  sentAt: result.sentAt,
                  crmStatus: result.crmStatus,
                  n8nConfigured: result.n8nConfigured,
                }
              : queueEntry,
          );

          await writeAutomationQueue(automationDir, updatedQueue);
          sendJson(res, 200, result);
        } catch (error) {
          sendJson(res, 500, {
            ok: false,
            status: "failed",
            message: error instanceof Error ? error.message : "creator automation failed",
            dryRun: true,
            allowSend: false,
          });
        }
      });
    },
  };
}

export default defineConfig({
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
    proxy: {
      "/api/echotik": {
        target: "https://open.echotik.live",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/echotik/, "/api/v3/echotik"),
        secure: true,
      },
    },
  },
  plugins: [react(), echotikCdnProxy(), creatorBackupPlugin(), creatorAutomationPlugin()],
});
