import { cn } from "@/lib/utils";

interface LogoLoaderProps {
  size?: number;
  className?: string;
  theme?: "auto" | "light" | "dark";
}

export function LogoLoader({ size = 56, className, theme = "auto" }: LogoLoaderProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("relative inline-flex items-center justify-center select-none", className)}
      style={{ width: size, height: size }}
    >
      {/* Light Mode Logo (4.png: black mark) */}
      {(theme === "auto" || theme === "light") && (
        <div
          className={cn(
            "relative w-full h-full",
            theme === "auto" && "dark:hidden block"
          )}
        >
          {/* Base Logo */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/4.png"
            alt=""
            width={size}
            height={size}
            className="w-full h-full object-contain pointer-events-none"
          />

          {/* Glossy reflection layer clipped strictly to logo silhouette */}
          <div
            className="absolute inset-0 pointer-events-none overflow-hidden logo-sheen-mask"
            style={{
              maskImage: 'url("/4.png")',
              WebkitMaskImage: 'url("/4.png")',
              maskSize: "contain",
              WebkitMaskSize: "contain",
              maskRepeat: "no-repeat",
              WebkitMaskRepeat: "no-repeat",
              maskPosition: "center",
              WebkitMaskPosition: "center",
            }}
          >
            <div className="absolute inset-0 logo-sheen-slide-light" />
          </div>
        </div>
      )}

      {/* Dark Mode Logo (3.png: white mark) */}
      {(theme === "auto" || theme === "dark") && (
        <div
          className={cn(
            "relative w-full h-full",
            theme === "auto" && "hidden dark:block"
          )}
        >
          {/* Base Logo */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/3.png"
            alt=""
            width={size}
            height={size}
            className="w-full h-full object-contain pointer-events-none opacity-90"
          />

          {/* Glossy reflection layer clipped strictly to logo silhouette */}
          <div
            className="absolute inset-0 pointer-events-none overflow-hidden logo-sheen-mask"
            style={{
              maskImage: 'url("/3.png")',
              WebkitMaskImage: 'url("/3.png")',
              maskSize: "contain",
              WebkitMaskSize: "contain",
              maskRepeat: "no-repeat",
              WebkitMaskRepeat: "no-repeat",
              maskPosition: "center",
              WebkitMaskPosition: "center",
            }}
          >
            <div className="absolute inset-0 logo-sheen-slide-dark" />
          </div>
        </div>
      )}
    </div>
  );
}
