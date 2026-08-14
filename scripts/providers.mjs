import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { commandInvocation, runtimeEnvironment } from "./runtime-env.mjs";

const execFileAsync = promisify(execFile);
const codexHome = process.env.CODEX_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? process.cwd(), ".codex");

function runProviderCommand(command, args, options) {
  const invocation = commandInvocation(command, args, options.env);
  return execFileAsync(invocation.command, invocation.args, { timeout: 10_000, maxBuffer: 1024 * 1024, ...options, shell: false });
}

const providers = {
  codex: {
    label: "OpenAI Codex",
    command: process.platform === "win32" ? "codex.cmd" : "codex",
    versionArgs: ["--version"],
    loginCommand: "codex --login",
    billing: "ChatGPT-Abo über Codex-Login; kein API-Key erforderlich",
  },
  claude: {
    label: "Claude Code",
    command: process.platform === "win32" ? "claude.exe" : "claude",
    versionArgs: ["--version"],
    loginCommand: "claude (dann /login; Claude Console nicht auswählen)",
    billing: "Claude Pro/Max-Abo; ANTHROPIC_API_KEY muss leer sein",
  },
};

export async function getProviderStatus() {
  const result = {};
  for (const [id, provider] of Object.entries(providers)) {
    try {
      const { stdout } = await runProviderCommand(provider.command, provider.versionArgs, {
        windowsHide: true,
        env: runtimeEnvironment(),
      });
      let auth = { loggedIn: false, authMethod: undefined, subscriptionType: undefined };
      if (id === "codex") {
        const login = await runProviderCommand(provider.command, ["login", "status"], {
          windowsHide: true,
          env: runtimeEnvironment("", { ...process.env, CODEX_HOME: codexHome }),
        });
        const loginOutput = `${login.stdout}\n${login.stderr}`;
        auth = {
          loggedIn: /logged in/i.test(loginOutput),
          authMethod: /chatgpt/i.test(loginOutput) ? "ChatGPT" : undefined,
          subscriptionType: undefined,
        };
      } else {
        const authResult = await runProviderCommand(provider.command, ["auth", "status", "--json"], {
          windowsHide: true,
          env: runtimeEnvironment(),
        });
        const status = JSON.parse(authResult.stdout);
        auth = {
          loggedIn: Boolean(status.loggedIn),
          authMethod: status.authMethod,
          subscriptionType: status.subscriptionType,
        };
      }
      result[id] = {
        id,
        label: provider.label,
        installed: true,
        version: stdout.trim(),
        loginCommand: provider.loginCommand,
        billing: provider.billing,
        apiKeyDetected: id === "codex" ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.ANTHROPIC_API_KEY),
        ...auth,
      };
    } catch (error) {
      result[id] = {
        id,
        label: provider.label,
        installed: false,
        error: error instanceof Error ? error.message : "CLI nicht gefunden",
        loginCommand: provider.loginCommand,
        billing: provider.billing,
        apiKeyDetected: id === "codex" ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.ANTHROPIC_API_KEY),
        loggedIn: false,
        authMethod: undefined,
        subscriptionType: undefined,
      };
    }
  }
  return result;
}

export function providerDefinition(id) {
  return providers[id];
}
