import { assertEgressEnv, parseWorkerGroup, type WorkerGroup } from "./groups";

// WORKER_GROUPS selects the process role (T-01). Imports are dynamic so the egress group never loads the DB client or S3/mail code.
let group: WorkerGroup;
try {
  group = parseWorkerGroup(process.env.WORKER_GROUPS);
  if (group === "verification-egress") assertEgressEnv(process.env);
} catch (e) {
  console.error(JSON.stringify({ msg: "worker.startup.refused", err: (e as Error).message }));
  process.exit(1);
}
await (group === "verification-egress" ? import("./egress-main") : import("./core-main"));
