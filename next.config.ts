import type { NextConfig } from "next";

const config: NextConfig = {
  typedRoutes: true,
  async headers() {
    return [
      {
        // Served no-cache so a browser re-checks the worker on every visit.
        // That is how installs of the old shell-caching worker get replaced by
        // the one that deletes those caches (see mobile/public/sw.js).
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // The Expo export's bundles and assets carry a content hash in their
        // file names, so a given URL never changes content and can be cached
        // forever. index.html, which names them, keeps Next's default
        // revalidate-every-time header — that is what makes a deploy visible.
        source: "/_expo/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/assets/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
  async redirects() {
    return [
      // The old web app's sign-in page. Bookmarks and any reset or magic-link
      // email still in someone's inbox point here; the client's is /sign-in.
      { source: "/login", destination: "/sign-in", permanent: false },
    ];
  },
  async rewrites() {
    return {
      /**
       * The client is the Expo web export in public/ (scripts/build-client.mjs),
       * built with `output: "single"` — one index.html, with routing done in
       * the browser by Expo Router. So every path that is not an API route,
       * one of the two pages Next still renders (/reset-password, the
       * /auth/callback route) or a real file in public/ has to be answered
       * with that index.html, or a reload on /you or a link to /workout?id=…
       * is a 404.
       *
       * `fallback` is what makes that safe: fallback rewrites are consulted
       * only after every filesystem route and public file has failed to
       * match, so this can never shadow an API route. An unknown /api/ path
       * is excluded explicitly so it stays a 404 rather than becoming a
       * 200 of HTML, which a client parsing JSON would report as a baffling
       * syntax error.
       */
      fallback: [{ source: "/:path((?!api/).*)", destination: "/index.html" }],
    };
  },
};

export default config;
