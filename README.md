# gitpp-app

**gitpp-app watches a repository's provenance-carrying git.pp records,
derives the one deterministic state from them, and posts that state as
a Check on the pushed commit — the winning value, the preserved losers,
and the ancestry that decided.**

For teams running several coding agents — or agents plus humans —
against the same shared state (configuration keys, task claims,
release freezes), who are tired of untangling collisions by hand and
silently losing the losing work. Not for code-level merge conflicts:
the fold resolves *labelled key* conflicts mechanically, and this
document says plainly where that boundary sits.

Today both halves of that sentence are live: the receiver verifies
and records deliveries, and the derivation step fetches the records,
folds them, and posts the answer as a Check on the commit. The status
section below says exactly what is proven, before you depend on it.

## Run it now: look at the live instance

This App is registered and running. The smallest complete thing you
can do with it right now is look at it:

```sh
curl https://gitpp-app.superinstance.dev/health
# {"status":"live","app":"gitpp-app","registered":true}

curl https://gitpp-app.superinstance.dev/events
# [{"t":"2026-10-22T00:43:43.700Z","event":"push",
#   "repo":"patchwork-quilt/gitpp-demo-quilt","installation":173944467,
#   "action":null},
#  {"t":"2026-10-22T00:43:44.987Z","event":"check_suite",
#   "repo":"patchwork-quilt/gitpp-demo-quilt","installation":173944467,
#   "action":"requested"}]
```

What just happened: `/health` reports that a registered App's record
is sitting in the Worker's credential store. `/events` is the ring of
webhook deliveries the receiver has accepted — an entry exists only
if its HMAC signature verified against the App's webhook secret
first. The two entries above are from registration day: a push to the
dogfood repository this App is installed on, and the check suite
GitHub requested alongside it. The ring is live; it holds the last 20
verified deliveries, newest last.

## Status — what exists, what does not

**Exists (verified 2026-10-21; derivation verified 2026-10-22):**

- The App itself: `gitpp-app`, App ID 5419092,
  <https://github.com/apps/gitpp-app>, owned by the patchwork-quilt
  org, registered through the App Manifest flow from this repo's
  landing page.
- One installation (ID 173944467) covering three repositories:
  `patchwork-quilt/gitpp-demo-quilt` (the records dogfood, from
  registration day), `patchwork-quilt/gitpp-action` (added
  2026-10-22 as the no-records control — its pushes derive to
  `skipped-no-records`, the designed silence, observed live), and
  `patchwork-quilt/gitpp-dogfood-day1` (the M2 live-day repo).
- Signature-verified webhook intake: the receiver verifies
  `X-Hub-Signature-256` against the stored webhook secret and
  records each accepted delivery in the ring above.
- The derivation loop: behind the 202, the Worker mints an
  installation token from the stored key, fetches the pushed
  commit's tarball (one API call), extracts `.gitpp/records/`,
  folds them with the vendored engine, and posts the derived state
  as an advisory check run named `git.pp state` on the commit —
  state, winners, losers with reasons, and the **qualifications
  line**, the Check's closing blockquote: *"Mechanical resolution
  of labelled key conflicts only; the fold does not settle semantic
  conflicts. Digests authenticate content, not authorship. Arrival
  order is never an input."* The conclusion is `neutral`, with one
  exception: input the App cannot read is never silent — a file
  that fails to parse or fails validation is rejected by name in
  the Check while the surviving records still derive, and a
  records surface it cannot read at all earns a `failure` Check
  titled "could not derive", naming every rejected file. A push
  and its check-suite for the same commit coalesce to one Check. A
  push that changes no records still re-derives and posts a fresh
  Check on the new commit — derivation is per commit, not per
  record-change. Repositories with no `.gitpp/records` get no
  Check, though their deliveries still appear in `/events`. Proven
  live on the demo repository: push → Check showing
  `config.timeout = 45`, winner `override-1`, losers
  `task-a`/`task-b`/`task-d` preserved.
- The App's credentials, held in the Worker's `CREDS` KV store —
  never in this repo, never rendered in a page or a log.

**Does not exist yet:**

- **A delta/frontier fetch.** Every derivation reads the repository
  tarball for the pushed commit in full (one API call) — cheap at
  this scale, but there is no incremental path yet; the engine's
  frontier machinery is not wired into this Worker.
