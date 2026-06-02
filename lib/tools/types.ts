export type Role = "admin" | "member";

export type ToolDef = {
  slug: string;
  name: string;
  description: string;
  departmentSlug: string;
  icon: string; // lucide icon name
  route: string;
  requiredRole?: Role; // default 'member'
};

export type DepartmentRow = {
  id: string;
  slug: string;
  name: string;
  icon: string;
};

export type Membership = {
  department_id: string;
  department_slug: string;
  role: Role;
};
