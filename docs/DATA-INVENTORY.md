# Data inventory — gitpp-app (DRAFT)

> **DRAFT — not yet published.** Prepared for the M3 Marketplace
> step. Every row is derived from `worker.js` as of 2026-11-02;
> where the code does not establish a fact, the row says so.
> Credential **categories** are named; no credential values appear
> here or anywhere in this repository.

## Data items

| # | Item | Source | Held where | Retention (as coded) | Purpose |
|---|------|--------|-----------|----------------------|---------|
| 1 | Webhook delivery body (full JSON payload) | GitHub → `POST /webhook` | Worker memory only, for the request's duration | Not persisted | Signature verification; extracting the fields in rows 2 and 4 |
| 2 | Delivery-log entry: `{t, event, repo, installation, action}` | Fields of row 1 (`repository.full_name`, `installation.id`, `action`) | CREDS KV, one key per entry (`evt:<timestamp>:<rand>`) | **No expiry implemented**; served (last 20) by `GET /events`, currently public by design for the dogfood phase | Delivery observability; dogfood proof surface |
| 3 | Derivation-log entry: `{t, event: "derive", repo, sha (7 chars), action, detail (≤120 chars)}` | The derivation loop itself | CREDS KV, same `evt:` key space as row 2 | **No expiry implemented** | Outcome trail for derivations and failures |
| 4 | Derivation inputs from row 1: `after` SHA, `ref`, `head_commit.timestamp` (push); `check_suite.head_sha`, `check_suite.head_branch` (check_suite, actions `requested`/`rerequested` only) | Row 1 | Worker memory | Not persisted (except the 7-char SHA in row 3) | Choosing what to derive |
| 5 | Repository tarball at the derived commit (caps: 25 MB compressed, 100 MB decompressed, 5,000 record files) | GitHub API (`GET /repos/{repo}/tarball/{sha}`), installation token | Worker memory only | Not persisted | Record extraction (row 6) |
| 6 | Extracted record files: `.gitpp/records/*.json`, `.gitpp/project.json`, `.gitpp/proposals/*.json`; surface path: `surface.json`, `records/*.json`, `.gitpp/proposals/*.json` from the `gitpp/state` tarball | Row 5 | Worker memory only | Not persisted (except row 11) | The fold's input |
| 7 | Derived state report (key values, winner/loser record ids, deciding ancestry, qualifications) | The fold over row 6 | **Posted to GitHub** as a Check run output (`title`, `summary`, `text`; name `git.pp state` or `git.pp surface`; conclusion `neutral`, or `failure` when the input could not be read) | GitHub-side, as part of the commit's check runs | The App's output |
| 8 | In-flight claim: `inflight:<repo>:<sha>` / `inflight-s:…`, value `"1"` | Derivation loop | CREDS KV | **TTL 600 s (10 min)** | One derivation per commit at a time |
| 9 | Posted/failed marker: `posted:<repo>:<sha>` / `posted-s:…`, value `posted:<check id>` or `failed:<check id>` | Derivation loop | CREDS KV | **TTL 86,400 s (24 h)** | Coalescing push + check_suite twins to one Check |
| 10 | Surface discovery cache: `surfinfo:<repo>` = `{has, tipSha, tipTime, checkedAt}` | Probe of the `gitpp/state` branch (or a state-branch push) | CREDS KV | **TTL 3,600 s (1 h)**; writes are monotonic in observation time | Non-surface repos cost no per-push call |
| 11 | Surface declaration cache: `surfdecl:<repo>:<tipSha>` = the fetched `surface.json` content | Row 6 (surface path) | CREDS KV | **TTL 30 days** | Reuse of the declaration as fetched at that tip |
| 12 | Surface manifest: `surfmanifest:<repo>` = `{ids, patterns, tipSha, at}` — record ids and declared key patterns only; no state digest | Last posted surface derivation | CREDS KV | **No expiry implemented** | History-integrity baseline: naming records that vanish between derivations |
| 13 | App credential record, key `app`: the GitHub manifest-conversion JSON. Categories: App id, name/slug, `html_url`, owner login, client id, **client secret**, **webhook secret**, **PEM private key**, permissions, events | GitHub, via `GET/POST /setup/callback` manifest conversion (one-time `code` parameter; the code itself is not stored) | CREDS KV | Persists until an operator deliberately clears it; the callback refuses (409) to overwrite an existing record | Authenticating as the App: webhook verification and token minting |
| 14 | Installation access token | Minted from row 13's private key (App JWT, RS256) via the GitHub API | Worker memory only (per-isolate cache, reused while >60 s of life remains) | Memory only; expires with the token (≤1 h) | API calls in rows 5, 7, and check-run lookups |
| 15 | Legacy delivery array, key `events` (same five fields as row 2, pre-2026-10-22 format) | Historical | CREDS KV | Read and merged by `GET /events`; no new writes | Continuity of the public ring |
| 16 | Console log line per accepted delivery (the row-2 fields as JSON) | `webhook()` | Cloudflare Workers logs | Platform-side; not set by this code | Operations |

## Processors

| Processor | Role |
|-----------|------|
| GitHub | Webhook source; REST API (tokens, tarballs, check runs); hosts the posted Checks |
| Cloudflare | Workers compute, KV storage (the CREDS namespace above), and the `gitpp-app.superinstance.dev` domain |

No other processors, analytics, or advertising services are used.

## Open items — to be confirmed before Marketplace submission

- A retention period for rows 2, 3, and 12 (no expiry is currently
  implemented for them).
- Gating of `GET /events` (currently public by design for the
  dogfood phase).
- The operator contact address carried by the privacy policy and
  the listing.
