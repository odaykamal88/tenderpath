import type { NextConfig } from "next";
import fs from "fs";
import path from "path";

// Next.js internally runs fs.realpathSync on the project dir. On Vercel the
// build path is a symlink, so we must match that resolution here — otherwise
// Turbopack's rootPath differs from dir and .next appears outside projectPath.
const projectRoot = fs.realpathSync(path.resolve(process.cwd()));

// When running from a git worktree, node_modules lives in the parent project.
// Walk up until we find the directory that contains node_modules so Turbopack's
// filesystem root encompasses the node_modules symlink.
function findModulesRoot(start: string): string {
  let dir = start;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "node_modules"))) return dir;
    dir = path.dirname(dir);
  }
  return start;
}
const turboRoot = findModulesRoot(projectRoot);

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://*.stripe.com https://*.stripe.network",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.stripe.com https://*.stripe.com https://*.stripe.network https://*.vercel-storage.com https://*.blob.vercel-storage.com",
  "frame-src https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com https://*.stripe.com https://*.stripe.network",
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  outputFileTracingRoot: turboRoot,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://checkout.stripe.com\" \"https://js.stripe.com\")",
          },
        ],
      },
    ];
  },
  // These routes read operator-curated CSVs from data/ at runtime via fs. The
  // tracer can't follow the dynamic process.cwd() paths, so without an explicit
  // include the files are omitted from the serverless bundle and the cron reads
  // an empty dir — a silent no-op in production. Keys are route globs; values are
  // globs resolved from the project root (Next 16 outputFileTracingIncludes).
  outputFileTracingIncludes: {
    "/api/cron/grants": ["./data/mena-grants/**/*"],
    "/api/cron/crawl": ["./data/developmentaid/**/*"],
    "/api/admin/sync-tenders": ["./data/developmentaid/**/*"],
  },
  turbopack: {
    root: turboRoot,
  },
  // pdfjs-dist MUST stay external. Bundling its legacy build breaks the worker
  // `.mjs` resolution in the Vercel serverless runtime, so PDF text extraction
  // (paste-a-tender URL, vault upload, proposal ingest) silently returns empty
  // in production while working locally. Externalizing makes it resolve from
  // node_modules at runtime, exactly as it does in dev.
  serverExternalPackages: ["@anthropic-ai/sdk", "@sparticuz/chromium", "puppeteer-core", "pdfjs-dist"],
};

export default nextConfig;
