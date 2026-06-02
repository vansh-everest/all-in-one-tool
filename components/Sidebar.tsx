import Link from "next/link";
import { signOut } from "@/app/account/actions";
import type { DepartmentRow } from "@/lib/tools/types";

export function Sidebar({
  departments,
  email,
  isSuperAdmin,
}: {
  departments: DepartmentRow[];
  email: string;
  isSuperAdmin: boolean;
}) {
  return (
    <aside className="flex w-60 flex-col border-r bg-white">
      <div className="border-b px-5 py-4">
        <Link href="/" className="text-sm font-semibold text-gray-900">
          Everest Tools
        </Link>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {departments.map((d) => (
          <Link
            key={d.slug}
            href={`/${d.slug}`}
            className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            {d.name}
          </Link>
        ))}
        {isSuperAdmin && (
          <Link
            href="/admin"
            className="mt-2 block rounded-md px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
          >
            Admin
          </Link>
        )}
      </nav>
      <div className="border-t px-3 py-3">
        <p className="truncate px-2 text-xs text-gray-500">{email}</p>
        <form action={signOut}>
          <button className="mt-1 w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
