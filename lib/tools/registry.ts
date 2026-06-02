import type { ToolDef } from "./types";

export const TOOLS: ToolDef[] = [
  {
    slug: "scrap-scale",
    name: "Scrap Scale",
    description: "Reconcile payment screenshots against Total Fund Collection.",
    departmentSlug: "accounting",
    icon: "Scale",
    route: "/accounting/scrap-scale",
    requiredRole: "member",
  },
];
