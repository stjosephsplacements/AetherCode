// Copies Monaco's prebuilt editor into public/monaco so the exam screen loads
// it from our own origin. Lab networks and Safe Exam Browser may block the CDN
// that @monaco-editor/react uses by default.
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// monaco-editor's "exports" hides package.json, so read it from its directory.
const packageDir = join(import.meta.dirname, "..", "node_modules", "monaco-editor");
const { version } = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
const target = join(import.meta.dirname, "..", "public", "monaco");
const stamp = join(target, "VERSION");

try {
  if (readFileSync(stamp, "utf8") === version) process.exit(0);
} catch {
  // Stamp does not exist or cannot be read; proceed with copy.
}

rmSync(target, { recursive: true, force: true });
cpSync(join(packageDir, "min", "vs"), join(target, "vs"), { recursive: true });
writeFileSync(stamp, version);
console.log(`monaco-editor ${version} copied to public/monaco`);

