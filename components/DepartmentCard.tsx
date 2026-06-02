import Link from "next/link";

export function DepartmentCard({
  slug,
  name,
  toolCount,
}: {
  slug: string;
  name: string;
  toolCount: number;
}) {
  return (
    <Link
      href={`/${slug}`}
      className="block rounded-xl border bg-white p-6 shadow-sm transition hover:shadow-md"
    >
      <h3 className="text-base font-semibold text-gray-900">{name}</h3>
      <p className="mt-1 text-sm text-gray-500">
        {toolCount} tool{toolCount === 1 ? "" : "s"}
      </p>
    </Link>
  );
}
