"use client";
import { setMembership } from "@/app/(app)/admin/actions";

type Profile = {
  clerk_user_id: string;
  email: string;
  full_name: string | null;
  is_super_admin: boolean;
};
type Dept = { id: string; slug: string; name: string };
type Mem = { profile_id: string; department_id: string; role: string };

export function AdminUserManager({
  profiles,
  departments,
  memberships,
}: {
  profiles: Profile[];
  departments: Dept[];
  memberships: Mem[];
}) {
  const roleFor = (pid: string, did: string) =>
    memberships.find((m) => m.profile_id === pid && m.department_id === did)?.role ?? "none";

  return (
    <div className="space-y-8">
      <section className="rounded-xl border bg-white p-6">
        <h2 className="mb-2 text-lg font-medium text-gray-900">Users &amp; access</h2>
        <p className="mb-4 text-sm text-gray-500">
          Staff sign in with their @everestfleet.in / @everestfleet.com Google account and appear here
          automatically. Assign each person a role per department below.
        </p>
        {profiles.length === 0 && (
          <p className="text-sm text-gray-400">No users yet — they appear after their first sign-in.</p>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="px-2 py-2">User</th>
                {departments.map((d) => (
                  <th key={d.id} className="px-2 py-2">
                    {d.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.clerk_user_id} className="border-t">
                  <td className="px-2 py-2 text-gray-900">
                    {p.email}
                    {p.is_super_admin && (
                      <span className="ml-1 text-xs text-indigo-600">(super)</span>
                    )}
                  </td>
                  {departments.map((d) => (
                    <td key={d.id} className="px-2 py-2">
                      <form action={setMembership}>
                        <input type="hidden" name="profile_id" value={p.clerk_user_id} />
                        <input type="hidden" name="department_id" value={d.id} />
                        <select
                          name="role"
                          defaultValue={roleFor(p.clerk_user_id, d.id)}
                          onChange={(e) => e.currentTarget.form?.requestSubmit()}
                          className="rounded border px-2 py-1 text-xs text-gray-900"
                        >
                          <option value="none">—</option>
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                        </select>
                      </form>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
