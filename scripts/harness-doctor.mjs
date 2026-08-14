import { databaseHealth, listAgents, listProjects } from "../db/local.ts";
import { getProviderStatus } from "./providers.mjs";
import { checkRuntime } from "./runtime-check.mjs";

const projects = listProjects().filter((project) => project.status !== "archived");
const requiredProviders = new Set(listAgents().filter((agent) => agent.enabled).map((agent) => String(agent.provider)));
const checks = projects.map((project) => ({
  projectId: project.id,
  name: project.name,
  runtime: checkRuntime(project.workspacePath, { probeProviders: true }),
}));
const providers = await getProviderStatus();
const errors = [];

for (const check of checks) {
  if (!check.runtime.ok) errors.push(...check.runtime.messages.map((message) => `${check.name}: ${message}`));
}
for (const providerId of requiredProviders) {
  const provider = providers[providerId];
  if (!provider?.installed) errors.push(`Provider ${providerId} ist nicht installiert oder nicht erreichbar: ${provider?.error ?? "unbekannter Fehler"}`);
  else if (!provider.loggedIn) errors.push(`Provider ${providerId} ist nicht mit dem lokalen Abo angemeldet.`);
  if (provider?.apiKeyDetected) errors.push(`Provider ${providerId} hat einen API-Key in der Umgebung. Der Harness erwartet das lokale Abo-Login.`);
}

const report = {
  ok: errors.length === 0,
  checkedAt: new Date().toISOString(),
  user: checks[0]?.runtime.user ?? checkRuntime("", { probeProviders: false }).user,
  database: databaseHealth(),
  projects: checks.map((check) => ({ projectId: check.projectId, name: check.name, workspace: check.runtime.workspace, git: check.runtime.git })),
  providers: Object.fromEntries(Object.entries(providers).map(([id, provider]) => [id, { installed: provider.installed, loggedIn: provider.loggedIn, version: provider.version ?? "", error: provider.error ?? "" }])),
  errors,
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
