import fs from "node:fs";
try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#"))
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
} catch {}
import { fetchViaBrowser } from "../src/lib/crawlers/_browser";

async function probe(label: string, url: string, opts: Parameters<typeof fetchViaBrowser>[1]) {
  console.log(`\n=== ${label} ===`);
  const t0 = Date.now();
  try {
    const r = await fetchViaBrowser(url, opts);
    console.log(`status=${r.status} ok=${r.ok} finalUrl=${r.finalUrl} bodyLen=${r.body.length} ${Date.now()-t0}ms`);
    console.log("--- first 800 chars ---");
    console.log(r.body.slice(0, 800));
    console.log("--- last 400 chars ---");
    console.log(r.body.slice(-400));
    // Does it have the target selector?
    if (label.includes("ADB")) {
      const m = r.body.match(/href="\/projects\/tenders\/[^"]*"/);
      console.log("ADB tender-link present?", m ? m[0].slice(0, 120) : "NO");
    }
    if (label.includes("EBRD")) {
      const m = r.body.match(/viewNotice\.html\?displayId=\d+/);
      console.log("EBRD notice-link present?", m ? m[0] : "NO");
      const cf = r.body.includes("Just a moment") || r.body.includes("cf-challenge");
      console.log("EBRD CF-challenge in body?", cf);
    }
  } catch (e) {
    console.log(`ERROR ${Date.now()-t0}ms: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main() {
  // ADB — navigate mode
  await probe("ADB navigate", "https://www.adb.org/projects/tenders", {
    mode: "navigate",
    warmupUrl: "https://www.adb.org/projects/tenders",
    waitForSelector: "a[href*='/projects/tenders/']",
    waitAfterNav: 500,
    waitMs: 2000,
    timeoutMs: 120000,
  });

  // EBRD — navigate mode
  await probe("EBRD navigate", "https://ecepp.ebrd.com/delta/viewNoticesPublic.html", {
    mode: "navigate",
    warmupUrl: "https://ecepp.ebrd.com/delta/viewNoticesPublic.html",
    waitForSelector: "a[href*='viewNotice.html?displayId=']",
    waitAfterNav: 1500,
    waitMs: 2000,
    timeoutMs: 120000,
  });
}
main();
