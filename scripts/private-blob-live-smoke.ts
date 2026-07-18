import assert from "node:assert/strict";
import { del, get, put } from "@vercel/blob";

if (!process.argv.includes("--live")) {
  throw new Error("Refusing to mutate Blob storage without --live");
}

const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is required");

async function main() {
  const pathname = `production-readiness/${crypto.randomUUID()}.txt`;
  let uploadedUrl: string | null = null;

  try {
    const uploaded = await put(pathname, "tenderpath-private-storage-smoke", {
      access: "private",
      token,
      contentType: "text/plain; charset=utf-8",
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    uploadedUrl = uploaded.url;
    assert.match(new URL(uploaded.url).hostname, /^[a-z0-9-]+\.private\.blob\.vercel-storage\.com$/i);

    const anonymous = await fetch(uploaded.url, { redirect: "manual" });
    assert.notEqual(anonymous.status, 200, "private Blob URL was anonymously readable");

    const authenticated = await get(uploaded.url, { access: "private", token });
    assert.ok(authenticated && authenticated.statusCode === 200 && authenticated.stream);
    const content = await new Response(authenticated.stream).text();
    assert.equal(content, "tenderpath-private-storage-smoke");

    console.log(JSON.stringify({
      ok: true,
      storeAccess: "private",
      anonymousStatus: anonymous.status,
      authenticatedStatus: authenticated.statusCode,
    }));
  } finally {
    if (uploadedUrl) await del(uploadedUrl, { token });
  }
}

main().catch((error) => {
  console.error("[private-blob:live-smoke-failed]", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
