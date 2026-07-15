const DEFAULT_LOCAL_LLM_BASE_URL = "http://192.168.9.105:8081/v1";
const DEFAULT_LOCAL_LLM_MODEL = "C:\\Users\\666\\Downloads\\Qwen3.5-9B.Q4_K_M.gguf";
const DEFAULT_LOCAL_LLM_MAX_TOKENS = 2048;
const DEFAULT_LOCAL_LLM_TEMPERATURE = 0;
const DEFAULT_SAFE_METHODS = ["observe", "extract"];

const externalSideEffectKeywords = [
  "发送",
  "send",
  "提交",
  "submit",
  "发货",
  "ship",
  "退款",
  "refund",
  "扣库存",
  "改库存",
  "库存",
  "删除",
  "delete",
  "付款",
  "payment",
];

export function isLocalBrowserAgentUrl(value) {
  try {
    const url = new URL(value);
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function normalizeBrowserAgentJson(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/^<think>\s*[\s\S]*?<\/think>\s*/i, "")
    .replace(/^<\/think>\s*/i, "");
  const fencedJson = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fencedJson?.[1] || text).trim();
}

export function classifyBrowserAgentGoal(goal) {
  const normalizedGoal = String(goal || "").trim();
  const normalizedLowerGoal = normalizedGoal.toLowerCase();
  const blockedKeywords = externalSideEffectKeywords.filter((keyword) =>
    includesUnconfirmedSideEffect(normalizedLowerGoal, keyword.toLowerCase()),
  );

  return {
    level: blockedKeywords.length ? "external_side_effect" : "safe_read_or_draft",
    allowedStagehandMethods: [...DEFAULT_SAFE_METHODS],
    blockedKeywords,
    requiresHumanConfirmation: true,
  };
}

function includesUnconfirmedSideEffect(goal, keyword) {
  const keywordIndex = goal.indexOf(keyword);
  if (keywordIndex < 0) return false;

  const clauseStart = Math.max(
    goal.lastIndexOf("。", keywordIndex - 1),
    goal.lastIndexOf("；", keywordIndex - 1),
    goal.lastIndexOf(";", keywordIndex - 1),
    goal.lastIndexOf(".", keywordIndex - 1),
    goal.lastIndexOf("!", keywordIndex - 1),
    goal.lastIndexOf("?", keywordIndex - 1),
  );
  const clausePrefix = goal.slice(clauseStart + 1, keywordIndex);
  if (/(不要|不许|不能|不自动|禁止|without|do not|don't|never)/.test(clausePrefix)) {
    return false;
  }

  const prefix = goal.slice(Math.max(0, keywordIndex - 6), keywordIndex);
  const sentencePrefix = goal.slice(Math.max(0, keywordIndex - 24), keywordIndex);
  return !(
    /(不要|不许|不能|不自动|禁止|without|do not|don't|never)\s*$/.test(prefix) ||
    /(不要|不许|不能|不自动|禁止)\s*[^。；;.!?]*[、,，]\s*$/.test(sentencePrefix)
  );
}

export function buildBrowserAgentRunConfig({ env = {}, module = "reviews", goal = "", url = "" } = {}) {
  const safety = classifyBrowserAgentGoal(goal);
  const configuredTemperature = Number.parseFloat(
    env.STAGEHAND_LLM_TEMPERATURE ?? env.LOCAL_LLM_TEMPERATURE ?? "",
  );

  return {
    module,
    goal,
    url,
    target: {
      isLocal: url ? isLocalBrowserAgentUrl(url) : true,
    },
    llm: {
      baseUrl: env.STAGEHAND_LLM_BASE_URL || env.LOCAL_LLM_BASE_URL || DEFAULT_LOCAL_LLM_BASE_URL,
      apiKey: env.STAGEHAND_LLM_API_KEY || env.LOCAL_LLM_API_KEY || "local",
      model: env.STAGEHAND_LLM_MODEL || env.LOCAL_LLM_MODEL || DEFAULT_LOCAL_LLM_MODEL,
      maxTokens: Number(env.STAGEHAND_LLM_MAX_TOKENS || env.LOCAL_LLM_MAX_TOKENS) || DEFAULT_LOCAL_LLM_MAX_TOKENS,
      temperature: Number.isFinite(configuredTemperature)
        ? configuredTemperature
        : DEFAULT_LOCAL_LLM_TEMPERATURE,
    },
    safety,
  };
}
