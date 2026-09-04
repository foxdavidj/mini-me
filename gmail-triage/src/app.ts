import { CALLBACK, equal, secret } from "./config";
import type { Config } from "./config";
import type { GoogleAuth } from "./google";
import { page } from "./page";
import type { Store, Session } from "./store";

export type AppOptions = {
  config: Config; store: Store; google: GoogleAuth; accessKey: string; css: string;
  now?: () => number;
  dashboard?: (request: Request, session: Session) => Promise<Response>;
};

const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'self'; style-src 'self'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'",
};

export function createApp(options: AppOptions): (request: Request) => Promise<Response> {
  const { config, store, google, accessKey, css } = options;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const respond = (body: string, status = 200, extra: HeadersInit = {}) => {
    const responseHeaders = new Headers(headers);
    new Headers(extra).forEach((value, key) => responseHeaders.set(key, value));
    return new Response(body, { status, headers: responseHeaders });
  };
  const redirect = (location: string, extra: HeadersInit = {}) => respond("", 303, { ...Object.fromEntries(new Headers(extra)), Location: location });

  return async (request) => {
    try {
      const url = new URL(request.url);
      if (request.headers.get("Host") !== new URL(config.origin).host) return respond("Invalid host", 400);
      if (request.method === "GET" && url.pathname === "/static/style.css") return respond(css, 200, { "Content-Type": "text/css; charset=utf-8" });
      if (request.method === "GET" && url.pathname.startsWith("/open/")) {
        if (!equal(url.pathname.slice("/open/".length), accessKey)) return respond("Forbidden", 403);
        const token = store.newSession(now());
        return redirect("/", { "Set-Cookie": `__Host-mini-me=${token}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400` });
      }
      const token = request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("__Host-mini-me="))?.slice("__Host-mini-me=".length) ?? "";
      const session = store.session(token, now());
      if (!session) return respond("Open the private connection link provided in your chat.", 403);
      if (request.method === "GET" && (url.pathname === "/accounts" || (url.pathname === "/" && !options.dashboard))) {
        const html = page(store.accounts(), session.csrf, session.message);
        store.message(session.id, null);
        // no-referrer turns a native form POST's Origin into "null" in browsers.
        // Allow same-origin form metadata here; entry and callback redirects keep
        // no-referrer so private keys and OAuth codes cannot leak through Referer.
        return respond(html, 200, { "Content-Type": "text/html; charset=utf-8", "Referrer-Policy": "same-origin" });
      }
      if (request.method === "POST" && url.pathname === "/oauth/google/start") {
        if (request.headers.get("Origin") !== config.origin) return respond("Forbidden", 403);
        const body = await request.text();
        if (body.length > 4096) return respond("Request too large", 413);
        const csrf = new URLSearchParams(body).get("csrf") ?? "";
        if (!equal(csrf, session.csrf)) return respond("Forbidden", 403);
        const state = secret();
        const flow = await google.authorization(state);
        store.startAttempt(session.id, state, flow.verifier, now());
        return redirect(flow.url);
      }
      if (request.method === "GET" && url.pathname === CALLBACK) {
        const verifier = store.takeAttempt(session.id, url.searchParams.get("state") ?? "", now());
        if (!verifier) {
          store.message(session.id, "That connection request expired or belongs to another browser. Please try again.");
          return redirect("/");
        }
        const code = url.searchParams.get("code");
        if (url.searchParams.has("error") || !code) {
          store.message(session.id, "Google access wasn’t granted. You can try connecting again.");
          return redirect("/");
        }
        try {
          const account = await google.exchange(code, verifier);
          store.connect(account, now());
          store.message(session.id, `Connected ${account.email}. You can add your next account.`);
        } catch {
          // Do not log Google exception objects: they can contain tokens or codes.
          console.warn("Google connection failed; no credentials were saved.");
          store.message(session.id, "Couldn’t complete the connection. Check that Gmail access is allowed and your account is a test user if the Google app is in Testing, then try again.");
        }
        return redirect("/");
      }
      if (options.dashboard) return options.dashboard(request, session);
      return respond("Not found", 404);
    } catch {
      console.warn("Connection service request failed.");
      return respond("Couldn’t complete the request. Please try again.", 500);
    }
  };
}
