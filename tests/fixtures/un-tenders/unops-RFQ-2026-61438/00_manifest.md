# 00_manifest.md — UNOPS RFQ/2026/61438 (goods RFQ, lowest_compliant)
# Folder: tests/fixtures/un-tenders/unops-RFQ-2026-61438/
# Pairs with the UNICEF RFP fixture to cover BOTH scoring methodologies.

**Note on layout:** The `documents:` section below uses illustrative prefixed
filenames (`01_rfq-section1-instructions.pdf`, etc.). The unzipped files in
`notice-293188/` preserve their original UN-portal filenames — the manifest's
flat naming is the LOGICAL view the Sprint 1 manifest loader maps onto via
`DocManifestEntry`.

tender: UNOPS RFQ/2026/61438
title: Supply, testing, delivery and unloading of Pipes and Fittings to Warehouses of Multiple Cities Local Water and Sanitation Corporation/Authority — Yemen — YEHCP AF 03
agency: UNOPS
type: RFQ                       # Request for Quotation
methodology: lowest_compliant    # goods; lowest priced technically-compliant, evaluated PER LOT
registration_level: Basic        # but UNOPS eSourcing also requires UNOPS vendor registration + login
beneficiary: Yemen
source_notice_url: https://www.ungm.org/Public/Notice/293188   # human reference only
final_deadline: 2026-04-20       # after all three amendments

# --- MULTI-LOT SHAPE (resolved at GATE 0, 2026-05-24) ---
# This tender is MULTI-LOT with per-lot evaluation: bidders may quote one or more of the 3 lots,
# but must offer 100% of items and quantities within each lot, and evaluation is done per lot.
# scoring-engine.ts handles this via TenderRubric.lots: LotRubric[] — each lot gets its own
# criteria, disqualifiers, and financialFormRef (the Price Quotation xlsx). Notice-wide
# disqualifiers (deadline, lead-applicant eligibility) live on TenderRubric.noticeWideDisqualifiers.
lots:
  - lot: 1   scope: HDPE pipes and fittings — Taiz City
  - lot: 2   scope: Heavy-class GI pipes, repair clamps, valves — Taiz City
  - lot: 3   scope: HDPE / DI / GI pipes and fittings — Taiz (Al-Turbah)

notes: |
  Rich versioning fixture: THREE amendments + a multi-round Q&A log. Use it to test that the diff
  engine (a) walks a sequence of version bumps, (b) distinguishes deadline-only amendments from
  spec-changing ones, and (c) ignores Q&A noise.

  Expected reextractAndDiff behavior:
   - Amendment 1 (26-Mar): deadline extension + attach pre-bid minutes  → deadline disqualifier delta
   - Amendment 2 (06-Apr): deadline extension + change Lot 3 GI-pipe spec → deadline delta + Lot 3 requirement delta (RubricDelta.lotId = "lot-3")
   - Amendment 3 (07-Apr): deadline extension + change Lot 1 HDPE butt-fusion fitting spec → deadline delta + Lot 1 requirement delta (RubricDelta.lotId = "lot-1")
   - Q&A NOISE that must NOT bump the rubric: a clarification answered as belonging to a different
     RFQ; a near-empty "." entry; multiple extension requests that were DENIED.
   - Q&A that IS binding: GI-fitting compliance to BS EN 10242 (Lot 3); backing-flange must meet spec (Lot 1).

  Q&A FORM: web text in the Revisions tab (NOT a downloadable PDF). Captured to `qa-revisions.md`
  with per-entry binding/informational/noise classifications.

  UNOPS amends by REPLACING documents (changes highlighted in orange inside the .docx). The base
  Schedule of Requirements for Lot 1 and Lot 3 may no longer be separately downloadable — only the
  amended versions. Where you have both base and amended (e.g. Lot 2), the diff engine can compare
  directly; where you only have the amended doc, the amendment narrative + orange highlights are the
  change record.

documents:
  # --- Base solicitation (present on this notice — no missing baseline, unlike the UNICEF example) ---
  - file: 01_rfq-section1-instructions.pdf      # "RFQ_Section 1_ Instruction to Bidders.pdf"
    role: solicitation
  - file: 02_general-conditions-goods.pdf       # "General_conditions_goods (Sep. 2024).pdf"
    role: guidelines
  - file: 03_schedule-of-requirements-lot2-secII.docx   # base Lot 2
    role: tor
    lot: 2
  - file: 04_schedule-of-requirements-lot2-secIII.docx  # base Lot 2
    role: tor
    lot: 2
  - file: 05_additional-tech-req-lot1.xlsx
    role: annex
    lot: 1
  - file: 06_additional-tech-req-lot2.xlsx
    role: annex
    lot: 2
  - file: 07_additional-tech-req-lot3.xlsx
    role: annex
    lot: 3

  # --- Info session ---
  - file: 08_prebid-meeting-minutes.pdf         # "Prebid meeting -RFQ-...-61438.docx.pdf"
    role: info_session
    issued: 2026-03

  # --- Amendments (UNOPS uploads revised docs; changes highlighted orange inside) ---
  - file: 09_amendment1-lot1-secII-schedule.docx    # "Amendment (1) - RFQ-Section-II ... -Lot 1.docx"
    role: amendment
    issued: 2026-04-07
    lot: 1
    supersedes: [base Lot 1 schedule]
    changes: Lot 1 Item 3 HDPE butt-fusion fitting spec + deadline
  - file: 10_amendment1-lot1-secIII-forms.docx       # "Amendment (1) - RFQ-Section-III-Returnable Bidding Forms -Lot 1.docx"
    role: amendment
    issued: 2026-04-07
    lot: 1
  - file: 11_amendment1-lot3-secII-schedule.docx     # "Amendment (1) - RFQ_Section_II ... _Lot 3.docx"
    role: amendment
    issued: 2026-04-06
    lot: 3
    supersedes: [base Lot 3 schedule]
    changes: Lot 3 Part 3 GI pipes spec + deadline
  - file: 12_amendment1-lot3-secIII-forms.docx       # "Amendment (1) - RFQ_Section_III-Returnable Bidding Forms- Lot 3.docx"
    role: amendment
    issued: 2026-04-06
    lot: 3

  # --- Q&A (CAPTURE the Revisions-tab web text; mark binding vs noise) ---
  - file: 13_qa-revisions.md
    role: qa
    issued: 2026-03-07 .. 2026-04-14
    capture: from Revisions tab (web text, not a file)

  # --- Price/financial submission forms — populate LotRubric.financialFormRef per lot ---
  - file: tmpl_price-quotation-lot1.xlsx        # role supporting — lot 1 financial form
    role: supporting
    lot: 1
  - file: tmpl_price-quotation-lot2.xlsx
    role: supporting
    lot: 2
  - file: tmpl_price-quotation-lot3.xlsx
    role: supporting
    lot: 3
  - file: tmpl_po-template.pdf                  # "PO Templet.PDF"
    role: supporting

# Why this pairs with the UNICEF RFP example:
#   UNICEF 146988 : RFP  / cumulative      / 1 amendment (deadline only) / Q&A as PDF      / base on a separate notice (135638)
#   UNOPS  293188 : RFQ  / lowest_compliant / 3 amendments (deadline+spec) / Q&A as web text / base PRESENT / multi-lot + noisy Q&A
# Together they exercise both methodologies, both Q&A capture forms, single vs sequential amendments,
# deadline-only vs spec-changing amendments, clean vs noisy clarification logs, AND the single-lot
# vs multi-lot LotRubric pattern.
