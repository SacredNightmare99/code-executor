import dns from "dns/promises";
import net from "net";

/**
 * URL safety checks used to prevent SSRF via user-supplied webhook URLs.
 * Blocks non-http(s) schemes and any hostname that resolves to a private,
 * loopback, link-local, or cloud-metadata address.
 */

// Private / reserved IPv4 ranges (as [baseInt, prefixBits]).
const PRIVATE_IPV4_CIDRS: Array<[number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10.0.0.0/8
  [0x7f000000, 8], // 127.0.0.0/8
  [0xa9fe0000, 16], // 169.254.0.0/16 (incl. cloud metadata 169.254.169.254)
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0a80000, 16], // 192.168.0.0/16
  [0x64400000, 10], // 100.64.0.0/10 (CGNAT)
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)
  ) {
    return null;
  }
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
}

function isPrivateIpv4(ip: string): boolean {
  const int = ipv4ToInt(ip);
  if (int === null) return true; // malformed → treat as blocked
  return PRIVATE_IPV4_CIDRS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (int & mask) === (base & mask);
  });
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  // Unspecified / loopback
  if (lower === "::" || lower === "::1" || lower.startsWith("0:0:0:0:0:0:0:")) {
    return true;
  }

  // IPv4-mapped addresses (e.g. ::ffff:127.0.0.1)
  if (lower.startsWith("::ffff:")) {
    return isPrivateIpv4(lower.slice(7));
  }

  // Unique local addresses fc00::/7
  if (lower.startsWith("fc") || lower.startsWith("fd")) {
    return true;
  }

  // Link-local fe80::/10 (first hextet 0xfe80 - 0xfebf)
  const hextet = lower.split(":")[0] || "";
  const prefix = hextet.slice(0, 3);
  if (
    prefix === "fe8" ||
    prefix === "fe9" ||
    prefix === "fea" ||
    prefix === "feb"
  ) {
    return true;
  }

  return false;
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIP(ip) === 4) return isPrivateIpv4(ip);
  if (net.isIP(ip) === 6) return isPrivateIpv6(ip);
  return true; // unknown format → treat as blocked
}

/**
 * Validate a URL against SSRF. Resolves the hostname and blocks any address
 * that is private, loopback, link-local, or metadata.
 *
 * @param {string} urlString - URL to check
 * @param {object} [options] - Optional overrides (mainly for tests)
 * @param {(hostname: string) => Promise<Array<{address: string}>>} [options.lookup] - DNS lookup fn
 * @returns {Promise<string|null>} Block reason string, or null if safe.
 */
export async function isBlockedUrl(
  urlString: string,
  options: { lookup?: (hostname: string) => Promise<Array<{ address: string }>> } = {},
): Promise<string | null> {
  const lookup = options.lookup ?? dnsLookup;

  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return "Invalid URL format";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Only http/https URLs are allowed";
  }

  const hostname = url.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "0.0.0.0" ||
    hostname === "::"
  ) {
    return "Local/internal hostnames are not allowed";
  }

  // If the hostname is already an IP literal, check it directly.
  if (net.isIP(hostname)) {
    return isPrivateAddress(hostname)
      ? "Private/loopback addresses are not allowed"
      : null;
  }

  // Resolve DNS and reject if any returned address is private.
  try {
    const addresses = await lookup(hostname);
    for (const { address } of addresses) {
      if (isPrivateAddress(address)) {
        return `Resolved address ${address} is not allowed (private/loopback)`;
      }
    }
    return null;
  } catch {
    return "Failed to resolve hostname";
  }
}

/** Default DNS lookup backed by the `dns` module. */
async function dnsLookup(hostname: string): Promise<Array<{ address: string }>> {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  return addresses;
}
