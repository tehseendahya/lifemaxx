import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { corsAllowlist, corsHeaders, corsHeadersFor, preflight } from "./cors";

const EXPO_WEB = "http://localhost:8081";

beforeEach(() => { delete process.env.MOBILE_CORS_ORIGINS; });
afterEach(() => { delete process.env.MOBILE_CORS_ORIGINS; });

const withOrigin = (origin: string) =>
  new Request("http://localhost:3000/api/mobile/bootstrap", { headers: { origin } });

describe("corsAllowlist", () => {
  it("is empty when the variable is unset", () => {
    expect(corsAllowlist()).toEqual([]);
  });

  it("splits on commas and trims", () => {
    process.env.MOBILE_CORS_ORIGINS = ` ${EXPO_WEB} , http://192.168.1.4:8081 ,`;
    expect(corsAllowlist()).toEqual([EXPO_WEB, "http://192.168.1.4:8081"]);
  });
});

describe("corsHeaders", () => {
  it("emits nothing when the allowlist is empty", () => {
    expect(corsHeaders(EXPO_WEB)).toEqual({});
  });

  it("emits nothing for an origin that is not on the list", () => {
    process.env.MOBILE_CORS_ORIGINS = EXPO_WEB;
    expect(corsHeaders("https://evil.example")).toEqual({});
  });

  it("emits nothing when there is no Origin header", () => {
    process.env.MOBILE_CORS_ORIGINS = EXPO_WEB;
    expect(corsHeaders(null)).toEqual({});
  });

  it("echoes the exact allowlisted origin, and varies on it", () => {
    process.env.MOBILE_CORS_ORIGINS = `https://other.example,${EXPO_WEB}`;
    const headers = corsHeaders(EXPO_WEB);

    expect(headers["Access-Control-Allow-Origin"]).toBe(EXPO_WEB);
    expect(headers["Vary"]).toBe("Origin");
    expect(headers["Access-Control-Allow-Headers"]).toBe("authorization, content-type");
    expect(headers["Access-Control-Allow-Methods"]).toBe("GET, POST, DELETE, OPTIONS");
  });

  it("is never a wildcard, and never grants credentials", () => {
    process.env.MOBILE_CORS_ORIGINS = EXPO_WEB;
    const headers = corsHeaders(EXPO_WEB);

    expect(headers["Access-Control-Allow-Origin"]).not.toBe("*");
    expect(headers).not.toHaveProperty("Access-Control-Allow-Credentials");
  });

  it("does not treat a prefix as a match", () => {
    process.env.MOBILE_CORS_ORIGINS = EXPO_WEB;
    expect(corsHeaders("http://localhost:8081.evil.example")).toEqual({});
    expect(corsHeaders("http://localhost:808")).toEqual({});
  });

  it("corsHeadersFor reads the request's Origin", () => {
    process.env.MOBILE_CORS_ORIGINS = EXPO_WEB;
    expect(corsHeadersFor(withOrigin(EXPO_WEB))["Access-Control-Allow-Origin"]).toBe(EXPO_WEB);
    expect(corsHeadersFor(withOrigin("https://evil.example"))).toEqual({});
  });
});

describe("preflight", () => {
  it("answers 204 with the headers for an allowlisted origin", () => {
    process.env.MOBILE_CORS_ORIGINS = EXPO_WEB;
    const res = preflight(withOrigin(EXPO_WEB));

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(EXPO_WEB);
    expect(res.headers.get("access-control-max-age")).toBe("600");
  });

  it("answers 204 with no headers otherwise — the browser blocks it, not us", () => {
    const res = preflight(withOrigin(EXPO_WEB));

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-max-age")).toBeNull();
  });
});
