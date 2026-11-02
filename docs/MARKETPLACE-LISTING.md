# Marketplace listing packet — gitpp-app

> Prepared 2026-11-02 (M3), against gitpp-app **v0.3.0**. Every
> field below is filled from verified facts; every claim in the
> copy is shipped and true today. Nothing here has been submitted.
> The submission itself — the org-owner click and acceptance of
> GitHub's Marketplace publisher terms — is Casey's (see the last
> section). Copy lengths were counted against GitHub's published
> listing specifications (see
> `files/IMPACT-AND-LANDSCAPE.md` §1 in the goal workspace for the
> sourced requirements).

## The listing fields

| Field | Value |
|---|---|
| App | gitpp-app (App ID 5419092, owned by the patchwork-quilt organisation) |
| Listing name | gitpp-app |
| Category | Project management (coordination state for agent teams). If the submission form's fixed list is consulted at submit time, nearest equivalents in order: Project management → Team collaboration → Continuous integration |
| Short description (40–80 chars) | `Deterministic, lossless resolution of conflicting claims on shared agent state` (78 chars; sentence case, no terminal punctuation, no app name, functionality not call-to-action) |
| Privacy policy URL | https://github.com/patchwork-quilt/gitpp-app/blob/main/docs/PRIVACY.md |
| Support URL | https://github.com/patchwork-quilt/gitpp-app/issues |
| App URL / homepage | https://gitpp-app.superinstance.dev (the landing page renders the exact manifest, the permission table, and the privacy/support links) |
| Documentation | https://github.com/patchwork-quilt/gitpp-app (README: endpoints, deploy, registration) and the normative spec at https://github.com/patchwork-quilt/git.pp-ng/blob/main/DESIGN.md |
| Pricing | **Free** — one plan, $0/month and $0/year (every plan must carry both prices). See "Pricing path" below |
| Publisher contact | Set in the org's Marketplace publisher profile at submission — CASEY-ONLY (see last section) |

### Introductory description (150–250 chars; begins with the app's name)

> gitpp-app derives a repository's declared coordination state from its records and posts it as an advisory Check on the pushed commit — the winning value for each key, the preserved losers, and the ancestry that decided.

(219 characters.)

### Detailed description (3–5 value propositions; ≤1,000 chars total)

> ### Who got it, who didn't, and why
> Two agents claim the same task or set the same freeze; the Check on the commit names the winner, the losers, and the rule that decided them. Nothing is silently overwritten.
>
> ### Losers are never deleted
> Every claim stays in the record and in the report. An authoritative dispute settlement can void a record's effects (fold law, git.pp-ng v0.2.0); a ratified accusation its author still stands behind is marked **contested**, not hidden.
>
> ### Advisory only — it never writes to your repo
> Three permissions — Metadata read, Contents read, Checks write — and the app never writes to a repository. The records live in your repo as plain git, the spec is open, uninstall is immediate, and stored data expires within 30 days.
>
> ### Proven in the open
> Live-day test 10/10: five agents, referee-chosen merge order, every Check matched an independent fold. Legibility 94.4% with cold readers. One fold, 1,155 conformance cases pinning the ports that ship.

(962 characters including headings, counted as typed.)

### The proof block (for the listing's evidence links)

- **Live-day 10/10** — five agents worked one shared state for a
  day; 5 branch Checks + 5 merge Checks, each matched an
  independent local fold of the same records exactly. Record:
  gitpp-app `README.md` / `docs/evidence/`.
- **Legibility 94.4%** (8.5/9) — cold readers predicting winners,
  values, and losers from the Check text, re-measured after the
  first pass's 88.9% miss and its fixes.
  Record: `docs/evidence/legibility.md`.
- **1,155-case conformance** — one corpus pinning the fold's
  TypeScript and Python ports byte-identically, including the
  retraction law (dispute + settlement, contested marking)
  shipped in git.pp-ng v0.2.0 and vendored here at v0.2.0. (The
  Elixir/beam port is a pre-law conformance spike and does not
  yet carry the retraction law — declared in the project
  DECISIONS.md, not hidden.)
- **Scale, stated at its measured width**: derivation exact at
  312 records; Check latency flat ~4–5 s to 300 records
  (project record, 2026-10-22). Nothing larger is claimed.

## Assets — required, with status

