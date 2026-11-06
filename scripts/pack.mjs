// Packs workspace packages for release.yml the way they are published.
//
//   node scripts/pack.mjs <out-dir> <package-dir>...
//
// Run `pnpm build` first. For each package this runs `pnpm pack` (which applies
// `publishConfig`, unlike `npm pack`), then fails if the packed package.json
// still has a `source` export condition or points at a file that isn't in the
// tarball. Writes <out-dir>/packed.json: [{ name, version, tarball }].

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const [outArg, ...dirs] = process.argv.slice(2);
if (!outArg || dirs.length === 0) {
  console.error("usage: node scripts/pack.mjs <out-dir> <package-dir>...");
  process.exit(2);
}

const out = resolve(outArg);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const shell = process.platform === "win32";
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", shell, ...opts });

// Reads one file from a .tgz (plain ustar, as npm and pnpm write it).
function readFromTarball(tarball, wanted) {
  const data = gunzipSync(readFileSync(tarball));
  const text = (start, end) => data.toString("utf8", start, end).replace(/\0.*$/s, "");
  for (let offset = 0; offset + 512 <= data.length; ) {
    const name = text(offset, offset + 100);
    if (!name) break;
    const prefix = text(offset + 345, offset + 500);
    const size = Number.parseInt(text(offset + 124, offset + 136).trim(), 8);
    const path = prefix ? `${prefix}/${name}` : name;
    if (path === wanted) return data.toString("utf8", offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${wanted} not found in ${tarball}`);
}

const problems = [];
const packed = [];

for (const dir of dirs) {
  const cwd = resolve(dir);
  const info = JSON.parse(run("pnpm", ["pack", "--json", "--pack-destination", out], { cwd }));
  const tarball = resolve(out, info.filename);
  const files = new Set(info.files.map((f) => f.path.replace(/^\.\//, "")));
  const manifest = JSON.parse(readFromTarball(tarball, "package/package.json"));
  const label = `${manifest.name}@${manifest.version}`;
  console.log(`\n${label}: ${info.filename}, ${files.size} files`);

  // Walk `exports` for conditions and targets.
  const walk = (node, path) => {
    if (typeof node === "string") {
      const target = node.replace(/^\.\//, "");
      if (!target.includes("*") && !files.has(target)) {
        problems.push(`${label}: ${path} points at ${node}, which is not in the tarball`);
      }
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (key === "source") {
          problems.push(`${label}: ${path} has a "source" condition (${JSON.stringify(value)})`);
        }
        walk(value, `${path}[${JSON.stringify(key)}]`);
      }
    }
  };
  if (!manifest.exports) problems.push(`${label}: packed package.json has no exports`);
  walk(manifest.exports, "exports");

  packed.push({ name: manifest.name, version: manifest.version, tarball });
}

writeFileSync(resolve(out, "packed.json"), `${JSON.stringify(packed, null, 2)}\n`);

if (problems.length > 0) {
  console.error(`\n${problems.map((p) => `✗ ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`\nAll ${packed.length} tarballs OK, written to ${out}`);
