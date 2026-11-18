// Prints the GitHub Release notes for a version from CHANGELOG.md.
//
//   node scripts/release-notes.mjs <version> [<published package>...]
//
// Uses the `## [<version>] - <date>` section of CHANGELOG.md (Keep a
// Changelog), names the npm packages that were published and links the
// compare URL from the changelog's link references. Exits 1 if the section
// is missing or empty.

import { readFileSync } from "node:fs";
import { publishOrder, workspacePackages } from "./lib/release.mjs";

const [version, ...published] = process.argv.slice(2);
if (!version) {
  console.error("usage: node scripts/release-notes.mjs <version> [<published package>...]");
  process.exit(2);
}

const lines = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").split(/\r?\n/);
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`CHANGELOG.md has no "## [${version}]" section`);
  process.exit(1);
}
let end = lines.findIndex((line, i) => i > start && (line.startsWith("## ") || /^\[[^\]]+\]: /.test(line)));
if (end === -1) end = lines.length;
const body = lines.slice(start + 1, end).join("\n").trim();
if (!body) {
  console.error(`The "## [${version}]" section of CHANGELOG.md is empty`);
  process.exit(1);
}

const all = publishOrder(workspacePackages()).map((p) => p.name);
const links = published.map((name) => `[\`${name}\` ${version}](https://www.npmjs.com/package/${name}/v/${version})`);
const missing = all.filter((name) => !published.includes(name)).map((name) => `\`${name}\``);
let intro = links.length > 0 ? `Published to npm: ${links.join(", ")}.` : "";
if (missing.length > 0) {
  const list = missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}` : missing[0];
  intro += `${intro ? " " : ""}${list} ${missing.length > 1 ? "weren't" : "wasn't"} published with this release.`;
}

const compare = lines.find((line) => line.startsWith(`[${version}]: `))?.slice(version.length + 4).trim();

console.log([intro, body, compare && `**Full changes:** ${compare}`].filter(Boolean).join("\n\n"));
