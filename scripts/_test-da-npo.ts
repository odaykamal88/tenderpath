/**
 * Dry-run the DevelopmentAid NPO crawler — no DB writes, just print what
 * it would upsert. Confirms our filter (NPO + Open + MENA) matches the
 * diff-script's numbers (~23 NPO rows, some non-MENA, some non-Open).
 */
import { crawlDevelopmentAidNPO } from "../src/lib/crawlers/developmentaid-npo";

(async () => {
  const r = await crawlDevelopmentAidNPO();
  console.log(`platform=${r.platform} status=${r.status} duration=${r.durationMs}ms`);
  if (r.error) console.log(`error: ${r.error}`);
  console.log(`tenders: ${r.tenders.length}`);
  console.table(r.tenders.map((t) => ({
    ref: t.reference_id,
    country: t.country,
    deadline: t.deadline,
    sector: t.sector,
    title: t.title.slice(0, 60),
  })));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
