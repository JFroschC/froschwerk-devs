import { accessSync, constants, existsSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { commandInvocation, runtimeEnvironment } from "./runtime-env.mjs";

function actualWindowsUser() {
  const result = spawnSync(process.platform === "win32" ? "whoami.exe" : "whoami", [], { encoding: "utf8", timeout: 2000, windowsHide: true });
  return String(result.stdout || "").trim() || [process.env.USERDOMAIN, process.env.USERNAME].filter(Boolean).join("\\") || "unbekannt";
}

function writeProbe(directory) {
  const probe = join(directory, `.froschwerk-write-check-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(probe, "ok", { flag: "wx" });
    unlinkSync(probe);
    return true;
  } catch {
    try { if (existsSync(probe)) unlinkSync(probe); } catch { /* best effort cleanup */ }
    return false;
  }
}

function pathCheck(target, { directory = false, write = false } = {}) {
  const result = { path: target, exists: existsSync(target), readable: false, writable: false, ok: false };
  if (!result.exists) return result;
  try {
    if (directory && !statSync(target).isDirectory()) return result;
    accessSync(target, constants.R_OK);
    result.readable = true;
    if (write && directory) {
      result.writable = writeProbe(target);
    } else if (write) {
      accessSync(target, constants.W_OK);
      result.writable = true;
    }
  } catch {
    result.writable = false;
  }
  result.ok = result.readable && (!write || result.writable);
  return result;
}

function commandCheck(command, env = runtimeEnvironment()) {
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  const result = { command, installed: false, path: "", version: "", error: "" };
  const located = spawnSync(lookup, [command], { encoding: "utf8", timeout: 3000, windowsHide: true, shell: false, env });
  result.path = String(located.stdout || "").split(/\r?\n/).find(Boolean)?.trim() ?? "";
  if (!result.path && process.platform === "win32" && command === "codex.cmd") {
    const npmCommand = join(process.env.APPDATA || "", "npm", command);
    if (existsSync(npmCommand)) result.path = npmCommand;
  }
  if (!result.path) {
    result.error = String(located.stderr || "CLI nicht gefunden").trim();
    return result;
  }
  result.installed = true;
  const versionInvocation = commandInvocation(command, ["--version"], env);
  const version = spawnSync(versionInvocation.command, versionInvocation.args, { encoding: "utf8", timeout: 5000, windowsHide: true, shell: false, env });
  result.version = String(version.stdout || version.stderr || "").trim().split(/\r?\n/)[0] ?? "";
  if (version.error) result.error = version.error.message;
  if (command === "codex.cmd" || command === "codex") {
    const helpInvocation = commandInvocation(command, ["exec", "--help"], env);
    const help = spawnSync(helpInvocation.command, helpInvocation.args, { encoding: "utf8", timeout: 5000, windowsHide: true, shell: false, env });
    result.execSyntaxValid = help.status === 0;
    if (!result.execSyntaxValid) result.error = String(help.stderr || "Codex exec --help failed").trim();
  }
  return result;
}

function gitWorkspaceCheck(workspacePath, env) {
  if (!workspacePath || !existsSync(join(workspacePath, ".git"))) return { repository: false, ok: true, error: "" };
  const result = spawnSync("git", ["-C", workspacePath, "rev-parse", "--show-toplevel"], {
    encoding: "utf8", timeout: 5000, windowsHide: true, env,
  });
  return { repository: true, ok: result.status === 0, root: String(result.stdout ?? "").trim(), error: result.error?.message ?? String(result.stderr ?? "").trim() };
}

export function checkRuntime(workspacePath = "", { probeProviders = true, requiredProvider } = {}) {
  const username = actualWindowsUser();
  const normalizedEnv = runtimeEnvironment(workspacePath);
  const userProfile = normalizedEnv.USERPROFILE || normalizedEnv.HOME || process.cwd();
  const codexHome = normalizedEnv.CODEX_HOME || join(userProfile, ".codex");
  const codexDirectory = pathCheck(codexHome, { directory: true, write: true });
  const codexTmp = pathCheck(join(codexHome, "tmp"), { directory: true, write: true });
  const codexState = pathCheck(join(codexHome, "state_5.sqlite"), { write: true });
  const arg0Directory = pathCheck(join(codexHome, "tmp", "arg0"), { directory: true, write: true });
  const workspace = workspacePath ? pathCheck(workspacePath, { directory: true, write: true }) : null;
  const git = gitWorkspaceCheck(workspacePath, normalizedEnv);
  const providers = probeProviders ? {
    codex: commandCheck(process.platform === "win32" ? "codex.cmd" : "codex", normalizedEnv),
    claude: commandCheck(process.platform === "win32" ? "claude.exe" : "claude", normalizedEnv),
  } : {
    codex: { command: process.platform === "win32" ? "codex.cmd" : "codex", installed: undefined, path: "", version: "", error: "Nicht geprüft" },
    claude: { command: process.platform === "win32" ? "claude.exe" : "claude", installed: undefined, path: "", version: "", error: "Nicht geprüft" },
  };

  const messages = [];
  if (/codexsandbox/i.test(username)) messages.push(`Harness läuft unter einem Sandbox-Benutzer (${username}). Bitte in einer normalen PowerShell starten.`);
  if (!codexDirectory.ok) messages.push(`CODEX_HOME ist nicht beschreibbar: ${codexHome}`);
  if (codexDirectory.ok && !codexTmp.ok && !codexState.ok) messages.push(`Codex benötigt Schreibrechte in ${codexHome} (State-Datenbank und temporäre Dateien).`);
  if (workspace && !workspace.ok) messages.push(`Der aktive Projekt-Workspace ist nicht beschreibbar: ${workspacePath}`);
  if (!git.ok) messages.push(`Git kann den aktiven Workspace trotz isolierter safe.directory-Konfiguration nicht verwenden: ${git.error || workspacePath}`);
  if (probeProviders && providers.codex.installed && providers.codex.execSyntaxValid === false) messages.push("Die installierte Codex-CLI konnte mit 'exec --help' nicht validiert werden.");
  if (probeProviders && requiredProvider && !providers[requiredProvider]?.installed) messages.push(`Der für diesen Agenten konfigurierte Provider ${requiredProvider} ist nicht installiert oder nicht über PATH erreichbar.`);

  return {
    ok: messages.length === 0,
    checkedAt: new Date().toISOString(),
    user: { username, userProfile, sandbox: /codexsandbox/i.test(username) },
    codexHome: { path: codexHome, directory: codexDirectory, tmp: codexTmp, state: codexState, arg0: arg0Directory },
    providers,
    workspace,
    git,
    messages,
  };
}
