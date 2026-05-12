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
  turbopack: {
    root: turboRoot,
  },
  serverExternalPackages: ["@anthropic-ai/sdk", "@sparticuz/chromium", "puppeteer-core"],
};

export default nextConfig;
