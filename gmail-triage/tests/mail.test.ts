import { expect, test } from "bun:test";
import { decodeMessage, GmailReader, readWithBackoff } from "../src/mail";

const data = (text: string) => Buffer.from(text).toString("base64url");
const base = { id: "message", threadId: "thread", internalDate: "1788560000000", labelIds: ["UNREAD", "INBOX"] };

test("prefers plain text in alternatives and excludes attachments", () => {
  const parsed = decodeMessage({ ...base, payload: { mimeType: "multipart/mixed", parts: [
    { mimeType: "multipart/alternative", parts: [
      { mimeType: "text/plain", body: { data: data("Actual message") } },
      { mimeType: "text/html", body: { data: data("<p>Duplicate message</p>") } },
    ] },
    { mimeType: "text/plain", filename: "attachment.txt", body: { data: data("Attachment contents") } },
  ] } });
  expect(parsed.text).toBe("Actual message");
  expect(parsed.labels).toEqual(["UNREAD", "INBOX"]);
});

test("HTML fallback drops active content and tracking images without fetching resources", () => {
  const parsed = decodeMessage({ ...base, payload: { mimeType: "text/html", body: { data: data('<script>alert(1)</script><p>Hello &amp; welcome</p><img src="https://example.com/pixel"><a href="https://example.com/private-token">Read more</a>') } } });
  expect(parsed.text).toContain("Hello & welcome");
  expect(parsed.text).not.toContain("alert");
  expect(parsed.text).not.toContain("private-token");
  expect(parsed.text).not.toContain("pixel");
});

test("flags truncated text and rejects malformed API responses", () => {
  const parsed = decodeMessage({ ...base, payload: { mimeType: "text/plain", body: { data: data("x".repeat(13000)) } } });
  expect(parsed.text.length).toBe(12000);
  expect(parsed.textTruncated).toBe(true);
  expect(() => decodeMessage({ id: "missing required fields" })).toThrow();
});

test("retries Gmail quota errors with increasing delays and returns the successful read", async () => {
  let calls = 0;
  const waits: number[] = [];
  const result = await readWithBackoff(async () => {
    if (++calls < 3) throw { response: { status: 403, data: { error: { errors: [{ reason: "rateLimitExceeded" }] } } } };
    return "mail";
  }, async (ms) => { waits.push(ms); });
  expect(result).toBe("mail");
  expect(calls).toBe(3);
  expect(waits[0]).toBeGreaterThanOrEqual(1000);
  expect(waits[0]).toBeLessThan(1500);
  expect(waits[1]).toBeGreaterThanOrEqual(2000);
  expect(waits[1]).toBeLessThan(2500);
});

test("does not retry a genuine permission denial", async () => {
  const error = { response: { status: 403, data: { error: { errors: [{ reason: "forbidden" }] } } } };
  let waits = 0;
  await expect(readWithBackoff(async () => { throw error; }, async () => { waits++; })).rejects.toBe(error);
  expect(waits).toBe(0);
});

test("persistent throttling stops after a bounded number of attempts", async () => {
  const error = { response: { status: 429 } };
  let calls = 0;
  await expect(readWithBackoff(async () => { calls++; throw error; }, async () => {})).rejects.toBe(error);
  expect(calls).toBe(7);
});

test("an import failure waits for other reads to persist before returning", async () => {
  const reader = Object.create(GmailReader.prototype) as GmailReader;
  const error = new Error("One read failed");
  const saved: string[] = [];
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  Object.assign(reader, {
    verify: async () => {},
    get: async (path: string) => path === "messages" ? { messages: [{ id: "bad" }, { id: "good" }] } : {},
    message: async (id: string) => {
      if (id === "bad") throw error;
      await pending;
      return decodeMessage({ ...base, id, payload: { mimeType: "text/plain", body: { data: data("Message") } } });
    },
  });
  let returned = false;
  const outcome = reader.unseen(new Set(), 10, message => { saved.push(message.id); }).catch(e => { returned = true; return e; });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(returned).toBe(false);
  finish();
  expect(await outcome).toBe(error);
  expect(saved).toEqual(["good"]);
});

test('explicit HTML reading recovers content hidden by a plain-text preheader',()=>{
 const source={...base,payload:{mimeType:'multipart/alternative',parts:[
  {mimeType:'text/plain',body:{data:data('View this email online')}},
  {mimeType:'text/html',body:{data:data('<p>Your appointment is tomorrow.</p><script>alert(1)</script><img src="https://example.com/track">')}},
 ]}};
 expect(decodeMessage(source).text).toBe('View this email online');
 expect(decodeMessage(source,true).text).toBe('Your appointment is tomorrow.');
 expect(decodeMessage({...base,payload:{mimeType:'text/plain',body:{data:data('Plain only')}}},true).text).toBe('Plain only');
});
