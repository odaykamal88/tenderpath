/**
 * Pure-logic smoke for the founder-sales reasoning engine (src/lib/network/next-steps.ts).
 * No DB, no LLM — asserts the deterministic honesty invariants that the whole
 * command center rests on. Run: npx tsx scripts/crm-next-steps-smoke.ts
 */
import { readSalesState, summarizePortfolio, type SalesSignalInput } from "../src/lib/network/next-steps";

const NOW = new Date("2026-07-19T12:00:00Z");
const DAY = 86_400_000;
const ago = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString();
const ahead = (d: number) => new Date(NOW.getTime() + d * DAY).toISOString();

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

function base(over: Partial<SalesSignalInput>): SalesSignalInput {
  return {
    id: 1, name: "Acme", pipeline_stage: "lead", is_active: true, profile_status: "ready",
    created_at: ago(30), last_activity_at: ago(1),
    contact_email: "a@b.com", contact_linkedin: null, contact_phone: null,
    fresh_count: 0, match_count: 2, top_score: 70, nearest_deadline: ahead(30), ungm_status: "unknown",
    ...over,
  };
}

console.log("1. Replied → advance, now");
{
  const r = readSalesState(base({ pipeline_stage: "replied", last_activity_at: ago(1) }), NOW);
  check("disposition advance", r.disposition === "advance");
  check("urgency now", r.urgency === "now");
  check("action mentions reply", /repl/i.test(r.recommendedAction));
}

console.log("2. Hot untapped lead → advance");
{
  const r = readSalesState(base({ pipeline_stage: "lead", top_score: 88, fresh_count: 3 }), NOW);
  check("hot_untapped signal", r.signals.some((s) => s.code === "hot_untapped"));
  check("disposition advance", r.disposition === "advance");
}

console.log("3. Deadline pressure on engaged deal → advance, high urgency");
{
  const r = readSalesState(base({ pipeline_stage: "contacted", nearest_deadline: ahead(2), match_count: 1, last_activity_at: ago(2) }), NOW);
  check("deadline_pressure signal", r.signals.some((s) => s.code === "deadline_pressure"));
  check("disposition advance", r.disposition === "advance");
  check("urgency now", r.urgency === "now");
}

console.log("4. Dead air + no live matches → sunset WITH basis");
{
  const r = readSalesState(base({ pipeline_stage: "contacted", last_activity_at: ago(40), match_count: 0, top_score: 0, nearest_deadline: null, fresh_count: 0 }), NOW);
  check("disposition sunset", r.disposition === "sunset");
  check("has a sunset basis signal", r.signals.some((s) => s.sunsetBasis));
}

console.log("5. No channel + no matches, aged → sunset");
{
  const r = readSalesState(base({ pipeline_stage: "lead", contact_email: null, contact_linkedin: null, contact_phone: null, match_count: 0, top_score: 0, nearest_deadline: null, last_activity_at: ago(30) }), NOW);
  check("disposition sunset", r.disposition === "sunset");
}

console.log("6. Won → nurture, paused");
{
  const r = readSalesState(base({ pipeline_stage: "won" }), NOW);
  check("disposition nurture", r.disposition === "nurture");
  check("urgency paused", r.urgency === "paused");
}

console.log("7. Lost → sunset, paused, basis");
{
  const r = readSalesState(base({ pipeline_stage: "lost" }), NOW);
  check("disposition sunset", r.disposition === "sunset");
  check("has sunset basis", r.signals.some((s) => s.sunsetBasis));
}

console.log("8. LIVE OVERRIDE: dead air BUT a tender closes in 2d → advance, not sunset");
{
  const r = readSalesState(base({ pipeline_stage: "contacted", last_activity_at: ago(40), match_count: 2, top_score: 80, nearest_deadline: ahead(2) }), NOW);
  check("disposition advance (override)", r.disposition === "advance");
  check("NOT sunset", r.disposition !== "sunset");
}

console.log("9. GLOBAL INVARIANT: every sunset read carries a sunset basis");
{
  const scenarios: SalesSignalInput[] = [
    base({ pipeline_stage: "contacted", last_activity_at: ago(45), match_count: 0, nearest_deadline: null }),
    base({ pipeline_stage: "lost" }),
    base({ is_active: false }),
    base({ pipeline_stage: "lead", contact_email: null, contact_linkedin: null, contact_phone: null, match_count: 0, nearest_deadline: null, last_activity_at: ago(40) }),
  ];
  let ok = true;
  for (const s of scenarios) {
    const r = readSalesState(s, NOW);
    if (r.disposition === "sunset" && !r.signals.some((sg) => sg.sunsetBasis)) ok = false;
  }
  check("no baseless sunset", ok);
}

console.log("10. Portfolio summary counts");
{
  const companies = [
    base({ id: 1, pipeline_stage: "replied", last_activity_at: ago(1) }),
    base({ id: 2, pipeline_stage: "won" }),
    base({ id: 3, pipeline_stage: "lost" }),
    base({ id: 4, pipeline_stage: "contacted", nearest_deadline: ahead(3), match_count: 1 }),
  ];
  const reads = companies.map((c) => readSalesState(c, NOW));
  const p = summarizePortfolio(companies, reads, NOW);
  check("totalActive 4", p.totalActive === 4);
  check("deadlinesThisWeek >= 1", p.deadlinesThisWeek >= 1);
  check("funnel has 7 stages", p.funnel.length === 7);
  check("advancing >= 2", p.advancing >= 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
