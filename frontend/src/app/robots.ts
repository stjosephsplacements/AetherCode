import type { MetadataRoute } from "next";
import { publicOrigin } from "@/lib/server/config";

// Public pages may be indexed; everything behind sign-in never is.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/$", "/about", "/architecture", "/changelog", "/help", "/privacy", "/security", "/status", "/system-check", "/terms"], disallow: "/" }],
    sitemap: `${publicOrigin()}/sitemap.xml`,
  };
}
