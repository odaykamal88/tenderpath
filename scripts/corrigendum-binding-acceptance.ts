/**
 * scripts/corrigendum-binding-acceptance.ts
 *
 * Sprint 9 — corrigendum + Q&A binding acceptance.
 *
 * Verifies the pure helpers that produce the multi-doc TenderInput from an
 * intake JSONB. The DB query layer in loadSupplementaryTenderDocs is glued
 * to the same `document_extractions` table the bid-no-bid path uses; we
 * trust that wiring and validate the parsing + transformation here.
 *
 * The fix closes the AGENTS.md hard rule:
 *
 *   "Any proposal review must read the call's corrigenda and Q&A appendix
 *    before scoring against the original guidelines."
 *
 * Pre-Sprint-9, buildTenderInputFromLegacy collapsed everything to ONE
 * solicitation doc. Post-Sprint-9, each amendment / Q&A document the user
 * uploads lands as its own IngestedDoc with the correct role, and amendments
 * carry `supersedes: ["solicitation"]` so the rubric extractor surfaces
 * corrigendum-driven changes explicitly.
 *
 * Decision branches covered:
 *   - empty / null / undefined intake → no refs
 *   - amendment-only intake → 1 ref (role=amendment)
 *   - qa-only intake → 1 ref (role=qa)
 *   - both → 2 refs in order
 *   - filename-only (no url, no doc_id) → ignored (no payload to extract)
 *   - vault_doc_id only (no url) → ref carries vaultDocId, url=null
 *   - bad types (non-string url, negative doc_id) → ignored
 *   - extraction not in "extracted" status → null IngestedDoc
 *   - extraction with no text → null IngestedDoc
 *   - amendment extraction → IngestedDoc with supersedes=["solicitation"]
 *   - qa extraction → IngestedDoc with no supersedes
 *   - filename fallback chain: ref.filename → extraction.file_name → "<role>.txt"
 *
 * Usage:
 *   npx tsx scripts/corrigendum-binding-acceptance.ts
 */

import {
  extractSupplementaryDocRefs,
  buildIngestedDocFromExtraction,
  type SupplementaryDocRef,
  type SupplementaryExtractionRow,
} from "@/lib/proposal-package/legacy-bridge";

let failures = 0;
function fail(msg: string): void {
  console.error(`    ✗ ${msg}`);
  failures += 1;
}
function pass(msg: string): void {
  console.log(`    ✓ ${msg}`);
}

