// Bumps manifest.json and versions.json version. Usage: node version-bump.mjs 1.2.3
import fs from "fs";

const targetVersion = process.argv[2];
if (!targetVersion) {
  console.error("Usage: node version-bump.mjs <version>");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));

manifest.version = targetVersion;
versions[targetVersion] = manifest.minAppVersion;

fs.writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");

console.log(`Bumped to ${targetVersion}`);