import assert from "node:assert/strict";
import { dedupKey } from "../src/lib/crawlers/types";

const base = {
  title: "Develop and Implement a Digital Awareness Campaign on Plastic Circularity",
  deadline: "2026-08-14",
};

const ungm = dedupKey({
  ...base,
  agency: "UNDP",
  reference_id: "UNGM-UNDP-KHM-00233,2",
});
const direct = dedupKey({
  ...base,
  agency: "UNDP-KHM",
  reference_id: "UNDP-UNDP-KHM-00233,2",
});
assert.equal(ungm, direct, "UNGM and direct UNDP country-office copies must share a canonical key");

const lot1 = dedupKey({ ...base, agency: "UNDP", reference_id: "UNDP-KHM-00233-LOT-1" });
const lot2 = dedupKey({ ...base, agency: "UNDP", reference_id: "UNDP-KHM-00233-LOT-2" });
assert.notEqual(lot1, lot2, "explicit lots must remain distinct");

const amendment1 = dedupKey({ ...base, agency: "UNDP", reference_id: "UNDP-KHM-00233-AMENDMENT-1" });
const amendment2 = dedupKey({ ...base, agency: "UNDP", reference_id: "UNDP-KHM-00233-AMENDMENT-2" });
assert.notEqual(amendment1, amendment2, "explicit amendments must remain distinct");

const originalRevision = dedupKey({ ...base, agency: "UNDP", reference_id: "UNDP-KHM-00233" });
const revisedRevision = dedupKey({ ...base, agency: "UNDP", reference_id: "UNDP-KHM-00233,1" });
assert.notEqual(originalRevision, revisedRevision, "comma-suffixed source revisions must remain distinct");

const cyrillicA = dedupKey({ title: "Поставка медицинского оборудования", agency: "JICA", deadline: "2026-09-01" });
const cyrillicB = dedupKey({ title: "Строительство учебного центра", agency: "JICA", deadline: "2026-09-01" });
assert.notEqual(cyrillicA, cyrillicB, "non-Latin titles must retain their identity");

const laterDeadline = dedupKey({ ...base, agency: "UNDP", deadline: "2026-08-21" });
assert.notEqual(direct, laterDeadline, "repeat procurements with a different deadline must remain distinct");

console.log("DIHA dedup smoke passed: aliases collapse while lots, amendments, repeat dates, and non-Latin titles stay distinct.");
