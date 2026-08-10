import { copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";

const require = createRequire(import.meta.url);
const source = require.resolve("vexflow/core");
const destination = fileURLToPath(new URL("../build/vexflow-core.js", import.meta.url));

await copyFile(source, destination);
