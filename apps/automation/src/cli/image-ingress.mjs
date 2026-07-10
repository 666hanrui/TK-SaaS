import { createImageIngressServer, purgeExpiredImages } from "../image-ingress/server.js";
import { loadAutomationConfig } from "../config.js";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage:
  npm run image:ingress

Run only on the model computer. It binds to AUTOMATION_IMAGE_INGRESS_HOST (loopback only),
accepts authenticated multipart image uploads over the FRP STCP visitor, and returns a short-lived
model-local image URL.`);
  process.exit(0);
}

const config = loadAutomationConfig();
const server = createImageIngressServer({ config });
const cleanupTimer = setInterval(
  () => purgeExpiredImages({ directory: config.imageIngress.dataDirectory }).catch(() => {}),
  Math.min(config.imageIngress.ttlMs, 60_000),
);
cleanupTimer.unref();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    clearInterval(cleanupTimer);
    server.close(() => process.exit(0));
  });
}

server.listen(config.imageIngress.port, config.imageIngress.host, () => {
  console.log(
    `TK-SaaS private image ingress listening on http://${config.imageIngress.host}:${config.imageIngress.port}; use an FRP STCP visitor for worker uploads.`,
  );
});
