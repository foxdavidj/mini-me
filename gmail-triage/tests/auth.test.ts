import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";
import { CALLBACK, GMAIL_SCOPE, hash, readConfig } from "../src/config";
import type { Config } from "../src/config";
import { googleAuth } from "../src/google";
import { Store } from "../src/store";

const origin = "https://test.example.ts.net";
const config: Config = { clientId: "test.apps.googleusercontent.com", clientSecret: "fake-secret", projectId: "test", callback: origin + CALLBACK, origin };
const key = "fake-entry-key";

describe("Gmail account connection", () => {
  let root: string;
  let store: Store;
  let handle: (request: Request) => Promise<Response>;
  let clock: number;
  let exchangeCalls: number;
  let failExchange: boolean;
  let email: string;

  const call = (path: string, cookie = "", init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has("Host")) headers.set("Host", "test.example.ts.net");
    headers.set("Cookie", cookie);
    return handle(new Request(origin + path, { ...init, headers }));
  };
  const login = async () => {
    const response = await call(`/open/${key}`);
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.status).toBe(303);
    return response.headers.get("Set-Cookie")?.split(";")[0] ?? "";
  };
  const begin = async (cookie: string) => {
    const html = await (await call("/", cookie)).text();
    const csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1];
    if (!csrf) throw new Error("Missing CSRF field");
    const response = await call("/oauth/google/start", cookie, {
      method: "POST", headers: { Origin: origin }, body: new URLSearchParams({ csrf }),
    });
    expect(response.status).toBe(303);
    return new URL(response.headers.get("Location") ?? "");
  };
  const finish = (cookie: string, state: string) => call(`${CALLBACK}?state=${state}&code=fake-code`, cookie);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mini-me-auth-"));
    store = new Store(root);
    clock = 1000;
    exchangeCalls = 0;
    failExchange = false;
    email = "one@example.com";
    const google = googleAuth(config);
    handle = createApp({ config, store, accessKey: key, css: "body {}", now: () => clock, google: {
      authorization: google.authorization,
      async exchange(_code, verifier) {
        exchangeCalls++;
        expect(verifier.length).toBeGreaterThanOrEqual(43);
        if (failExchange) throw new Error("Simulated Google failure including fake-secret-token");
        return { email, credentials: JSON.stringify({ refresh_token: "fake-refresh", access_token: "fake-access" }) };
      },
    } });
  });

  afterEach(() => { store.close(); rmSync(root, { recursive: true, force: true }); });

  test("private entry, secure cookie, trusted host, and session expiry", async () => {
    expect((await call("/")).status).toBe(403);
    expect((await call("/open/wrong")).status).toBe(403);
    expect((await call(`/open/${key}`, "", { headers: { Host: "evil.example" } })).status).toBe(400);
    const response = await call(`/open/${key}`);
    const cookieHeader = response.headers.get("Set-Cookie") ?? "";
    expect(cookieHeader).toContain("Secure; HttpOnly; SameSite=Lax; Path=/");
    const cookie = cookieHeader.split(";")[0] ?? "";
    expect((await call("/", cookie)).status).toBe(200);
    clock += 86401;
    expect((await call("/", cookie)).status).toBe(403);
  });

  test("requires matching CSRF and origin before starting OAuth", async () => {
    const cookie = await login();
    expect((await call("/oauth/google/start", cookie, { method: "POST" })).status).toBe(403);
    expect((await call("/oauth/google/start", cookie, { method: "POST", headers: { Origin: origin }, body: "csrf=wrong" })).status).toBe(403);
    expect((await call("/oauth/google/start", cookie, { method: "POST", headers: { Origin: "https://evil.example" } })).status).toBe(403);
  });

  test("real Google authorization URL uses exact callback, PKCE, and Gmail permission", async () => {
    const url = await begin(await login());
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(config.callback);
    expect(url.searchParams.get("scope")).toBe(GMAIL_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")?.length).toBeGreaterThan(20);
  });

  test("state is browser-bound and single-use, including concurrent callbacks", async () => {
    const cookie = await login();
    const other = await login();
    const state = (await begin(cookie)).searchParams.get("state") ?? "";
    await finish(other, state);
    await finish(cookie, "wrong");
    expect(exchangeCalls).toBe(0);
    await Promise.all([finish(cookie, state), finish(cookie, state)]);
    expect(exchangeCalls).toBe(1);
    expect(store.accounts()).toHaveLength(1);
  });

  test("expired requests and denied consent never exchange codes", async () => {
    const cookie = await login();
    const state = (await begin(cookie)).searchParams.get("state") ?? "";
    clock += 601;
    await finish(cookie, state);
    const state2 = (await begin(cookie)).searchParams.get("state") ?? "";
    await call(`${CALLBACK}?state=${state2}&error=access_denied`, cookie);
    await finish(cookie, state2);
    expect(exchangeCalls).toBe(0);
    expect(store.accounts()).toHaveLength(0);
  });

  test("stores accounts separately and replaces only the reconnected account", async () => {
    const cookie = await login();
    for (const address of ["one@example.com", "two@example.com", "one@example.com"]) {
      email = address;
      await finish(cookie, (await begin(cookie)).searchParams.get("state") ?? "");
    }
    expect(store.accounts().map((row) => row.email)).toEqual(["one@example.com", "two@example.com"]);
    const page = await call("/", cookie);
    const html = await page.text();
    expect(html).toContain("two@example.com");
    expect(html).not.toContain("fake-refresh");
    expect(html).not.toContain("fake-access");
    expect(page.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(page.headers.get("Cache-Control")).toBe("no-store");
    expect(statSync(root).mode & 0o777).toBe(0o700);
    expect(statSync(join(root, "gmail.sqlite")).mode & 0o777).toBe(0o600);
  });

  test("Google failure preserves saved credentials and hides exception details", async () => {
    const cookie = await login();
    await finish(cookie, (await begin(cookie)).searchParams.get("state") ?? "");
    const before = store.db.query("SELECT * FROM accounts").all();
    failExchange = true;
    await finish(cookie, (await begin(cookie)).searchParams.get("state") ?? "");
    expect(store.db.query("SELECT * FROM accounts").all()).toEqual(before);
    const html = await (await call("/", cookie)).text();
    expect(html).toContain("Couldn’t complete");
    expect(html).not.toContain("fake-secret-token");
  });

  test("SQLite persists accounts and pending OAuth across a restart", async () => {
    const token = store.newSession(clock);
    const session = store.session(token, clock);
    if (!session) throw new Error("Session missing");
    store.startAttempt(session.id, "state", "verifier", clock);
    store.connect({ email: "one@example.com", credentials: "{}" }, clock);
    expect(session.id).toBe(hash(token));
    store.close();
    store = new Store(root);
    expect(store.session(token, clock)).not.toBeNull();
    expect(store.takeAttempt(session.id, "state", clock)).toBe("verifier");
    expect(store.accounts()).toHaveLength(1);
  });

  test("HTML escapes mailbox data and does not allow script injection", async () => {
    store.connect({ email: '<script>alert("test")</script>@example.com', credentials: "{}" }, clock);
    const html = await (await call("/", await login())).text();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("runtime validation rejects wrong client types, endpoints, and callback hosts", () => {
    const path = join(root, "client.json");
    const valid = { web: { client_id: config.clientId, client_secret: config.clientSecret, project_id: config.projectId,
      auth_uri: "https://accounts.google.com/o/oauth2/auth", token_uri: "https://oauth2.googleapis.com/token", redirect_uris: [config.callback] } };
    writeFileSync(path, JSON.stringify(valid));
    expect(readConfig(path)).toEqual(config);
    for (const invalid of [{ installed: valid.web }, { web: { ...valid.web, token_uri: "https://evil.example" } }, { web: { ...valid.web, redirect_uris: ["http://localhost" + CALLBACK] } }]) {
      writeFileSync(path, JSON.stringify(invalid));
      expect(() => readConfig(path)).toThrow();
    }
    expect(readFileSync(path, "utf8")).not.toBeEmpty();
  });
});
