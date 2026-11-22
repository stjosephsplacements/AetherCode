import Image from "next/image";
import type { Brand as CollegeBrand } from "@/lib/server/branding";
import { cn } from "@/lib/utils";

/** Logo mark + wordmark, vertically centred on one shared horizontal midline. */
export function Brand({ size = 22, className, brand }: { size?: number; className?: string; brand?: CollegeBrand }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {/* A college's logo is an arbitrary file from the operator: plain img, no optimiser. */}
      {brand?.logoURLs.length ? (
        brand.logoURLs.map((url) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={url} src={url} alt="" width={size} height={size} className="block shrink-0 object-contain" style={{ width: size, height: size }} />
        ))
      ) : (
        <>
          <Image src="/4.png" alt="" width={size} height={size} priority className="logo-light block shrink-0 object-contain" />
          <Image src="/3.png" alt="" width={size} height={size} priority className="logo-dark block shrink-0 object-contain" />
        </>
      )}
      <span className="text-[15px] font-semibold leading-none tracking-[-0.01em] text-ink">{brand?.name ?? "AetherCode"}</span>
    </span>
  );
}
