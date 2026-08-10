import { spawnSync } from "node:child_process";
import process from "node:process";

if (process.env.CH_SONGBOOK_SKIP_OSMD_PREPARE === "1") {
  process.stdout.write("Skipping OSMD prepare build for the CH-songbook package target.\n");
  process.exit(0);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
for (const script of ["husky", "build"]) {
  const result = spawnSync(npm, ["run", script], {
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
