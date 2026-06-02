import { requireDepartmentAccess } from "@/lib/auth/guards";
import { toolsForDepartment } from "@/lib/auth/access";
import { TOOLS } from "@/lib/tools/registry";
import { ToolCard } from "@/components/ToolCard";

export default async function DepartmentPage({
  params,
}: {
  params: Promise<{ department: string }>;
}) {
  const { department } = await params;
  const { role, department: dept } = await requireDepartmentAccess(department);
  const isSuper = role === "super";
  const tools = toolsForDepartment(TOOLS, department, isSuper ? null : role, isSuper);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">{dept.name}</h1>
      {tools.length === 0 ? (
        <p className="text-sm text-gray-500">No tools available in this department yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((t) => (
            <ToolCard key={t.slug} name={t.name} description={t.description} route={t.route} />
          ))}
        </div>
      )}
    </div>
  );
}
