import type { MetadataRoute } from "next";
import { publicOrigin } from "@/lib/server/config";
import { PUBLIC_PATHS } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = publicOrigin();
  return [
    { url: `${origin}/`, changeFrequency: "monthly", priority: 1 },
    ...PUBLIC_PATHS.map((path) => ({ url: `${origin}${path}`, changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}
