import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { URL } from "node:url";

const bundleUrl = new URL("../build/opensheetmusicdisplay-ch-songbook.min.js", import.meta.url);
const bundle = await readFile(bundleUrl, "utf8");

if (bundle.includes("data:font/woff2;base64") || !bundle.includes("Bravura with Academico (external)")) {
  throw new Error("The CH-songbook bundle contains embedded fonts or lacks its external-font contract.");
}
if (!bundle.includes("./vexflow-core.js")) {
  throw new Error("The CH-songbook bundle does not reference its separate VexFlow core artefact.");
}

const require = createRequire(import.meta.url);
const namespace = require(bundleUrl.pathname);
const osmd = namespace.opensheetmusicdisplay || namespace.default || namespace;
if (typeof osmd.OpenSheetMusicDisplay !== "function") {
  throw new Error("The CH-songbook bundle does not expose OpenSheetMusicDisplay.");
}

process.stdout.write(
  "CH-songbook bundle contract verified: external fonts and separate VexFlow core.\n",
);
