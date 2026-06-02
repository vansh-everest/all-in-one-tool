import Link from "next/link";

export function ToolCard({
  name,
  description,
  route,
}: {
  name: string;
  description: string;
  route: string;
}) {
  return (
    <Link
      href={route}
      className="block rounded-xl border bg-white p-6 shadow-sm transition hover:shadow-md"
    >
      <h3 className="text-base font-semibold text-gray-900">{name}</h3>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
    </Link>
  );
}
