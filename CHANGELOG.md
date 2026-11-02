# Changelog

All notable changes to gitpp-app. Versions name this repository's
mainline; a version is tagged only when the tagged tree is the
deployed Worker (see the 0.1.0 note).

## [0.3.0] — 2026-11-02

M3 gate-closing: the delivery log is operator-only, the two
unexpired stores gain retention, and the privacy filing is final.

- **`GET /events` is removed.** The recorded delivery ring was
  public by design during the dogfood phase; gating it was a hard
  Marketplace gate (Casey ruling, 2026-11-02). There is no route
  and no header-auth variant: this Worker holds no operator
  credential of its own — its only secrets are the App's GitHub
  credentials, which are not reused across trust domains — so the
  path falls through to the same 404 as every unlisted path. The
  operator reads the ring through the CREDS store under their own
  Cloudflare credentials; per-delivery lines also land in the
  Workers logs. The landing page and README say so in the same
  words.
- **Retention, implemented.** The event log (`evt:` keys) and the
  surface manifest (`surfmanifest:<repo>`) were the family's two
  stores written without expiry. Both now write with a 30-day
  `expirationTtl`, set by two named constants in worker.js
  (`EVENT_LOG_RETENTION_SECONDS`,
  `SURFACE_MANIFEST_RETENTION_SECONDS`) — operator-configurable;
  30 days matches the surface declaration cache's existing period
  and the window GitHub's Marketplace customer-experience
  standard allows for deleting user data. A lapsed manifest
  simply re-bases the history-integrity check at the next posted
  derivation. Entries written before this release carried no
  expiry; the operator deleted them (and the pre-2026-10-22
  legacy `events` array) from the live store at deployment, so
  every entry now held expires on a stated schedule. S24 in the
  suite pins the new TTLs and the unchanged ones (inflight
  600 s, posted 24 h, surfinfo 1 h, surfdecl 30 d).
