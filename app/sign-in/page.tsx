"use client";
import { useActionState } from "react";
import { signIn } from "./actions";

export default function SignInPage() {
  const [state, action, pending] = useActionState(
    signIn,
    null as { error: string } | null,
  );
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <form
        action={action}
        className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-8 shadow-sm"
      >
        <h1 className="text-xl font-semibold text-gray-900">Everest Internal Tools</h1>
        <input
          name="email"
          type="email"
          required
          placeholder="Email"
          className="w-full rounded-md border px-3 py-2 text-sm text-gray-900"
        />
        <input
          name="password"
          type="password"
          required
          placeholder="Password"
          className="w-full rounded-md border px-3 py-2 text-sm text-gray-900"
        />
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-xs text-gray-500">Accounts are created by an administrator.</p>
      </form>
    </main>
  );
}
