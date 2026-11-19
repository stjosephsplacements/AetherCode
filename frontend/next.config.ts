import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// The live-update socket is same-origin in production, which 'self' covers. For local
// development it is served from the gateway's own address, so that origin is allowed too.
// Other machines on the network (DEV_ORIGINS) reach that gateway at their own address for it.
const developmentHosts = isDev
  ? (process.env.DEV_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean).map((origin) => new URL(origin).hostname)
  : [];
const realtimeSource = (() => {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_REALTIME_URL ?? "");
    const hosts = [url.host, ...developmentHosts.map((hostname) => `${hostname}${url.port ? `:${url.port}` : ""}`)];
    if (/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) {
      const alt = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
      hosts.push(`${alt}${url.port ? `:${url.port}` : ""}`);
    }
    return hosts.map((host) => ` ${url.protocol}//${host}`).join("");
  } catch {
    return "";
  }
})();

// Everything is served from our own origin: the gateway is reached through
// /api, fonts are self-hosted by next/font, Monaco by public/monaco. Monaco
// runs its tokenizer in a blob: worker.
function policy(thirdParty: boolean): string {
  const analyticsScripts = " https://www.googletagmanager.com https://*.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://static.cloudflareinsights.com https://analytics-aethercode.stjosephsplacements.in";
  const analyticsImages = " https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com https://*.googletagmanager.com";
  const analyticsConnections = " https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com https://*.analytics.google.com https://www.googletagmanager.com https://*.googletagmanager.com https://stats.g.doubleclick.net https://cloudflareinsights.com https://analytics-aethercode.stjosephsplacements.in";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${thirdParty ? analyticsScripts : ""}${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${thirdParty ? analyticsImages : ""}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    `connect-src 'self'${realtimeSource}${thirdParty ? analyticsConnections : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

const commonHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "accelerometer=(), camera=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()" },
];

// The forgot and reset pages: the reset link carries a bearer, so no third-party host is allowed there and no
// Referer is sent from them. The catch-all rule below excludes these two paths.
const resetPageHeaders = [
  ...commonHeaders,
  { key: "Content-Security-Policy", value: policy(false) },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "no-store" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Dev assets and the hot-reload socket are refused to other origins unless listed.
  allowedDevOrigins: developmentHosts,
  poweredByHeader: false,
  // Tests and imported questions arrive through server actions; nginx accepts
  // 2 MB and the gateway 1 MiB of JSON, so a larger body could not get through.
  // cpus caps build workers so the Docker build fits in builder memory.
  experimental: { serverActions: { bodySizeLimit: "2mb" }, cpus: 4 },
  // The platform pages moved out of the college workspace into /admin.
  async redirects() {
    return [
      { source: "/staff/colleges", destination: "/admin/colleges", permanent: false },
      { source: "/staff/analytics/platform", destination: "/admin/analytics", permanent: false },
      { source: "/staff/placements", destination: "/placement", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        // Every page except the reset pages, which get resetPageHeaders instead.
        source: "/((?!auth/reset-password|auth/forgot-password).*)",
        headers: [
          ...commonHeaders,
          { key: "Content-Security-Policy", value: policy(true) },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
      { source: "/auth/reset-password", headers: resetPageHeaders },
      { source: "/auth/forgot-password", headers: resetPageHeaders },
      {
        source: "/fonts/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/monaco/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
