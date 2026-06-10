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
  {
    slug: "invoice-zoho",
    name: "Invoice → Zoho Bills",
    description: "OCR invoice emails into the Zoho purchase-bill template (Excel export).",
    departmentSlug: "accounting",
    icon: "ReceiptText",
    route: "/accounting/invoice-zoho",
    requiredRole: "member",
  },
];
