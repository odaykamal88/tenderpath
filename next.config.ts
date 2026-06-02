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

const nextConfig: NextConfig = {
  outputFileTracingRoot: turboRoot,
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
  serverExternalPackages: ["@anthropic-ai/sdk", "@sparticuz/chromium", "puppeteer-core"],
};

export default nextConfig;
