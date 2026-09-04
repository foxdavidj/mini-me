import { OAuth2Client } from "google-auth-library";
import { convert } from "html-to-text";
import { z } from "zod";
import type { Config } from "./config";
import { tokenSchema } from "./google";
import type { Store } from "./store";

type Part = { mimeType: string; filename: string; headers: { name: string; value: string }[]; body: { data?: string | undefined }; parts: Part[] };
const partSchema: z.ZodType<Part> = z.lazy(() => z.object({
  mimeType: z.string().default(""), filename: z.string().default(""),
  headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  body: z.object({ data: z.string().optional() }).default({}),
  parts: z.array(partSchema).default([]),
}));
const messageSchema = z.object({
  id: z.string(), threadId: z.string(), labelIds: z.array(z.string()).default([]),
  snippet: z.string().default(""), internalDate: z.string(), payload: partSchema,
});
const labelSchema = z.object({ messagesTotal: z.number().default(0), messagesUnread: z.number().default(0) });
const listSchema = z.object({ messages: z.array(z.object({ id: z.string() })).default([]), nextPageToken: z.string().optional() });

function bodies(part: Part): { plain: string[]; html: string[] } {
  if (part.filename || part.mimeType === "message/rfc822") return { plain: [], html: [] };
  const result = { plain: [] as string[], html: [] as string[] };
  if (part.body.data && ["text/plain", "text/html"].includes(part.mimeType)) {
    const contentType = part.headers.find((h) => h.name.toLowerCase() === "content-type")?.value ?? "";
    const charset = contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] ?? "utf-8";
    const bytes = Buffer.from(part.body.data, "base64url");
    let text: string;
    try { text = new TextDecoder(charset).decode(bytes); } catch { text = bytes.toString("utf8"); }
    (part.mimeType === "text/plain" ? result.plain : result.html).push(text);
  }
  for (const child of part.parts) {
    const found = bodies(child);
    result.plain.push(...found.plain); result.html.push(...found.html);
  }
  return result;
}

export function decodeMessage(input: unknown) {
  const message = messageSchema.parse(input);
  const header = (name: string) => message.payload.headers.find((h) => h.name.toLowerCase() === name)?.value ?? "";
  const content = bodies(message.payload);
  const fullText = content.plain.length ? content.plain.join("\n\n") : convert(content.html.join("\n"), {
    wordwrap: false, selectors: [{ selector: "a", options: { ignoreHref: true } }, { selector: "img", format: "skip" }],
  });
  return {
    id: message.id, threadId: message.threadId, labels: message.labelIds,
    from: header("from"), to: header("to"), subject: header("subject"),
    receivedAt: new Date(Number(message.internalDate)).toISOString(),
    snippet: message.snippet, text: fullText.slice(0, 12000), textTruncated: fullText.length > 12000,
    listId: header("list-id"),
  };
}

export type InspectedMessage = ReturnType<typeof decodeMessage>;

/** Only Gmail GET operations are exposed. Token refresh writes only local credentials. */
export class GmailReader {
  private readonly oauth: OAuth2Client;

  constructor(config: Config, store: Store, readonly email: string) {
    const row = store.db.query<{ credentials: string }, [string]>("SELECT credentials FROM accounts WHERE email = ?").get(email);
    if (!row) throw new Error("Account is not connected");
    let storedJson = row.credentials;
    let stored = tokenSchema.parse(JSON.parse(storedJson));
    this.oauth = new OAuth2Client({ clientId: config.clientId, clientSecret: config.clientSecret, transporterOptions: { timeout: 30000, retry: false } });
    this.oauth.setCredentials(stored);
    this.oauth.on("tokens", (tokens) => {
      const next = tokenSchema.parse({ ...stored, ...tokens, refresh_token: tokens.refresh_token || stored.refresh_token });
      const nextJson = JSON.stringify(next);
      // Do not overwrite credentials from a concurrent browser reconnect.
      const updated = store.db.query("UPDATE accounts SET credentials = ? WHERE email = ? AND credentials = ?").run(nextJson, email, storedJson);
      if (updated.changes) { stored = next; storedJson = nextJson; }
    });
  }

