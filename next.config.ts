import type { NextConfig } from "next";
import fs from "fs";
import path from "path";

// Next.js internally runs fs.realpathSync on the project dir. On Vercel the
// build path is a symlink, so we must match that resolution here — otherwise
// Turbopack's rootPath differs from dir and .next appears outside projectPath.
const projectRoot = fs.realpathSync(path.resolve(process.cwd()));

const nextConfig: NextConfig = {
  outputFileTracingRoot: projectRoot,
  serverExternalPackages: ["@anthropic-ai/sdk"],
};

export default nextConfig;
