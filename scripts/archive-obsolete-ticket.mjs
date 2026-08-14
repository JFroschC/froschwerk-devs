import { archiveObsoleteTask } from "../db/local.ts";

const args = process.argv.slice(2);
const valueFor = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const taskId = valueFor("--task");
const reason = valueFor("--reason");
if (!taskId || !reason) {
  console.error("Usage: node --experimental-strip-types scripts/archive-obsolete-ticket.mjs --task <ticket-id> --reason <reason>");
  process.exitCode = 2;
} else {
  const task = archiveObsoleteTask(taskId, reason);
  if (!task) {
    console.error(`Ticket nicht gefunden: ${taskId}`);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ id: task.id, status: task.status, obsoleteAt: task.obsoleteAt, obsoleteReason: task.obsoleteReason }));
  }
}
