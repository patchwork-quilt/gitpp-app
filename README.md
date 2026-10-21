# gitpp-app

**git.pp, as a GitHub App: when agents and humans finish work
concurrently against the same shared state, gitpp-app derives the one
deterministic state from their provenance-carrying records and posts
it as a Check on the pull request — winner, preserved losers, and the
ancestry that decided.** For teams running several coding agents
against shared configuration, task claims, and release state, who are
tired of untangling collisions by hand and losing the losing work.

Part of the git.pp family (patchwork-quilt). The fold specification
and conformance corpus live in `git.pp-ng`; this repo is only the
GitHub-facing receiver and, once registered, the App.

## Status

**Receiver live, App unregistered — dark by design.** The Worker in
this repo is deployed at <https://gitpp-app.superinstance.dev> ahead
of registration, so the owner's one click has somewhere real to land:

- `GET /` — what the App will be, and the registration desk: the
  exact manifest the button sends to GitHub, rendered in full.
- `GET /health` — `{"status":"dark","app":"gitpp-app","registered":false}`.
- `POST /webhook` — answers `503 {"error":"not configured"}` until a
  webhook secret exists. That is the honest state, not an error.
- No derivation yet: the receiver accepts and logs events; deriving
  state from them is the next M1 step, after registration.

## The permission manifest, in plain words

`manifest.json` in this repo is what GitHub will be asked to create.
Read tier only:

| Permission | Level | Why |
|---|---|---|
| Metadata | Read | Platform baseline. |
| Contents | Read | Read the record files. **GitHub grants Contents repository-wide; there is no path-scoped grant.** The app touches record paths only as a matter of published policy and open source — the limit is policy, enforced by this code being public, not by the grant itself. This sentence is the honest version and it is the version the listing will carry. |
| Checks | Write | Post the derived state as a Check run. |

Nothing else: no pull-request permission (the deciding ancestry
rides in the Check's own output), no administration, no repository
creation, no contents write. Events: `push`, `pull_request`,
`installation`, `installation_repositories`.

What the Check does and does not claim, in the specification's own
terms: it resolves **labelled key conflicts mechanically**; it does
**not** settle semantic conflicts; content digests authenticate
*content*, not authorship; and the resolution rule's tie-break is
ancestry — **arrival order is never an input**.

Collection cost, and why the receiver is built webhook-fed with
clone-class (tarball) collection rather than per-file REST reads,
is modelled in [BUDGET.md](BUDGET.md).

## Registration runbook (the owner, once)

1. Open <https://gitpp-app.superinstance.dev>. Read the manifest on
   the page — it is byte-identical to `manifest.json` here; the
   deploy script refuses to deploy if they drift.
2. Click **Create the gitpp-app GitHub App** and confirm on GitHub.
   (Manifest-flow names are first-come; if `gitpp-app` is taken,
   GitHub will say so at this step, and the name in both files gets
   adjusted before retrying.)
3. GitHub redirects back to `/setup/callback`, which exchanges the
   one-time code and displays the new App's credentials **exactly
   once** — App ID, slug, client ID, webhook secret, private key.
   The receiver stores nothing and logs nothing; if the page is
   missed, a new private key can be generated under the App's
   GitHub settings instead.
4. Put the credentials in the Secure Vault (private key + webhook
   secret at minimum). Never in a repo, never in a ticket.
5. Set the Worker's `WEBHOOK_SECRET` secret to the webhook secret
   from step 3 — that is what lifts the receiver out of its dark
   state (`/webhook` starts answering 202 to signature-valid events).
6. Install the App on one repository (GitHub's install flow, per-repo
   selection) and open a test PR. Expect one structured log line per
   event in the Worker's logs; derivation arrives with the next M1
   step.

## Deploy

`deploy/deploy.py` uploads `worker.js` via the fleet's OAuth route
and asserts the embedded manifest matches `manifest.json`. The
hostname is a Workers Custom Domain on the same script.

## Licence

MIT — SuperInstance.
