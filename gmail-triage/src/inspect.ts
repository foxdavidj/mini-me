import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_DATA, privateWrite, readConfig } from "./config";
import { GmailReader } from "./mail";
import { Store } from "./store";

process.umask(0o077);
const { values } = parseArgs({ args: Bun.argv.slice(2), options: {
  "data-dir": { type: "string", default: DEFAULT_DATA },
  limit: { type: "string", default: "20" },
  query: { type: "string", default: "in:inbox is:unread" },
  account: { type: "string" },
} });
const store = new Store(values["data-dir"]);
try {
  const config = readConfig(join(values["data-dir"], "client_secret.json"));
  const accounts = store.accounts().filter((account) => !values.account || account.email === values.account);
  if (!accounts.length) throw new Error("No matching connected accounts");
  const results = await Promise.allSettled(accounts.map(({ email }) => new GmailReader(config, store, email).inspect(Number(values.limit), values.query)));
  const report = {
    createdAt: new Date().toISOString(), mode: "read-only" as const,
    accounts: results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
    failedAccounts: results.flatMap((result, index) => result.status === "rejected" ? [accounts[index]?.email ?? "unknown"] : []),
  };
  const path = join(values["data-dir"], "reports", `inspection-${Date.now()}.json`);
  privateWrite(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ reportPath: path, ...report, accounts: report.accounts.map((account) => ({ ...account, messages: account.messages.map(({ text: _text, ...metadata }) => metadata) })) }, null, 2));
  if (report.failedAccounts.length) process.exitCode = 1;
} catch {
  console.error("Read-only inspection failed. Check the account connection and command options; credential details were suppressed.");
  process.exitCode = 1;
} finally { store.close(); }
