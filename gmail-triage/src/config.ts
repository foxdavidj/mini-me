import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const CALLBACK = "/oauth/google/callback";
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const DEFAULT_DATA = join(homedir(), ".local/share/mini-me/gmail-triage");

const clientSchema = z.object({ web: z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  project_id: z.string().min(1),
  auth_uri: z.literal("https://accounts.google.com/o/oauth2/auth"),
  token_uri: z.literal("https://oauth2.googleapis.com/token"),
  redirect_uris: z.array(z.url()),
}) });

export type Config = {
  clientId: string;
  clientSecret: string;
  projectId: string;
  callback: string;
  origin: string;
};

export function readConfig(path: string): Config {
  const { web } = clientSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const callbacks = web.redirect_uris.filter((value) => new URL(value).pathname === CALLBACK);
  if (callbacks.length !== 1 || !callbacks[0]) throw new Error("Register one /oauth/google/callback redirect URI.");
  const url = new URL(callbacks[0]);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".ts.net") || url.search || url.hash || url.username || url.password) {
    throw new Error("The callback must use an HTTPS Tailscale hostname.");
  }
  return { clientId: web.client_id, clientSecret: web.client_secret, projectId: web.project_id, callback: url.href, origin: url.origin };
}

export const secret = () => randomBytes(32).toString("base64url");
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const equal = (a: string, b: string) => timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));

export function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

export function privateWrite(path: string, value: string): void {
  privateDirectory(dirname(path));
  const temporary = `${path}.${secret()}.tmp`;
  writeFileSync(temporary, value, { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
}

export function accessKey(dataDir: string): string {
  const path = join(dataDir, "access.key");
  if (!existsSync(path)) privateWrite(path, secret());
  chmodSync(path, 0o600);
  return readFileSync(path, "utf8").trim();
}
