import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import https from "node:https";
import { createCreatorRuntime } from "./server/creatorRuntime.js";

function echotikCdnProxy() {
  return {
    name: "echotik-cdn-proxy",
    configureServer(server) {
      server.middlewares.use("/api/echotik-cdn", (request, response) => {
        const targetUrl = `https://echosell-images.tos-ap-southeast-1.volces.com${request.url}`;
        https
          .get(
            targetUrl,
            {
              headers: {
                Referer: "https://www.tiktok.com/",
                Origin: "https://www.tiktok.com",
                "User-Agent": request.headers["user-agent"] || "TK-SaaS Creator Workbench",
              },
            },
            (upstream) => {
              response.writeHead(upstream.statusCode || 502, {
                "Content-Type": upstream.headers["content-type"] || "image/jpeg",
                "Cache-Control": "public, max-age=86400",
              });
              upstream.pipe(response);
            },
          )
          .on("error", () => {
            response.writeHead(502);
            response.end();
          });
      });
    },
  };
}

function creatorRuntimePlugin() {
  return {
    name: "creator-runtime",
    async configureServer(server) {
      const runtime = await createCreatorRuntime({ rootDirectory: process.cwd() });
      server.middlewares.use(async (request, response, next) => {
        if (!(await runtime.handle(request, response))) next();
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
        rewrite: (requestPath) => requestPath.replace(/^\/api\/echotik/, "/api/v3/echotik"),
        secure: true,
      },
    },
  },
  plugins: [react(), echotikCdnProxy(), creatorRuntimePlugin()],
});
