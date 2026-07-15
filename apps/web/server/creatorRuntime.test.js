import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCreatorRuntime } from "./creatorRuntime.js";

const temporaryDirectories = [];

async function fixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-saas-creators-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "src", "lib"), { recursive: true });
  await writeFile(
    path.join(root, "src", "lib", "echotikRealSeed.json"),
    JSON.stringify([
      {
        id: "echotik-1",
        displayName: "Creator One",
        handle: "creatorone",
        followers: 12000,
        matchedKeywords: ["braids"],
        contact: {},
        recentVideos: [],
      },
    ]),
  );
  return root;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("store-manager creator runtime", () => {
  it("initializes from the tracked EchoTik seed and persists edits outside browser storage", async () => {
    const root = await fixtureRoot();
    const runtime = await createCreatorRuntime({ rootDirectory: root, env: {} });

    const initial = await runtime.getCreators();
    expect(initial.count).toBe(1);
    expect(initial.source).toBe("tracked-echotik-seed");

    const edited = [{ ...initial.creators[0], crmStatus: "ready_to_contact" }];
    await runtime.saveCreators(edited, { reason: "crm-status-change" });

    const disk = JSON.parse(await readFile(path.join(root, "data", "creator-crm", "creators.json"), "utf8"));
    expect(disk.creators[0].crmStatus).toBe("ready_to_contact");
    const backups = await import("node:fs/promises").then(({ readdir }) =>
      readdir(path.join(root, "data", "creator-crm", "backups")),
    );
    expect(backups).toHaveLength(1);
  });

  it("uses the model-computer endpoint for a structured outreach draft", async () => {
    const root = await fixtureRoot();
    const requests = [];
    const runtime = await createCreatorRuntime({
      rootDirectory: root,
      env: { CREATOR_LLM_BASE_URL: "http://127.0.0.1:16081/v1" },
      fetchImpl: async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '```json\n{"subject":"Hair collaboration","draft":"Hi Creator One, your braids content is a strong fit."}\n```',
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });

    const creator = (await runtime.getCreators()).creators[0];
    const result = await runtime.processAutomation({
      action: "draft",
      dryRun: true,
      allowSend: false,
      creator,
    });

    expect(requests[0].url).toBe("http://127.0.0.1:16081/v1/chat/completions");
    expect(result).toMatchObject({
      status: "draft_ready",
      source: "model-computer",
      subject: "Hair collaboration",
      draft: "Hi Creator One, your braids content is a strong fit.",
      allowSend: false,
    });
  });

  it("falls back to a usable local template when the model computer is offline", async () => {
    const root = await fixtureRoot();
    const runtime = await createCreatorRuntime({
      rootDirectory: root,
      env: {},
      fetchImpl: async () => {
        throw new Error("model offline");
      },
    });
    const creator = (await runtime.getCreators()).creators[0];
    const result = await runtime.processAutomation({ action: "draft", creator });

    expect(result.source).toBe("local-template-fallback");
    expect(result.draft).toContain("@creatorone");
    expect(result.warning).toBe("model offline");
  });
});
