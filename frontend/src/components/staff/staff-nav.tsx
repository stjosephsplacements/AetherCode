"use client";

import { List, Lock, Moon, Sun } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tooltip } from "radix-ui";
import { useState } from "react";
import { ICONS, type NavItem } from "@/components/nav-links";
import { Dialog, DialogTrigger, SheetContent } from "@/components/ui/dialog";
import { setTheme, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export type NavGroup = { label: string; items: NavItem[] };

// "/staff", "/admin" and "/placement" are every page's parent, so it is active only on its own page.
const isActive = (pathname: string, href: string) => pathname === href || (href !== "/staff" && href !== "/admin" && href !== "/placement" && pathname.startsWith(`${href}/`));

export function StaffNav({ groups, collapsed = false }: { groups: NavGroup[]; collapsed?: boolean }) {
  const pathname = usePathname();
  return (
    <Tooltip.Provider delayDuration={150} skipDelayDuration={0}>
      <div className={collapsed ? "space-y-3" : "space-y-5"}>
        {groups.map((group, index) => (
          <div key={group.label}>
            {collapsed ? (
              index > 0 && <hr aria-hidden className="mx-1.5 mb-3 border-line" />
            ) : (
              <p className="mb-1 px-2.5 font-[family-name:var(--font-eyebrow)] text-[10.5px] uppercase tracking-[0.14em] text-ink-subtle">{group.label}</p>
            )}
            <ul className="space-y-px">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = ICONS[item.icon];
                const link = item.locked ? (
                  <span
                    aria-disabled="true"
                    title={item.locked}
                    className={cn("flex h-8 cursor-not-allowed items-center gap-2.5 rounded-[var(--radius-control)] text-[13.5px] text-ink-subtle", collapsed ? "justify-center" : "px-2.5")}
                  >
                    <Icon className="size-4 shrink-0" />
                    {!collapsed && (
                      <>
                        {item.label}
                        <Lock className="ml-auto size-3" />
                      </>
                    )}
                    {!collapsed && <span className="sr-only">{item.locked}</span>}
                  </span>
                ) : (
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    className={cn(
                      "relative flex h-8 items-center gap-2.5 rounded-[var(--radius-control)] text-[13.5px] transition-colors",
                      collapsed ? "justify-center" : "px-2.5",
                      active ? "bg-hover font-medium text-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
                    )}
                  >
                    {/* The orange tick marks where you are, the same mark as "now" on the overview. */}
                    {active && <span aria-hidden className={cn("absolute top-1.5 bottom-1.5 w-[2px] rounded-full bg-brand", collapsed ? "-left-2.5" : "-left-2")} />}
                    <Icon className="size-4 shrink-0" />
                    {!collapsed && item.label}
                  </Link>
                );
                return (
                  <li key={item.href}>
                    {collapsed ? (
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
                        <Tooltip.Portal>
                          <Tooltip.Content side="right" sideOffset={10} className="z-50 animate-fade rounded-md border border-line-strong bg-surface px-2 py-1 text-[12.5px] font-medium text-ink shadow-[var(--shadow-overlay)]">
                            {item.locked ? `${item.label}: ${item.locked}` : item.label}
                          </Tooltip.Content>
                        </Tooltip.Portal>
                      </Tooltip.Root>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Tooltip.Provider>
  );
}

/** Where you are as a path, each step a link back up. Ids are shortened. */
export function StaffPath({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const labels = new Map(groups.flatMap((group) => group.items.map((item) => [item.href, item.label.toLowerCase()])));
  const steps = pathname.split("/").filter(Boolean);
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 truncate font-mono text-[12.5px]">
      {steps.map((step, index) => {
        const href = `/${steps.slice(0, index + 1).join("/")}`;
        const label = labels.get(href) ?? (step.length > 16 ? step.slice(0, 8) : step);
        const last = index === steps.length - 1;
        return (
          <span key={href}>
            {index > 0 && <span className="px-1.5 text-ink-subtle">/</span>}
            {last ? (
              <span aria-current="page" className="text-ink">
                {label}
              </span>
            ) : (
              <Link href={href} className="text-ink-muted transition-colors hover:text-ink">
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/** Below lg the sidebar folds into a sheet behind a menu button. */
export function StaffMenu({ groups, college }: { groups: NavGroup[]; college?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger aria-label="Open menu" className="-ml-1.5 grid size-9 place-items-center rounded-[var(--radius-control)] text-ink-muted transition-colors hover:bg-hover hover:text-ink lg:hidden">
        <List className="size-[18px]" />
      </DialogTrigger>
      <SheetContent title="Menu" className="w-[min(92vw,360px)]">
        {college && <div className="border-b border-line px-5 py-4">{college}</div>}
        <nav aria-label="Main" className="space-y-6 px-4 py-5" onClick={(event) => (event.target as Element).closest("a") && setOpen(false)}>
          {groups.map((group) => (
            <div key={group.label}>
              <p className="mb-2 px-1 font-[family-name:var(--font-eyebrow)] text-[10px] uppercase tracking-[0.16em] text-ink-subtle">{group.label}</p>
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const Icon = ICONS[item.icon];
                  return (
                    <li key={item.href}>
                      <MobileNavLink href={item.href} icon={<Icon className="size-5" />} label={item.label} locked={item.locked} />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </SheetContent>
    </Dialog>
  );
}

function MobileNavLink({ href, icon, label, locked }: { href: string; icon: React.ReactNode; label: string; locked?: string }) {
  const pathname = usePathname();
  const current = isActive(pathname, href);
  if (locked) {
    return (
      <span className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] text-ink-subtle" title={locked}>
        <span className="grid size-9 place-items-center rounded-lg bg-hover text-ink-subtle">{icon}</span>
        <span>{label}</span>
        <Lock className="ml-auto size-3.5" />
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors",
        current ? "bg-brand-soft font-medium text-ink" : "text-ink-muted active:bg-hover",
      )}
    >
      <span className={cn("grid size-9 place-items-center rounded-lg transition-colors", current ? "bg-brand text-brand-ink" : "bg-hover text-ink-muted")}>
        {icon}
      </span>
      <span>{label}</span>
    </Link>
  );
}

/** Dark and light, one click from anywhere in the console. */
export function ThemeToggle() {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="grid size-9 place-items-center rounded-[var(--radius-control)] text-ink-muted transition-[color,background-color,transform] hover:bg-hover hover:text-ink active:scale-[0.97]"
    >
      {theme === "dark" ? <Sun className="size-[17px]" /> : <Moon className="size-[17px]" />}
    </button>
  );
}
