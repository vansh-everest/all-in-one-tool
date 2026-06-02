import { notFound } from "next/navigation";
import { requireDepartmentAccess } from "@/lib/auth/guards";
import { toolsForDepartment } from "@/lib/auth/access";
import { TOOLS } from "@/lib/tools/registry";

export default async function ToolPage({
  params,
}: {
  params: Promise<{ department: string; tool: string }>;
}) {
  const { department, tool } = await params;
  const { role } = await requireDepartmentAccess(department);
  const isSuper = role === "super";
  const allowed = toolsForDepartment(TOOLS, department, isSuper ? null : role, isSuper);
  const def = allowed.find((t) => t.slug === tool);
  if (!def) notFound();

  // v1: the only tool is Scrap Scale, rendered as a stub.
  // Real tool components are added per-tool in later prompts.
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold text-gray-900">{def.name}</h1>
      <p className="mb-6 text-sm text-gray-500">{def.description}</p>
      <div className="rounded-xl border border-dashed bg-white p-12 text-center text-gray-400">
        Coming soon.
      </div>
    </div>
  );
}
