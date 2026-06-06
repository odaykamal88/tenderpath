import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UnsafeUrlError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value < 0 || value > 255) return null;
    out = (out << 8) + value;
  }
  return out >>> 0;
}

function inIpv4Range(value: number, cidrBase: string, bits: number): boolean {
  const base = ipv4ToInt(cidrBase);
  if (base === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (base & mask);
}

function isUnsafeIpv4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === null) return true;
  return [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ].some(([base, bits]) => inIpv4Range(value, base as string, bits as number));
}

function isUnsafeIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  const mappedIpv4 = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (mappedIpv4) return isUnsafeIpv4(mappedIpv4);

  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb")
    || normalized.startsWith("ff")
    || normalized.startsWith("2001:db8:");
}

function isUnsafeIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isUnsafeIpv4(address);
  if (version === 6) return isUnsafeIpv6(address);
  return true;
}

function validateHostname(hostname: string): void {
  const host = hostname.toLowerCase();
  if (!host || host.length > 253) {
    throw new UnsafeUrlError("URL hostname is invalid.", "INVALID_HOST");
  }
  if (
    host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
  ) {
    throw new UnsafeUrlError("Internal hostnames are not allowed.", "INTERNAL_HOST");
  }
}

export async function assertSafeHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("URL is invalid.", "INVALID_URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeUrlError("Only HTTP(S) URLs are allowed.", "UNSUPPORTED_PROTOCOL");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("Credentialed URLs are not allowed.", "CREDENTIALS_IN_URL");
  }

  validateHostname(url.hostname);

  const directIpVersion = isIP(url.hostname);
  if (directIpVersion) {
    if (isUnsafeIpAddress(url.hostname)) {
      throw new UnsafeUrlError("Private, local, or reserved IPs are not allowed.", "UNSAFE_IP");
    }
    return url;
  }

  let records: Array<{ address: string }>;
  try {
    records = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError("Hostname could not be resolved.", "DNS_LOOKUP_FAILED");
  }

  if (records.length === 0) {
    throw new UnsafeUrlError("Hostname resolved to no addresses.", "DNS_EMPTY");
  }
  const unsafe = records.find((record) => isUnsafeIpAddress(record.address));
  if (unsafe) {
    throw new UnsafeUrlError("Hostname resolves to a private, local, or reserved address.", "DNS_UNSAFE_IP");
  }

  return url;
}

