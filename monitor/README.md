# monitor/ — local-only monitoring pipeline (prototype)

Proves the full capture → redact → store → report chain on **one machine**, no
network, before deploying to the team. Monitoring-only: no flagging, no scoring,
no punitive logic anywhere.

## Run it

```bash
cd monitor
npm install
npm run compile
npm run capture     # read THIS machine's agent logs, enrich + redact + store
npm run report      # print the per-coder usage / cost view
```

- `capture` stamps each session with the **coder login** (chosen identity source)
  and the machine's **IP** (context only), classifies the task, **redacts secrets
  from the prompt**, and appends to `monitor/data/interactions.jsonl` (gitignored).
- `report` aggregates **by coder**: sessions, claude-vs-opencode split, token
  totals, **estimated cost**, IPs seen, and the cost signal you asked for —
  *simple-class tasks that ran on the expensive Claude model*.

## What's real vs. placeholder

- **Claude Code capture** — verified against real logs (authoritative model +
  tokens + prompt).
- **OpenCode capture** — best-effort/unverified (not installed here); confirm the
  log format on a real install.
- **Cost rates** — placeholders in [src/cost.ts](src/cost.ts); edit to your
  contract prices.

## Going from 1 machine to 30 (not built yet)

This local store stands in for the central backend. To monitor the team:

1. The `capture` step ships records to a **central ingestion API** instead of
   writing locally (each coder's VS Code runs it).
2. A **database** with **90-day retention** (PRD §7) holds interactions.
3. A **role-gated dashboard** shows the per-coder / per-IP / cost views; per-coder
   **prompt drill-down is restricted to authorized roles and access-logged** (§7).

## Before switching on for real people (required, not optional)

Per PRD §7: monitoring of prompt content per-person must be **disclosed to the
coders** and **lawful in their jurisdiction**. Surface a visible "monitoring is
on" indicator and capture consent. This product never flags or punishes — keep it
that way; that boundary is what makes the monitoring defensible.

## Caveat on "by IP"

IP is a weak per-person key: 30 coders behind one office NAT share a public IP,
and VPN/DHCP scramble it. Use the **coder login** for attribution and treat IP as
a location signal (in-office vs remote) only.
