"use client";

import { useNow } from "@/lib/client/use-now";
import { TIME_ZONE } from "@/lib/utils";

const stamp = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: TIME_ZONE });

/** The college's wall clock, ticking every second. The server's render shows until the browser takes over. */
export function Clock({ initial }: { initial: string }) {
  const now = useNow(1000);
  return (
    <time dateTime={new Date(now ?? Date.parse(initial)).toISOString()} suppressHydrationWarning>
      {stamp.format(now ?? Date.parse(initial))}
    </time>
  );
}