- **A second installation.** The app has exactly one installation
  so far. The code is installation-driven (every derivation uses
  the webhook's own installation id) and nothing in it is specific
  to the repositories named above.

The landing page at <https://gitpp-app.superinstance.dev> now leads
with the live status and keeps the manifest desk below it — read the
desk as the register-your-own entry point (below).

## The model

Five concepts, in the order they compose:

- **Record** — a JSON claim about one key of shared state: the value,
  who asserted it, and which records it descends from (its ancestry).
  Records are files in the repository, written by agents and humans
  through ordinary git.
- **Fold** — the deterministic derivation over a set of records. For
  each key it names one winner; every loser is preserved and remains
  cloneable. The tie-break is ancestry — *arrival order is never an
  input*. The fold's specification and conformance corpus live in
  `git.pp-ng`; this repo does not redefine them.
- **Webhook intake** — GitHub delivers events to the receiver, which
  verifies the HMAC-SHA-256 signature, records a five-field summary
  (time, event, repo, installation, action — never payload bodies),
  and acknowledges immediately.
- **Installation** — the App acts per installation, with an
  installation access token minted from its private key. The token
  this App actually received carries exactly the manifest's
  permissions: checks write, contents read, metadata read (observed
  at mint time, 2026-10-21).
- **Check** — the output surface the derivation step writes: a
  check run on the pushed commit (pull requests carrying that commit
  display it) whose output carries the derived state and the
  deciding ancestry. This is also why the ancestry
  needs no pull-request permission: it rides in the Check's own
  output, not in comments.

```
agent / human ──push records──▶ GitHub ──webhook (HMAC-signed)──▶ this Worker
Worker: verify signature → record delivery → 202        ✓ live today
        └─▶ fetch records → fold → post Check            ✓ live today
```

### Endpoints, and how each behaves

| Route | Behaviour |
|---|---|
| `GET /` | Landing page and registration desk. Renders the exact manifest JSON a registration would send, next to the permission table. |
| `GET /health` | `{"status":"live","app":"gitpp-app","registered":true}` once a registered App's record is in the `CREDS` store. A fresh deployment with an empty store answers `{"status":"dark",...,"registered":false}` — that is the honest pre-registration state, not an error. |
| `POST /webhook` | No stored App record → `503 {"error":"not configured"}`. Stored record → signature verified: mismatch → `401`, nothing recorded; match → delivery recorded, `202`. |
| `GET /events` | The recorded ring as JSON (last 20, newest last). **Public by design for the dogfood phase** — it is the proof surface that events are arriving. It carries no payload bodies and no sender data, and it gets gated before any Marketplace step. |
| `GET\|POST /setup/callback` | The manifest-flow conversion endpoint. Exchanges the single-use code GitHub redirects with, stores the resulting App record in `CREDS`, and renders only the App's id, URL, and owner login. |

Failure behaviour, stated:

- **Wrong signature** → `401`; nothing is recorded.
- **Signature-valid body that is not JSON** → recorded with null
  repo/action fields; a valid signature with an unparseable body
  carries nothing else to extract.
- **Missing or rejected manifest code** at the callback → an error
  page, nothing stored. Codes are single-use and short-lived; the
  endpoint fails closed.
- **Credential-store write failure** during conversion → a "Storage
  failed" page. The App still exists on GitHub; the recovery is in
  the runbook below. This has happened once — see *The binding that
  vanished*.

## Permissions — the manifest, in plain words

`manifest.json` in this repo is byte-identical to the manifest the
App was registered with (`deploy/deploy.py` refuses to deploy if
the copy embedded in `worker.js` drifts from it). Two read grants,
and the one write the Check requires:

| Permission | Level | Why |
|---|---|---|
| Metadata | Read | Platform baseline: which repos exist, who installed the App. |
| Contents | Read | To read the record files. **GitHub grants Contents repository-wide; there is no path-scoped grant.** The App touches record paths only as a matter of published policy and open source — the limit is policy, enforced by this code being public, not by the grant itself. This sentence is the honest version, and it is the version any listing will carry. |
| Checks | Write | To post the derived state as a Check run on the pushed commit. |

Nothing else: no pull-request permission, no administration, no
repository creation, no contents write.

**Events: `push` and `check_suite` — and the two absences are both
deliberate.** `pull_request` is absent because GitHub's manifest
validation rejected it: those events require the `pull_requests`
permission, which this App does not request (the ancestry rides in
the Check output instead). `installation` and
`installation_repositories` (the misspelling is GitHub's own, from
its validation error) are absent because GitHub delivers
installation events to every App by default and refuses them as
manifest declarations. Receipt: the 2026-10-21 rejection and
correction are in this repo's git history (`07fc1a3`), and the
registered manifest above is what survived validation.

## Honest limits

- Derivation is per-commit and whole-snapshot: each push fetches
  the full tarball and folds from scratch. Correct first, fast
  later — the incremental path is designed, not built.
- Coalescing is per commit, in two layers: an in-flight claim
  (10 min TTL) and a posted marker (24 h TTL) in the credential
  store, plus — before anything posts — a check against GitHub
  itself for an existing `git.pp state` run on that commit. A push
  and its check-suite for the same commit produce one Check. The
  public event ring now stores one key per entry, so simultaneous
  deliveries no longer overwrite each other; the ring remains a
  courtesy log, and the Check count is the invariant.
- The fold resolves labelled key conflicts mechanically. It does
  **not** settle semantic conflicts, and a gitpp Check must never be
  read as claiming it did.
- Content digests authenticate *content*, not authorship. A
  record's ancestry says what it descends from, not who is honest.
- Contents read is repository-wide by platform design; the
  record-paths-only limit is policy and public code, not the grant.
- `/events` is public metadata during the dogfood phase.

## The deep layer

### Why this is an App at all — the Checks API refuses Actions tokens

Creating a check run requires a GitHub App token (or a fine-grained
PAT). A workflow's built-in `GITHUB_TOKEN` is refused by the Checks
API endpoints — verified against GitHub's Checks API documentation,
2026-10-21, in the programme's platform-facts record. That single
platform fact forces the family's shape: **gitpp-action** advises
from inside CI, where its native surface is the job summary; only an
App can post the real Check. If you arrived here wanting the fold in
your pipeline today with no install, the Action is the door — see
the shelf below.

### The limit that actually binds is not the famous one

An installation token's primary limit — 5,000 requests/hour — is a
*floor* that scales with repos and users (to 12,500; 15,000 on
GHEC). The constraint that binds this App's design is the secondary
limit: **80 content-generating requests per minute, 500 per hour**.
Posting a Check is content-generating. So derivation must coalesce
per commit instead of firing per event: coalescing is per commit,
so the push and the check-suite for one commit produce one fold and
one Check — and each new commit gets its own. This is a design
requirement, not an optimisation; it was stated before the
derivation step was built, and the build inherited it.
(BUDGET.md §1, with the correction recorded there.)

The same document does the collection arithmetic. Reading records
file-by-file over REST costs N+2 API calls per derivation; at the
demo scale of 62 records (62 is the poc-scale-1 record set; the
dogfood repository below carries 8) and a modelled 900
derivations/day, that is ≈ 5,940 calls/hour — over the primary floor
before any other API use. Clone-class collection (one fetch
operation plus bytes —
a tarball on Workers, which has no git binary) lands at ≈ 180 REST
calls/hour, about 4% of the budget, with the real cost moved to
bandwidth and fold CPU, which are ours to provision. That is why
the receiver is webhook-fed and why the fold's checkpoint/delta
machinery matters: repeat derivations re-read a frontier and a
tail, not the world. BUDGET.md is labelled a model, not a
measurement — read it as one.

### The 10-second acknowledgment shapes the receiver

GitHub expects a webhook endpoint to respond within 10 seconds, so
everything expensive lives behind the acknowledgment. What the
receiver does inside the window is deliberately small: verify the
signature, record five fields, answer 202. `worker.js` is one file
and the intake path is most of it — the smallness is the design,
and the derivation step runs behind the ack, never inside it.

### The binding that vanished

On registration day, the conversion callback reported "Storage
failed": GitHub had created the App, but the receiver stored
nothing. Root cause: the Worker script-upload route silently drops
non-secret bindings on this account, so the `CREDS` KV binding —
declared in the deploy metadata all along — was not attached at
runtime, and the callback's write had nowhere to land. The manifest
code was single-use, so the credentials were recovered from the
App's GitHub settings instead (a fresh webhook secret and a
generated private key, written into `CREDS` from the operator
side), and `/health` flipped to live when the record landed.