async function main(): Promise<void> {
  console.log("\n=== Sprint 9 — corrigendum + Q&A binding acceptance ===\n");

  // ----------------------------------------------------------------------
  // extractSupplementaryDocRefs
  // ----------------------------------------------------------------------
  console.log("  test 1: empty / null / undefined intake → []");
  {
    const a = extractSupplementaryDocRefs(null);
    const b = extractSupplementaryDocRefs(undefined);
    const c = extractSupplementaryDocRefs({});
    if (a.length !== 0) fail(`null intake → ${a.length} refs, expected 0`);
    else if (b.length !== 0) fail(`undefined intake → ${b.length} refs, expected 0`);
    else if (c.length !== 0) fail(`empty intake → ${c.length} refs, expected 0`);
    else pass(`null / undefined / empty all yield []`);
  }

  console.log("\n  test 2: amendment URL only → 1 ref (role=amendment)");
  {
    const refs = extractSupplementaryDocRefs({
      amendment_url: "https://blob.example.com/corrigendum-1.pdf",
      amendment_filename: "Corrigendum_No_1.pdf",
    });
    if (refs.length !== 1) fail(`expected 1 ref, got ${refs.length}`);
    else if (refs[0].role !== "amendment") fail(`expected role=amendment, got ${refs[0].role}`);
    else if (refs[0].url !== "https://blob.example.com/corrigendum-1.pdf") fail(`url mismatch`);
    else if (refs[0].filename !== "Corrigendum_No_1.pdf") fail(`filename mismatch`);
    else if (refs[0].vaultDocId != null) fail(`vaultDocId should be null when no doc_id`);
    else pass(`amendment ref carries url + filename`);
  }

  console.log("\n  test 3: qa URL only → 1 ref (role=qa)");
  {
    const refs = extractSupplementaryDocRefs({
      qa_url: "https://blob.example.com/qa-round-1.pdf",
    });
    if (refs.length !== 1) fail(`expected 1 ref, got ${refs.length}`);
    else if (refs[0].role !== "qa") fail(`expected role=qa, got ${refs[0].role}`);
    else if (refs[0].url !== "https://blob.example.com/qa-round-1.pdf") fail(`url mismatch`);
    else pass(`qa ref carries url`);
  }

  console.log("\n  test 4: both amendment + qa → 2 refs in [amendment, qa] order");
  {
    const refs = extractSupplementaryDocRefs({
      amendment_url: "https://blob.example.com/amendment.pdf",
      qa_url: "https://blob.example.com/qa.pdf",
    });
    if (refs.length !== 2) fail(`expected 2 refs, got ${refs.length}`);
    else if (refs[0].role !== "amendment") fail(`expected first=amendment, got ${refs[0].role}`);
    else if (refs[1].role !== "qa") fail(`expected second=qa, got ${refs[1].role}`);
    else pass(`amendment listed before qa (rolePriority alignment)`);
  }

  console.log("\n  test 5: filename-only entry (no url, no doc_id) → ignored");
  {
    const refs = extractSupplementaryDocRefs({
      amendment_filename: "orphan.pdf",
      qa_filename: "orphan-qa.pdf",
    });
    if (refs.length !== 0) fail(`expected 0 refs (filename without payload is useless), got ${refs.length}`);
    else pass(`filename-only entries skipped — no extraction would be findable`);
  }

  console.log("\n  test 6: vault_doc_id only → ref carries vaultDocId, url=null");
  {
    const refs = extractSupplementaryDocRefs({
      amendment_doc_id: 4242,
    });
    if (refs.length !== 1) fail(`expected 1 ref, got ${refs.length}`);
    else if (refs[0].vaultDocId !== 4242) fail(`expected vaultDocId=4242, got ${refs[0].vaultDocId}`);
    else if (refs[0].url != null) fail(`url should be null when only doc_id present`);
    else pass(`vault_doc_id alone is enough to trigger lookup`);
  }

  console.log("\n  test 7: bad types (non-string url, negative doc_id) → ignored");
  {
    const refs = extractSupplementaryDocRefs({
      amendment_url: 12345 as unknown as string, // non-string
      amendment_doc_id: -5, // negative
      qa_url: "", // empty
      qa_doc_id: 0, // zero
    });
    if (refs.length !== 0) fail(`expected 0 refs for all-bad input, got ${refs.length}`);
    else pass(`type / value sanity holds: non-string url, negative id, empty url, zero id all rejected`);
  }

  console.log("\n  test 8: string doc_id coerces (intake JSONB sometimes serialises ints as strings)");
  {
    const refs = extractSupplementaryDocRefs({
      qa_doc_id: "999" as unknown as number,
    });
    if (refs.length !== 1) fail(`expected 1 ref, got ${refs.length}`);
    else if (refs[0].vaultDocId !== 999) fail(`expected vaultDocId=999, got ${refs[0].vaultDocId}`);
    else pass(`string "999" coerced to 999 (real-world JSONB tolerance)`);
  }

  // ----------------------------------------------------------------------
  // buildIngestedDocFromExtraction
  // ----------------------------------------------------------------------
  console.log("\n  test 9: extraction status != 'extracted' → null doc");
  {
    const ref: SupplementaryDocRef = { url: "x", role: "amendment" };
    const pendingExtraction: SupplementaryExtractionRow = {
      file_name: "amendment.pdf",
      file_url: "x",
      text_content: "some text",
      char_count: 100,
      status: "pending",
    };
    const failedExtraction: SupplementaryExtractionRow = {
      file_name: "amendment.pdf",
      file_url: "x",
      text_content: null,
      char_count: 0,
      status: "failed",
    };
    const a = buildIngestedDocFromExtraction(ref, pendingExtraction);
    const b = buildIngestedDocFromExtraction(ref, failedExtraction);
    const c = buildIngestedDocFromExtraction(ref, null);
    if (a !== null) fail(`pending extraction should yield null`);
    else if (b !== null) fail(`failed/no-text extraction should yield null`);
    else if (c !== null) fail(`null extraction should yield null`);
    else pass(`only status='extracted' with text produces a doc`);
  }

  console.log("\n  test 10: amendment extraction → IngestedDoc with supersedes=['solicitation']");
  {
    const ref: SupplementaryDocRef = {
      url: "https://blob.example.com/corr.pdf",
      filename: "Corrigendum_No_1.pdf",
      role: "amendment",
    };
    const ex: SupplementaryExtractionRow = {
      file_name: "Corrigendum_No_1.pdf",
      file_url: "https://blob.example.com/corr.pdf",
      text_content: "Corrigendum text changing deadline from 1 May to 15 May",
      char_count: 60,
      status: "extracted",
    };
    const doc = buildIngestedDocFromExtraction(ref, ex);
    if (!doc) fail(`expected IngestedDoc, got null`);
    else if (doc.manifest.role !== "amendment") fail(`expected role=amendment, got ${doc.manifest.role}`);
    else if (doc.manifest.docId !== "amendment") fail(`expected docId=amendment, got ${doc.manifest.docId}`);
    else if (!doc.manifest.supersedes || doc.manifest.supersedes[0] !== "solicitation") fail(`expected supersedes=['solicitation'], got ${JSON.stringify(doc.manifest.supersedes)}`);
    else if (doc.manifest.filename !== "Corrigendum_No_1.pdf") fail(`filename should come from ref first`);
    else if (!doc.text.includes("1 May")) fail(`text should be passed through verbatim`);
    else if (!doc.manifest.contentHash) fail(`contentHash should be present`);
    else pass(`amendment doc emits supersedes + content hash + role=amendment`);
  }

  console.log("\n  test 11: qa extraction → IngestedDoc with no supersedes");
  {
    const ref: SupplementaryDocRef = { url: "x", role: "qa" };
    const ex: SupplementaryExtractionRow = {
      file_name: "QA_Round_1.pdf",
      file_url: "x",
      text_content: "Q1: Can JV bid? A1: Yes per Section 5.",
      char_count: 50,
      status: "extracted",
    };
    const doc = buildIngestedDocFromExtraction(ref, ex);
    if (!doc) fail(`expected doc`);
    else if (doc.manifest.role !== "qa") fail(`role mismatch`);
    else if (doc.manifest.supersedes !== undefined) fail(`qa should NOT supersede solicitation — got ${JSON.stringify(doc.manifest.supersedes)}`);
    else pass(`qa doc emits no supersedes (binding by virtue of role=qa)`);
  }

  console.log("\n  test 12: filename fallback chain");
  {
    const ref1: SupplementaryDocRef = { url: "x", filename: "FromRef.pdf", role: "amendment" };
    const ref2: SupplementaryDocRef = { url: "x", role: "amendment" }; // no filename
    const ref3: SupplementaryDocRef = { url: "x", role: "qa" }; // no filename
    const exWithName: SupplementaryExtractionRow = {
      file_name: "FromExtraction.pdf",
      file_url: "x",
      text_content: "...",
      char_count: 5,
      status: "extracted",
    };
    const exNoName: SupplementaryExtractionRow = {
      file_name: null,
      file_url: "x",
      text_content: "...",
      char_count: 5,
      status: "extracted",
    };
    const d1 = buildIngestedDocFromExtraction(ref1, exWithName);
    const d2 = buildIngestedDocFromExtraction(ref2, exWithName);
    const d3 = buildIngestedDocFromExtraction(ref3, exNoName);
    if (d1?.manifest.filename !== "FromRef.pdf") fail(`ref filename should win, got ${d1?.manifest.filename}`);
    else if (d2?.manifest.filename !== "FromExtraction.pdf") fail(`extraction filename should be 2nd choice, got ${d2?.manifest.filename}`);
    else if (d3?.manifest.filename !== "qa.txt") fail(`final fallback is <role>.txt, got ${d3?.manifest.filename}`);
    else pass(`ref.filename → extraction.file_name → "<role>.txt"`);
  }

  console.log("\n=== Summary ===");
  if (failures > 0) {
    console.error(`✗ ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("✓ Corrigendum + Q&A binding helpers pass all decision branches\n");
}

main().catch((err) => {
  console.error("✗ unhandled error:", err);
  process.exit(1);
});
