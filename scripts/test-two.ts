import fs from "node:fs";
try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#"))
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
} catch {}
import { crawlADB } from "../src/lib/crawlers/adb";
import { crawlEBRD } from "../src/lib/crawlers/ebrd";
async function main() {
  for (const [name, fn] of [["ADB", crawlADB], ["EBRD", crawlEBRD]] as const) {
    const t0 = Date.now();
    const r = await fn();
    console.log(`${name.padEnd(6)} ${r.status.padEnd(8)} count=${String(r.tenders.length).padEnd(5)} ${Date.now()-t0}ms${r.error ? ` err=${r.error.slice(0,200)}` : ""}`);
    if (r.tenders[0]) {
      const t = r.tenders[0];
      console.log(`  sample: [${t.reference_id}] ${t.title.slice(0,80)}`);
      console.log(`          country=${t.country} deadline=${t.deadline}`);
    }
  }
}
main();
