/**
 * Email and password. The gate in `app/_layout.tsx` owns the navigation on
 * success, reacting to the auth state change — this screen deliberately does
 * not navigate, so there is only ever one thing pushing.
 *
 * Two sign-in screens were written in parallel (one here, one in
 * `features/settings`). This is the surviving one: it is built on the design
 * system rather than on raw `shell-theme` values, it creates the `profiles` row
 * on first sign-in, and it carries the same `ConnectionCard` as the You screen
 * — which matters here most, because a wrong API base URL and a wrong password
 * fail identically from the outside.
 */
export { SignInScreen as default } from "@/features/settings";
