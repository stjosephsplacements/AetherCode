import Link from "next/link";
import type { ReactNode } from "react";
import type { User } from "@/lib/auth";
import { signOut } from "@/app/actions";
import { Logo } from "./ui";

const NAV: Record<User["role"], Array<[string, string]>> = {
  admin: [
    ["/admin", "People"],
    ["/faculty", "Exams"],
    ["/faculty/questions", "Questions"],
  ],
  faculty: [
    ["/faculty", "Exams"],
    ["/faculty/questions", "Questions"],
  ],
  student: [["/student", "My exams"]],
};

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
          <Link href="/">
            <Logo />
          </Link>
          <nav className="flex gap-1">
            {NAV[user.role].map(([href, label]) => (
              <Link key={href} href={href} className="rounded-full px-3 py-1.5 text-sm font-medium text-muted hover:bg-sunken hover:text-ink">
                {label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold leading-tight">{user.name}</p>
              <p className="text-xs capitalize text-faint">
                {user.role}
                {user.batch ? ` · ${user.batch}` : ""}
              </p>
            </div>
            <form action={signOut}>
              <button className="rounded-full px-3 py-1.5 text-sm font-medium text-muted hover:bg-sunken hover:text-ink">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-10">{children}</main>
    </div>
  );
}
