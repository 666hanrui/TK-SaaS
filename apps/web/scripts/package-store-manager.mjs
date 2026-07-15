import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDirectory, "..");
const repoRoot = path.resolve(webRoot, "..", "..");
const outputRoot = path.join(repoRoot, "output", "deploy");
const commitResult = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
});
const commit = commitResult.status === 0 ? commitResult.stdout.trim() : "uncommitted";
const packageName = `TK-SaaS-store-manager-creators-${commit}`;
const stagingRoot = path.join(outputRoot, "staging");
const packageRoot = path.join(stagingRoot, packageName);
const zipPath = path.join(outputRoot, `${packageName}.zip`);
const checksumPath = `${zipPath}.sha256`;
const seed = JSON.parse(await readFile(path.join(webRoot, "src", "lib", "echotikRealSeed.json"), "utf8"));

if (!Array.isArray(seed) || seed.length < 188) {
  throw new Error(`tracked creator seed is incomplete: ${Array.isArray(seed) ? seed.length : 0}`);
}
await readFile(path.join(webRoot, "dist", "index.html"), "utf8");

await rm(stagingRoot, { recursive: true, force: true });
await rm(zipPath, { force: true });
await rm(checksumPath, { force: true });
await mkdir(path.join(packageRoot, "apps"), { recursive: true });

const packagedWebRoot = path.join(packageRoot, "apps", "web");
await mkdir(path.join(packagedWebRoot, "server"), { recursive: true });
await mkdir(path.join(packagedWebRoot, "scripts"), { recursive: true });
for (const filename of [
  ".env.store-manager.example",
  "index.html",
  "package-lock.json",
  "package.json",
  "server.mjs",
  "vite.config.mjs",
]) {
  await cp(path.join(webRoot, filename), path.join(packagedWebRoot, filename));
}
await cp(path.join(webRoot, "dist"), path.join(packagedWebRoot, "dist"), { recursive: true });
await cp(path.join(webRoot, "src"), path.join(packagedWebRoot, "src"), {
  recursive: true,
  filter(source) {
    return !path.basename(source).endsWith(".test.js");
  },
});
await cp(
  path.join(webRoot, "server", "creatorRuntime.js"),
  path.join(packagedWebRoot, "server", "creatorRuntime.js"),
);
for (const filename of [
  "creator-preflight.mjs",
  "install-store-manager.ps1",
  "start-store-manager.ps1",
]) {
  await cp(path.join(webRoot, "scripts", filename), path.join(packagedWebRoot, "scripts", filename));
}

const automationTarget = path.join(packageRoot, "apps", "automation", "examples", "shadow");
await mkdir(automationTarget, { recursive: true });
for (const filename of [
  "README.md",
  "echotik-creators-search.json",
  "echotik-creator-detail.json",
]) {
  await cp(
    path.join(repoRoot, "apps", "automation", "examples", "shadow", filename),
    path.join(automationTarget, filename),
  );
}

await mkdir(path.join(packageRoot, "docs", "specs"), { recursive: true });
for (const filename of [
  "store-manager-creator-workbench-sop.md",
  "store-manager-windows-operations-sop.md",
]) {
  await cp(
    path.join(repoRoot, "docs", "specs", filename),
    path.join(packageRoot, "docs", "specs", filename),
  );
}
await cp(
  path.join(repoRoot, "店长电脑-启动达人工作台.cmd"),
  path.join(packageRoot, "start-creator-workbench.cmd"),
);

const manifest = {
  schemaVersion: 1,
  packageName,
  commit,
  producedAt: new Date().toISOString(),
  creatorSeedCount: seed.length,
  entrypoint: "start-creator-workbench.cmd",
  healthUrl: "http://127.0.0.1:5173/api/health",
  workbenchUrl: "http://127.0.0.1:5173/?section=creators",
  modelBaseUrl: "http://127.0.0.1:16081/v1",
  excludedState: [
    ".env and credentials",
    "creator CRM data and backups",
    "browser profiles and cookies",
    "node_modules",
  ],
};
await writeFile(
  path.join(packageRoot, "DEPLOYMENT-MANIFEST.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(packageRoot, "README-FIRST.txt"),
  [
    "TK-SaaS 店长电脑达人工作台",
    `版本：${commit}`,
    `内置真实达人种子：${seed.length} 人`,
    "",
    "1. 将整个文件夹放到 C:\\TK-SaaS（更新时保留原 apps\\web\\data 和 .env）。",
    "2. 首次运行 apps\\web\\scripts\\install-store-manager.ps1。",
    "3. 以后双击 start-creator-workbench.cmd。",
    "4. 完整说明见 docs\\specs\\store-manager-creator-workbench-sop.md。",
    "",
    "本包不包含账号密码、token、Cookie、Chrome profile 或已有达人 CRM 数据。",
  ].join("\r\n"),
  "utf8",
);

let archiveResult;
if (process.platform === "win32") {
  archiveResult = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -LiteralPath '${packageRoot.replaceAll("'", "''")}' -DestinationPath '${zipPath.replaceAll("'", "''")}' -Force`,
    ],
    { cwd: outputRoot, encoding: "utf8" },
  );
} else {
  archiveResult = spawnSync("zip", ["-q", "-r", zipPath, packageName], {
    cwd: stagingRoot,
    encoding: "utf8",
  });
}
if (archiveResult.status !== 0) {
  throw new Error(archiveResult.stderr || archiveResult.stdout || "failed to create deployment zip");
}

const checksum = createHash("sha256").update(await readFile(zipPath)).digest("hex");
await writeFile(checksumPath, `${checksum}  ${path.basename(zipPath)}\n`, "utf8");
await rm(stagingRoot, { recursive: true, force: true });

console.log(
  JSON.stringify(
    {
      ok: true,
      packageName,
      commit,
      creatorSeedCount: seed.length,
      zipPath,
      checksumPath,
      sha256: checksum,
    },
    null,
    2,
  ),
);
