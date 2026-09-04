import { expect, test } from "bun:test";
import { decodeMessage } from "../src/mail";

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
