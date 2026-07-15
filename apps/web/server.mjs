import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCreatorRuntime } from "./server/creatorRuntime.js";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.join(rootDirectory, "dist");
const runtime = await createCreatorRuntime({ rootDirectory });
const host = runtime.env.CREATOR_WEB_HOST || "127.0.0.1";
const port = Number(runtime.env.CREATOR_WEB_PORT || 5173);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function proxyGet(request, response, targetUrl, headers = {}) {
  const upstream = https.get(
    targetUrl,
    {
      headers: {
        Accept: request.headers.accept || "*/*",
        "User-Agent": request.headers["user-agent"] || "TK-SaaS Creator Workbench",
        ...headers,
      },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, {
        "Content-Type": upstreamResponse.headers["content-type"] || "application/octet-stream",
        "Cache-Control": upstreamResponse.headers["cache-control"] || "no-store",
      });
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", (error) => {
    response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: false, message: error.message }));
  });
}

async function serveStatic(request, response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let filePath = path.resolve(distDirectory, relativePath);
  if (!filePath.startsWith(`${distDirectory}${path.sep}`) && filePath !== distDirectory) {
    response.writeHead(403);
    response.end();
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) filePath = path.join(filePath, "index.html");
    await access(filePath);
  } catch {
    filePath = path.join(distDirectory, "index.html");
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": path.basename(filePath) === "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
  });
  createReadStream(filePath).pipe(response);
}

await access(path.join(distDirectory, "index.html")).catch(() => {
  throw new Error("Web build is missing. Run npm run build before npm run start:manager.");
});

const server = http.createServer(async (request, response) => {
  if (await runtime.handle(request, response)) return;

  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
  if (request.method === "GET" && url.pathname.startsWith("/api/echotik-cdn/")) {
    const remotePath = url.pathname.replace(/^\/api\/echotik-cdn/, "");
    proxyGet(
      request,
      response,
      `https://echosell-images.tos-ap-southeast-1.volces.com${remotePath}${url.search}`,
      { Referer: "https://www.tiktok.com/", Origin: "https://www.tiktok.com" },
    );
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/echotik/")) {
    const remotePath = url.pathname.replace(/^\/api\/echotik/, "/api/v3/echotik");
    const username = runtime.env.ECHOTIK_USERNAME || "";
    const password = runtime.env.ECHOTIK_PASSWORD || "";
    const authorization = username || password
      ? `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
      : request.headers.authorization;
    proxyGet(request, response, `https://open.echotik.live${remotePath}${url.search}`, {
      ...(authorization ? { Authorization: authorization } : {}),
    });
    return;
  }

  await serveStatic(request, response, url.pathname);
});

server.listen(port, host, async () => {
  const health = await runtime.health();
  console.log(
    JSON.stringify(
      {
        ok: true,
        url: `http://${host}:${port}`,
        creatorCount: health.creatorCount,
        dataDirectory: health.dataDirectory,
        modelBaseUrl: health.modelBaseUrl,
      },
      null,
      2,
    ),
  );
});
