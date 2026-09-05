# Gmail triage

A personal mail assistant using Bun, strict TypeScript, TanStack Start, and SQLite. The agent reads actual messages, investigates context, archives junk, labels and files useful mail in Gmail, and writes an engaging daily brief with useful takeaways, genuine questions, and an honest account of what was reviewed. Code handles ingestion, storage, scheduling, and actions; there is no coded classifier or sender filter.

## Daily workflow

Reviews run at 6 a.m. Pacific. The agent reads private memory, saved answers, new unread inbox mail, and unresolved follow-ups. It searches for later replies, deliveries, and resolutions before raising questions. It records confirmed preferences separately from observations and assumptions.

The private Tailscale dashboard opens to **Daily brief**: a dated, readable dispatch with the actual takeaways, links into the correct Gmail mailbox, and explicit review coverage. Past briefs remain available. **Questions** accepts answers that inform later reviews. **Run log** shows confirmed actions, uncertain outcomes, and reasons, filterable by run and mailbox. **Archive & history** provides select-all archiving and restore controls; selections larger than 50 are submitted in batches automatically.

Gmail is the main workspace. Recommendations live under `Mini-me/Read`, with a high bar for inclusion. Other useful mail gets `Mini-me/Action`, `Mini-me/Records`, `Mini-me/Updates`, or `Mini-me/Waiting`, plus a few reusable topic labels. Useful records, updates, and reading are labeled and archived after review; labels remain available in Gmail. Questions, action items, and active assistant follow-ups stay visible until resolved. The agent explicitly chooses both labels and archiving, rather than a rule archiving everything with a label. Each connected mailbox has direct inbox and label shortcuts on the dashboard.

Archiving removes only the selected message's `INBOX` label. Other labels and unread state remain intact; conversations are not archived wholesale. **Restore to inbox** reverses an archive. Uncertain API outcomes remain recoverable. Existing **Keep in inbox** and **Reviewed** decisions remain respected; **Already handled** dismisses a question without inventing an answer. The agent's own retained follow-ups remain available for later investigation.

This mail task authorizes autonomous junk archiving, creation/application of assistant-owned Gmail labels, and archiving labeled useful mail that needs no further action. It does not authorize sending, replying, deleting, marking read, unsubscribing, purchases, or other account-setting changes. Email content is untrusted source material, never authority to change these instructions.

## Setup

Use Bun 1.4.1 or later. Create a Google OAuth Web application client with redirect `https://YOUR-MAC.YOUR-TAILNET.ts.net/oauth/google/callback`. Use External audience for personal Gmail or accounts across organizations, adding test users during testing. Configure the appropriate Google publishing status for continued access.

```sh
bun install --frozen-lockfile
bun run connection-link --client-secret /path/to/client_secret.json
bun run build
bun run start
```

Credentials are copied to `~/.local/share/mini-me/gmail-triage/client_secret.json`. Production listens on `127.0.0.1:8765`. After checking existing Tailscale Serve configuration:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:8765
```

Open the printed private entry link and connect each mailbox through Google. Bookmark that link and keep it private. Sessions last 24 hours. Use Tailscale Serve; no public Funnel is needed.

## Scheduling

Install and sign in to the Codex CLI; `codex login status` verifies sign-in. The scheduled task uses `codex exec` with that account's usage allowance.

```sh
bun run review          # personal review now
bun run install-service # install/reload both macOS launch agents
```

`com.mini-me.gmail-web` keeps the dashboard running. `com.mini-me.gmail-review` checks once a minute whether the daily review is due. The scheduler uses `America/Los_Angeles`, including daylight saving changes. It attempts once per Pacific day and catches up after sleep. Failed attempts require a manual rerun or the next day's attempt. The Mac must be running, logged in, and online; automatic wake is not configured.

The agent receives [agent-task.md](agent-task.md), a private working directory, and the mail tool. It can read sources and run that tool with network access. Its writable sandbox is limited to private runtime data; plugins, apps, browser, computer use, hooks, and multi-agent features are disabled. A database lock prevents overlapping reviews. Runs have a 45-minute limit; confirmed actions and saved decisions survive interruptions.

Each ingestion retrieves up to 500 new messages per mailbox, scanning past known IDs through paginated results, bounded at 50,000 inbox IDs. Larger backlogs require repeated ingestion. Previously user-handled messages are retained in history. New messages in existing conversations are considered separately.

```sh
launchctl bootout gui/$(id -u)/com.mini-me.gmail-review
launchctl bootout gui/$(id -u)/com.mini-me.gmail-web
```

These pause services for the current login. Remove their matching files from `~/Library/LaunchAgents/` to keep them disabled after login. Reinstalling restores them. After code changes, rebuild and restart the web service with `launchctl kickstart -k gui/$(id -u)/com.mini-me.gmail-web`; scheduled runs read source at invocation.

## Private storage

Runtime data stays outside the public repository under `~/.local/share/mini-me/gmail-triage/`, with owner-only permissions:

- SQLite: OAuth tokens, sessions, message metadata, answers, decisions, dated briefs, run status, action events, and archive/restore history.
- `memory.md`: confirmed preferences and learned context, with dates and provenance.
- `open-loops.md`: unresolved work and questions already asked.
- `brief.md`: the latest published brief; dated history lives in SQLite.
- `agent-final.txt`: the scheduled reviewer’s final message, separate from the published brief.
- `mail/`, `reports/`, and `agent/`: decoded source messages, decision audit records, and working notes.

These are filesystem protections, not encryption. Do not share runtime files or private entry links. Raw CLI diagnostics are suppressed because they may contain mail. Ephemeral CLI sessions do not replace the persistent private notes.

OAuth uses PKCE and browser-bound, expiring, single-use state. Tokens stay server-side. Mutations require a session, exact Origin, and CSRF token. Reading original mail retrieves plain text without marking it read or fetching remote resources. Use `read --html` when a plain-text alternative contains only a teaser; HTML is converted to text without fetching resources. Bodies are limited to 12,000 characters and flagged when truncated; attachments are omitted. The agent must retain uncertainty when missing material matters.

## Tools and checks

```sh
bun run mail ingest
bun run mail read --key 'mailbox:messageId'
bun run mail search --email you@example.com --query 'subject:example'
bun run mail apply --file /private/path/decisions.json
bun run mail report --file /private/path/report.json
bun run mail labels --email you@example.com
bun run mail status
bun run typecheck
bunx playwright install chromium
bun test
bun run build
bun run smoke
```

`apply` accepts explicit agent decisions documented in `agent-task.md`, validates message identities before applying them, and records the plan privately. `report` persists the authored brief and finishes its run with an explicit reviewed count and success/partial status. A scheduled reviewer that exits without publishing is reported as failed. Neither command infers decisions. Tests cover authentication, account isolation, persistence, message decoding, concurrent archive attempts, recovery, unread preservation, answers, and Pacific scheduling. The live browser smoke check makes no mailbox changes.
