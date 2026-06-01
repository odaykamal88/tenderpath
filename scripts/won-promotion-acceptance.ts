/**
 * scripts/won-promotion-acceptance.ts
 *
 * Sprint 12 — won-tender → past_performance promotion acceptance.
 *
 * Verifies the pure helpers in won-promotion.ts: amount parsing, year
 * parsing, structured-evidence builder, sector tag inference. The DB
 * promotion (promoteWonPipelineItem) is verified by manual + preview-deploy
 * testing — same pattern as Sprint 6c rate-limit + Sprint 9 corrigendum.
 *
 * Usage:
 *   npx tsx scripts/won-promotion-acceptance.ts
 */

import {
  parseAmountUsd,
  parseYearFromDeadline,
  buildPromotedEvidence,
  inferSectorTag,
  wonFileUrlFor,
  WON_URL_SCHEME,
  type WonPipelineRow,
} from "@/lib/applicant-evidence/won-promotion";

let failures = 0;
function fail(msg: string): void {
  console.error(`    ✗ ${msg}`);
  failures += 1;
}
function pass(msg: string): void {
  console.log(`    ✓ ${msg}`);
}

async function main(): Promise<void> {
  console.log("\n=== Sprint 12 — won-tender → past_performance promotion ===\n");

  // ----------------------------------------------------------------------
  // parseAmountUsd
  // ----------------------------------------------------------------------
  console.log("  test 1: parseAmountUsd common USD shapes");
  {
    const cases: Array<[string | null, number | undefined]> = [
      ["USD 480,000", 480_000],
      ["$1,234,567.89", 1_234_568], // rounded
      ["USD 1.2M", 1_200_000],
      ["$500K", 500_000],
      ["480000", 480_000], // bare number, no currency marker — still parsed
      ["us$ 250000", 250_000],
      ["", undefined],
      [null, undefined],
    ];
    for (const [input, want] of cases) {
      const got = parseAmountUsd(input);
      if (got !== want) {
        fail(`parseAmountUsd(${JSON.stringify(input)}) = ${got}, want ${want}`);
        return;
      }
    }
    pass(`USD prefixed amounts, K/M suffixes, bare numbers, null/empty all handled`);
  }

  console.log("\n  test 2: parseAmountUsd refuses non-USD without conversion");
  {
    const cases: Array<[string, undefined]> = [
      ["EUR 480,000", undefined],
      ["€250000", undefined],
      ["GBP 100K", undefined],
      ["£1.2M", undefined],
      ["JPY 1,000,000", undefined],
    ];
    for (const [input, want] of cases) {
      const got = parseAmountUsd(input);
      if (got !== want) {
        fail(`expected non-USD ${JSON.stringify(input)} → undefined, got ${got}`);
        return;
      }
    }
    pass(`non-USD currencies refuse (honest about not having FX rates)`);
  }

  console.log("\n  test 3: parseAmountUsd documented limitation — comma always = thousands");
  {
    // Scope per the helper's docstring: comma is ALWAYS thousands. European
    // decimal ("1,5M" meant as 1.5M) is wrongly parsed as 15M. This test
    // pins that conservative behavior so the limitation can't silently
    // regress into a "magic heuristic" that produces inconsistent results.
    const a = parseAmountUsd("$1,500");          // US thousands → 1500
    const b = parseAmountUsd("$1,234.56");        // US thousands + decimal → 1235
    const c = parseAmountUsd("$1,500,000");       // double thousands → 1.5M
    const d = parseAmountUsd("$2.5M");            // US decimal + suffix → 2.5M
    if (a !== 1500) fail(`"$1,500" → 1500, got ${a}`);
    else if (b !== 1235) fail(`"$1,234.56" → 1235, got ${b}`);
    else if (c !== 1_500_000) fail(`"$1,500,000" → 1500000, got ${c}`);
    else if (d !== 2_500_000) fail(`"$2.5M" → 2500000, got ${d}`);
    else pass(`comma=thousands, dot=decimal, K/M suffix multiplies — all stable`);
  }

  // ----------------------------------------------------------------------
  // parseYearFromDeadline
  // ----------------------------------------------------------------------
  console.log("\n  test 4: parseYearFromDeadline shapes");
  {
    const cases: Array<[string | Date | null, number | undefined]> = [
      ["2024-12-31T15:00:00Z", 2024],
      ["31 Dec 2023", 2023],
      [new Date("2025-06-15"), 2025],
      ["Q1 2026", 2026],
      ["sometime", undefined],
      [null, undefined],
      ["1899-01-01", undefined], // out of range
      ["2200-01-01", undefined], // out of range
    ];
    for (const [input, want] of cases) {
      const got = parseYearFromDeadline(input);
      if (got !== want) {
        fail(`parseYearFromDeadline(${JSON.stringify(input)}) = ${got}, want ${want}`);
        return;
      }
    }
    pass(`ISO / human / Date / prose / OOB year all handled`);
  }

  // ----------------------------------------------------------------------
  // wonFileUrlFor
  // ----------------------------------------------------------------------
  console.log("\n  test 5: wonFileUrlFor stable + parseable");
  {
    const url = wonFileUrlFor(4242);
    if (url !== `${WON_URL_SCHEME}4242`) fail(`URL shape changed: ${url}`);
    else if (!url.startsWith(WON_URL_SCHEME)) fail(`scheme prefix missing`);
    else pass(`URL = ${url} (stable, prefix-detectable for downstream consumers)`);
  }

  // ----------------------------------------------------------------------
  // buildPromotedEvidence
  // ----------------------------------------------------------------------
  console.log("\n  test 6: buildPromotedEvidence fully-populated row");
  {
    const row: WonPipelineRow = {
      id: 100,
      user_id: 7,
      tender_id: 5050,
      tender_title: "PSA Oxygen Plant Maintenance LTA, East Africa",
      tender_agency: "WHO Africa Region",
      tender_deadline: "2024-08-31T00:00:00Z",
      tender_value: "USD 480,000",
      notes: "Won via partner consortium with Atlas Eng. Biomedical sector.",
    };
    const ev = buildPromotedEvidence(row);
    if (!ev.name.startsWith("Won bid")) fail(`name should start "Won bid": ${ev.name}`);
    else if (ev.fileUrl !== wonFileUrlFor(100)) fail(`fileUrl mismatch: ${ev.fileUrl}`);
    else if (ev.structured.type !== "past_performance") fail(`structured.type should be past_performance`);
    else {
      const data = ev.structured.data as Record<string, unknown>;
      if (data.client !== "WHO Africa Region") fail(`client should be agency: ${data.client}`);
      else if (data.project !== "PSA Oxygen Plant Maintenance LTA, East Africa") fail(`project should be title: ${data.project}`);
      else if (data.amount_usd !== 480_000) fail(`amount_usd: ${data.amount_usd}`);
      else if (data.year !== 2024) fail(`year: ${data.year}`);
      else if (!ev.textContent.includes("PSA Oxygen")) fail(`textContent missing title`);
      else if (!ev.textContent.includes("480,000")) fail(`textContent missing amount`);
      else if (!ev.textContent.includes("partner consortium")) fail(`textContent should include user notes`);
      else pass(`fully-populated row → structured PastPerformance + prose summary`);
    }
  }

  console.log("\n  test 7: buildPromotedEvidence with sparse row (no agency, no value)");
  {
    const row: WonPipelineRow = {
      id: 200,
      user_id: 7,
      tender_id: null,
      tender_title: null,
      tender_agency: null,
      tender_deadline: null,
      tender_value: null,
      notes: null,
    };
    const ev = buildPromotedEvidence(row);
    const data = ev.structured.data as Record<string, unknown>;
    if (data.client !== "Unknown agency") fail(`agency fallback: ${data.client}`);
    else if (data.project !== "Won opportunity #200") fail(`title fallback: ${data.project}`);
    else if (data.amount_usd !== undefined) fail(`amount_usd should be undefined when no value`);
    else if (data.year !== undefined) fail(`year should be undefined when no deadline`);
    else pass(`sparse row uses fallback labels, omits missing fields`);
  }

  console.log("\n  test 8: buildPromotedEvidence preserves non-USD value as display string");
  {
    const row: WonPipelineRow = {
      id: 300,
      user_id: 7,
      tender_id: null,
      tender_title: "HDPE pipe supply",
      tender_agency: "UNICEF Yemen",
      tender_deadline: "2023-04-01",
      tender_value: "EUR 250,000",
      notes: null,
    };
    const ev = buildPromotedEvidence(row);
    const data = ev.structured.data as Record<string, unknown>;
    if (data.amount_usd !== undefined) fail(`non-USD should leave amount_usd undefined`);
    else if (!ev.textContent.includes("EUR 250,000")) fail(`textContent should preserve raw display`);
    else if (!ev.textContent.includes("Value (as displayed)")) fail(`textContent should label raw display`);
    else pass(`non-USD: structured.amount_usd undefined, prose carries raw display`);
  }

  console.log("\n  test 9: buildPromotedEvidence deterministic timestamp");
  {
    const row: WonPipelineRow = {
      id: 400, user_id: 1, tender_id: null, tender_title: "X", tender_agency: "Y",
      tender_deadline: null, tender_value: null, notes: null,
    };
    const a = buildPromotedEvidence(row);
    const b = buildPromotedEvidence(row);
    if (a.structured.extracted_at !== b.structured.extracted_at) {
      fail(`pure builder should produce identical extracted_at; got ${a.structured.extracted_at} vs ${b.structured.extracted_at}`);
    } else if (a.structured.extracted_at !== new Date(0).toISOString()) {
      fail(`pure builder should use epoch-0 placeholder, got ${a.structured.extracted_at}`);
    } else {
      pass(`pure builder is deterministic (real timestamp set in DB-writing wrapper)`);
    }
  }

  // ----------------------------------------------------------------------
  // inferSectorTag
  // ----------------------------------------------------------------------
  console.log("\n  test 10: inferSectorTag — keyword match on title + notes");
  {
    const cases: Array<[Partial<WonPipelineRow>, string | null]> = [
      [{ tender_title: "PSA Oxygen Plant Maintenance", notes: null }, "sector-biomedical"],
      [{ tender_title: "HDPE pipe supply, Yemen", notes: null }, "sector-water"],
      [{ tender_title: "Fleet management LTA", notes: null }, "sector-logistics"],
      [{ tender_title: "Government data platform", notes: "SaaS web app development" }, "sector-ict"],
      [{ tender_title: "Teacher training program", notes: null }, "sector-education"],
      [{ tender_title: "Seed distribution", notes: null }, "sector-agriculture"],
      [{ tender_title: "Solar grid electrification", notes: null }, "sector-energy"],
      [{ tender_title: "Road rehabilitation, civil works", notes: null }, "sector-construction"],
      [{ tender_title: "Unrelated random tender", notes: "no markers" }, null],
    ];
    for (const [partial, want] of cases) {
      const row: WonPipelineRow = {
        id: 1, user_id: 1, tender_id: null,
        tender_title: partial.tender_title ?? null,
        tender_agency: partial.tender_agency ?? null,
        tender_deadline: null, tender_value: null,
        notes: partial.notes ?? null,
      };
      const got = inferSectorTag(row);
      if (got !== want) {
        fail(`inferSectorTag(${JSON.stringify(partial.tender_title)}) = ${got}, want ${want}`);
        return;
      }
    }
    pass(`8 sector keywords + no-match all classify correctly`);
  }

  console.log("\n=== Summary ===");
  if (failures > 0) {
    console.error(`✗ ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("✓ Won-promotion pure helpers hold across amount / year / build / sector branches\n");
}

main().catch((err) => {
  console.error("✗ unhandled error:", err);
  process.exit(1);
});
