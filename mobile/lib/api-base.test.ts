import { describe, expect, it } from "vitest";
import { resolveApiBase, webOriginFor } from "./api-base";

describe("resolveApiBase", () => {
  const origin = "https://lifemaxx.vercel.app";

  it("prefers the You-screen override over everything", () => {
    expect(resolveApiBase({ override: "http://192.168.1.5:3000", bundled: "https://b", webOrigin: origin }))
      .toBe("http://192.168.1.5:3000");
  });

  it("uses the bundled URL over the page origin", () => {
    expect(resolveApiBase({ override: null, bundled: "https://b", webOrigin: origin })).toBe("https://b");
  });

  it("falls back to the page origin when nothing is configured", () => {
    expect(resolveApiBase({ override: null, bundled: "", webOrigin: origin })).toBe(origin);
  });

  it("is empty with nothing configured and no origin (native)", () => {
    expect(resolveApiBase({ override: null, bundled: "", webOrigin: null })).toBe("");
  });
});

describe("webOriginFor", () => {
  it("returns the origin on web", () => {
    expect(webOriginFor("web", { origin: "http://localhost:3000" })).toBe("http://localhost:3000");
  });

  it("never applies on native, whatever a polyfilled location says", () => {
    expect(webOriginFor("ios", { origin: "http://localhost:8081" })).toBeNull();
    expect(webOriginFor("android", { origin: "http://localhost:8081" })).toBeNull();
  });

  it("rejects the opaque 'null' origin of a file:// page", () => {
    expect(webOriginFor("web", { origin: "null" })).toBeNull();
  });

  it("is null with no location at all (static rendering)", () => {
    expect(webOriginFor("web", undefined)).toBeNull();
    expect(webOriginFor("web", {})).toBeNull();
  });
});
