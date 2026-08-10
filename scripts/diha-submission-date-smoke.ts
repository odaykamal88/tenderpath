import assert from "node:assert/strict";
import { submissionDueDate } from "../src/lib/submissions/store";

assert.equal(submissionDueDate("2026-08-31"), "2026-08-31");
assert.equal(submissionDueDate("2026-08-31T00:00:00.000Z"), "2026-08-31");
assert.equal(submissionDueDate(new Date("2026-08-31T00:00:00.000Z")), "2026-08-31");
assert.equal(submissionDueDate(null), null);
assert.equal(submissionDueDate("not-a-date"), null);

console.log("DIHA submission-date smoke passed: PostgreSQL DATE objects remain calendar-correct.");