- **Privacy filing final.** `docs/PRIVACY.md` and
  `docs/DATA-INVENTORY.md` lose their DRAFT markings: every
  statement is now true of the code — the gated log, the coded
  retentions, the uninstall/deletion story (uninstall is
  immediate and self-service; stored entries expire within
  30 days or sooner on request through the support route), the
  24-hour incident-notification commitment, and the operator
  contact (the repository's public issue tracker).
- **Landing page completed.** `landingPage()` gains a "Privacy,
  data, and support" section: the privacy policy and data
  inventory, the normative spec (git.pp-ng DESIGN.md) and the
  conformance corpus, the support route, and the statement that
  the delivery log is not public. The former `/events` link is
  gone.
- Tests: 152 assertions (was 144) — S24 pins the retention TTLs
  across every scenario write.

## [0.2.0] — 2026-11-02

Retraction is fold law in the vendored engine (git.pp-ng v0.2.0, Casey
ruling 2026-11-02).

- Engine re-vendored from git.pp-ng `src/fold.ts` at `c37ed87`
  (v0.2.0), via gitpp-action's `lib/fold.ts`, transpiled by the same
  recipe as the previous vendoring (bun build + three mechanical
  rewrites; the recipe was first re-proven byte-identical against the
  previous vendored body). Dispute + settlement records now fold: an
  authoritative settlement upholding a dispute voids the target
  record's effects; unattributed record sets are dispute-inert, so
  existing projects derive exactly as before.
- The state Check gains a **Retractions** section (the same wording as
  the Action's report): retracted records named with the upheld dispute
  that voided them; a ratified accusation the record's author neither
  filed nor settled is marked **contested**, with dispute/settlement
  provenance; open disputes are listed as having no effect on the
  state. In the byte-budget cascade the section is dropped last.
- App-layer display helper renamed `kindOf` → `displayKind`: the
  v0.2.0 engine declares its own `kindOf` in the same module scope, and
  a duplicate declaration is a SyntaxError in module code. (Caught by
  the surface suite before deploy, not in production.)
- The STATE-ONLY ruling (same packet: closure differences stay
  informational) is noted in an app-layer comment at the vendored
  block's boundary — the transpile strips comments, so the ruling
  comment itself lives at the decision point in git.pp-ng's two ports
  and in gitpp-action's comment-preserving vendoring.
- Tests: 144 assertions (was 138) — S23 pins the contested marking, the
  unmarked self-retraction, and the inert open dispute.

## [0.1.0] — 2026-11-02

The first versioned line: the registered App, the derivation loop,
and declared surfaces, as they stand on main.

- **2026-10-21 — Registration.** The receiver lands dark (landing
  page + App Manifest registration desk, signature-gated webhook
  intake); `gitpp-app` (App ID 5419092) is registered through the
  manifest flow, its record stored in the CREDS KV namespace by the
  conversion callback. Manifest corrected to GitHub's validation:
  events are `push` and `check_suite` only.
- **2026-10-22 — M1: the derivation loop.** On a verified push /
  check_suite event, behind the 202 acknowledgement: mint an
  installation token from the stored key, fetch the repository
  tarball in one call, gate and fold the `.gitpp/records` with the
  vendored engine, and post the derived state as an advisory Check
  named `git.pp state` — coalesced to one Check per commit, with
  per-entry event-ring keys so simultaneous deliveries cannot
  overwrite each other. Playtest fixes followed the same day
  (input gate, visible failures, idempotent posting, report
  budget, legibility).
- **2026-10-23 — Mapping B: declared surfaces.** A repository can
  declare a coordination surface (`surface.json` + records on the
  orphan branch `gitpp/state`); the Worker derives it as a second
  Check, `git.pp surface`, with proposal previews and a
  history-integrity line. Same day: surface report-text and
  adversarial rounds (duplicate ids named at intake, monotonic
  discovery cache, duplicate declarations refused), the vendored
  fold refreshed for the `__proto__` input-gate fix (git.pp-ng
  issue #38), and the SCALE-1 fixes (byte-budgeted Check text,
  pre-post exists recheck).
- **2026-11-02 — Production pass.** MIT LICENSE added (the repo
  had none; every sibling carries MIT). The surface harness
  (`surface.test.mjs`, 138 checks) now runs in CI on push and
  pull request. README status refreshed to the re-verified
  installation state: two installations — 177983265 (SuperInstance:
  gitpp-demo-quilt, gitpp-dogfood-day1, gitpp-dogfood-b1) and
  173944467 (patchwork-quilt: gitpp-action) — with probe pushes
  returning the expected state and surface Checks. Draft privacy
  policy and data inventory added under `docs/` for the M3
  Marketplace step.

- **2026-11-02 — Reconciliation deploy (tagging gate, resolved).**
  Earlier today this entry stood untagged: the deployed Worker and
  this repo had diverged in both directions (verified by diff) —
  the landing page deployed 2026-10-26 was not in this repo, and
  the SCALE-1 fixes above were not in the deployed script. The
  deployed script was re-extracted from Cloudflare and re-diffed
  against main (`6822a8c`): the divergence was still exactly those
  two items, plus one inert header comment (the org-tidy repo
  reference). The deployed `landingPage()` was ported into
  `worker.js` byte-for-byte (commit `c413e54`; surface suite
  138 passed, 0 failed; CI green), the tree was deployed via
  `deploy/deploy.py`, and the deploy was verified end-to-end:
  `/health` returns `{"status":"live","registered":true}`, the
  landing page served before and after is byte-identical, and a
  probe push to `SuperInstance/gitpp-demo-quilt` returned the
  `git.pp state` Check ("poc-quilt-1"). Production now runs this
  tree — including SCALE-1 — and the page production uniquely had
  is preserved in the repo. **v0.1.0 is tagged on this tree: the
  first tag at which repo == deployed.**
