import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { accessKey, DEFAULT_DATA, privateWrite, readConfig } from "./config";
import { createApp } from "./app";
import { googleAuth } from "./google";
import { Store } from "./store";

process.umask(0o077);
const { values } = parseArgs({ args: Bun.argv.slice(2), options: {
  "data-dir": { type: "string", default: DEFAULT_DATA },
  "client-secret": { type: "string" },
  "connection-link": { type: "boolean", default: false },
  port: { type: "string", default: "8765" },
} });
const dataDir = values["data-dir"];
const clientPath = join(dataDir, "client_secret.json");
const source = values["client-secret"] ?? clientPath;
const config = readConfig(source);
if (values["client-secret"]) privateWrite(clientPath, readFileSync(source, "utf8"));
const key = accessKey(dataDir);
if (values["connection-link"]) {
  console.log(`${config.origin}/open/${key}`);
} else {
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
  const store = new Store(dataDir);
  const css = await Bun.file(new URL("../static/style.css", import.meta.url)).text();
  const server = Bun.serve({
    hostname: "127.0.0.1", port, maxRequestBodySize: 4096,
    fetch: createApp({ config, store, google: googleAuth(config), accessKey: key, css }),
  });
  console.log(`Gmail connection service running on Bun ${Bun.version}, loopback port ${port}.`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await server.stop();
    store.close();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
