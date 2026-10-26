#!/usr/bin/env node
/**
 * Everything `npm run build` does before `next build`.
 *
 * The UI is the Expo app in mobile/, on the phone and in the browser alike;
 * Next is the API plus the two auth pages a password-reset email depends on.
 * So a deploy has to produce the Expo web export and hand it to Next as static
 * files, and this script is that hand-off:
 *
 *   1. Install mobile/'s own dependency tree, unless it is already installed
 *      from the current lockfile. It is a separate npm project on purpose
 *      (React Native and Next need different Reacts; see mobile/README.md),
 *      so Vercel's root `npm install` never touches it.
 *   2. `expo export --platform web` into a temp dir, with the Supabase and
 *      VAPID values mapped across from the names the server already uses.
 *   3. Replace root public/ with the export. public/ is therefore entirely
 *      generated and gitignored; the hand-written files that used to live
 *      there (manifest, icons, sw.js) are in mobile/public/, which Expo copies
 *      into the export, and mobile/public/index.html is the HTML template.
 *   4. Production only: apply database migrations (see `migrate()` for why
 *      here, and why never on a preview).
 *
 * Plain .mjs with no dependencies beyond Node itself and dotenv, so it runs
 * before anything is compiled and cannot be broken by the app's own types.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseDotenv } from "dotenv";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mobileRoot = join(repoRoot, "mobile");
const publicDir = join(repoRoot, "public");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function log(message) {
  console.log(`[build-client] ${message}`);
}

function run(cmd, args, options = {}) {
  execFileSync(cmd, args, { stdio: "inherit", ...options });
}

// ------------------------------------------------------------------ migrate

/**
 * `npm run db:migrate`, on production builds and nothing else.
 *
 * Production once shipped code that read `exercise_cues` before anyone had
 * run the migration creating it. Migrating as part of the production build
 * closes that gap; the migrator is idempotent, so a build with nothing new to
 * apply is a no-op.
 *
 * Never on a preview: every environment shares the production database, so a
 * preview build of an unmerged branch would land that branch's migration in
 * production before review. Never locally either. VERCEL_ENV is read from the
 * real process environment only — nothing in this script loads .env files
 * into process.env — so a `vercel env pull`ed .env.local cannot turn a laptop
 * build into a production migration.
 */
function migrate() {
  if (process.env.VERCEL_ENV !== "production") {
    log(`Skipping database migrations (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}; they run on production builds only).`);
    return;
  }
  log("VERCEL_ENV=production — applying database migrations (npm run db:migrate).");
  run(npm, ["run", "db:migrate"], { cwd: repoRoot });
}

// ------------------------------------------------------------------ install

/**
 * Whether mobile/node_modules already matches mobile/package-lock.json.
 *
 * npm keeps a copy of what it installed in node_modules/.package-lock.json.
 * Every package the lockfile names must be there at the same version; if so,
 * `npm ci` would delete and re-download an identical tree, which is slow
 * locally and pointless. Anything missing, mismatched or unreadable means
 * install.
 */
function mobileInstallIsCurrent() {
  try {
    const wanted = JSON.parse(readFileSync(join(mobileRoot, "package-lock.json"), "utf8")).packages ?? {};
    const have = JSON.parse(readFileSync(join(mobileRoot, "node_modules", ".package-lock.json"), "utf8")).packages ?? {};
    for (const [path, entry] of Object.entries(wanted)) {
      if (path === "") continue; // the project itself
      // Optional packages for another OS/CPU are in the lockfile and rightly
      // absent from this machine's tree.
      if (entry.optional && !have[path]) continue;
      if (have[path]?.version !== entry.version) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function installMobile() {
  if (mobileInstallIsCurrent()) {
    log("mobile/node_modules matches mobile/package-lock.json — skipping npm ci.");
    return;
  }
  log("Installing mobile/ dependencies (npm ci --prefix mobile).");
  run(npm, ["ci", "--prefix", mobileRoot, "--no-audit", "--no-fund"], { cwd: repoRoot });
}

// ------------------------------------------------------------------ env

/**
 * The client's build-time env, derived from the server's.
 *
 * Vercel already holds NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY and
 * NEXT_PUBLIC_VAPID_PUBLIC_KEY; making the owner duplicate each one under an
 * EXPO_PUBLIC_ name would be two copies of a value that must never differ (the
 * client and the API have to be on the same Supabase project). So the server
 * names are mapped across unless an EXPO_PUBLIC_ one is already set.
 *
 * Locally those values live in root .env.local, which `next build` reads but
 * this process does not. Only the three public keys are taken from it, and
 * only into the child's env — never DATABASE_URL or any secret, and never into
 * this process.
 *
 * EXPO_PUBLIC_API_BASE_URL is forced empty: the web build talks to the origin
 * it was served from (`apiBaseUrl()` in mobile/lib/config.ts), which is what
 * makes previews hit their own API and keeps CORS out of production. A LAN URL
 * left in mobile/.env for phone development must not leak into a deploy.
 */
function clientEnv() {
  const fromFiles = {};
  for (const file of [".env", ".env.local"]) {
    const path = join(repoRoot, file);
    if (existsSync(path)) Object.assign(fromFiles, parseDotenv(readFileSync(path)));
  }
  const server = (key) => process.env[key] || fromFiles[key] || "";

  const env = { ...process.env, EXPO_PUBLIC_API_BASE_URL: "" };
  const mapping = {
    EXPO_PUBLIC_SUPABASE_URL: "NEXT_PUBLIC_SUPABASE_URL",
    EXPO_PUBLIC_SUPABASE_ANON_KEY: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    EXPO_PUBLIC_VAPID_PUBLIC_KEY: "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  };
  for (const [expoKey, serverKey] of Object.entries(mapping)) {
    if (env[expoKey]) {
      log(`${expoKey} is set explicitly.`);
    } else if (server(serverKey)) {
      env[expoKey] = server(serverKey);
      log(`${expoKey} <- ${serverKey}`);
    } else {
      // Not fatal: the app shows "not configured" rather than failing, and a
      // missing VAPID key only hides the notifications offer. But it is worth
      // a loud line in the build log.
      log(`WARNING: neither ${expoKey} nor ${serverKey} is set; the web client will be built without it.`);
    }
  }
  return env;
}

// ------------------------------------------------------------------ export

function exportWeb() {
  const outDir = mkdtempSync(join(tmpdir(), "lifemaxx-web-"));
  try {
    log(`Exporting the Expo web build to ${outDir}.`);
    run(npx, ["expo", "export", "--platform", "web", "--output-dir", outDir], {
      cwd: mobileRoot,
      env: clientEnv(),
    });

    if (!existsSync(join(outDir, "index.html"))) {
      throw new Error("expo export produced no index.html — refusing to replace public/.");
    }

    rmSync(publicDir, { recursive: true, force: true });
    cpSync(outDir, publicDir, {
      recursive: true,
      // EAS Update's manifest for the export; meaningless on a web host.
      filter: (src) => src !== join(outDir, "metadata.json"),
    });
    log("public/ now holds the web client.");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

installMobile();
exportWeb();
// Last, so a client build that fails never leaves a migration applied for a
// deploy that will not happen. Still before `next build`, which follows this
// script in package.json.
migrate();
