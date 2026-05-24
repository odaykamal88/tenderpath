# 00_manifest.md — UNICEF RFPS-DAN-2021-503347 (services RFP, cumulative)
# Folder: tests/fixtures/un-tenders/unicef-RFPS-DAN-2021-503347/

**Note on layout:** This tender spans TWO UNGM notices (135638 base + 146988 amendment),
each unzipped into its own `notice-NNNNNN/` subdirectory because filenames collide across
notices (the `Annex C ... revised.docx` filename appears in both with different content —
72,546 vs 79,150 bytes). The `documents:` section below uses illustrative renamed paths
(`01_base-rfp.pdf`, etc.); the Sprint 1 manifest loader maps the LOGICAL view onto the
actual file paths under `notice-135638/` and `notice-146988/` via `DocManifestEntry`.

tender: UNICEF RFPS-DAN-2021-503347
title: Global Long-term Arrangements (LTAs) for Oxygen Generation Plant Repair and Biomedical Engineering Technical Services
agency: UNICEF
type: RFP                      # Request for Proposal
methodology: cumulative        # services RFP → technical score + financial score (NOT lowest-price)
lots:
  - lot: main                  scope: single-lot tender — LotRubric.lotId = "main"
registration_level: Basic
beneficiary: Multiple destinations
source_notice_urls:                              # this tender spans TWO notices
  base:      https://www.ungm.org/Public/Notice/135638   # original RFP, published 29-Jul-2021
  amendment: https://www.ungm.org/Public/Notice/146988   # Amendment No. 1, published 01-Oct-2021
original_deadline: 2021-08-24 23:59 (Copenhagen)         # base; later extended by Amendment 1
final_deadline:    2021-10-31 23:59 (Window 2)           # after Amendment 1

notes: |
  This tender spans two UNGM notices: the BASE RFP (135638, 29-Jul-2021) and the AMENDMENT No. 1
  package (146988, 01-Oct-2021). The folder represents the tender, so it draws from both. Three
  things to know:

  1. BASELINE FOUND. The base RFP document is "RFPS 503347.pdf" on notice 135638 — this is where the
     numbered technical evaluation rubric (criteria 1.2, 1.4; sections 7.1.4a, 7.1.5 referenced in the
     Q&A) actually lives. The full base set (RFP + all annexes + Q&A + slides + webinar) is on 135638;
     146988 adds Amendment 1 and a (re-)revised Annex C.

  2. AMENDMENT TYPE = deadline/process, not scoring. Amendment No. 1 extends the deadline into two
     submission windows (7 Oct / 31 Oct 2021) and adds validate-or-resubmit instructions. It changes
     the DEADLINE disqualifier and submission process — it does NOT move the evaluation criteria or
     weights. Expected reextractAndDiff result: a RubricDelta on the deadline disqualifier
     (RubricDelta.lotId undefined — notice-wide), criteria unchanged. (Good negative case: not every
     amendment touches scoring.)

  3. FILENAME COLLISION → hash-compare, not name-compare. "Annex C - RFPS TOR ... revised.docx" appears
     on BOTH notices but with different content (72,546 vs 79,150 bytes), so they may be different
     versions wearing the same name. This is the case the DocManifestEntry contentHash field exists for:
     the engine must hash-compare to decide whether Annex C actually changed, never trust the filename.

  EXTRACTABLE DISQUALIFIERS (from the base RFP description on 135638 — Sprint 1 should pull these
   into TenderRubric.noticeWideDisqualifiers since this is a single-lot tender):
   - submission channel: proposals only to supplybid@unicef.org; sent elsewhere = invalidated
   - subject line must include bid number RFPS-DAN-2021-503347
   - attachments max 10 MB per email; editable + PDF versions required
   - no cc/bcc on the submission email
   - technical proposal must contain NO pricing; financial proposal as a separate file AND separate email
     (→ confirms two-envelope cumulative methodology)
   - questions deadline 9-Aug-2021; proposal deadline 24-Aug-2021 (base, pre-amendment)

documents:
  # --- BASELINE (from notice 135638, the original RFP, 29-Jul-2021) ---
  - file: notice-135638/RFPS 503347.pdf
    role: solicitation
    issued: 2021-07-29
    contains: numbered technical evaluation rubric (criteria 1.2, 1.4; sections 7.1.4a, 7.1.5)
  - file: notice-135638/Annex C - RFPS TOR - Plant repair and biomed services - revised.docx
    role: tor
    issued: 2021-07-29
    note: same filename as the amendment's Annex C — HASH-COMPARE, do not assume identical (72546 bytes)

  # --- Present on notice 146988 (Amendment No. 1 package) ---
  - file: notice-146988/RFPS-DAN-503347 Amendment 1.pdf
    role: amendment
    issued: 2021-10-01
    supersedes: [base RFP deadline disqualifier]
    changes: deadline disqualifier (two-window extension) + submission process; NO scoring/criteria changes
  - file: notice-146988/Annex C - RFPS TOR - Plant repair and biomed services - revised.docx
    role: tor
    issued: 2021-10-01
    supersedes: [base Annex C]
    note: identical filename to base — hash-compare to confirm whether it actually changed (79150 bytes vs base 72546)
  - file: notice-135638/Q & A.pdf
    role: qa
    issued: 2021
    note: same Q&A PDF appears on both notices — verify identical via hash; classified entries in qa-classifications.md
  - file: notice-135638/2021.08.10 - Plant Repair Bid Conference Slides.pdf
    role: info_session
    issued: 2021-08-10
  - file: notice-135638/Webinar recording.docx
    role: info_session
    issued: 2021

  # --- Submission templates the $299 product must FILL and EXPORT into (format targets) ---
  - file: notice-146988/Annex D - Technical Proposal PSA Plant Repair.docx
    role: supporting
    purpose: output_format_target — technical proposal template (use the amended version)
  - file: notice-146988/Technical Proposal Submission form.docx
    role: supporting
    purpose: output_format_target — technical submission form (use the amended version)
  - file: notice-146988/Annex E - Financial Proposal Submission Form.xlsx
    role: supporting
    purpose: output_format_target — financial proposal form (XLSX)

# Reading notes for Claude Code:
#  - .pdf via pdf-reading skill; .docx via mammoth; .xlsx via the xlsx skill / openpyxl.
#  - The financial form is an XLSX and the technical form is a DOCX: these define the
#    required OUTPUT formats for the proposal-draft export step, not just inputs.
#  - The classified Q&A captures (with binding/informational/noise tags) are in
#    `qa-classifications.md` — supplementary to the Q&A PDF, not a replacement.