Two of the three asset classes are now produced (drafts for the
publisher's eye, in `docs/marketplace-assets/`); the screenshots
remain to be captured. Dimensions are GitHub's published
specifications.

| Asset | Specification | Status | Subject / source |
|---|---|---|---|
| Logo | ≥200×200 px, square/centered, transparent background recommended, avoid text (shown in a circular badge) | **PRODUCED** — `docs/marketplace-assets/logo-800.png` (800×800, transparent) | A quilt/patch mark in the org's existing visual language; no text |
| Feature card | 965×482 px custom background | **PRODUCED** — `docs/marketplace-assets/feature-card-965x482.png` (exact size) | The `git.pp state` Check answering a two-agent claim: winner, loser, deciding rule |
| Screenshots (up to 5, all same dimensions) | ≥1200 px wide, UI only, no browser chrome, short captions each | **NEEDS PRODUCING** | (1) A real `git.pp state` Check on SuperInstance/gitpp-demo-quilt; (2) a `git.pp surface` Check on patchwork-quilt/gitpp-dogfood-b1, including a named vanished record; (3) a Check showing a **contested** retraction; (4) the landing page's permission table; (5) the record files themselves under `.gitpp/records/` |

## The eight trust requirements (github-road.md §4) — status

M3's gate: the listing is held to the trust reviewer's eight
requirements. Each is marked against v0.3.0 as deployed.

1. **Metadata: Read as the only platform-baseline permission** —
   **DONE.** The manifest requests exactly metadata:read,
   contents:read, checks:write; the landing page renders the
   manifest verbatim.
2. **Contents: Read stated truthfully** — repository-wide as the
   platform grants it; the records-paths-only limit stated as
   published policy and public code, not as the grant — **DONE.**
   Said in those words on the landing page, in the README, and
   in the privacy policy.
3. **Checks: Write is the only write** — **DONE.** The App posts
   advisory Check runs and writes nothing else anywhere; it
   never writes to a repository.
4. **No Pull Requests permission** — **DONE.** Ancestry rides in
   Check output; PR comments were dropped as a surface precisely
   to keep this permission unrequested.
5. **No Administration, no repository creation** — **DONE.**
   Users create their own repositories and record branches.
6. **Minimal, validated webhook surface** — push and check_suite
   only (the manifest's list, as GitHub validated it);
   HMAC-SHA-256 signature verification before anything is
   recorded; derivation runs behind the 202 acknowledgement —
   **DONE.** Marketplace purchase events, when the listing
   exists, arrive as ordinary signed deliveries: the receiver
   already verifies, logs, and 202s any signed event, and a free
   plan has no purchase state to apply. No code change is needed
   for the free listing.
7. **A write tier, if ever offered, is a separate disclosed
   opt-in** — **DONE as designed.** The shipped App is the
   read-only tier only; no Contents: Write exists in the
   manifest, and none is implied by the listing copy.
8. **Privacy policy + data inventory written before the
   listing** — **DONE at v0.3.0.** `docs/PRIVACY.md` and
   `docs/DATA-INVENTORY.md` are final (no DRAFT markings) and
   code-true: the delivery log is operator-only (the public
   `/events` route was removed), all six KV stores carry coded
   retentions (event log and surface manifest: 30 days), the
   uninstall/deletion story is stated (immediate self-service
   uninstall; stored entries expire within 30 days or are
   deleted sooner on request), and the 24-hour
   incident-notification commitment is made in the policy.

Plus the road's §5 support requirement — **an org-level support
surface** (a named human is a publishing authority, not a support
desk): **READY.** Support is the public issue tracker of the
org-owned repository,
<https://github.com/patchwork-quilt/gitpp-app/issues>, named in
the privacy policy, the data inventory, and the landing page.

Plus GitHub's customer-experience expectations (landscape memo
§1.3): account deletion without a support call — **DONE** by
construction (GitHub-side uninstall is immediate; the App holds
no accounts); user data deleted within 30 days of a request or
of the relationship's end — **DONE** (30-day coded expiry +
deletion-on-request procedure, both in the published policy);
24-hour incident notification to GitHub — **DONE** as a stated
commitment in the policy.

## Pricing path

The listing launches **free**, and the free tier is the product.
Paid plans are unreachable until the owning organisation is a
**verified publisher** with roughly **100 installations** — both
are earned with the free listing, in that order. GitHub retains
5% of paid transactions and pays out monthly once revenue passes
$500; neither figure binds anything today. No paid plan should
be added until an in-app account surface (current plan, price,
usage, visible immediately) exists — the free listing needs none.

## CASEY-ONLY — what remains, and only this

1. **Produce or commission the three image assets** (table
   above), or delegate their production.
2. **Submit the listing** from the patchwork-quilt org owner
   account: GitHub requires an organisation owner to submit (the
   App-manager role is not sufficient), including setting the
   publisher contact information in the org's Marketplace
   publisher profile and **accepting GitHub's Marketplace
   publisher terms**. This is the one action with the operator's
   name on it; everything above it is prepared.
3. Nothing else. In particular, the 30-day retention period is
   shipped as a reversible default (two constants in
   `worker.js`); changing it is a one-line edit and a redeploy,
   not a submission blocker.
