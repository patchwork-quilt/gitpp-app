# Privacy policy — gitpp-app

> This policy describes the reference instance at
> <https://gitpp-app.superinstance.dev>, operated by the
> patchwork-quilt organisation, as of the v0.3.0 release
> (2026-11-02). It is derived from, and checked against, the
> receiver's code (`worker.js`) and `docs/DATA-INVENTORY.md` in
> this repository — where this policy and the code disagree, the
> code is what the App does, and the discrepancy is a bug in this
> document. Anyone who registers their own instance of this App
> through the manifest flow operates their own receiver and is
> the operator of that instance; this policy covers only the
> reference instance.

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

## What the App stores, and for how long

In the receiver's Cloudflare KV store, and nowhere else:

- **A delivery log.** One entry per accepted delivery and per
  derivation outcome, holding five fields — time, event,
  repository full name, installation id, action — plus, for
  derivation entries, a 7-character commit prefix and a short
  outcome detail (at most 120 characters). **No webhook payload
  bodies are stored.** Entries expire automatically **30 days**
  after they are written. The log is **not public**: there is no
  route that serves it (an earlier public `/events` page was
  removed in v0.3.0); the operator reads it through the KV store
  under the operator's own Cloudflare credentials.
- **Operational keys** that keep derivation idempotent, each with
  its own automatic expiry: in-flight claims (10 minutes),
  posted/failed Check markers (24 hours), a surface-discovery
  cache (1 hour), cached surface declarations (30 days), and a
  surface manifest holding record ids and declared key patterns
  per repository (30 days).
- **The App's own credential record** — the App's registration
  data and credentials (see the data inventory for the
  categories). It is the instance's own registration record, not
  user data; it persists while the instance is registered, and
  deleting it — a deliberate operator act — returns the instance
  to its dark, unregistered state. Secret values are never
  rendered in a page, a response, or a log.

Delivery-log and surface-manifest entries written before
v0.3.0 carried no automatic expiry. The operator deleted those
entries when v0.3.0 was deployed, so every entry the store now
holds expires on the schedule above.

## What the App sends, and to whom

- **Check runs to GitHub**: the derived state — key values,
  winning and losing record ids, and the ancestry that decided —
  posted to the commit it derived from. This is the App's output
  and its purpose.
  When the operator has configured signing, a Check also carries
  an Attestation section — two digests and an Ed25519 signature
  over the derivation (see `docs/SIGNING.md` in the App's
  repository). It is a public receipt that this App produced
  that derivation; it contains no user data.
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

## Uninstalling, and deleting your data

- **Uninstalling the App takes effect immediately.** The App can
  no longer read the repository or post Checks to it, and GitHub
  sends it no further deliveries for that installation. Nothing
  needs to be requested and no support contact is required.
- **What remains after an uninstall** is limited to delivery-log
  entries and, for repositories that declared a surface, the
  surface manifest that name the repository. Both expire
  automatically within 30 days (see above). The derived Check
  runs the App posted live on GitHub, under GitHub's retention,
  like any other check run.
- **Earlier deletion on request.** To have a repository's stored
  entries deleted before they expire, open an issue at the
  support address below naming the repository. The operator
  deletes the entries for that repository from the KV store and
  confirms on the issue. The same applies if a GitHub account is
  deleted: the App holds no account data beyond repository full
  names and installation ids in log entries, and the deletion
  route and the 30-day expiry cover all of it.

## Security

Webhook deliveries are accepted only after HMAC-SHA-256 signature
verification against the App's webhook secret; unsigned or
wrongly-signed deliveries are refused and nothing is recorded.
Installation access tokens are minted per derivation, cached only
in the receiver's memory while valid, and never stored.

If the operator confirms a security incident affecting data the
App holds, the operator will notify GitHub within 24 hours of
confirmation, and will describe the incident and the response in
the repository's issue tracker.

## Contact

Support and privacy contact for this instance is the public
issue tracker of its repository:
<https://github.com/patchwork-quilt/gitpp-app/issues>. This is
also the address for the deletion requests described above.
