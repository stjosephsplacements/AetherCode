"use client";

import Image from "next/image";
import Link from "next/link";
import { List, X, ArrowRight, ShieldCheck, Code, GraduationCap, Monitor, Clock, GitBranch, BookOpen, Terminal, ChartBar, Buildings } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect, useCallback } from "react";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";
import { ThemeIcon } from "./footer-controls";
import { LiquidGlass } from "./liquid-glass";

type DropdownItem = { href: string; label: string; desc: string; icon: React.ComponentType<{ className?: string }> };
type NavGroup = { label: string; items: DropdownItem[]; featured?: { title: string; desc: string; href: string } };

const PLATFORM: NavGroup = {
  label: "Platform",
  items: [
    { href: "/help", label: "For Students", desc: "Exams, practice and results", icon: GraduationCap },
    { href: "/staff", label: "For Staff", desc: "Author exams, manage students", icon: Buildings },
    { href: "/system-check", label: "System Check", desc: "Verify your laptop is ready", icon: Monitor },
    { href: "/login", label: "Sign In", desc: "Access your account", icon: ArrowRight },
  ],
  featured: { title: "Coding exams for colleges", desc: "Same exam, same editor, same hidden tests. Marks come from what you write.", href: "/#product" },
};

const DEVELOPERS: NavGroup = {
  label: "Developers",
  items: [
    { href: SITE.repo, label: "GitHub", desc: "Source code and issues", icon: GitBranch },
    { href: SITE.engineRepo, label: "Execution Engine", desc: "Sandboxed code runner", icon: Terminal },
    { href: "/architecture", label: "Architecture", desc: "How AetherCode works", icon: Code },
    { href: "/changelog", label: "Changelog", desc: "What shipped recently", icon: Clock },
  ],
};

const RESOURCES: NavGroup = {
  label: "Resources",
  items: [
    { href: "/help", label: "Help Center", desc: "Guides and FAQ", icon: BookOpen },
    { href: "/security", label: "Security", desc: "Threat model and practices", icon: ShieldCheck },
    { href: "/status", label: "Status", desc: "Service health", icon: ChartBar },
  ],
};

const NAV_GROUPS = [PLATFORM, DEVELOPERS, RESOURCES];

const ease = "transition-all duration-[350ms] [transition-timing-function:cubic-bezier(0.2,0,0,1)]";

