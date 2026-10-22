// Adds the shebang so `npx df-market-intelligence-mcp` runs, and ships the built-in endpoint list.
import { chmodSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
const f = "dist/index.js";
const s = readFileSync(f, "utf8");
if (!s.startsWith("#!")) writeFileSync(f, "#!/usr/bin/env node\n" + s);
chmodSync(f, 0o755);
copyFileSync("src/catalog.snapshot.json", "dist/catalog.snapshot.json");
