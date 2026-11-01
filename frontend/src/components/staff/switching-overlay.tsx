import { LogoLoader } from "@/components/ui/logo-loader";

/** Covers the page with the logo loader while a college change loads, so there is no blank flash. */
export function SwitchingOverlay({ label = "Switching college" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className="fixed inset-0 z-[100] grid place-items-center bg-canvas/80 backdrop-blur-sm animate-enter">
      <LogoLoader size={64} />
    </div>
  );
}
