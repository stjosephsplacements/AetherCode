import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  serverExternalPackages: ["postgres"],
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
};

export default nextConfig;
