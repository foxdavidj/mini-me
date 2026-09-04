import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createApp } from "../src/app";
import type { Config } from "../src/config";
import { Store } from "../src/store";

test("a real browser form starts OAuth without losing its Origin or leaking the private entry URL", async () => {
  const root = mkdtempSync(join(tmpdir(), "mini-me-browser-"));
  const store = new Store(root);
  const cert = join(root, "test-cert.pem");
  const key = join(root, "test-key.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
  let handler: (request: Request) => Promise<Response> = async () => new Response("Starting", { status: 503 });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, tls: { cert: Bun.file(cert), key: Bun.file(key) }, fetch: (request) => handler(request) });
  const origin = `https://127.0.0.1:${server.port}`;
  const config: Config = { clientId: "test.apps.googleusercontent.com", clientSecret: "fake-secret", projectId: "test", callback: origin + "/oauth/google/callback", origin };
  const app = createApp({ config, store, accessKey: "private-test-key", css: "body {}", google: {
    async authorization() { return { url: `${origin}/google-test`, verifier: "test-verifier" }; },
    async exchange() { throw new Error("Consent is not part of this browser test"); },
  } });
  const observed: { postOrigin?: string; destinationReferer?: string | null } = {};
  handler = async (request) => {
    if (new URL(request.url).pathname === "/google-test") {
      observed.destinationReferer = request.headers.get("Referer");
      return new Response("<h1>Sign-in destination reached</h1>", { headers: { "Content-Type": "text/html" } });
    }
    if (request.method === "POST") observed.postOrigin = request.headers.get("Origin") ?? "";
    return app(request);
  };
  const browser = await chromium.launch();
  try {
    // A real HTTPS listener exercises cookies and native form submission. Only the
    // OAuth destination is a stub; no requests go to Google and no consent occurs.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(`${origin}/open/private-test-key`);
    const post = page.waitForResponse((response) => response.request().method() === "POST");
    await page.getByRole("button", { name: "Connect a Google account" }).click();
    const response = await post;
    expect(observed.postOrigin).toBe(origin);
    expect(response.status()).toBe(303);
    await page.waitForURL(`${origin}/google-test`);
    expect(await page.locator("h1").textContent()).toBe("Sign-in destination reached");
    expect(observed.destinationReferer).toBeNull();
    expect(store.accounts()).toHaveLength(0);
  } finally {
    await browser.close();
    await server.stop(true);
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
