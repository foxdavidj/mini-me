import type { Account } from "./store";

const escape = (text: string): string => text.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char] ?? char);

export function page(accounts: Account[], csrf: string, message: string | null): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connect your mail · Mini Me</title><link rel="stylesheet" href="/static/style.css"></head>
  <body><main><div class="eyebrow">MINI ME / GMAIL</div><h1>A little less inbox.</h1>
  <p class="intro">Connect your mailboxes so we can help you find what matters.</p>
  ${message ? `<div class="notice" role="status">${escape(message)}</div>` : ""}
  <section><div class="section-heading"><h2>Your accounts</h2><span>${accounts.length} connected</span></div>
  ${accounts.length ? `<ul>${accounts.map((account) => `<li><span>${escape(account.email)}</span><span class="connected">Connected</span></li>`).join("")}</ul>` : "<p>No accounts connected yet. Start with any of your Gmail accounts.</p>"}
  <form method="post" action="/oauth/google/start"><input type="hidden" name="csrf" value="${escape(csrf)}">
  <button type="submit">Connect a Google account <span aria-hidden="true">↗</span></button></form>
  <p class="hint">Choose an account on Google’s page and approve Gmail access. Repeat for each mailbox.</p></section>
  <p class="footer">This step only connects your accounts. Reviewing and organizing your mail comes next.</p>
  </main></body></html>`;
}
