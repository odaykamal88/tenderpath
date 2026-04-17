import fs from "node:fs";
try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#"))
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
} catch {}
process.env.UNGM_DEBUG = "1";
import { crawlUNGM } from "../src/lib/crawlers/ungm";
(async () => {
  const t0 = Date.now();
  const r = await crawlUNGM();
  console.log("status:", r.status);
  console.log("tenders:", r.tenders.length);
  console.log("duration:", r.durationMs, "ms");
  if (r.status === "failure") console.log("error:", r.error);
  if (r.tenders.length) {
    console.log("sample:", {
      title: r.tenders[0].title,
      country: r.tenders[0].country,
      sector: r.tenders[0].sector,
      description: (r.tenders[0].description ?? "").slice(0, 120),
    });
  }
  console.log("wall:", Date.now() - t0, "ms");
  process.exit(0);
})();
