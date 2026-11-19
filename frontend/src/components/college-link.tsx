import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * A link that may point at /admin/open, a route handler that sets the college cookie and redirects.
 * Next's client router prefetches and soft-navigates a Link, which does not carry that cookie
 * redirect through, so these go through a normal navigation. Every other path keeps client navigation.
 */
export function CollegeLink({ href, ...props }: ComponentProps<typeof Link> & { href: string }) {
  if (href.startsWith("/admin/open")) {
    // Link-only props are not valid on an anchor.
    const anchor = Object.fromEntries(Object.entries(props).filter(([key]) => !["prefetch", "scroll", "replace", "shallow", "locale", "legacyBehavior", "passHref", "as", "onNavigate"].includes(key)));
    return <a href={href} {...(anchor as ComponentProps<"a">)} />;
  }
  return <Link href={href} {...props} />;
}
