"use client";

import { useEffect, useState } from "react";

const pad = (value: number) => String(value).padStart(2, "0");

/** Time left until `to`, ticking each second: "2d 4h", "3h 12m" or "12:05". */
export function Countdown({ to, className }: { to: string; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  if (now === null) return <span className={className}>&nbsp;</span>;
  const seconds = Math.max(0, Math.floor((Date.parse(to) - now) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const text = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${pad(minutes)}m` : `${pad(minutes)}:${pad(seconds % 60)}`;
  return (
    <time dateTime={to} className={className}>
      {text}
    </time>
  );
}
