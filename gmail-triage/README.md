# Gmail triage

A private morning mail review using Bun, strict TypeScript, TanStack Start, React, Vite, and SQLite. Connect multiple Google accounts, summarize unread inbox mail, review decisions, and archive selected messages with a restore option.

## Review workflow

Open your private Tailscale entry link (print it with `bun run connection-link`). The dashboard has:

- **Needs you:** tasks, decisions, security notices, and uncertain messages.
- **Worth reading:** newsletter summaries, including AI, marketing, design opportunities, and D&D.
- **Ready to archive:** optional promotions and other proposed cleanup.
- **Records & other:** invoices, receipts, pay stubs, and retained information.
- **Recent activity:** saved decisions and **Restore to inbox** for archived messages.

**Keep in inbox** and **Reviewed** save a local decision and remove the item from the pending queue; neither changes Gmail. **Archive selected** removes only `INBOX` from the selected messages, preserving `UNREAD` and other labels. It does not archive an entire conversation. Restore adds `INBOX` back. Ambiguous API responses remain visible and recoverable. Reading an original here fetches plain text without marking it read; attachments and remote resources are omitted.

Daily runs only prepare suggestions. They never archive, delete, send, reply, unsubscribe, or mark mail read. Mail already outside the inbox is excluded. Reviewed message IDs are remembered per mailbox; unfinished items remain in the queue across days. New messages in an existing conversation are processed separately.

## Setup

Use Bun 1.4.1 or later. Create a Google OAuth **Web application** client with the redirect `https://YOUR-MAC.YOUR-TAILNET.ts.net/oauth/google/callback`. Use External audience for personal Gmail or accounts from multiple organizations. Add test users while testing. Gmail refresh tokens normally expire after seven days in Testing; ongoing operation needs the appropriate production/personal-use setup or reconnection.

```sh
bun install --frozen-lockfile
bun run connection-link --client-secret /path/to/client_secret.json
bun run build
bun run start
```

Importing credentials copies them into `~/.local/share/mini-me/gmail-triage/client_secret.json`. The production server listens on `127.0.0.1:8765`. After checking existing Tailscale Serve configuration:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:8765
```

Open the printed private entry link and connect each mailbox on Google's sign-in page. Bookmark the entry link; it grants access and must stay private. Sessions last 24 hours. Use Tailscale Serve, not Funnel. No OAuth secrets or mail content belong in the public repository.

## Daily review at 6 a.m. Pacific

Install and sign in to the Codex CLI first (`codex login status` verifies this without printing tokens). The classifier uses `codex exec` and that existing sign-in; it consumes the corresponding Codex usage allowance. No additional OpenAI API key is required for this configuration.

```sh
bun run review          # run a review now
bun run install-service # install/reload both macOS background services
```

The installer creates these per-user launch agents:

- `com.mini-me.gmail-web`: keeps the production dashboard running.
- `com.mini-me.gmail-review`: checks once a minute whether today's review is due.

The scheduler calculates the date and hour in `America/Los_Angeles`, so daylight saving changes and the Mac's selected time zone do not shift the intended 6 a.m. Pacific start. It makes one scheduled attempt per Pacific day, starting within roughly a minute when the Mac is awake. If asleep or offline at the scheduled time, it can catch up when running again; a network failure during an attempted run is reported in the dashboard and requires a manual rerun or the next day's attempt. The Mac must be powered on, the user logged in, and internet available. This does not configure automatic wake or run before login.

Each run processes up to 60 previously unreviewed messages per mailbox, scanning past known IDs through paginated results (bounded at 50,000 inbox IDs). It works through larger initial backlogs over several runs. Messages are classified in batches of 15. Completed batches survive a later failure; missing batches are retried on another run. A SQLite process lock prevents overlapping reviewers. A manual review can be run independently of the daily schedule, but will also honor the lock.

The classifier receives normalized mail as untrusted data via stdin, with shell, browser, plugin, app, and multi-agent features disabled, web search disabled, and a read-only sandbox. It returns schema-validated JSON. The application verifies source message IDs before saving anything. It never executes model output or grants it authority to change Gmail. Classification is advisory and can be wrong; review uncertain items and proposed archives. No links or attachments are fetched by the classifier.

To pause the scheduled job or stop the dashboard:

```sh
launchctl bootout gui/$(id -u)/com.mini-me.gmail-review
launchctl bootout gui/$(id -u)/com.mini-me.gmail-web
```

These unload the services for the current login. Remove the corresponding files in `~/Library/LaunchAgents/` to keep them disabled after the next login. `bun run install-service` restores them. The schedule label on the dashboard reflects the configured cadence, not an external launchctl health probe.

After code changes, run `bun run build` and restart the web service with `launchctl kickstart -k gui/$(id -u)/com.mini-me.gmail-web`. Scheduled reviews read the TypeScript source at each invocation. Private logs are under the data directory; CLI diagnostic content is suppressed because it may contain mail. Status and incomplete reviews appear in the dashboard.

## Storage and authentication

Private data stays outside the repository under `~/.local/share/mini-me/gmail-triage/`, with owner-only directory and file permissions. SQLite contains OAuth tokens, sessions, pending OAuth attempts, review classifications, run records, decisions, and archive/restore records. These are filesystem protections, not database encryption. Do not share the database or sidecar files.

Google OAuth uses PKCE and browser-bound, ten-minute, single-use state. Tokens and verifiers remain on the server. The `gmail.modify` permission also permits sending, but this application has no send or delete path. Reconnecting replaces only that account's credentials. Token refresh uses a compare-and-swap update to avoid overwriting a concurrent reconnect.

Authenticated requests require a session cookie. Mutations additionally require an exact Origin and per-session CSRF token. Server-rendered scripts use per-request CSP nonces. The account connection page uses `Referrer-Policy: same-origin` to preserve the native form's Origin; private-entry and OAuth redirects use `no-referrer`.

Mail is decoded as plain text, preferring the text MIME alternative; HTML fallback is converted without fetching resources. Message text is bounded at 12,000 characters and marked when truncated. Alternate MIME parts can disagree, and summary accuracy depends on available text. Attachments are not analyzed. The CLI's temporary input/output workspace is removed after classification and sessions are ephemeral. Private inspection snapshots remain until manually removed.

## Inspection and checks

```sh
bun run inspect --limit 20
bun run inspect --account you@example.com --limit 20 --query 'in:inbox is:unread'
bun run typecheck
bunx playwright install chromium
bun test
bun run build
bun run smoke # optional live dashboard check; no mailbox changes
```

Inspection retrieves a bounded sample (maximum 100 per account), saves a private JSON report in `reports/`, and prints metadata/snippets. It does not change messages or labels. The daily reviewer separately implements pagination and processing history.

Tests cover OAuth, CSRF and origin handling in a real Chromium browser, replay/expiry, account isolation, SQLite persistence, MIME decoding, review deduplication, invented message IDs, concurrent archive attempts, uncertain responses and undo, preservation of other Gmail labels, and Pacific scheduling across daylight saving time. Gmail changes are tested with mocks; live unattended rehearsals are read-only.

References: [TanStack Start hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting), [Codex non-interactive execution](https://developers.openai.com/codex/noninteractive), [Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [message label modification](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/modify), [Google testing limits](https://support.google.com/cloud/answer/15549945), [personal-use exception](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification#personal-use), [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve).
