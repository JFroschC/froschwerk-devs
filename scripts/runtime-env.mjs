import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

function normalizedWorkspace(workspace) {
  return resolve(workspace).replace(/\\/g, "/");
}

/**
 * Give child processes access to the selected repository without changing the
 * user's global Git configuration. This is required when the Harness runs as
 * FroschAgent while the repository is owned by the interactive Windows user.
 */
export function withWorkspaceGitTrust(workspace, baseEnv = process.env) {
  const env = { ...baseEnv };
  if (!workspace) return env;

  const configuredCount = Number.parseInt(String(env.GIT_CONFIG_COUNT ?? "0"), 10);
  const index = Number.isSafeInteger(configuredCount) && configuredCount >= 0 ? configuredCount : 0;
  env.GIT_CONFIG_COUNT = String(index + 1);
  env[`GIT_CONFIG_KEY_${index}`] = "safe.directory";
  env[`GIT_CONFIG_VALUE_${index}`] = normalizedWorkspace(workspace);
  return env;
}

/** Normalize the profile-sensitive environment inherited by every local CLI. */
export function runtimeEnvironment(workspace = "", baseEnv = process.env) {
  const env = { ...baseEnv };
  const userProfile = env.USERPROFILE || env.HOME || process.cwd();

  if (process.platform === "win32" && env.USERPROFILE) {
    // Start-Process -Credential may retain HOME from the caller even though it
    // correctly replaces USERPROFILE. Git and several CLIs prefer HOME.
    env.HOME = env.USERPROFILE;
    const drive = env.USERPROFILE.match(/^[A-Za-z]:/)?.[0];
    if (drive) {
      env.HOMEDRIVE = drive;
      env.HOMEPATH = env.USERPROFILE.slice(drive.length) || "\\";
    }

    // Windows environment keys are case-insensitive, JavaScript object keys
    // are not. A credential-launched process may expose `Path` instead of
    // `PATH`; canonicalize it before adding the user's npm directory.
    const pathValue = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === "PATH" && key !== "PATH") delete env[key];
    }
    env.PATH = String(pathValue);
    const npmBin = env.APPDATA ? join(env.APPDATA, "npm") : "";
    if (npmBin && existsSync(npmBin)) {
      const pathEntries = String(env.PATH ?? "").split(";").filter(Boolean);
      if (!pathEntries.some((entry) => entry.toLowerCase() === npmBin.toLowerCase())) {
        env.PATH = [npmBin, ...pathEntries].join(";");
      }
    }
  }

  env.CODEX_HOME ||= join(userProfile, ".codex");
  return workspace ? withWorkspaceGitTrust(workspace, env) : env;
}

function pathEntries(env) {
  return String(env.PATH ?? env.Path ?? "").split(process.platform === "win32" ? ";" : ":").filter(Boolean);
}

function resolveWindowsCommand(command, env) {
  if (isAbsolute(command) && existsSync(command)) return command;
  const candidates = [
    ...(env.APPDATA ? [join(env.APPDATA, "npm", command)] : []),
    ...pathEntries(env).map((entry) => join(entry.replace(/^"|"$/g, ""), command)),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

/**
 * npm's Windows shim starts Node through a second cmd.exe layer. Passing
 * Codex' quoted TOML values and workspace paths through that layer can turn
 * the shim's `"%_prog%"` into `""node""`. Invoke the JavaScript entry point
 * with this already-running Node binary instead; every argument then remains
 * a distinct argv value, including workspaces containing spaces.
 */
export function commandInvocation(command, args = [], env = process.env) {
  if (process.platform === "win32" && basename(command).toLowerCase() === "codex.cmd") {
    const shim = resolveWindowsCommand(command, env);
    const cli = process.env.CODEX_CLI_JS
      || env.CODEX_CLI_JS
      || (shim ? join(dirname(shim), "node_modules", "@openai", "codex", "bin", "codex.js") : "");
    if (cli && existsSync(cli)) {
      return { command: process.execPath, args: [cli, ...args], resolvedCommand: shim || cli };
    }

    // Preserve a useful native error for non-npm/custom installations. Normal
    // Harness installations always take the shell-free branch above.
    return {
      command: env.ComSpec || env.COMSPEC || "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args],
    };
  }
  return { command, args };
}
