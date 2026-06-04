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
  {
    slug: "lender-followup",
    name: "Lender Follow-up Tracker",
    description: "Track open pending items per lender from unread Gmail (read-only).",
    departmentSlug: "finance",
    icon: "Landmark",
    route: "/finance/lender-followup",
    requiredRole: "member",
  },
];
