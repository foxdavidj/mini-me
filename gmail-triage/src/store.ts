import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { hash, privateDirectory, secret } from "./config";

export type Session = { id: string; csrf: string; message: string | null };
export type Account = { email: string; connected_at: number };
export type AccountConnection = { email: string; credentials: string };

export class Store {
  readonly db: Database;

  constructor(dataDir: string) {
    privateDirectory(dataDir);
    const path = join(dataDir, "gmail.sqlite");
    this.db = new Database(path, { create: true, strict: true });
    chmodSync(path, 0o600);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL, message TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS oauth_attempts (
        state_hash TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        verifier TEXT NOT NULL, expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS accounts (
        email TEXT PRIMARY KEY, connected_at INTEGER NOT NULL, credentials TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version = 1;
    `);
  }

  newSession(now: number): string {
    this.db.query("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    const token = secret();
    this.db.query("INSERT INTO sessions (id, csrf, expires_at) VALUES (?, ?, ?)").run(hash(token), secret(), now + 86400);
    return token;
  }

  session(token: string, now: number): Session | null {
    return this.db.query<Session, [string, number]>("SELECT id, csrf, message FROM sessions WHERE id = ? AND expires_at > ?").get(hash(token), now);
  }

  message(id: string, message: string | null): void {
    this.db.query("UPDATE sessions SET message = ? WHERE id = ?").run(message, id);
  }

  startAttempt(sessionId: string, state: string, verifier: string, now: number): void {
    this.db.query("DELETE FROM oauth_attempts WHERE expires_at <= ?").run(now);
    const count = this.db.query<{ count: number }, []>("SELECT count(*) AS count FROM oauth_attempts").get();
    if (count && count.count >= 100) throw new Error("Too many pending connections");
    this.db.query("INSERT INTO oauth_attempts VALUES (?, ?, ?, ?)").run(hash(state), sessionId, verifier, now + 600);
  }

  takeAttempt(sessionId: string, state: string, now: number): string | null {
    // DELETE RETURNING atomically consumes the state before the async token exchange.
    const row = this.db.query<{ verifier: string }, [string, string, number]>(
      "DELETE FROM oauth_attempts WHERE state_hash = ? AND session_id = ? AND expires_at > ? RETURNING verifier",
    ).get(hash(state), sessionId, now);
    return row?.verifier ?? null;
  }

  connect(account: AccountConnection, now: number): void {
    this.db.query(`INSERT INTO accounts VALUES (?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET connected_at = excluded.connected_at, credentials = excluded.credentials`)
      .run(account.email, now, account.credentials);
  }

  accounts(): Account[] {
    return this.db.query<Account, []>("SELECT email, connected_at FROM accounts ORDER BY email").all();
  }

  close(): void { this.db.close(); }
}
