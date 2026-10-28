import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Hero } from "@/components/site/hero";
import { Numbers } from "@/components/site/numbers";
import { OpenSource } from "@/components/site/open-source";
import { Product } from "@/components/site/product";
import { Button } from "@/components/ui/button";
import { requireViewer } from "@/lib/server/session";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/server/tokens";
import { homeFor } from "@/lib/viewer";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function Landing() {
  // Signed in? The landing page is for visitors; go straight to work.
  const jar = await cookies();
  if (jar.get(ACCESS_COOKIE) || jar.get(REFRESH_COOKIE)) redirect(homeFor(await requireViewer()));

  return (
    <>
      <Hero />
      <Numbers />
      <Product />
      <OpenSource />

      <section className="mx-auto max-w-6xl px-6 py-28 text-center sm:py-32">
        <h2 className="heading mx-auto max-w-[18ch] text-[2.4rem] text-ink sm:text-[3.2rem]">Sign in with the account your college gave you.</h2>
        <div data-reveal className="mt-9 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" className="rounded-[10px]">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="lg" variant="secondary" className="rounded-[10px]">
            <Link href="/help">Read the help center</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
