"use client";

import { CaretLeft, List, Lock, Moon, Sun } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tooltip } from "radix-ui";
import { useState } from "react";
import { ICONS, type NavItem } from "@/components/nav-links";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { setTheme, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export type NavGroup = { label: string; items: NavItem[] };

const pathOf = (href: string) => href.split(/[?#]/)[0] ?? href;

/** Flatten a nav tree for breadcrumbs and lookups. */
export function flattenNav(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => [item, ...flattenNav(item.children ?? [])]);
}

/** "/staff", "/admin" and "/placement" are roots: active only on their own page. */
export function isNavActive(pathname: string, href: string) {
  const path = pathOf(href);
  if (path === "/staff" || path === "/admin" || path === "/placement") return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** Exact match preferred for nested trees so a child does not light up every ancestor the same way. */
function isNavExact(pathname: string, href: string) {
  return pathname === pathOf(href);
}

/** True when this item or any nested leaf matches — so parents stay marked when a child URL is not a path prefix. */
export function isNavBranch(pathname: string, item: NavItem): boolean {
  if (isNavActive(pathname, item.href)) return true;
  return (item.children ?? []).some((child) => isNavBranch(pathname, child));
}

/** Deepest nav trail for the current path (parent → … → leaf), for breadcrumbs. */
export function navTrail(items: NavItem[], pathname: string): NavItem[] | null {
  for (const item of items) {
    const childTrail = item.children?.length ? navTrail(item.children, pathname) : null;
    if (childTrail) return [item, ...childTrail];
    if (isNavActive(pathname, item.href)) return [item];
  }
  return null;
}

/**
 * File-tree guides: continuous trunk through siblings (`│`), tee into a row (`├──`),
 * curved elbow on the last child (`╰──`).
 */
function TreeGuides({ last }: { last: boolean }) {
  if (last) {
    return (
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 h-1/2 w-3 rounded-bl-[7px] border-b border-l border-line"
      />
    );
  }
  return (
    <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-3">
      <span className="absolute inset-y-0 left-0 w-px bg-line" />
      <span className="absolute left-0 top-1/2 h-px w-full -translate-y-px bg-line" />
    </span>
  );
}

function NavLink({
  item,
  collapsed,
  depth,
  last = true,
}: {
  item: NavItem;
  collapsed: boolean;
  depth: number;
  last?: boolean;
}) {
  const pathname = usePathname();
  const exact = isNavExact(pathname, item.href);
  const inBranch = isNavBranch(pathname, item);
  const Icon = ICONS[item.icon];
  const nested = depth > 0;
  const showChildren = !collapsed && (item.children?.length ?? 0) > 0;

  const link = item.locked ? (
    <span
      aria-disabled="true"
      title={item.locked}
      className={cn(
        "flex h-9 cursor-not-allowed items-center text-[13.5px] text-ink-subtle",
        collapsed ? "justify-center px-0" : "gap-2.5 px-3",
        nested && !collapsed && "h-8 pr-3 text-[13px]",
      )}
    >
      <Icon className={cn("shrink-0 opacity-60", nested ? "size-3.5" : "size-4")} />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && <Lock className="ml-auto size-3 shrink-0 opacity-70" />}
      {!collapsed && <span className="sr-only">{item.locked}</span>}
    </span>
  ) : (
    <Link
      href={item.href}
      aria-current={exact ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "relative flex items-center rounded-control transition-[color,background-color,box-shadow]",
        collapsed ? "h-9 justify-center" : "h-9 gap-2.5 px-3 text-[13.5px]",
        nested && !collapsed && "h-8 pr-3 text-[13px]",
        exact
          ? "bg-hover font-medium text-ink shadow-[var(--shadow-nav-active)]"
          : inBranch && depth === 0
            ? "font-medium text-ink"
            : "text-ink-muted hover:bg-hover/70 hover:text-ink",
      )}
    >
      <Icon className={cn("shrink-0", nested ? "size-3.5" : "size-4")} />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );

  return (
    <li className={cn(nested && !collapsed && "relative pl-3")}>
      {nested && !collapsed && <TreeGuides last={last} />}
      {collapsed ? (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content side="right" sideOffset={10} className="z-50 animate-fade border border-line-strong bg-surface px-2.5 py-1.5 text-[12.5px] font-medium text-ink shadow-[var(--shadow-overlay)]">
              {item.locked ? `${item.label}: ${item.locked}` : item.label}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      ) : (
        link
      )}
      {showChildren && (
        <ul className="relative ml-5 mt-0.5">
          {item.children!.map((child, index, all) => (
            <NavLink
              key={`${child.href}:${child.label}`}
              item={child}
              collapsed={collapsed}
              depth={depth + 1}
              last={index === all.length - 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function StaffNav({ groups, collapsed = false }: { groups: NavGroup[]; collapsed?: boolean }) {
  return (
    <Tooltip.Provider delayDuration={150} skipDelayDuration={0}>
      <div className={collapsed ? "space-y-4" : "space-y-6"}>
        {groups.map((group, index) => (
          <div key={group.label}>
            {collapsed ? (
              index > 0 && <div aria-hidden className="mx-2 mb-4 h-px bg-line" />
            ) : (
              <p className="mb-2 px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-subtle">{group.label}</p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} collapsed={collapsed} depth={0} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Tooltip.Provider>
  );
}

function crumbLabel(step: string, labels: Map<string, string>, href: string) {
  return labels.get(href) ?? (step.length > 16 ? `${step.slice(0, 8)}…` : step);
}

/** Where you are as a path, each step a link back up. Prefers the sidebar tree when nested. */
export function StaffPath({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const labels = new Map(groups.flatMap((group) => flattenNav(group.items).map((item) => [pathOf(item.href), item.label])));
  const trail = navTrail(
    groups.flatMap((group) => group.items),
    pathname,
  );

  type Crumb = { href: string; label: string };
  let crumbs: Crumb[] = [];
  if (trail && trail.length > 0) {
    crumbs = trail.map((item) => ({ href: pathOf(item.href), label: item.label }));
    const leaf = crumbs[crumbs.length - 1]!.href;
    if (pathname.startsWith(`${leaf}/`)) {
      const extra = pathname.slice(leaf.length + 1).split("/").filter(Boolean);
      extra.forEach((step, index) => {
        const href = `${leaf}/${extra.slice(0, index + 1).join("/")}`;
        crumbs.push({ href, label: crumbLabel(step, labels, href) });
      });
    }
  } else {
    const steps = pathname.split("/").filter(Boolean);
    crumbs = steps.map((step, index) => {
      const href = `/${steps.slice(0, index + 1).join("/")}`;
      return { href, label: crumbLabel(step, labels, href) };
    });
  }

  return (
    <nav aria-label="Breadcrumb" className="min-w-0 truncate font-mono text-[12.5px]">
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <span key={`${crumb.href}:${crumb.label}`}>
            {index > 0 && <span className="px-1.5 text-ink-subtle">/</span>}
            {last ? (
              <span aria-current="page" className="text-ink">
                {crumb.label}
              </span>
            ) : (
              <Link href={crumb.href} className="text-ink-muted transition-colors hover:text-ink">
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/** Below lg the sidebar folds into a floating panel behind a menu button. */
export function StaffMenu({ groups, college, title }: { groups: NavGroup[]; college?: React.ReactNode; title?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger aria-label="Open menu" className="-ml-1.5 grid size-9 place-items-center rounded-control text-ink-muted transition-colors hover:bg-hover hover:text-ink lg:hidden">
        <List className="size-[18px]" />
      </DialogTrigger>
      <DialogContent title={title ?? "Menu"} className="!fixed !inset-auto !left-3 !top-3 !w-[min(calc(100vw-24px),320px)] !max-h-[calc(100dvh-24px)] !translate-x-0 !translate-y-0 !rounded-panel border border-line">
        {college && <div className="mb-1 border-b border-line px-5 pb-3">{college}</div>}
        <nav aria-label="Main" className="space-y-5 overflow-y-auto px-3 pb-5" onClick={(event) => (event.target as Element).closest("a") && setOpen(false)}>
          {groups.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-subtle">{group.label}</p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <MobileNavBranch key={`${item.href}:${item.label}`} item={item} depth={0} />
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </DialogContent>
    </Dialog>
  );
}

function MobileNavBranch({ item, depth, last = true }: { item: NavItem; depth: number; last?: boolean }) {
  const nested = depth > 0;
  return (
    <li className={cn(nested && "relative pl-3")}>
      {nested && <TreeGuides last={last} />}
      <MobileNavLink href={item.href} label={item.label} icon={item.icon} locked={item.locked} nested={nested} />
      {item.children && item.children.length > 0 && (
        <ul className="relative ml-5 mt-0.5">
          {item.children.map((child, index, all) => (
            <MobileNavBranch
              key={`${child.href}:${child.label}`}
              item={child}
              depth={depth + 1}
              last={index === all.length - 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function MobileNavLink({
  href,
  label,
  icon,
  locked,
  nested,
}: {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  locked?: string;
  nested: boolean;
}) {
  const pathname = usePathname();
  const current = isNavExact(pathname, href);
  const Icon = ICONS[icon];
  if (locked) {
    return (
      <span
        className={cn("flex items-center gap-2.5 py-2.5 pr-3 text-[15px] text-ink-subtle", nested ? "pl-2" : "px-3")}
        title={locked}
      >
        <Icon className="size-4 shrink-0 opacity-60" />
        <span className="truncate">{label}</span>
        <Lock className="ml-auto size-3.5 shrink-0" />
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-control py-2.5 pr-3 text-[15px] transition-[color,background-color,box-shadow]",
        nested ? "pl-2" : "px-3",
        current ? "bg-hover font-medium text-ink shadow-[var(--shadow-nav-active)]" : "text-ink-muted active:bg-hover",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
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
      className="grid size-9 place-items-center rounded-control text-ink-muted transition-[color,background-color,transform] hover:bg-hover hover:text-ink active:scale-[0.97]"
    >
      {theme === "dark" ? <Sun className="size-[17px]" /> : <Moon className="size-[17px]" />}
    </button>
  );
}

export function SidebarCollapse({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      title={`${collapsed ? "Expand" : "Collapse"} sidebar (Ctrl+B)`}
      className="grid size-8 place-items-center rounded-control text-ink-subtle transition-colors hover:bg-hover hover:text-ink"
    >
      <CaretLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
    </button>
  );
}
