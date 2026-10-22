import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="animate-enter">
        <p className="text-sm text-ink-muted">404</p>
        <h1 className="display mt-2 text-[2.2rem] text-ink">This page doesn’t exist</h1>
        <Button asChild variant="secondary" className="mt-8">
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </main>
  );
}