The generalised lesson is baked into `deploy/deploy.py`: after
every upload it re-attaches the bindings through the settings
PATCH route, which is the route that holds. A deploy that reports
success is not evidence the bindings exist; verify the settings,
not the upload response.

### Verify it yourself

- `curl https://gitpp-app.superinstance.dev/health` and `/events` —
  the outputs at the top of this document, reproducible now.
- Webhook negatives: `POST /webhook` with no valid signature and
  watch it refuse (`401` against the live instance; `503` against
  any deployment whose store is still empty).
- Manifest integrity: `python3 deploy/deploy.py` refuses to deploy
  if the manifest embedded in `worker.js` differs from
  `manifest.json`, and prints the comparison before uploading.
- Fold claims trace sideways, not to this README: the engine the
  derivation step calls is specified in `git.pp-ng`, and its
  measured ledger is that repo's RESULTS.md (three independent
  ports passing one conformance corpus byte-identically). Anything
  here that reads as a claim about the fold should be checked
  there.

## Registration

### How this instance was registered

On 2026-10-21, through the App Manifest flow starting from this
repo's landing page, so the App is owned by the patchwork-quilt
org: **gitpp-app, ID 5419092, <https://github.com/apps/gitpp-app>**.
It is installed on exactly one repository,
`patchwork-quilt/gitpp-demo-quilt` (installation 173944467). The
first submission was rejected by GitHub's manifest validation over
the event list; the correction narrowed the events and never
widened a permission. The callback's credential store failed once
(*The binding that vanished*, above) and the credentials were
recovered via the App's settings; the record now lives in the
`CREDS` KV namespace (title `gitpp-app-creds`) under the key `app`,
with the delivery ring under `events`.