  private async get(path: string, params: Record<string, string | number> = {}): Promise<unknown> {
    const response = await this.oauth.request<unknown>({ method: "GET", url: `https://gmail.googleapis.com/gmail/v1/users/me/${path}`, params });
    return response.data;
  }

  async verify() {
    const profile = z.object({ emailAddress: z.email() }).parse(await this.get("profile"));
    if (profile.emailAddress.toLowerCase() !== this.email) throw new Error("Connected mailbox identity mismatch");
  }

  async unseen(known: Set<string>, limit = 60) {
    await this.verify();
    const inbox = labelSchema.parse(await this.get("labels/INBOX"));
    const unread = labelSchema.parse(await this.get("labels/UNREAD"));
    const ids: string[] = [];
    let pageToken = "";
    let remaining = false;
    // Bound initial backlogs; page past already reviewed IDs so old mail is not starved.
    for (let page = 0; page < 100; page++) {
      const listed = listSchema.parse(await this.get("messages", {q:"in:inbox is:unread",maxResults:500,...(pageToken ? {pageToken} : {})}));
      for (const {id} of listed.messages) if (!known.has(id) && !ids.includes(id)) ids.push(id);
      pageToken = listed.nextPageToken ?? "";
      if (ids.length >= limit || !pageToken) { remaining = ids.length > limit || Boolean(pageToken); break; }
      if (page === 99) remaining = true;
    }
    const messages: InspectedMessage[] = [];
    for (let start = 0; start < Math.min(ids.length,limit); start += 4) {
      const batch=ids.slice(start,Math.min(start+4,limit));
      messages.push(...await Promise.all(batch.map(id=>this.message(id))));
    }
    return {email:this.email,inboxUnread:inbox.messagesUnread,allUnread:unread.messagesTotal,remaining,messages};
  }

  async message(id: string) { return decodeMessage(await this.get(`messages/${encodeURIComponent(id)}`, {format:"full"})); }

  async inbox(id: string, present: boolean): Promise<"changed" | "unchanged"> {
    const path=`messages/${encodeURIComponent(id)}`;
    const current=z.object({labelIds:z.array(z.string()).default([])}).parse(await this.get(path,{format:"minimal"}));
    if (current.labelIds.includes("TRASH") || current.labelIds.includes("SPAM")) throw new Error("Message moved to spam or trash; review manually");
    if (current.labelIds.includes("INBOX") === present) return "unchanged";
    const response=await this.oauth.request<unknown>({method:"POST",url:`https://gmail.googleapis.com/gmail/v1/users/me/${path}/modify`,data:present ? {addLabelIds:["INBOX"]} : {removeLabelIds:["INBOX"]}});
    const updated=z.object({labelIds:z.array(z.string()).default([])}).parse(response.data);
    if (updated.labelIds.includes("INBOX") !== present) throw new Error("Gmail did not confirm inbox change");
    return "changed";
  }

  async inspect(limit: number, query: string) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Sample limit must be between 1 and 100");
    const profile = z.object({ emailAddress: z.email() }).parse(await this.get("profile"));
    if (profile.emailAddress.toLowerCase() !== this.email) throw new Error("Connected mailbox identity mismatch");
    const [inbox, unread, listed] = await Promise.all([
      this.get("labels/INBOX").then((data) => labelSchema.parse(data)),
      this.get("labels/UNREAD").then((data) => labelSchema.parse(data)),
      this.get("messages", { q: query, maxResults: limit }).then((data) => listSchema.parse(data)),
    ]);
    const messages: InspectedMessage[] = [];
    for (let start = 0; start < listed.messages.length; start += 4) {
      messages.push(...await Promise.all(listed.messages.slice(start, start + 4).map(async ({ id }) => decodeMessage(await this.get(`messages/${encodeURIComponent(id)}`, { format: "full" })))));
    }
    return {
      email: this.email, inboxMessages: inbox.messagesTotal, inboxUnread: inbox.messagesUnread,
      allUnread: unread.messagesTotal, query, sampleLimit: limit, sampled: messages.length,
      moreMatches: Boolean(listed.nextPageToken), messages,
    };
  }
}
