import Image from "next/image";
import type { Brand as CollegeBrand } from "@/lib/server/branding";
import { cn } from "@/lib/utils";

export function Brand({ size = 22, className, brand }: { size?: number; className?: string; brand?: CollegeBrand }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {/* A college's logo is an arbitrary file from the operator: plain img, no optimiser. */}
      {brand?.logoURLs.length ? (
        brand.logoURLs.map((url) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={url} src={url} alt="" width={size} height={size} className="object-contain" style={{ width: size, height: size }} />
        ))
      ) : (
        <Image src="/logo.png" alt="" width={size} height={size} priority />
      )}
      <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{brand?.name ?? "AetherCode"}</span>
    </span>
  );
}
