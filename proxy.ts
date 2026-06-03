import { clerkMiddleware } from "@clerk/nextjs/server";

// Next.js 16: the former `middleware` convention is `proxy`. A single default
// export is permitted, which is how Clerk's middleware is wired in.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/__clerk/(.*)",
    "/(api|trpc)(.*)",
  ],
};
