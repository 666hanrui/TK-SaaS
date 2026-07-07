#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";

const INPUT_PATH = path.resolve(process.cwd(), "output", "inspect", "echotik-requests.json");

function summarizeObject(obj, prefix = "") {
  const result = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) {
      result.push({ key: fullKey, type: "null" });
    } else if (Array.isArray(value)) {
      result.push({ key: fullKey, type: `array[${value.length}]` });
      if (value.length > 0 && typeof value[0] === "object") {
        result.push(...summarizeObject(value[0], `${fullKey}[0]`));
      }
    } else if (typeof value === "object") {
      result.push(...summarizeObject(value, fullKey));
    } else {
      result.push({ key: fullKey, type: typeof value, sample: String(value).slice(0, 60) });
    }
  }
  return result;
}

async function main() {
  const raw = await fs.readFile(INPUT_PATH, "utf-8");
  const captured = JSON.parse(raw);

  const responses = captured.filter((item) => item.type === "response" && item.status === 200);

  for (const response of responses) {
    const pathname = new URL(response.url).pathname;
    if (!response.body || typeof response.body !== "object") continue;

    console.log(`\n=== ${response.url} ===`);
    if (response.body.data && typeof response.body.data === "object") {
      const keys = Object.keys(response.body.data);
      console.log("Top-level data keys:", keys.slice(0, 30).join(", ") + (keys.length > 30 ? `... (${keys.length} total)` : ""));

      if (Array.isArray(response.body.data.list)) {
        console.log(`List count: ${response.body.data.list.length}`);
        if (response.body.data.list.length > 0) {
          const summary = summarizeObject(response.body.data.list[0]);
          console.log("First item fields:");
          for (const field of summary) {
            const sample = field.sample !== undefined ? ` = ${field.sample}` : "";
            console.log(`  ${field.key}: ${field.type}${sample}`);
          }
        }
      } else if (Array.isArray(response.body.data)) {
        console.log(`Array count: ${response.body.data.length}`);
        if (response.body.data.length > 0 && typeof response.body.data[0] === "object") {
          const summary = summarizeObject(response.body.data[0]);
          console.log("First item fields:");
          for (const field of summary) {
            const sample = field.sample !== undefined ? ` = ${field.sample}` : "";
            console.log(`  ${field.key}: ${field.type}${sample}`);
          }
        }
      } else if (keys.length > 0) {
        for (const key of keys) {
          const value = response.body.data[key];
          if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
            console.log(`Array ${key} count: ${value.length}`);
            const summary = summarizeObject(value[0]);
            console.log(`First ${key} item fields:`);
            for (const field of summary) {
              const sample = field.sample !== undefined ? ` = ${field.sample}` : "";
              console.log(`  ${field.key}: ${field.type}${sample}`);
            }
          } else if (key === "more_filters") {
            console.log(`more_filters structure:`);
            console.log(JSON.stringify(value, null, 2).slice(0, 2000));
          }
        }
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
