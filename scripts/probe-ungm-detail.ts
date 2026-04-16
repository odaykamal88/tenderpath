/**
 * One-shot probe: fetch a single UNGM notice detail page via the same
 * proxy path the crawler uses, dump key sections so we can confirm the
 * HTML shape before writing the parser.
 *
 * Run: node_modules/.bin/tsx scripts/probe-ungm-detail.ts <noticeId>
 */
import fs from "node:fs";
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";

try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#"))
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
} catch {}

const id = process.argv[2] ?? "";
if (!id) { console.error("usage: probe-ungm-detail.ts <noticeId>"); process.exit(1); }

const auth = `${encodeURIComponent(process.env.PROXY_USER!)}:${encodeURIComponent(process.env.PROXY_PASS!)}`;
const agent = new HttpsProxyAgent(`http://${auth}@${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`);

const url = new URL(`https://www.ungm.org/Public/Notice/${id}`);

const req = https.request({
  hostname: url.hostname, port: 443, path: url.pathname, method: "GET",
  agent, rejectUnauthorized: false,
  headers: {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml",
    "Accept-Encoding": "identity",
    Connection: "close",
  },
}, (res) => {
  const chunks: Buffer[] = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    console.log(`HTTP ${res.statusCode} len=${body.length}`);
    fs.writeFileSync(`/tmp/ungm-${id}.html`, body);
    // hunt for key section markers
    const markers = [
      /<h1[^>]*>[\s\S]{0,500}?<\/h1>/,
      /<div[^>]*class="[^"]*description[^"]*"[^>]*>[\s\S]{0,200}/i,
      /UNSPSC[\s\S]{0,400}/i,
      /Country[\s\S]{0,200}/,
      /Reference[\s\S]{0,200}/,
      /<div[^>]*class="[^"]*fieldGroup[^"]*"[\s\S]{0,600}/i,
      /data-[a-z-]+="[A-Z]{2,3}"/,
    ];
    for (const m of markers) {
      const hit = body.match(m);
      console.log("---", m.source.slice(0, 50));
      console.log(hit?.[0]?.slice(0, 400) ?? "(none)");
    }
    process.exit(0);
  });
});
req.on("error", (e) => { console.error("err", e.message); process.exit(1); });
req.setTimeout(60000, () => { req.destroy(new Error("timeout")); });
req.end();
