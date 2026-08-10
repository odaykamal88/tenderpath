import assert from "node:assert/strict";
import { crawlerWorkerEndpoints } from "../src/lib/crawlers/worker-endpoints";

const fromOrigin = crawlerWorkerEndpoints("https://crawler.example.workers.dev");
assert.deepEqual(fromOrigin, {
  fetch: "https://crawler.example.workers.dev/fetch",
  fetchMany: "https://crawler.example.workers.dev/fetch-many",
  health: "https://crawler.example.workers.dev/health",
});

const fromFetch = crawlerWorkerEndpoints("https://crawler.example.workers.dev/fetch");
assert.deepEqual(fromFetch, fromOrigin);
assert.equal(crawlerWorkerEndpoints("  "), null);
assert.throws(
  () => crawlerWorkerEndpoints("file:///tmp/crawler"),
  /must use http or https/,
);
assert.throws(
  () => crawlerWorkerEndpoints("https://user:secret@crawler.example.workers.dev/fetch"),
  /must not contain credentials/,
);

console.log("DIHA ops smoke passed: crawler worker endpoints are canonical and credential-safe.");
