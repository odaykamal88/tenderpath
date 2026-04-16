/**
 * Smoke-test all Tier-1 crawlers — fetch live data, no DB writes.
 * Run: node_modules/.bin/tsx scripts/test-crawlers.ts
 */
import fs from "node:fs";

try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#"))
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
} catch {}

import { crawlUNGM } from "../src/lib/crawlers/ungm";
import { crawlReliefWeb } from "../src/lib/crawlers/reliefweb";
import { crawlTED } from "../src/lib/crawlers/ted-eu";
import { crawlUKFTS } from "../src/lib/crawlers/uk-fts";
import { crawlWorldBank } from "../src/lib/crawlers/world-bank";
import { crawlSAMGov } from "../src/lib/crawlers/sam-gov";

const fns = [
  ["UNGM", crawlUNGM],
  ["ReliefWeb", crawlReliefWeb],
  ["TED EU", crawlTED],
  ["UK FTS", crawlUKFTS],
  ["World Bank", crawlWorldBank],
  ["SAM.gov", crawlSAMGov],
] as const;

async function main() {
for (const [name, fn] of fns) {
  const t0 = Date.now();
  const r = await fn();
  console.log(
    `${name.padEnd(12)} ${r.status.padEnd(8)} count=${String(r.tenders.length).padEnd(5)} ${Date.now() - t0}ms${r.error ? ` err=${r.error.slice(0, 120)}` : ""}`,
  );
  if (r.tenders[0]) {
    const t = r.tenders[0];
    console.log(`  sample: [${t.reference_id}] ${t.title.slice(0, 80)}`);
    console.log(`          country=${t.country} deadline=${t.deadline} url=${t.source_url?.slice(0, 80)}`);
  }
}
}
main();
