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
    return hosts.map((host) => ` ${url.protocol}//${host}`).join("");
  } catch {
    return "";
  }
})();

// Everything is served from our own origin: the gateway is reached through
// /api, fonts are self-hosted by next/font, Monaco by public/monaco. Monaco
// runs its tokenizer in a blob: worker.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://*.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://static.cloudflareinsights.com https://analytics-aethercode.stjosephsplacements.in${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com https://*.googletagmanager.com",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  `connect-src 'self'${realtimeSource} https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com https://*.analytics.google.com https://www.googletagmanager.com https://*.googletagmanager.com https://stats.g.doubleclick.net https://cloudflareinsights.com https://analytics-aethercode.stjosephsplacements.in`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

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
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
