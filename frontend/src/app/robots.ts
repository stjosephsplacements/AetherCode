import type { MetadataRoute } from "next";
import { publicOrigin } from "@/lib/server/config";

// Public pages may be indexed; everything behind sign-in never is.
// Built from PUBLIC_ORIGIN, which exists at run time but not while the image is built.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/$", "/about", "/architecture", "/changelog", "/help", "/privacy", "/security", "/status", "/system-check", "/terms"], disallow: "/" }],
    sitemap: `${publicOrigin()}/sitemap.xml`,
  };
}
