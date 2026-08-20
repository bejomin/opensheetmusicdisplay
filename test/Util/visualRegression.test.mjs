import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import canvasPkg from "canvas";

const { createCanvas } = canvasPkg;
const comparator = path.join(import.meta.dirname, "visualRegression.mjs");
const temporaryDirectories = [];

function makeCorpus() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "osmd-visual-regression-"));
    temporaryDirectories.push(directory);
    fs.mkdirSync(path.join(directory, "blessed"));
    fs.mkdirSync(path.join(directory, "current"));
    return directory;
}

function writePng(file, width, height, changedPixels = []) {
    const imageCanvas = createCanvas(width, height);
    const context = imageCanvas.getContext("2d");
    const image = context.createImageData(width, height);
    image.data.fill(255);
    for (const [pixel, rgba] of changedPixels) {
        image.data.set(rgba, pixel * 4);
    }
    context.putImageData(image, 0, 0);
    fs.writeFileSync(file, imageCanvas.toBuffer("image/png"));
}

function writePair(directory, name, blessed, current) {
    writePng(path.join(directory, "blessed", name), ...blessed);
    writePng(path.join(directory, "current", name), ...current);
}

function runComparator(directory, prefix = "", environment = {}) {
    const args = [comparator, directory];
    if (prefix) {
        args.push(prefix);
    }
    return spawnSync(process.execPath, args, {
        encoding: "utf8",
        env: { ...process.env, NPROC: "2", ...environment },
    });
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { force: true, recursive: true });
    }
});

describe("visual-regression comparator", () => {
    it("sorts pixel differences and writes compatible diff artifacts", () => {
        const directory = makeCorpus();
        const white = [3, 1, []];
        writePair(directory, "same.png", white, white);
        writePair(directory, "small.png", white, [3, 1, [[0, [0, 0, 0, 255]]]]);
        writePair(directory, "large.png", white, [3, 1, [
            [0, [0, 0, 0, 255]],
            [1, [0, 0, 0, 255]],
        ]]);

        const diff = path.join(directory, "diff");
        fs.mkdirSync(path.join(diff, "nested"), { recursive: true });
        fs.writeFileSync(path.join(diff, "stale.txt"), "stale");
        fs.writeFileSync(path.join(diff, "nested", "keep.txt"), "keep");

        const result = runComparator(directory);
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.equal(fs.readFileSync(path.join(diff, "results.txt"), "utf8"), "large 2\nsmall 1\nsame 0\n");
        assert.equal(fs.existsSync(path.join(diff, "stale.txt")), false);
        assert.equal(fs.existsSync(path.join(diff, "nested", "keep.txt")), true);

        for (const name of ["large", "small"]) {
            assert.equal(fs.existsSync(path.join(diff, `${name}.png`)), true);
            assert.equal(fs.existsSync(path.join(diff, `${name}_Blessed.png`)), true);
            assert.equal(fs.existsSync(path.join(diff, `${name}_Current.png`)), true);
        }
        assert.equal(fs.existsSync(path.join(diff, "same.png")), false);
    });

    it("reports size mismatches and images missing from either corpus", () => {
        const directory = makeCorpus();
        writePair(directory, "shared.png", [1, 1, []], [2, 1, []]);
        writePng(path.join(directory, "blessed", "blessed-only.png"), 1, 1);
        writePng(path.join(directory, "current", "current-only.png"), 1, 1);

        const result = runComparator(directory);
        const diff = path.join(directory, "diff");
        const warnings = fs.readFileSync(path.join(diff, "warnings.txt"), "utf8");
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.equal(fs.readFileSync(path.join(diff, "results.txt"), "utf8"), "shared 2\n");
        assert.match(warnings, /blessed-only\.png missing in .*current/);
        assert.match(warnings, /current-only\.png doesn't exist in .*blessed/);
        assert.match(result.stdout, /dimensions differ/);
        assert.equal(fs.existsSync(path.join(diff, "shared.png")), true);
    });

    it("honors prefix and channel-threshold controls", () => {
        const directory = makeCorpus();
        writePair(directory, "Keep.png", [1, 1, [[0, [0, 0, 0, 255]]]], [1, 1, [[0, [4, 4, 4, 255]]]]);
        writePair(directory, "Skip.png", [1, 1, []], [1, 1, [[0, [0, 0, 0, 255]]]]);

        const result = runComparator(directory, "Keep", { CHANNEL_THRESHOLD: "5" });
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /image filter \(name prefix\): Keep\*\.png/);
        assert.equal(fs.readFileSync(path.join(directory, "diff", "results.txt"), "utf8"), "Keep 0\n");
    });

    it("fails clearly when required image directories are empty", () => {
        const directory = makeCorpus();
        const result = runComparator(directory);

        assert.equal(result.status, 1);
        assert.match(result.stderr, /Missing images in .*current/);
    });
});
