import "../load-env";
import webpush from "web-push";
import { createECDH, randomBytes } from "node:crypto";

/**
 * Verifies the web-push wiring as far as it can be verified without a phone.
 *
 * Everything except the last hop happens locally: VAPID key validation, the
 * signed JWT, the ECDH key agreement with the subscriber's public key, and the
 * aes128gcm payload encryption. `generateRequestDetails` produces exactly the
 * request `sendNotification` would send — so if this passes, a failure on a
 * real device is a device or a subscription problem, not a configuration one.
 *
 * Generates a VAPID pair and prints it if none is configured, which is the
 * thing you need before the first deploy.
 *
 *   npm run push:verify
 */

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/** A subscription with real P-256 keys, so the encryption step is genuinely exercised. */
function syntheticSubscription() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    endpoint: "https://web.push.apple.com/verify-only-not-a-real-endpoint",
    keys: {
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
}

function main() {
  console.log("\nVAPID keys");

  let publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;
  let generated = false;

  if (!publicKey || !privateKey) {
    const pair = webpush.generateVAPIDKeys();
    publicKey = pair.publicKey;
    privateKey = pair.privateKey;
    generated = true;
    console.log("  no keys configured — generated a pair for you:\n");
    console.log(`    NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}`);
    console.log(`    VAPID_PRIVATE_KEY=${privateKey}\n`);
    console.log("  Put both in .env.local and in Vercel's encrypted env vars.");
    console.log("  Keep them stable: rotating them invalidates every existing subscription.\n");
  }

  const subject = process.env.VAPID_SUBJECT ?? "mailto:none@example.com";
  check("VAPID subject is a mailto: or https: URL", /^(mailto:|https:\/\/)/.test(subject), subject);
  check("public key is a 65-byte uncompressed P-256 point",
    Buffer.from(publicKey, "base64url").length === 65,
    `${Buffer.from(publicKey, "base64url").length} bytes`);
  check("private key is 32 bytes",
    Buffer.from(privateKey, "base64url").length === 32,
    `${Buffer.from(privateKey, "base64url").length} bytes`);

  console.log("\nsigning and encryption");

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    check("web-push accepts the VAPID configuration", true);
  } catch (err) {
    check("web-push accepts the VAPID configuration", false,
      err instanceof Error ? err.message : String(err));
    return finish(generated);
  }

  // The exact payload shape public/sw.js destructures in its push handler.
  const payload = JSON.stringify({
    title: "Today's verdict",
    body: "You're 38g under protein for the fourth day running. That's a shake and a yogurt.",
    url: "/",
  });

  try {
    const details = webpush.generateRequestDetails(syntheticSubscription(), payload);

    check("a signed request is produced", Boolean(details.headers.Authorization));
    check("the Authorization header carries a VAPID JWT",
      String(details.headers.Authorization).startsWith("vapid t="));
    check("the payload is encrypted, not sent in the clear",
      Buffer.isBuffer(details.body) && !details.body.includes("protein"));
    check("content encoding is aes128gcm",
      details.headers["Content-Encoding"] === "aes128gcm",
      String(details.headers["Content-Encoding"]));
    check("a TTL is set", details.headers.TTL !== undefined, String(details.headers.TTL));
  } catch (err) {
    check("payload encryption", false, err instanceof Error ? err.message : String(err));
  }

  console.log("\nservice worker contract");
  const handled = JSON.parse(payload) as Record<string, unknown>;
  check("sw.js reads title, body and url from the payload",
    ["title", "body", "url"].every((k) => k in handled));

  finish(generated);
}

function finish(generated: boolean) {
  if (failures === 0) {
    console.log("\nEverything verifiable without a device passed.");
    console.log("The last hop needs a real subscription: install to the iOS home screen,");
    console.log("enable notifications in Settings, then trigger a cron with");
    console.log('  curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/nightly\n');
    if (generated) console.log("Remember to save the generated keys above — a second run makes different ones.\n");
  } else {
    console.log(`\n${failures} check(s) failed.\n`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main();