export function Navbar() {
  const pathname = usePathname();
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState<string | null>(null);
  const closeTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const enter = useCallback((label: string) => {
    clearTimeout(closeTimeout.current);
    setActiveGroup(label);
  }, []);

  const leave = useCallback(() => {
    closeTimeout.current = setTimeout(() => setActiveGroup(null), 200);
  }, []);

  const close = useCallback(() => {
    clearTimeout(closeTimeout.current);
    setActiveGroup(null);
  }, []);

  useEffect(() => () => clearTimeout(closeTimeout.current), []);

  const group = NAV_GROUPS.find((g) => g.label === activeGroup);

  return (
    <header className="relative sticky top-0 z-40 px-3 pt-3 font-mono" onMouseLeave={leave}>
      {/* Floating pill bar — liquid glass */}
      <LiquidGlass className="mx-auto flex h-12 max-w-6xl items-center gap-0.5 rounded-full px-2 text-[13px]" style={{ boxShadow: "var(--shadow-panel)" }}>
        <Link href="/" className={cn(ease, "flex h-9 items-center gap-2.5 rounded-full pl-3 pr-4 text-ink hover:bg-hover")}>
          <Image src="/4.png" alt="" width={16} height={16} priority className="logo-light object-contain" />
          <Image src="/3.png" alt="" width={16} height={16} priority className="logo-dark object-contain" />
          <span className="font-semibold tracking-tight">AetherCode</span>
        </Link>

        <nav aria-label="Main" className="ml-2 hidden items-center gap-0.5 md:flex">
          {NAV_GROUPS.map((g) => (
            <div key={g.label} onMouseEnter={() => enter(g.label)}>
              <button
                type="button"
                className={cn(
                  ease, "flex h-9 items-center rounded-full px-4 text-[13.5px]",
                  activeGroup === g.label ? "bg-hover text-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
                )}
              >
                {g.label}
              </button>
            </div>
          ))}
          <Link
            href="/about"
            onMouseEnter={close}
            className={cn(
              ease, "flex h-9 items-center rounded-full px-4 text-[13.5px]",
              pathname.startsWith("/about") ? "bg-hover text-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
            )}
          >
            About
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <div className={cn(ease, "hidden h-9 items-center rounded-full px-2 text-ink-muted hover:bg-hover hover:text-ink sm:flex")}>
            <ThemeIcon />
          </div>
          <Link
            href="/login"
            className={cn(ease, "flex h-8 items-center rounded-full bg-brand px-4 text-[13px] font-medium text-brand-ink hover:opacity-90")}
          >
            Sign in
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className={cn(ease, "grid size-9 place-items-center rounded-full text-ink-muted hover:bg-hover hover:text-ink md:hidden")}
          >
            {mobileOpen ? <X className="size-4" /> : <List className="size-4" />}
          </button>
        </div>
      </LiquidGlass>

      {/* Mega dropdown — liquid glass panel overlaying the page */}
      {group && (
        <LiquidGlass
          strong
          onMouseEnter={() => enter(group.label)}
          onMouseLeave={leave}
          className="absolute inset-x-3 top-full z-50 mx-auto mt-1 max-w-5xl rounded-2xl p-6"
          style={{ boxShadow: "var(--shadow-overlay)" }}
        >
          <div className="flex gap-8">
            <div className="flex-1">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">{group.label}</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={close}
                    className={cn(ease, "group flex items-center gap-3.5 rounded-xl px-3 py-2.5 hover:bg-hover")}
                  >
                    <item.icon className="size-5 shrink-0 text-ink-muted group-hover:text-brand" />
                    <div>
                      <p className="text-[14px] font-medium text-ink">{item.label}</p>
                      <p className="text-[12.5px] text-ink-muted">{item.desc}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
            {group.featured && (
              <Link
                href={group.featured.href}
                onClick={close}
                className={cn(ease, "hidden w-56 shrink-0 rounded-xl bg-hover/50 p-4 hover:bg-hover lg:block")}
              >
                <p className="text-[14px] font-semibold text-ink">{group.featured.title}</p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted">{group.featured.desc}</p>
                <p className="mt-3 flex items-center gap-1 text-[12.5px] font-medium text-brand">
                  Learn more <ArrowRight className="size-3.5" />
                </p>
              </Link>
            )}
          </div>
        </LiquidGlass>
      )}

      {/* Mobile menu */}
      {mobileOpen && (
        <nav
          aria-label="Main"
          className="liquid-glass mx-auto mt-2 max-w-6xl overflow-hidden rounded-2xl px-3 py-2 shadow-[var(--shadow-panel)] md:hidden"
        >
          {NAV_GROUPS.map((g) => (
            <div key={g.label}>
              <button
                type="button"
                onClick={() => setMobileExpanded(mobileExpanded === g.label ? null : g.label)}
                className={cn(ease, "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-[14px] text-ink-muted hover:bg-hover hover:text-ink")}
              >
                {g.label}
                <span className={cn("text-[12px] transition-transform", mobileExpanded === g.label && "rotate-90")}>▸</span>
              </button>
              {mobileExpanded === g.label && (
                <div className="ml-4 border-l border-line pl-3">
                  {g.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className="block rounded-lg px-3 py-2 text-[13px] text-ink-muted hover:text-ink"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
          <Link
            href="/about"
            onClick={() => setMobileOpen(false)}
            className="block rounded-lg px-3 py-2.5 text-[14px] text-ink-muted hover:bg-hover hover:text-ink"
          >
            About
          </Link>
          <div className="mt-2 border-t border-line pt-3">
            <Link
              href="/login"
              onClick={() => setMobileOpen(false)}
              className="block rounded-full bg-brand px-4 py-2.5 text-center text-[14px] font-medium text-brand-ink"
            >
              Sign in
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
