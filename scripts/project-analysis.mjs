import { execFileSync } from "node:child_process";
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { runtimeEnvironment } from "./runtime-env.mjs";

const ignoredDirectories = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".data", ".wrangler", ".cache"]);
const secretFile = /(^|\/)(\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx)|id_rsa(?:\.pub)?|credentials(?:\.json)?|secrets?\..*)$/i;
const relevantFiles = new Set([
  "README.md", "README", "package.json", "tsconfig.json", "jsconfig.json", "vite.config.ts", "vite.config.mjs",
  "next.config.ts", "next.config.mjs", "vitest.config.ts", "vitest.config.mts", "jest.config.js", "jest.config.ts",
  "playwright.config.ts", "cypress.config.ts", "docker-compose.yml", "Dockerfile",
]);

function isPlanningDocument(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase();
  return normalized.includes("docs/designupdate/") && normalized.endsWith(".html") && normalized.includes("umsetzungsplan");
}

function compact(value, limit) {
  const normalized = String(value ?? "").replace(/\r\n/g, "\n").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}\n[… gekürzt …]` : normalized;
}

function safeRelative(workspace, candidate) {
  const value = relative(workspace, candidate);
  return value && !value.startsWith(`..${sep}`) && value !== ".." && !value.includes(`..${sep}`) ? value.split(sep).join("/") : "";
}

async function readSafeFile(workspace, relativePath, limit = 6000) {
  if (secretFile.test(relativePath)) return { path: relativePath, excluded: "secret" };
  const filePath = resolve(workspace, relativePath);
  if (!safeRelative(workspace, filePath)) return { path: relativePath, excluded: "outside_workspace" };
  try {
    const stats = await lstat(filePath);
    if (!stats.isFile()) return { path: relativePath, excluded: "not_a_file" };
    if (stats.size > 250_000) return { path: relativePath, excluded: "too_large", size: stats.size };
    const content = await readFile(filePath, "utf8");
    return { path: relativePath, content: compact(content, limit), size: stats.size };
  } catch (error) {
    return { path: relativePath, excluded: error instanceof Error ? error.message : "unreadable" };
  }
}

async function collectTree(workspace, { maxDepth = 4, maxEntries = 400 } = {}) {
  const entries = [];
  const relevant = [];
  let omitted = 0;
  async function walk(directory, depth) {
    if (entries.length >= maxEntries || depth > maxDepth) { omitted += 1; return; }
    let children;
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch {
      omitted += 1;
      return;
    }
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      if (entries.length >= maxEntries) { omitted += 1; break; }
      const fullPath = resolve(directory, child.name);
      const relativePath = safeRelative(workspace, fullPath);
      if (!relativePath) continue;
      if (child.isSymbolicLink()) {
        entries.push({ path: relativePath, type: "symlink", excluded: "not_followed" });
        continue;
      }
      if (child.isDirectory()) {
        if (ignoredDirectories.has(child.name)) {
          entries.push({ path: relativePath, type: "directory", excluded: "ignored" });
        } else {
          entries.push({ path: relativePath, type: "directory" });
          await walk(fullPath, depth + 1);
        }
        continue;
      }
      if (!child.isFile()) continue;
      if (secretFile.test(relativePath)) {
        entries.push({ path: relativePath, type: "file", excluded: "secret" });
        continue;
      }
      entries.push({ path: relativePath, type: "file" });
      if ((depth <= 1 && relevantFiles.has(basename(relativePath))) || isPlanningDocument(relativePath)) relevant.push(relativePath);
    }
  }
  await walk(workspace, 0);
  return { entries, relevant: [...new Set(relevant)].slice(0, 12), omitted };
}

function gitStatus(workspace) {
  try {
    const output = execFileSync("git", ["-C", workspace, "status", "--porcelain=v1", "--branch", "--untracked-files=normal"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 4000, windowsHide: true,
      env: runtimeEnvironment(workspace),
    });
    const lines = output.trim().split(/\r?\n/).filter(Boolean);
    const branch = lines.find((line) => line.startsWith("##"))?.slice(2).trim() ?? "unbekannt";
    return { available: true, branch, changedFiles: Math.max(0, lines.length - (lines[0]?.startsWith("##") ? 1 : 0)), preview: lines.slice(0, 30) };
  } catch {
    return { available: false, branch: "", changedFiles: 0, preview: [] };
  }
}

function packageSummary(file) {
  if (!file?.content) return undefined;
  try {
    const parsed = JSON.parse(file.content);
    return {
      name: parsed.name ?? "",
      version: parsed.version ?? "",
      scripts: Object.entries(parsed.scripts ?? {}).map(([name, command]) => ({ name, command: String(command) })).slice(0, 30),
      dependencies: Object.keys(parsed.dependencies ?? {}).slice(0, 40),
      devDependencies: Object.keys(parsed.devDependencies ?? {}).slice(0, 40),
    };
  } catch {
    return { parseError: "package.json konnte nicht gelesen werden" };
  }
}

export async function analyzeProjectWorkspace(project, context = {}) {
  const workspace = resolve(String(project?.workspacePath ?? "").trim() || process.cwd());
  const workspaceStats = await lstat(workspace).catch(() => undefined);
  if (!workspaceStats?.isDirectory()) {
    return {
      status: "failed",
      summary: "Der konfigurierte Workspace ist nicht erreichbar.",
      snapshot: { workspace: { path: workspace, exists: false }, warnings: ["Workspace wurde nicht gefunden oder ist kein Ordner."] },
    };
  }
  const tree = await collectTree(workspace);
  const keyFiles = await Promise.all(tree.relevant.map((relativePath) => readSafeFile(
    workspace,
    relativePath,
    isPlanningDocument(relativePath) ? 30_000 : undefined,
  )));
  const packageFile = keyFiles.find((file) => file.path === "package.json");
  const summaryParts = [
    `${project?.name ?? "Projekt"}: ${tree.entries.filter((entry) => entry.type === "file").length} sichtbare Dateien`,
    tree.omitted ? `${tree.omitted} Bereiche aufgrund von Kontextgrenzen ausgelassen` : "Kontextgrenzen eingehalten",
    packageFile?.content ? "Projektkonfiguration erkannt" : "keine package.json im Root erkannt",
  ];
  const snapshot = {
    project: {
      id: project?.id ?? "",
      name: project?.name ?? "",
      key: project?.key ?? "",
      type: project?.type ?? "",
      description: project?.description ?? "",
      startCommand: project?.startCommand ?? "",
      testCommand: project?.testCommand ?? "",
    },
    workspace: { path: workspace, exists: true, analysisMode: "read-only", excludedDirectories: [...ignoredDirectories] },
    fileTree: tree.entries,
    files: keyFiles,
    package: packageSummary(packageFile),
    git: gitStatus(workspace),
    board: context.board ?? {},
    requests: context.requests ?? {},
    limits: { maxDepth: 4, maxEntries: 400, maxFileBytes: 250_000, secretFilesExcluded: true },
    warnings: tree.omitted ? ["Der Dateibaum wurde begrenzt; große oder irrelevante Bereiche wurden nicht an Mira gesendet."] : [],
  };
  return { status: "succeeded", summary: `${summaryParts.join(". ")}.`, snapshot };
}