### Register your own

1. Deploy the Worker first (see Deploy), so your
   `/setup/callback` exists.
2. Choose an unused app name — manifest names are first-come. Set
   it, plus `url`, `hook_attributes.url`, and `redirect_url` for
   your deployment, in **both** `manifest.json` and the manifest
   embedded in `worker.js`; the deploy script refuses to ship if
   they differ.
3. Open the landing page and read the manifest it renders — it is
   exactly what the form sends. Submit, and confirm on GitHub.
   **The whole flow — click, GitHub's confirmation, and the
   callback exchange — must complete within one hour**; GitHub
   expires the manifest code. It takes two unhurried minutes.
4. The callback exchanges the code and stores the App's record in
   the `CREDS` store automatically — nothing to copy, nothing to
   vault by hand, and no secret ever appears in a page or a log.
   The confirmation page shows only the App's id, its GitHub URL,
   and the owner login. `/health` flips to `registered: true`.
5. Install the App on one repository (per-repo selection in
   GitHub's install flow) and push. Verified deliveries appear at
   `/events`.
6. If the callback shows "Storage failed": the App still exists on
   GitHub. Under the App's settings, set a webhook secret and
   generate a private key, then write the record — app id,
   webhook secret, PEM — as JSON into your `CREDS` namespace
   under `app`. That is the recovery this instance used.

## Deploy

`python3 deploy/deploy.py` uploads `worker.js` via the fleet's
OAuth route, asserts the embedded manifest matches `manifest.json`
(refusing on drift), re-attaches the `CREDS` KV binding via the
settings PATCH after every upload (see *The binding that vanished*),
and attaches the `gitpp-app.superinstance.dev` Workers Custom
Domain. The KV namespace id is in `deploy/metadata.json`.

## The shelf

One tool, one repo — take the one whose shape fits:

- **[gitpp-action](https://github.com/patchwork-quilt/gitpp-action)**
  — the fold as a GitHub Action. Start here to get derived state in
  your own CI today: no install, no App, removable by deleting one
  workflow file. Its native surface is the job summary.
- **[git.pp-ng](https://github.com/patchwork-quilt/git.pp-ng)** —
  the specification, the fold engine, the conformance corpus, and
  RESULTS.md, the measured ledger. Read it to know exactly what
  the fold does and does not claim.
- **[gitpp-demo-quilt](https://github.com/patchwork-quilt/gitpp-demo-quilt)**
  — the dogfood repository this App is installed on: the
  poc-quilt-1 record set (poc-quilt-1 is the dogfood project —
  the programme's original eight-record proof-of-concept set)
  hosted on GitHub under `.gitpp/records`, whose derived state is
  `config.timeout = 45`, winner `override-1`, losers preserved.

## Licence

MIT — SuperInstance.
