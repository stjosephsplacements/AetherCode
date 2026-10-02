// IPv4 allow-listing for exam networks. Entries are CIDR ranges ("10.20.0.0/16")
// or single addresses ("10.20.3.4").

function ipv4ToInt(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    result = result * 256 + Number(part);
  }
  return result;
}

export function isValidNetwork(entry: string): boolean {
  const [address, bits, ...rest] = entry.trim().split("/");
  if (rest.length > 0 || ipv4ToInt(address) === null) return false;
  return bits === undefined || (/^\d{1,2}$/.test(bits) && Number(bits) <= 32);
}

// Accepts IPv4 and IPv4-mapped IPv6 ("::ffff:10.0.0.1") client addresses.
export function normalizeClientIp(value: string | null | undefined): string | null {
  const first = value?.split(",")[0]?.trim();
  if (!first) return null;
  const mapped = first.toLowerCase().startsWith("::ffff:") ? first.slice(7) : first;
  return ipv4ToInt(mapped) === null ? first : mapped;
}

export function ipAllowed(clientIp: string | null, networks: string[]): boolean {
  if (networks.length === 0) return true;
  const ip = clientIp === null ? null : ipv4ToInt(clientIp);
  if (ip === null) return false;
  return networks.some((entry) => {
    const [address, bits = "32"] = entry.trim().split("/");
    const base = ipv4ToInt(address);
    if (base === null) return false;
    const size = 2 ** (32 - Number(bits));
    return Math.floor(ip / size) === Math.floor(base / size);
  });
}
