import OpenAI from "openai";
import { CustomOpenAIClient } from "@browserbasehq/stagehand";
import { z } from "zod";

export function normalizeModelJson(value) {
  let text = String(value ?? "").trim();
  text = text.replace(/^<think>[\s\S]*?<\/think>\s*/i, "").replace(/^<\/think>\s*/i, "");
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) text = fenced[1].trim();

  if (!text.startsWith("{") && !text.startsWith("[")) {
    const objectStart = text.indexOf("{");
    const arrayStart = text.indexOf("[");
    const start = [objectStart, arrayStart].filter((index) => index >= 0).sort((a, b) => a - b)[0];
    if (start !== undefined) {
      const objectEnd = text.lastIndexOf("}");
      const arrayEnd = text.lastIndexOf("]");
      const end = Math.max(objectEnd, arrayEnd);
      if (end > start) text = text.slice(start, end + 1);
    }
  }

  return text.trim();
}

export class LocalStagehandOpenAIClient extends CustomOpenAIClient {
  constructor({ modelName, client, maxTokens, temperature, hasVision = true, imageResolver }) {
    super({ modelName, client });
    this.client = client;
    this.modelName = modelName;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
    this.hasVision = hasVision;
    this.imageResolver = imageResolver;
  }

  async createChatCompletion({ options, retries = 1, logger }) {
    const messages = [...options.messages];
    if (options.image) {
      if (!this.hasVision) throw new Error("Stagehand requested an image but the configured model is not vision-enabled.");
      const imageUrl = await this.imageResolver.publish({
        buffer: options.image.buffer,
        mimeType: "image/jpeg",
        filenameHint: "stagehand-screenshot",
      });
      messages.push({
        role: "user",
        content: [
          ...(options.image.description
            ? [{ type: "text", text: options.image.description }]
            : []),
          {
            type: "image_url",
            image_url: { url: imageUrl },
          },
        ],
      });
    }

    if (options.response_model) {
      messages.push({
        role: "user",
        content: `Return only valid JSON matching this schema:\n${JSON.stringify(
          z.toJSONSchema(options.response_model.schema),
        )}`,
      });
    }

    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages,
      temperature: this.temperature,
      top_p: options.top_p,
      frequency_penalty: options.frequency_penalty,
      presence_penalty: options.presence_penalty,
      max_tokens: Math.max(Number(options.maxOutputTokens || 0), this.maxTokens),
      response_format: options.response_model ? { type: "json_object" } : undefined,
      stream: false,
      tools: options.tools?.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
    });

    const content = normalizeModelJson(response.choices[0]?.message?.content);
    const usage = {
      prompt_tokens: response.usage?.prompt_tokens ?? 0,
      completion_tokens: response.usage?.completion_tokens ?? 0,
      total_tokens: response.usage?.total_tokens ?? 0,
    };

    if (!options.response_model) return { data: content, usage };

    try {
      const parsed = JSON.parse(content);
      options.response_model.schema.parse(parsed);
      return { data: parsed, usage };
    } catch (error) {
      logger?.({
        category: "local-openai",
        level: 0,
        message: "Local model response did not satisfy the requested JSON schema.",
      });
      if (retries > 0) {
        return this.createChatCompletion({ options, retries: retries - 1, logger });
      }
      throw error;
    }
  }
}

export function createLocalStagehandClient(config, imageResolver) {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: config.timeoutMs,
    maxRetries: 0,
  });

  return new LocalStagehandOpenAIClient({
    modelName: config.model,
    client,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    hasVision: config.hasVision,
    imageResolver,
  });
}
