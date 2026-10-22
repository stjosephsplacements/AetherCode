import "server-only";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { type BrandingConfig, logoFiles, parseBranding, pickBrand } from "@/lib/branding";

const EMPTY: BrandingConfig = { default: {}, tenants: {} };
let cached: { file: string; modified: number; config: BrandingConfig } | null = null;

/** The branding file, re-read when it changes, so a new logo needs no restart. */
async function loadConfig(): Promise<{ file: string; config: BrandingConfig } | null> {
  const file = process.env.BRANDING_FILE?.trim();
  if (!file) return null;
  try {
    const modified = (await stat(file)).mtimeMs;
    if (cached?.file !== file || cached.modified !== modified) {
      const { config, problems } = parseBranding(await readFile(file, "utf8"));
      for (const problem of problems) console.warn(`BRANDING_FILE ${file}: ${problem}`);
      cached = { file, modified, config };
    }
    return { file, config: cached.config };
  } catch (error) {
    console.warn(`BRANDING_FILE ${file} could not be read: ${error instanceof Error ? error.message : error}`);
    return { file, config: cached?.file === file ? cached.config : EMPTY };
  }
}

export type Brand = { name: string | null; color: string | null; logoURLs: string[] };

/** The brand to show a viewer in a college; the AetherCode defaults when none is set. */
export async function brandFor(tenantId: string | null): Promise<Brand> {
  const loaded = await loadConfig();
  const brand = loaded ? pickBrand(loaded.config, tenantId) : {};
  return {
    name: brand.name ?? null,
    color: brand.color ?? null,
    logoURLs: logoFiles(brand).map((_, index) => `/branding/logo?n=${index}${tenantId ? `&tenant=${encodeURIComponent(tenantId)}` : ""}`),
  };
}

/** A college's logo file from beside the branding file, by its configured name only. */
export async function logoFor(tenantId: string | null, index = 0): Promise<{ data: Buffer; type: string } | null> {
  const loaded = await loadConfig();
  if (!loaded) return null;
  const logo = logoFiles(pickBrand(loaded.config, tenantId))[index];
  if (!logo) return null;
  const extension = path.extname(logo).slice(1).toLowerCase();
  const type = extension === "svg" ? "image/svg+xml" : extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
  try {
    return { data: await readFile(path.join(path.dirname(loaded.file), logo)), type };
  } catch {
    return null;
  }
}
