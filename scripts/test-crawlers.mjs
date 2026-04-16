#!/usr/bin/env node
/**
 * Smoke-test all Tier-1 crawlers — fetch live data, no DB writes.
 * Run: node scripts/test-crawlers.mjs
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs";

// Load .env.local
try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#"))
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
} catch {}

// Strip TypeScript via Node's experimental loader.
register("ts-node/esm", pathToFileURL("./"));

const mods = await Promise.all([
  import("../src/lib/crawlers/ungm.ts"),
  import("../src/lib/crawlers/reliefweb.ts"),
  import("../src/lib/crawlers/ted-eu.ts"),
  import("../src/lib/crawlers/uk-fts.ts"),
  import("../src/lib/crawlers/world-bank.ts"),
  import("../src/lib/crawlers/sam-gov.ts"),
]);

const fns = [
  ["UNGM", mods[0].crawlUNGM],
  ["ReliefWeb", mods[1].crawlReliefWeb],
  ["TED EU", mods[2].crawlTED],
  ["UK FTS", mods[3].crawlUKFTS],
  ["World Bank", mods[4].crawlWorldBank],
  ["SAM.gov", mods[5].crawlSAMGov],
];

for (const [name, fn] of fns) {
  const t0 = Date.now();
  const r = await fn();
  console.log(
    `${name.padEnd(12)} ${r.status.padEnd(8)} count=${String(r.tenders.length).padEnd(5)} ${Date.now() - t0}ms${r.error ? ` err=${r.error}` : ""}`,
  );
  if (r.tenders[0]) {
    const t = r.tenders[0];
    console.log(`  sample: [${t.reference_id}] ${t.title.slice(0, 80)}`);
    console.log(`          country=${t.country} deadline=${t.deadline} url=${t.source_url?.slice(0, 80)}`);
  }
}
