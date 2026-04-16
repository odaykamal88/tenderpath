import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { resolve } from "path";

// Force-load .env.local so empty shell env vars don't shadow project values
try {
  const envPath = resolve(process.cwd(), ".env.local");
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    // Override empty shell env vars with .env.local values
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env.local not found, skip
}

const nextConfig: NextConfig = {
  turbopack: {
    root: "/Users/odaykamal/Desktop/TENDERPATH",
  },
  serverExternalPackages: ["@anthropic-ai/sdk"],
};

export default nextConfig;
