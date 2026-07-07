import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import http from "http";
import https from "https";

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
  plugins: [react(), echotikCdnProxy()],
});
