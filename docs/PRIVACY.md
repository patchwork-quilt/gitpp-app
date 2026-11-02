# Privacy policy — gitpp-app (DRAFT)

> **DRAFT — not yet published.** This draft was prepared for the M3
> Marketplace step and is derived strictly from the receiver's code
> (`worker.js`) and `docs/DATA-INVENTORY.md` in this repository.
> Items marked *to be confirmed* must be settled before any
> Marketplace submission. It describes the reference instance at
> <https://gitpp-app.superinstance.dev>. Anyone who registers their
> own instance of this App through the manifest flow operates their
> own receiver and is the operator of that instance.

## What the App does

gitpp-app is a GitHub App. On repositories where it is installed,
it receives `push` and `check_suite` webhook deliveries, derives
the repository's declared git.pp state from its record files, and
posts that state back to GitHub as an advisory Check run on the
commit. It requests exactly three permissions — Metadata (read),
Contents (read), Checks (write) — and no others.

## What the App receives and reads

- **Webhook deliveries** from GitHub for the two subscribed
  events. The delivery body is processed in memory. From it, the
  receiver uses the event type, the action, the repository's full
  name, the installation id, and — for derivation — the pushed
  commit SHA and ref (push) or the check suite's head SHA and
  branch (check_suite).
- **Repository record files.** To derive, the App downloads the
  repository tarball at the pushed commit through the GitHub API
  (one call; size-capped at 25 MB compressed / 100 MB
  decompressed) and extracts, in memory, only the record paths:
  `.gitpp/records/*.json`, `.gitpp/project.json`,
  `.gitpp/proposals/*.json`, and — for a declared surface —
  `surface.json` and `records/*.json` on the `gitpp/state` branch.
  The tarball and the extracted files are not persisted; they
  exist only for the duration of the derivation.
  GitHub grants Contents repository-wide — there is no path-scoped
  grant — so the record-paths-only limit is a matter of this
  published policy and the App's public source code, not of the
  grant itself.

## What the App stores

In the receiver's Cloudflare KV store, and nothing else:

- **A delivery log.** One entry per accepted delivery and per
  derivation outcome, holding five fields — time, event,
  repository full name, installation id, action — plus, for
  derivation entries, a 7-character commit prefix and a short
  outcome detail (at most 120 characters). **No webhook payload
  bodies are stored.** The last 20 entries are readable at
  `/events`; that endpoint is public by design for the dogfood
  phase and will be gated before any Marketplace step.
- **Operational keys** that keep derivation idempotent: in-flight
  claims (10-minute expiry), posted/failed Check markers (24-hour
  expiry), a surface-discovery cache (1-hour expiry), cached
  surface declarations (30-day expiry), and a surface manifest
  holding record ids and declared key patterns per repository
  (no expiry is currently implemented).
- **The App's own credential record** — the App's registration
  data and credentials (see the data inventory for the categories).
  Secret values are never rendered in a page, a response, or a
  log.

Event-log entries and the surface manifest currently have **no
automatic expiry** in the code. A retention period for them is
*to be confirmed before Marketplace submission*.

## What the App sends, and to whom

- **Check runs to GitHub**: the derived state — key values,
  winning and losing record ids, and the ancestry that decided —
  posted to the commit it derived from. This is the App's output
  and its purpose.
- **API calls to GitHub**: installation-token requests, the
  tarball fetch, and check-run lookups/posts above.
- **No other disclosure.** The App sells nothing, shares nothing
  with third parties for their own purposes, runs no analytics or
  advertising, and uses no repository data to train models.

## Processors

- **GitHub** — the platform the App runs against: webhook source,
  API, tarball hosting, and the Checks the App posts.
- **Cloudflare** — hosts the receiver (Workers) and its KV store,
  and serves its domain.

No other processors are used.

## Security

Webhook deliveries are accepted only after HMAC-SHA-256 signature
verification against the App's webhook secret; unsigned or
wrongly-signed deliveries are refused and nothing is recorded.
Installation access tokens are minted per derivation, cached only
in the receiver's memory while valid, and never stored.

## Contact

Operator contact for privacy questions: *to be confirmed before
Marketplace submission.*
