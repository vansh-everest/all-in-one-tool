"use client";
import { useActionState } from "react";
import { createUser, setMembership } from "@/app/(app)/admin/actions";

type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  is_super_admin: boolean;
};
type Dept = { id: string; slug: string; name: string };
type Mem = { profile_id: string; department_id: string; role: string };

type CreateState = { error?: string; ok?: boolean; tempPassword?: string; email?: string } | null;

export function AdminUserManager({
  profiles,
  departments,
  memberships,
}: {
  profiles: Profile[];
  departments: Dept[];
  memberships: Mem[];
}) {
  const [createState, createAction, creating] = useActionState<CreateState, FormData>(
    createUser,
    null,
  );

  const roleFor = (pid: string, did: string) =>
    memberships.find((m) => m.profile_id === pid && m.department_id === did)?.role ?? "none";

  return (
    <div className="space-y-8">
      <section className="rounded-xl border bg-white p-6">
        <h2 className="mb-4 text-lg font-medium text-gray-900">Add user</h2>
        <form action={createAction} className="flex flex-wrap items-end gap-3">
          <input
            name="email"
            type="email"
            required
            placeholder="email@everestfleet.in"
            className="rounded-md border px-3 py-2 text-sm text-gray-900"
          />
          <input
            name="full_name"
            placeholder="Full name"
            className="rounded-md border px-3 py-2 text-sm text-gray-900"
          />
          <button
            disabled={creating}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create user"}
          </button>
        </form>
        {createState?.error && <p className="mt-2 text-sm text-red-600">{createState.error}</p>}
        {createState?.ok && (
          <p className="mt-2 rounded bg-green-50 p-3 text-sm text-green-800">
            Created <b>{createState.email}</b>. Temp password:{" "}
            <code className="font-mono">{createState.tempPassword}</code> — share it once; the user
            should change it after signing in.
          </p>
        )}
      </section>

      <section className="rounded-xl border bg-white p-6">
        <h2 className="mb-4 text-lg font-medium text-gray-900">Memberships</h2>
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
                <tr key={p.id} className="border-t">
                  <td className="px-2 py-2 text-gray-900">
                    {p.email}
                    {p.is_super_admin && (
                      <span className="ml-1 text-xs text-indigo-600">(super)</span>
                    )}
                  </td>
                  {departments.map((d) => (
                    <td key={d.id} className="px-2 py-2">
                      <form action={setMembership}>
                        <input type="hidden" name="profile_id" value={p.id} />
                        <input type="hidden" name="department_id" value={d.id} />
                        <select
                          name="role"
                          defaultValue={roleFor(p.id, d.id)}
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
