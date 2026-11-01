import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

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
  "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com https://*.analytics.google.com https://www.googletagmanager.com https://*.googletagmanager.com https://stats.g.doubleclick.net https://cloudflareinsights.com https://analytics-aethercode.stjosephsplacements.in",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Tests and imported questions arrive through server actions; nginx accepts
  // 2 MB and the gateway 1 MiB of JSON, so a larger body could not get through.
  // cpus caps build workers so the Docker build fits in builder memory.
  experimental: { serverActions: { bodySizeLimit: "2mb" }, cpus: 4 },
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
