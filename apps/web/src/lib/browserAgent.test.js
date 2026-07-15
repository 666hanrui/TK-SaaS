import { describe, expect, it } from "vitest";
import {
  buildBrowserAgentRunConfig,
  classifyBrowserAgentGoal,
  isLocalBrowserAgentUrl,
  normalizeBrowserAgentJson,
} from "./browserAgent";

describe("browser agent safety and configuration", () => {
  it("uses the local OpenAI-compatible model endpoint by default", () => {
    const config = buildBrowserAgentRunConfig({
      env: {},
      module: "reviews",
      goal: "读取低星评价并生成回复草稿",
    });

    expect(config.llm).toMatchObject({
      baseUrl: "http://192.168.9.105:8081/v1",
      apiKey: "local",
      maxTokens: 2048,
      temperature: 0,
    });
    expect(config.llm.model).toContain("Qwen3.5-9B.Q4_K_M.gguf");
    expect(config.safety.requiresHumanConfirmation).toBe(true);
  });

  it("allows local TK-SaaS pages for the first Stagehand trial", () => {
    expect(isLocalBrowserAgentUrl("http://127.0.0.1:5173/")).toBe(true);
    expect(isLocalBrowserAgentUrl("http://localhost:5173/reviews")).toBe(true);
    expect(isLocalBrowserAgentUrl("https://www.instagram.com/youtube")).toBe(false);
  });

  it("keeps read and draft goals safe for automatic observe/extract", () => {
    const result = classifyBrowserAgentGoal("筛选1-3星评价，读取内容，生成回复草稿，但不要发送");

    expect(result.level).toBe("safe_read_or_draft");
    expect(result.allowedStagehandMethods).toEqual(["observe", "extract"]);
    expect(result.requiresHumanConfirmation).toBe(true);
  });

  it("treats grouped negative instructions as safety constraints instead of requested side effects", () => {
    const result = classifyBrowserAgentGoal(
      "观察当前页面并提取适合商品评分模块试点的信息；不要发送、提交、发货、退款或改库存。",
    );

    expect(result.level).toBe("safe_read_or_draft");
    expect(result.blockedKeywords).toEqual([]);
  });

  it("blocks external side-effect goals unless a human confirms at action time", () => {
    const result = classifyBrowserAgentGoal("点击发送回复，然后把订单标记为已发货并扣库存");

    expect(result.level).toBe("external_side_effect");
    expect(result.allowedStagehandMethods).toEqual(["observe", "extract"]);
    expect(result.blockedKeywords).toEqual(expect.arrayContaining(["发送", "发货", "库存"]));
    expect(result.requiresHumanConfirmation).toBe(true);
  });

  it("normalizes a model JSON response wrapped in a markdown code fence", () => {
    expect(normalizeBrowserAgentJson("```json\n{\"action\":\"observe\"}\n```"))
      .toBe('{"action":"observe"}');
  });

  it("removes residual thinking tags before parsing model JSON", () => {
    expect(normalizeBrowserAgentJson("</think>\n\n```json\n{\"action\":\"observe\"}\n```"))
      .toBe('{"action":"observe"}');
  });

  it("returns unwrapped model JSON unchanged", () => {
    expect(normalizeBrowserAgentJson('{"action":"observe"}')).toBe('{"action":"observe"}');
  });
});
