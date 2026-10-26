/**
 * Which API base URL wins, as a pure function.
 *
 * Kept apart from `./config` for the reason `./chunked-store` is kept apart
 * from `./secure-store`: config imports `react-native` and `expo-constants`,
 * which a node test runner cannot load, and the precedence rule is the part
 * with a decision in it.
 *
 * Most specific first: the override typed in the You screen, then the URL
 * baked into the bundle, then — on the web only — the origin the page was
 * served from. That last layer is what lets one web export work on
 * production, on every Vercel preview and on `next start` locally: the client
 * and the API are the same Next deployment, so same-origin is always right and
 * there is no CORS to configure. Native never gets it, because a phone has no
 * origin and `localhost` there is the phone itself.
 */
export function resolveApiBase(input: {
  override: string | null;
  bundled: string;
  webOrigin: string | null;
}): string {
  if (input.override) return input.override;
  if (input.bundled) return input.bundled;
  return input.webOrigin ?? "";
}

/**
 * The page's origin, when there is a usable one.
 *
 * Only on the web, and only http(s): a page opened from `file://` reports the
 * origin as the string "null", which as an API base would turn every request
 * into a fetch of "null/api/…". No origin is better than that — the app then
 * says the API is not configured instead of failing opaquely.
 */
export function webOriginFor(platform: string, location: { origin?: string } | undefined): string | null {
  if (platform !== "web") return null;
  const origin = location?.origin;
  if (!origin || !/^https?:\/\//.test(origin)) return null;
  return origin.replace(/\/+$/, "");
}
