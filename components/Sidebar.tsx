"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import type { DepartmentRow } from "@/lib/tools/types";

function navClass(active: boolean): string {
  return [
    "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-all duration-200",
    active
      ? "bg-surface-secondary font-medium text-ink"
      : "text-ink-tertiary hover:bg-surface-secondary/60 hover:text-ink-secondary",
  ].join(" ");
}

export function Sidebar({
  departments,
  email,
  isSuperAdmin,
}: {
  departments: DepartmentRow[];
  email: string;
  isSuperAdmin: boolean;
}) {
  const pathname = usePathname();
  const isActive = (slug: string) => pathname === `/${slug}` || pathname.startsWith(`/${slug}/`);

  return (
    <aside className="flex w-60 flex-col border-r border-line-light bg-surface">
      <div className="px-5 py-5">
        <Link href="/" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element -- small local brand asset */}
          <img src="/everest-logo.png" alt="Everest" className="h-9 w-auto" />
        </Link>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {departments.map((d) => (
          <Link key={d.slug} href={`/${d.slug}`} className={navClass(isActive(d.slug))}>
            {d.name}
          </Link>
        ))}
        {isSuperAdmin && (
          <Link
            href="/admin"
            className={[
              "mt-2 flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-all duration-200",
              pathname.startsWith("/admin")
                ? "bg-brand/10 font-medium text-brand"
                : "font-medium text-brand hover:bg-brand/10",
            ].join(" ")}
          >
            Admin
          </Link>
        )}
      </nav>
      <div className="flex items-center gap-2 border-t border-line-light px-4 py-3">
        <UserButton />
        <p className="truncate text-xs text-ink-tertiary">{email}</p>
      </div>
    </aside>
  );
}
