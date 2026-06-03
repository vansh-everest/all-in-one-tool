import { SignOutButton } from "@clerk/nextjs";

export default function NotAllowed() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="rounded-xl border bg-white p-8 text-center">
        <h1 className="mb-2 text-lg font-semibold text-gray-900">Access restricted</h1>
        <p className="mb-4 text-sm text-gray-600">
          Sign in with an @everestfleet.in or @everestfleet.com Google account.
        </p>
        <SignOutButton>
          <button className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white">Sign out</button>
        </SignOutButton>
      </div>
    </div>
  );
}
