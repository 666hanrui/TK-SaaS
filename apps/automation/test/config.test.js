import assert from "node:assert/strict";
import test from "node:test";
import { loadAutomationConfig } from "../src/config.js";

test("FRP Qwen profile selects the configured remote model without replacing unrelated policy settings", () => {
  const config = loadAutomationConfig({
    cwd: "/tmp/tk-saas-config-test",
    env: {
      AUTOMATION_MODEL_PROFILE: "frp_qwen_vision",
      AUTOMATION_MODE: "shadow",
      AUTOMATION_ALLOWED_ORIGINS: "https://seller.example.test",
      AUTOMATION_EXTERNAL_READ: "true",
      LOCAL_LLM_BASE_URL: "http://old-model.example.test/v1",
      LOCAL_LLM_MODEL: "old-model",
    },
  });
  assert.equal(config.modelProfile, "frp_qwen_vision");
  assert.equal(config.llm.baseUrl, "http://49.235.153.151:6081/v1");
  assert.equal(config.llm.model, "C:\\Users\\666\\Downloads\\Qwen3.5-9B.Q4_K_M.gguf");
  assert.equal(config.llm.imageTransport, "remote_url");
  assert.deepEqual(config.allowedOrigins, ["https://seller.example.test"]);
  assert.equal(config.externalReadEnabled, true);
});

test("a LAN worker service requires a bearer token while a local development service does not", () => {
  const lan = loadAutomationConfig({
    cwd: "/tmp/tk-saas-config-test",
    env: { AUTOMATION_SERVICE_HOST: "192.168.1.80" },
  });
  const local = loadAutomationConfig({
    cwd: "/tmp/tk-saas-config-test",
    env: { AUTOMATION_SERVICE_HOST: "127.0.0.1" },
  });
  assert.equal(lan.service.requireToken, true);
  assert.equal(lan.service.token, "");
  assert.equal(local.service.requireToken, false);
});

test("the FRP model profile permits an explicit private image transport override", () => {
  const config = loadAutomationConfig({
    cwd: "/tmp/tk-saas-config-test",
    env: {
      AUTOMATION_MODEL_PROFILE: "frp_qwen_vision",
      AUTOMATION_IMAGE_TRANSPORT_OVERRIDE: "http_upload",
      AUTOMATION_IMAGE_UPLOAD_URL: "https://image-upload.example.test/private",
      AUTOMATION_IMAGE_UPLOAD_BEARER_TOKEN: "test-token",
    },
  });
  assert.equal(config.llm.baseUrl, "http://49.235.153.151:6081/v1");
  assert.equal(config.llm.imageTransport, "http_upload");
  assert.equal(config.llm.imageUploadUrl, "https://image-upload.example.test/private");
});

test("the FRP profile permits a worker-local STCP model endpoint override", () => {
  const config = loadAutomationConfig({
    cwd: "/tmp/tk-saas-config-test",
    env: {
      AUTOMATION_MODEL_PROFILE: "frp_qwen_vision",
      AUTOMATION_MODEL_BASE_URL_OVERRIDE: "http://127.0.0.1:16081/v1",
    },
  });
  assert.equal(config.llm.baseUrl, "http://127.0.0.1:16081/v1");
  assert.equal(config.llm.model, "C:\\Users\\666\\Downloads\\Qwen3.5-9B.Q4_K_M.gguf");
});

test("HCRD inventory configuration targets the authenticated session API and keeps visual audit enabled", () => {
  const config = loadAutomationConfig({
    cwd: "/tmp/tk-saas-config-test",
    env: {
      HCRD_BASE_URL: "http://124.156.202.7:8888/wms-main",
      HCRD_INVENTORY_PAGE_SIZE: "200",
      HCRD_USERNAME: "test-user",
      HCRD_PASSWORD: "test-password",
    },
  });
  assert.deepEqual(config.hcrdInventory, {
    baseUrl: "http://124.156.202.7:8888/wms-main",
    path: "/inventory/inventory/listForClientAction.json",
    pageSize: 200,
    maxPages: 100,
    visualAudit: true,
    authWaitMs: 300_000,
    username: "test-user",
    password: "test-password",
  });
});

test("TikTok inventory configuration enables complete session API pagination and visual audit", () => {
  const config = loadAutomationConfig({
    cwd: "/tmp/tk-saas-config-test",
    env: {},
  });
  assert.deepEqual(config.tiktokInventory, {
    apiPath: "/api/v1/product/stock/sku/list",
    pageSize: 50,
    maxPages: 100,
    sessionApi: true,
    visualAudit: true,
  });
});
