# mini-me

A collection of small, independent projects that Codex can run on demand to help me stay productive.

Each subproject lives in its own directory with a short README explaining its purpose, setup, and how to run it. We'll build and refine the workflows together as needs come up.

Prefer Bun and strict TypeScript for new projects, with SQLite when local persistence is needed. Use Python only when a specific library or workflow calls for it.

First project: [Gmail triage](gmail-triage/) across multiple accounts. A personal agent reads mail, investigates context, archives junk, and organizes useful messages with Gmail labels. A private Tailscale dashboard presents a daily brief, genuine questions, run logs, and archive/restore history. Reviews run daily at 6 a.m. Pacific on the Mac, with learned preferences stored privately.

Keep credentials, account tokens, and private runtime data out of Git.
