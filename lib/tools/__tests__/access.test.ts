import { describe, it, expect } from "vitest";
import { filterDepartmentsForUser, toolsForDepartment } from "../../auth/access";
import type { DepartmentRow, Membership, ToolDef } from "../types";

const depts: DepartmentRow[] = [
  { id: "1", slug: "accounting", name: "Accounting", icon: "Calculator" },
  { id: "2", slug: "marketing", name: "Marketing", icon: "Megaphone" },
];
const tools: ToolDef[] = [
  { slug: "scrap-scale", name: "Scrap Scale", description: "", departmentSlug: "accounting", icon: "Scale", route: "/accounting/scrap-scale", requiredRole: "member" },
  { slug: "admin-only", name: "Admin Only", description: "", departmentSlug: "accounting", icon: "Lock", route: "/accounting/admin-only", requiredRole: "admin" },
];

describe("filterDepartmentsForUser", () => {
  it("super_admin sees all departments", () => {
    expect(filterDepartmentsForUser(depts, [], true).map((d) => d.slug)).toEqual(["accounting", "marketing"]);
  });
  it("member sees only their departments", () => {
    const m: Membership[] = [{ department_id: "1", department_slug: "accounting", role: "member" }];
    expect(filterDepartmentsForUser(depts, m, false).map((d) => d.slug)).toEqual(["accounting"]);
  });
});

describe("toolsForDepartment", () => {
  it("member sees only member-level tools", () => {
    const result = toolsForDepartment(tools, "accounting", "member", false);
    expect(result.map((t) => t.slug)).toEqual(["scrap-scale"]);
  });
  it("dept admin sees admin tools too", () => {
    const result = toolsForDepartment(tools, "accounting", "admin", false);
    expect(result.map((t) => t.slug)).toEqual(["scrap-scale", "admin-only"]);
  });
  it("super_admin sees all tools regardless of role", () => {
    const result = toolsForDepartment(tools, "accounting", null, true);
    expect(result.map((t) => t.slug)).toEqual(["scrap-scale", "admin-only"]);
  });
});
