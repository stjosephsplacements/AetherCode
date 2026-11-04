import { cn } from "@/lib/utils";

/** A progress ring: `value` of `max`, with whatever you put inside shown in the middle. */
export function Ring({ value, max, size = 96, stroke = 9, className, trackClass = "stroke-line", barClass = "stroke-brand", children }: { value: number; max: number; size?: number; stroke?: number; className?: string; trackClass?: string; barClass?: string; children?: React.ReactNode }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const share = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className={cn("relative grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className={trackClass} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} strokeLinecap="round" className={cn(barClass, "transition-[stroke-dashoffset] duration-700")} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - share)} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}
