# Changelog

All notable changes to gitpp-app. Versions name this repository's
mainline; a version is tagged only when the tagged tree is the
deployed Worker (see the 0.1.0 note).

## [0.1.0] — untagged

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

**Why untagged:** the deployed Worker and this repo have diverged
in both directions (verified by diff, 2026-11-02): the landing page
deployed 2026-10-26 is not in this repo, and the SCALE-1 fixes
above are not in the deployed script. The 0.1.0 tag waits for the
reconciliation deploy that makes this tree the deployed Worker;
tagging earlier would claim a version for code that is not what
runs. See README → Status.
