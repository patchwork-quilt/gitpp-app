// gitpp-app — the GitHub App receiver for git.pp.
//
// DARK BY DESIGN: no GitHub App is registered yet. This Worker is the
// receiving half, deployed ahead of registration so the owner's single
// click (the App Manifest flow, from the landing page below) has
// somewhere real to land. Until the conversion callback stores the new
// App's record in the CREDS KV namespace, the webhook endpoint answers
// 503 "not configured" — that is the honest state, not an error.
//
// What this file does today:
//   GET  /               landing page + the registration form. The page
//                        renders the exact manifest JSON that the form
//                        will POST to GitHub, so the human sees precisely
//                        what they are creating before clicking.
//   GET|POST /setup/callback?code=...
//                        the manifest-flow conversion: exchanges the
//                        temporary code and stores the FULL conversion
//                        JSON in CREDS under "app". The rendered page
//                        shows only success, the app id, its html_url,
//                        and the owner login — no secret value ever
//                        appears in a response or a log.
//   POST /webhook        signature-verified event intake. The webhook
//                        secret is read from the stored CREDS "app"
//                        record. Verified events are appended to a
//                        capped ring in CREDS under "events" (202), and
//                        push / check_suite events trigger derivation
//                        behind the ack (see DERIVATION LOOP below): the
//                        repo's .gitpp records are fetched as a tarball,
//                        folded, and posted back as an advisory Check.
//   GET  /events         the recorded event ring, as JSON. Public by
//                        design for the dogfood phase (see README).
//   GET  /health         {"status":"dark",...} until CREDS holds an
//                        "app" record, then {"status":"live",...}.
//
// Do not add logging of the conversion response anywhere in this file.

// The App Manifest, byte-identical to manifest.json in this repo.
// deploy/deploy.py refuses to deploy if the two drift apart.
const MANIFEST = /*MANIFEST-BEGIN*/{
  "name": "gitpp-app",
  "url": "https://gitpp-app.superinstance.dev",
  "description": "Deterministic, lossless resolution of labelled key conflicts in shared agent state — winner, losers, and the ancestry that decided; it does not settle semantic conflicts, and content digests authenticate content, not authorship.",
  "public": true,
  "hook_attributes": {
    "url": "https://gitpp-app.superinstance.dev/webhook"
  },
  "redirect_url": "https://gitpp-app.superinstance.dev/setup/callback",
  "default_permissions": {
    "metadata": "read",
    "contents": "read",
    "checks": "write"
  },
  "default_events": [
    "push",
    "check_suite"
  ]
}/*MANIFEST-END*/;

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function page(title, body) {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body { font-family: ui-monospace, Menlo, Consolas, monospace; margin: 2rem auto; max-width: 52rem; padding: 0 1rem; line-height: 1.5; color: #111; }
  pre { border: 1px solid #999; padding: 1rem; overflow-x: auto; background: #f7f7f7; font-size: 0.85rem; }
  table { border-collapse: collapse; } td, th { border: 1px solid #999; padding: 0.3rem 0.6rem; text-align: left; }
  button { font: inherit; padding: 0.5rem 1rem; cursor: pointer; }
  .warn { border: 2px solid #111; padding: 0.5rem 1rem; }
</style>
</head>
<body>
${body}
</body>
</html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

function landingPage() {
  const manifestJson = JSON.stringify(MANIFEST, null, 2);
  return page(
    "gitpp-app — the git.pp GitHub App",
    `<h1>gitpp-app</h1>
<p><strong>Status: live.</strong> The GitHub App exists —
<a href="https://github.com/apps/gitpp-app">github.com/apps/gitpp-app</a>
(app 5419092, owned by patchwork-quilt) — and is installed on
patchwork-quilt/gitpp-demo-quilt. The receiver behind this page verifies
and records its webhook deliveries (<a href="/events">recent events</a>;
<a href="/health">health</a>). On each push it now derives the repo's
git.pp state from its records and posts it as an advisory Check on the
commit — the derivation loop below the ack, recorded in the same event
ring.</p>
<p>gitpp-app brings git.pp to GitHub: when agents and humans complete
work concurrently against the same shared state — configuration keys, task
claims, release freezes — it derives one deterministic state from their
provenance-carrying records and posts it as a Check on the pull request:
the winning value, the preserved losers, and the ancestry that decided.
It resolves labelled key conflicts mechanically; it does not settle
semantic conflicts.</p>
<h2>The manifest this instance was created from</h2>
<p>Shown in full — exactly this JSON, nothing hidden. It was sent to
GitHub's App Manifest flow on the patchwork-quilt organisation's page, so
the app is owned by the org, not by a personal account. The button below
sends the same manifest again — that is how you register <em>your own</em>
instance (a fork gets its own app, its own credentials, its own store);
it does not change this instance.</p>
<pre>${esc(manifestJson)}</pre>
<table>
<tr><th>Permission</th><th>Level</th><th>Why</th></tr>
<tr><td>Metadata</td><td>Read</td><td>Platform baseline: which repos exist, who installed the app.</td></tr>
<tr><td>Contents</td><td>Read</td><td>To read the record files. GitHub grants Contents repository-wide; there is no narrower grant. The app touches record paths only as a matter of published policy and open source — the limit is policy, not the grant, and this page says so in those words.</td></tr>
<tr><td>Checks</td><td>Write</td><td>To post the derived state as a Check run on pull requests.</td></tr>
</table>
<p>Nothing else. No pull-request permission (the ancestry rides in the
Check's own output), no administration, no repository creation, no
contents write. Events: push and check_suite (installation events
are delivered to every app by default and cannot be listed;
pull_request events would require a pull-requests permission this
app deliberately does not request — learned from GitHub's own
manifest validation, 2026-10-21).</p>
<form action="https://github.com/organizations/patchwork-quilt/settings/apps/new" method="post">
<input type="hidden" name="manifest" value="${esc(JSON.stringify(MANIFEST))}">
<p><button type="submit">Register your own instance with this manifest</button></p>
</form>
<p>After GitHub confirms, it redirects back here with a one-time code;
this site exchanges it and stores the new App's credentials directly in
its own credential store — nothing to copy, nothing to vault by hand.
The confirmation page shows only the app's id, its GitHub URL, and the
owning org; no secret value is ever displayed or logged by this
site.</p>`,
  );
}

// UNTESTED BY DESIGN: this path can only be exercised by a real
// registration click (GitHub issues the code only inside the manifest
// flow, and each code is single-use). It will be verified on the day the
// owner clicks — the runbook in README.md covers what to expect. Until
// then it sits dark, like the rest of the app, and fails closed: a
// missing or rejected code shows an error page and nothing else.
//
// On success the FULL conversion JSON is stored in CREDS under "app"
// and the page renders only non-secret fields. Secret values from the
// conversion must never be rendered, logged, or copied anywhere else.
async function setupCallback(url, env) {
  const code = url.searchParams.get("code");
  if (!code) {
    return page(
      "gitpp-app — setup callback",
      `<h1>Setup callback</h1>
<p class="warn">No <code>code</code> parameter. This endpoint only does
anything in the seconds after GitHub redirects here from a real App
Manifest registration. Arriving here directly is expected to fail, and
it just did — closed, by design.</p>`,
    );
  }
  let conv;
  try {
    const resp = await fetch(
      `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "gitpp-app-receiver",
        },
      },
    );
    if (!resp.ok) throw new Error(`conversion HTTP ${resp.status}`);
    conv = await resp.json();
  } catch (err) {
    return page(
      "gitpp-app — conversion failed",
      `<h1>Conversion failed</h1>
<p class="warn">GitHub did not convert that code (${esc(err.message)}).
Manifest codes are single-use and short-lived; if the registration
completed on GitHub's side, the app exists there and its credentials
can be viewed under the app's settings on GitHub instead. Nothing was
stored or logged here.</p>`,
    );
  }
  // Store the full conversion record in the credential store. From
  // here on, only non-secret fields are rendered — see below.
  try {
    await env.CREDS.put("app", JSON.stringify(conv));
  } catch {
    return page(
      "gitpp-app — storage failed",
      `<h1>Storage failed</h1>
<p class="warn">GitHub created the app, but this receiver could not
store its credentials. The app exists on GitHub; a fresh registration
flow or a manual credential recovery under the app's GitHub settings
is needed. No credential values were displayed or logged here.</p>`,
    );
  }
  return page(
    "gitpp-app — App created",
    `<h1>App created</h1>
<p><strong>Success.</strong> The App's credentials were stored
automatically in this Worker's credential store — there is nothing to
copy and nothing to vault by hand. This receiver has left its dark
state; install the App on a repository to start receiving events.</p>
<table>
<tr><th>Field</th><th>Value</th></tr>
<tr><td>App ID</td><td>${esc(conv.id ?? "")}</td></tr>
<tr><td>App</td><td>${esc(conv.html_url ?? "")}</td></tr>
<tr><td>Owner</td><td>${esc(conv.owner?.login ?? "")}</td></tr>
</table>`,
  );
}

async function hmacHex(secret, bodyText) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(bodyText),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a, b) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) {
    diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  }
  return diff === 0;
}

async function storedApp(env) {
  if (!env.CREDS) return null;
  const raw = await env.CREDS.get("app");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function webhook(request, env, ctx) {
  // The honest dark state: no stored App record means this receiver was
  // never wired to a registered App. Say so, in so many words.
  const app = await storedApp(env);
  const secret = app?.webhook_secret;
  if (!secret) {
    return Response.json({ error: "not configured" }, { status: 503 });
  }
  const bodyText = await request.text();
  const header = request.headers.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + (await hmacHex(secret, bodyText));
  if (!constantTimeEqual(header, expected)) {
    return Response.json({ error: "signature mismatch" }, { status: 401 });
  }
  const event = request.headers.get("x-github-event") ?? "unknown";
  let payload = {};
  try {
    payload = JSON.parse(bodyText);
  } catch {
    // A signature-valid body that is not JSON carries nothing to record.
  }
  // Record a minimal ring entry: when, what event, which repo and
  // installation, which action. No payload bodies, no other fields.
  const entry = {
    t: new Date().toISOString(),
    event,
    repo: payload?.repository?.full_name ?? null,
    installation: payload?.installation?.id ?? null,
    action: payload?.action ?? null,
  };
  let ring = [];
  try {
    const raw = await env.CREDS.get("events");
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) ring = parsed;
  } catch {
    ring = [];
  }
  ring.push(entry);
  ring = ring.slice(-20);
  await env.CREDS.put("events", JSON.stringify(ring));
  console.log(JSON.stringify({ app: "gitpp-app", ...entry }));
  // Derivation runs BEHIND the ack: GitHub allows webhook receivers 10
  // seconds, and minting a token + fetching a tarball + folding does not
  // belong in that window. The 202 goes out regardless of its outcome.
  maybeDerive(env, ctx, app, event, payload);
  return Response.json({ accepted: true }, { status: 202 });
}

async function events(env) {
  let ring = [];
  if (env.CREDS) {
    try {
      const raw = await env.CREDS.get("events");
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) ring = parsed;
    } catch {
      ring = [];
    }
  }
  return Response.json(ring);
}

// ============================================================================
// VENDORED FOLD ENGINE — DO NOT EDIT IN THIS REPO.
//
// Source : patchwork-quilt/git.pp-ng — src/fold.ts
// Commit : c130862b354f8895e68a4a0d8349f27389e570e3
// Via    : patchwork-quilt/gitpp-action lib/fold.ts (byte-identical
//          vendoring of the same upstream commit), transpiled to plain
//          JS (types stripped only — no semantic edits) for the Worker.
//
// The fold's semantics are a specification (git.pp-ng DESIGN.md), held
// identical across ports by the git.pp conformance corpus. Fixes belong
// upstream; this copy is refreshed by re-vendoring, never local edits.
// ============================================================================

var CLASS_RANK = {
  override: 0,
  task: 1,
  witness: 2
};
var FALLBACK_RANK = 2;
var WITNESS_RANK = CLASS_RANK["witness"];
function pyEscapeString(s) {
  let out = '"';
  for (let i = 0;i < s.length; i++) {
    const code = s.charCodeAt(i);
    const ch = s[i];
    if (ch === '"')
      out += "\\\"";
    else if (ch === "\\")
      out += "\\\\";
    else if (ch === `
`)
      out += "\\n";
    else if (ch === "\r")
      out += "\\r";
    else if (ch === "\t")
      out += "\\t";
    else if (ch === "\b")
      out += "\\b";
    else if (ch === "\f")
      out += "\\f";
    else if (code < 32 || code >= 127) {
      out += "\\u" + code.toString(16).padStart(4, "0");
    } else
      out += ch;
  }
  return out + '"';
}
function pyFloatRepr(n) {
  const neg = n < 0;
  const abs = Math.abs(n);
  const exp = abs.toExponential();
  const eIdx = exp.indexOf("e");
  const mant = exp.slice(0, eIdx);
  const E = parseInt(exp.slice(eIdx + 1), 10);
  const decpt = E + 1;
  let s;
  if (decpt <= -4 || decpt > 16) {
    const eSign = E < 0 ? "-" : "+";
    s = mant + "e" + eSign + String(Math.abs(E)).padStart(2, "0");
  } else {
    s = String(abs);
  }
  return neg ? "-" + s : s;
}
function pyNumber(n) {
  if (Number.isNaN(n))
    return "NaN";
  if (!Number.isFinite(n))
    return n > 0 ? "Infinity" : "-Infinity";
  if (n === 0)
    return "0";
  if (Number.isInteger(n) && Math.abs(n) < 1000000000000000000000)
    return BigInt(n).toString();
  return pyFloatRepr(n);
}
function pyCanonical(value) {
  if (value === null || value === undefined)
    return "null";
  if (typeof value === "boolean")
    return value ? "true" : "false";
  if (typeof value === "number")
    return pyNumber(value);
  if (typeof value === "string")
    return pyEscapeString(value);
  if (Array.isArray(value)) {
    return "[" + value.map(pyCanonical).join(", ") + "]";
  }
  if (typeof value === "object") {
    const obj = value;
    const keys = Object.keys(obj).sort(cmpCodePoints);
    return "{" + keys.map((k) => pyEscapeString(k) + ": " + pyCanonical(obj[k])).join(", ") + "}";
  }
  return pyEscapeString(String(value));
}
function pyValueKey(v) {
  if (typeof v === "boolean")
    return "n:" + (v ? "1" : "0");
  if (typeof v === "number")
    return "n:" + String(v);
  if (typeof v === "string")
    return "s:" + v;
  if (v === null || v === undefined)
    return "z:";
  return "c:" + pyCanonical(v);
}
function pyDeepEqual(a, b) {
  const aNum = typeof a === "number" || typeof a === "boolean";
  const bNum = typeof b === "number" || typeof b === "boolean";
  if (aNum || bNum) {
    if (!(aNum && bNum))
      return false;
    return Number(a) === Number(b);
  }
  if (a === null || b === null || a === undefined || b === undefined) {
    return (a ?? null) === (b ?? null);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!(Array.isArray(a) && Array.isArray(b)))
      return false;
    if (a.length !== b.length)
      return false;
    return a.every((v, i) => pyDeepEqual(v, b[i]));
  }
  if (typeof a === "object" || typeof b === "object") {
    if (!(typeof a === "object" && typeof b === "object"))
      return false;
    const ao = a;
    const bo = b;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length)
      return false;
    return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && pyDeepEqual(ao[k], bo[k]));
  }
  return a === b;
}
function parentsOf(rec) {
  const ps = rec.parents;
  if (!Array.isArray(ps))
    return [];
  return ps.map((p) => String(p));
}
function effectsOf(rec) {
  const eff = rec.effects;
  const out = {};
  if (eff && typeof eff === "object" && !Array.isArray(eff)) {
    for (const [k, v] of Object.entries(eff)) {
      out[String(k)] = v;
    }
  }
  return out;
}
function rankOf(rec) {
  const kind = rec.kind;
  if (typeof kind === "string" && Object.prototype.hasOwnProperty.call(CLASS_RANK, kind)) {
    return CLASS_RANK[kind];
  }
  return FALLBACK_RANK;
}
function cmpCodePoints(a, b) {
  const ai = Array.from(a);
  const bi = Array.from(b);
  const n = Math.min(ai.length, bi.length);
  for (let i = 0;i < n; i++) {
    const ca = ai[i].codePointAt(0);
    const cb = bi[i].codePointAt(0);
    if (ca !== cb)
      return ca < cb ? -1 : 1;
  }
  return ai.length - bi.length;
}
function indexKey(rec) {
  if (!("digest" in rec))
    return pyCanonical(rec);
  const rest = { ...rec };
  delete rest.digest;
  return pyCanonical(rest);
}
function indexRecords(records) {
  const ordered = [...records].sort((a, b) => {
    const ida = String(a.id ?? "");
    const idb = String(b.id ?? "");
    const byId = cmpCodePoints(ida, idb);
    if (byId !== 0)
      return byId;
    return cmpCodePoints(indexKey(a), indexKey(b));
  });
  const idx = {};
  for (const r of ordered) {
    idx[String(r.id)] = r;
  }
  return idx;
}

class MinHeap {
  h = [];
  push(x) {
    const h = this.h;
    h.push(x);
    let i = h.length - 1;
    while (i > 0) {
      const p = i - 1 >> 1;
      if (cmpCodePoints(h[p], h[i]) <= 0)
        break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }
  pop() {
    const h = this.h;
    if (h.length === 0)
      return;
    const top = h[0];
    const last = h.pop();
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && cmpCodePoints(h[l], h[m]) < 0)
          m = l;
        if (r < h.length && cmpCodePoints(h[r], h[m]) < 0)
          m = r;
        if (m === i)
          break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.h.length;
  }
}
function cycleAffected(nodes, parents) {
  const indeg = {};
  const children = {};
  for (const r of nodes) {
    indeg[r] = 0;
    children[r] = [];
  }
  for (const r of nodes) {
    for (const p of parents[r]) {
      if (Object.prototype.hasOwnProperty.call(indeg, p)) {
        indeg[r] += 1;
        children[p].push(r);
      }
    }
  }
  const heap = new MinHeap;
  for (const r of nodes)
    if (indeg[r] === 0)
      heap.push(r);
  const done = new Set;
  let n;
  while ((n = heap.pop()) !== undefined) {
    done.add(n);
    for (const c of children[n]) {
      indeg[c] -= 1;
      if (indeg[c] === 0)
        heap.push(c);
    }
  }
  const out = new Set(nodes);
  for (const d of done)
    out.delete(d);
  return out;
}
function topological(nodes, parents) {
  const indeg = {};
  const children = {};
  for (const r of nodes) {
    indeg[r] = parents[r].length;
    children[r] = [];
  }
  for (const r of nodes) {
    for (const p of parents[r]) {
      if (Object.prototype.hasOwnProperty.call(children, p)) {
        children[p].push(r);
      }
    }
  }
  const heap = new MinHeap;
  for (const r of nodes)
    if (indeg[r] === 0)
      heap.push(r);
  const order = [];
  let n;
  while ((n = heap.pop()) !== undefined) {
    order.push(n);
    for (const c of children[n]) {
      indeg[c] -= 1;
      if (indeg[c] === 0)
        heap.push(c);
    }
  }
  return order;
}
function deriveLegacy(records) {
  const idx = indexRecords([...records]);
  const ids = new Set(Object.keys(idx));
  const parents = {};
  for (const rid of Object.keys(idx))
    parents[rid] = parentsOf(idx[rid]);
  const children = {};
  for (const rid of Object.keys(idx))
    children[rid] = [];
  for (const [rid, ps] of Object.entries(parents)) {
    for (const p of ps) {
      if (Object.prototype.hasOwnProperty.call(children, p)) {
        children[p].push(rid);
      }
    }
  }
  const orphan = new Set;
  const work = [];
  for (const rid of Object.keys(idx)) {
    if (parents[rid].some((p) => !ids.has(p)))
      work.push(rid);
  }
  for (const rid of work)
    orphan.add(rid);
  let head = 0;
  while (head < work.length) {
    for (const c of children[work[head]] ?? []) {
      if (!orphan.has(c)) {
        orphan.add(c);
        work.push(c);
      }
    }
    head += 1;
  }
  const nonOrphan = new Set;
  for (const rid of ids)
    if (!orphan.has(rid))
      nonOrphan.add(rid);
  for (const rid of cycleAffected(nonOrphan, parents))
    orphan.add(rid);
  const applied = [];
  for (const rid of ids)
    if (!orphan.has(rid))
      applied.push(rid);
  applied.sort(cmpCodePoints);
  const appliedSet = new Set(applied);
  const order = topological(new Set(applied), parents);
  const anc = {};
  for (const rid of order) {
    const a = new Set;
    for (const p of parents[rid]) {
      if (appliedSet.has(p)) {
        a.add(p);
        for (const x of anc[p])
          a.add(x);
      }
    }
    anc[rid] = a;
  }
  const setters = {};
  for (const rid of applied) {
    for (const k of Object.keys(effectsOf(idx[rid]))) {
      if (!setters[k])
        setters[k] = new Set;
      setters[k].add(rid);
    }
  }
  const state = {};
  const conflicts = [];
  for (const k of Object.keys(setters).sort(cmpCodePoints)) {
    const cands = [...setters[k]].sort(cmpCodePoints);
    let best = Infinity;
    for (const c of cands)
      best = Math.min(best, rankOf(idx[c]));
    const pool = new Set(cands.filter((c) => rankOf(idx[c]) === best));
    const dominated = new Set;
    for (const d of pool) {
      for (const a of anc[d])
        if (pool.has(a))
          dominated.add(a);
    }
    const maximal = [...pool].filter((c) => !dominated.has(c)).sort(cmpCodePoints);
    let winner;
    if (maximal.length === 1) {
      winner = maximal[0];
    } else {
      const cleanliness = (c) => {
        let intent = 0;
        let wit = 0;
        for (const a of anc[c]) {
          const r = rankOf(idx[a]);
          if (r < WITNESS_RANK)
            intent += 1;
          if (r === WITNESS_RANK)
            wit += 1;
        }
        return [-intent, wit, c];
      };
      winner = [...maximal].sort((a, b) => {
        const ca = cleanliness(a);
        const cb = cleanliness(b);
        if (ca[0] !== cb[0])
          return ca[0] - cb[0];
        if (ca[1] !== cb[1])
          return ca[1] - cb[1];
        return cmpCodePoints(ca[2], cb[2]);
      })[0];
    }
    state[k] = effectsOf(idx[winner])[k];
    const distinct = new Set;
    for (const c of cands)
      distinct.add(pyValueKey(effectsOf(idx[c])[k]));
    if (distinct.size >= 2) {
      conflicts.push({
        key: k,
        winner,
        losers: cands.filter((c) => c !== winner).sort(cmpCodePoints)
      });
    }
  }
  const orphans = [...orphan].sort(cmpCodePoints);
  return { state, order, conflicts, orphans };
}
function prepareDerive(records) {
  const idx = indexRecords([...records]);
  const ids = new Set(Object.keys(idx));
  const parents = {};
  for (const rid of Object.keys(idx))
    parents[rid] = parentsOf(idx[rid]);
  const children = {};
  for (const rid of Object.keys(idx))
    children[rid] = [];
  for (const [rid, ps] of Object.entries(parents)) {
    for (const p of ps) {
      if (Object.prototype.hasOwnProperty.call(children, p)) {
        children[p].push(rid);
      }
    }
  }
  const orphan = new Set;
  const work = [];
  for (const rid of Object.keys(idx)) {
    if (parents[rid].some((p) => !ids.has(p)))
      work.push(rid);
  }
  for (const rid of work)
    orphan.add(rid);
  let head = 0;
  while (head < work.length) {
    for (const c of children[work[head]] ?? []) {
      if (!orphan.has(c)) {
        orphan.add(c);
        work.push(c);
      }
    }
    head += 1;
  }
  const nonOrphan = new Set;
  for (const rid of ids)
    if (!orphan.has(rid))
      nonOrphan.add(rid);
  for (const rid of cycleAffected(nonOrphan, parents))
    orphan.add(rid);
  const applied = [];
  for (const rid of ids)
    if (!orphan.has(rid))
      applied.push(rid);
  applied.sort(cmpCodePoints);
  const order = topological(new Set(applied), parents);
  return { idx, parents, applied, order, orphan };
}
var POP8 = new Uint8Array(256);
for (let i = 1;i < 256; i++)
  POP8[i] = POP8[i >> 1] + (i & 1);
function popcount32(x) {
  return POP8[x & 255] + POP8[x >>> 8 & 255] + POP8[x >>> 16 & 255] + POP8[x >>> 24];
}
function buildAncestry(order, parents, idx) {
  const n = order.length;
  const words = Math.ceil(n / 32);
  const bits = new Uint32Array(n * words);
  const pos = new Map;
  const intentMask = new Uint32Array(words);
  const witnessMask = new Uint32Array(words);
  for (let i = 0;i < n; i++) {
    pos.set(order[i], i);
    const r = rankOf(idx[order[i]]);
    if (r < WITNESS_RANK)
      intentMask[i >> 5] |= 1 << (i & 31);
    else
      witnessMask[i >> 5] |= 1 << (i & 31);
  }
  for (let i = 0;i < n; i++) {
    const row = i * words;
    for (const p of parents[order[i]]) {
      const pi = pos.get(p);
      if (pi === undefined)
        continue;
      const prow = pi * words;
      for (let w = 0;w < words; w++)
        bits[row + w] |= bits[prow + w];
      bits[row + (pi >> 5)] |= 1 << (pi & 31);
    }
  }
  return { n, words, bits, pos, intentMask, witnessMask };
}
function maskedPopcount(anc, row, mask) {
  const off = row * anc.words;
  let s = 0;
  for (let w = 0;w < anc.words; w++)
    s += popcount32(anc.bits[off + w] & mask[w]);
  return s;
}
function rowPopcount(anc, row) {
  const off = row * anc.words;
  let s = 0;
  for (let w = 0;w < anc.words; w++)
    s += popcount32(anc.bits[off + w]);
  return s;
}
function derive(records) {
  const { idx, parents, applied, order, orphan } = prepareDerive(records);
  const anc = buildAncestry(order, parents, idx);
  const setters = {};
  for (const rid of applied) {
    for (const k of Object.keys(effectsOf(idx[rid]))) {
      if (!setters[k])
        setters[k] = new Set;
      setters[k].add(rid);
    }
  }
  const intentCnt = new Int32Array(anc.n).fill(-1);
  const witCnt = new Int32Array(anc.n).fill(-1);
  const countsOf = (row) => {
    if (intentCnt[row] < 0) {
      intentCnt[row] = maskedPopcount(anc, row, anc.intentMask);
      witCnt[row] = maskedPopcount(anc, row, anc.witnessMask);
    }
    return [intentCnt[row], witCnt[row]];
  };
  const union = new Uint32Array(anc.words);
  const state = {};
  const conflicts = [];
  for (const k of Object.keys(setters).sort(cmpCodePoints)) {
    const cands = [...setters[k]].sort(cmpCodePoints);
    let best = Infinity;
    for (const c of cands)
      best = Math.min(best, rankOf(idx[c]));
    const pool = cands.filter((c) => rankOf(idx[c]) === best);
    union.fill(0);
    for (const d of pool) {
      const drow = anc.pos.get(d) * anc.words;
      for (let w = 0;w < anc.words; w++)
        union[w] |= anc.bits[drow + w];
    }
    const maximal = pool.filter((c) => {
      const ci = anc.pos.get(c);
      return (union[ci >> 5] & 1 << (ci & 31)) === 0;
    }).sort(cmpCodePoints);
    let winner;
    if (maximal.length === 1) {
      winner = maximal[0];
    } else {
      winner = [...maximal].sort((a, b) => {
        const [ai, aw] = countsOf(anc.pos.get(a));
        const [bi, bw] = countsOf(anc.pos.get(b));
        if (ai !== bi)
          return bi - ai;
        if (aw !== bw)
          return aw - bw;
        return cmpCodePoints(a, b);
      })[0];
    }
    state[k] = effectsOf(idx[winner])[k];
    const distinct = new Set;
    for (const c of cands)
      distinct.add(pyValueKey(effectsOf(idx[c])[k]));
    if (distinct.size >= 2) {
      conflicts.push({
        key: k,
        winner,
        losers: cands.filter((c) => c !== winner).sort(cmpCodePoints)
      });
    }
  }
  const orphans = [...orphan].sort(cmpCodePoints);
  return { state, order, conflicts, orphans };
}
var _SHA_K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
function sha256Hex(input) {
  const H = new Uint32Array([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(Math.ceil((bytes.length + 1 + 8) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 128;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0, false);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 4294967296), false);
  const w = new Uint32Array(64);
  const rotr = (x, n) => x >>> n | x << 32 - n;
  for (let off = 0;off < padded.length; off += 64) {
    for (let i = 0;i < 16; i++)
      w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16;i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3];
    let e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0;i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const t1 = h + S1 + ch + _SHA_K[i] + w[i] >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = S0 + maj >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    H[0] = H[0] + a >>> 0;
    H[1] = H[1] + b >>> 0;
    H[2] = H[2] + c >>> 0;
    H[3] = H[3] + d >>> 0;
    H[4] = H[4] + e >>> 0;
    H[5] = H[5] + f >>> 0;
    H[6] = H[6] + g >>> 0;
    H[7] = H[7] + h >>> 0;
  }
  let hex = "";
  for (let i = 0;i < 8; i++)
    hex += H[i].toString(16).padStart(8, "0");
  return hex;
}
function recordLeaf(rec) {
  const r = rec;
  const normalized = {
    id: String(r.id ?? ""),
    parents: parentsOf(rec).slice().sort(cmpCodePoints),
    kind: r.kind ?? null,
    effects: effectsOf(rec),
    reason: r.reason ?? null
  };
  return sha256Hex(pyCanonical(normalized));
}
function closureIds(at, idx, parents) {
  const closure = new Set;
  const stack = [at];
  while (stack.length > 0) {
    const n = stack.pop();
    if (closure.has(n))
      continue;
    closure.add(n);
    for (const p of parents[n] ?? []) {
      if (!Object.prototype.hasOwnProperty.call(idx, p))
        return null;
      stack.push(p);
    }
  }
  return [...closure];
}
function frontierMembers(at) {
  if (typeof at === "string")
    return [at];
  if (Array.isArray(at)) {
    if (at.length === 0)
      return null;
    const seen = new Set;
    for (const m of at) {
      if (typeof m !== "string")
        return null;
      if (seen.has(m))
        return null;
      seen.add(m);
    }
    return [...at];
  }
  return [String(at)];
}
function closureIdsMulti(members, idx, parents) {
  const union = new Set;
  for (const m of members) {
    if (!Object.prototype.hasOwnProperty.call(idx, m))
      return null;
    const cl = closureIds(m, idx, parents);
    if (cl === null)
      return null;
    for (const id of cl)
      union.add(id);
  }
  return [...union];
}
function checkpointRoot(records, at) {
  const idx = indexRecords([...records]);
  const members = frontierMembers(at);
  if (members === null)
    return null;
  const parents = {};
  for (const rid of Object.keys(idx))
    parents[rid] = parentsOf(idx[rid]);
  const closure = closureIdsMulti(members, idx, parents);
  if (closure === null)
    return null;
  const entries = closure.sort(cmpCodePoints).map((rid) => `${rid}:${recordLeaf(idx[rid])}`);
  return sha256Hex(entries.join(`
`));
}
function verifyCheckpoint(records, checkpoint) {
  if (typeof checkpoint !== "object" || checkpoint === null)
    return false;
  const expectedRoot = checkpoint.closureRoot;
  const v2 = expectedRoot !== undefined && expectedRoot !== null;
  const atRaw = checkpoint.at;
  const want = checkpoint.state;
  if (atRaw === undefined || atRaw === null || typeof want !== "object" || want === null || Array.isArray(want)) {
    return v2 ? "MISMATCH" : false;
  }
  const members = frontierMembers(atRaw);
  if (members === null)
    return v2 ? "MISMATCH" : false;
  const idx = indexRecords([...records]);
  const parents = {};
  for (const rid of Object.keys(idx))
    parents[rid] = parentsOf(idx[rid]);
  const closure = closureIdsMulti(members, idx, parents);
  let stateOk = false;
  if (closure !== null) {
    const subset = closure.sort(cmpCodePoints).map((rid) => idx[rid]);
    stateOk = pyDeepEqual(derive(subset).state, want);
  }
  if (!v2)
    return stateOk;
  if (!stateOk)
    return "MISMATCH";
  const actualRoot = checkpointRoot(records, members);
  return actualRoot === String(expectedRoot) ? "VERIFIED" : "STATE-ONLY";
}
function buildCheckpoint(records, at) {
  const idx = indexRecords([...records]);
  const atId = String(at);
  if (!Object.prototype.hasOwnProperty.call(idx, atId))
    return null;
  const parents = {};
  for (const rid of Object.keys(idx))
    parents[rid] = parentsOf(idx[rid]);
  const closure = closureIds(atId, idx, parents);
  if (closure === null)
    return null;
  const closureRecords = closure.sort(cmpCodePoints).map((rid) => idx[rid]);
  const root = checkpointRoot(records, atId);
  if (root === null)
    return null;
  return {
    at: atId,
    state: derive(closureRecords).state,
    closureRoot: root,
    closure: closureRecords
  };
}
function buildFrontierCheckpoint(records, frontierIds) {
  const idx = indexRecords([...records]);
  const parents = {};
  for (const rid of Object.keys(idx))
    parents[rid] = parentsOf(idx[rid]);
  let members;
  if (frontierIds === undefined) {
    const applied = derive(records).order;
    if (applied.length === 0)
      return null;
    const appliedSet = new Set(applied);
    const hasAppliedChild = new Set;
    for (const rid of applied) {
      for (const p of parents[rid]) {
        if (appliedSet.has(p))
          hasAppliedChild.add(p);
      }
    }
    members = applied.filter((r) => !hasAppliedChild.has(r)).sort(cmpCodePoints);
  } else {
    const norm = frontierMembers(frontierIds);
    if (norm === null)
      return null;
    members = [...norm].sort(cmpCodePoints);
  }
  const closure = closureIdsMulti(members, idx, parents);
  if (closure === null)
    return null;
  const closureRecords = closure.sort(cmpCodePoints).map((rid) => idx[rid]);
  const root = checkpointRoot(records, members);
  if (root === null)
    return null;
  return {
    at: members.length === 1 ? members[0] : [...members],
    state: derive(closureRecords).state,
    closureRoot: root,
    closure: closureRecords
  };
}
function deriveDelta(checkpoint, tailRecords) {
  if (typeof checkpoint !== "object" || checkpoint === null)
    return null;
  const { at, state, closureRoot, closure } = checkpoint;
  if (typeof at !== "string" && !Array.isArray(at) || typeof state !== "object" || state === null || Array.isArray(state) || typeof closureRoot !== "string" || !Array.isArray(closure)) {
    return null;
  }
  const members = frontierMembers(at);
  if (members === null)
    return null;
  const closureIdSet = new Set;
  const closureById = new Map;
  for (const r of closure) {
    const id = r.id;
    if (typeof id !== "string")
      return null;
    if (closureIdSet.has(id))
      return null;
    closureIdSet.add(id);
    closureById.set(id, r);
  }
  if (!members.every((m) => closureIdSet.has(m)))
    return null;
  const idx = indexRecords([...closure]);
  const parents = {};
  for (const rid of Object.keys(idx))
    parents[rid] = parentsOf(idx[rid]);
  const cl = closureIdsMulti(members, idx, parents);
  if (cl === null)
    return null;
  if (cl.length !== closureIdSet.size || !cl.every((id) => closureIdSet.has(id))) {
    return null;
  }
  if (checkpointRoot(closure, members) !== closureRoot)
    return null;
  if (!pyDeepEqual(derive(closure).state, state))
    return null;
  const tail = [];
  for (const r of tailRecords) {
    const id = r.id;
    if (typeof id === "string" && closureIdSet.has(id)) {
      if (!pyDeepEqual(r, closureById.get(id)))
        return null;
      continue;
    }
    tail.push(r);
  }
  return derive([...closure, ...tail]);
}
function witnessFreshnessLegacy(records) {
  const idx = indexRecords([...records]);
  const out = derive(records);
  const applied = new Set(out.order);
  const parents = {};
  for (const rid of Object.keys(idx))
    parents[rid] = parentsOf(idx[rid]);
  const ancestorsIncl = (start) => {
    const seen = new Set([start]);
    const stack = [...parents[start] ?? []];
    while (stack.length > 0) {
      const n = stack.pop();
      if (seen.has(n) || !applied.has(n))
        continue;
      seen.add(n);
      for (const p of parents[n] ?? [])
        stack.push(p);
    }
    return seen;
  };
  const total = applied.size;
  const result = {};
  for (const rid of out.order) {
    const kind = idx[rid].kind;
    if (kind === "witness")
      result[rid] = total - ancestorsIncl(rid).size;
  }
  return result;
}
function witnessFreshness(records) {
  const idx = indexRecords([...records]);
  const out = derive(records);
  const parents = {};
  for (const rid of Object.keys(idx))
    parents[rid] = parentsOf(idx[rid]);
  const anc = buildAncestry(out.order, parents, idx);
  const total = out.order.length;
  const result = {};
  for (const rid of out.order) {
    const kind = idx[rid].kind;
    if (kind === "witness") {
      result[rid] = total - (rowPopcount(anc, anc.pos.get(rid)) + 1);
    }
  }
  return result;
}

// ==== END VENDORED FOLD ENGINE ====

// ============================================================================
// DERIVATION LOOP — the app answers.
//
// On a verified push / check_suite (requested|rerequested) event, behind
// the 202 ack (GitHub gives webhook receivers 10 seconds; derivation
// lives in ctx.waitUntil), this Worker:
//   1. mints an installation token (App JWT, RS256, from the stored PEM);
//   2. fetches the repo tarball at the head sha in ONE call and extracts
//      any .gitpp/records/*.json + .gitpp/project.json from it;
//   3. folds the records with the vendored derive() below;
//   4. posts the result as an advisory Check run (conclusion: neutral).
// Coalescing: CREDS key `derived:<repo>:<sha>` is claimed before work
// starts and kept after a successful post (TTL 24h), so push +
// check_suite for one commit yield ONE check run. A repo with no
// .gitpp/records surface is skipped quietly — absence is not an error.
// Derivation failures are recorded in the events ring and NEVER fail
// the webhook response.
// ============================================================================

const QUALIFICATIONS =
  "Mechanical resolution of labelled key conflicts only; the fold does " +
  "not settle semantic conflicts. Digests authenticate content, not " +
  "authorship. Arrival order is never an input.";

const REPORT_CLASS_RANK = { override: 0, task: 1, witness: 2 };

function fmtValue(v) {
  return typeof v === "string" ? v : JSON.stringify(v);
}

function kindOf(rec) {
  return typeof rec?.kind === "string" ? rec.kind : "witness";
}

/** Human explanation of one conflict, from the records themselves.
 * Ported verbatim in shape from gitpp-action's fold.mjs. */
function explainConflict(conflict, byId) {
  const winner = byId.get(conflict.winner);
  const wClass = kindOf(winner);
  const lines = [];
  lines.push(
    `- **${conflict.key}** = ${fmtValue(winner?.effects?.[conflict.key])} ` +
      `— winner \`${conflict.winner}\` (${wClass}` +
      (winner?.reason ? `, reason: "${winner.reason}"` : "") +
      `, parents: [${(winner?.parents ?? []).join(", ")}])`,
  );
  for (const loserId of conflict.losers) {
    const loser = byId.get(loserId);
    const lClass = kindOf(loser);
    let why;
    if ((REPORT_CLASS_RANK[wClass] ?? 2) < (REPORT_CLASS_RANK[lClass] ?? 2)) {
      why = `outranked — ${wClass} beats ${lClass} (class priority is absolute)`;
    } else if ((winner?.parents ?? []).includes(loserId)) {
      why = "superseded — the winner descends from it";
    } else {
      why =
        "lost the tie-break among incomparable candidates of the same " +
        "class (cleanest ancestry chain, then smallest id)";
    }
    lines.push(
      `  - loser \`${loserId}\` (${lClass}) set ${fmtValue(loser?.effects?.[conflict.key])} — ${why}; preserved in the record`,
    );
  }
  return lines;
}

function renderReport(records, project) {
  const out = derive(records);
  const byId = new Map(records.map((r) => [String(r.id), r]));
  const title = project ? `git.pp state — ${project}` : "git.pp state";
  const lines = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(
    `${records.length} records · ${Object.keys(out.state).length} keys · ` +
      `${out.conflicts.length} conflict(s) · ${out.orphans.length} orphan(s)`,
  );
  lines.push("");
  lines.push("## State");
  lines.push("");
  for (const key of Object.keys(out.state).sort()) {
    lines.push(`- \`${key}\` = ${fmtValue(out.state[key])}`);
  }
  if (out.conflicts.length > 0) {
    lines.push("");
    lines.push("## Conflicts (losers preserved)");
    lines.push("");
    for (const c of out.conflicts) lines.push(...explainConflict(c, byId));
  }
  if (out.orphans.length > 0) {
    lines.push("");
    lines.push("## Orphans (excluded from state)");
    lines.push("");
    lines.push(out.orphans.map((o) => `- \`${o}\``).join("\n"));
  }
  lines.push("");
  lines.push(`> ${QUALIFICATIONS}`);
  return { text: lines.join("\n") + "\n", out, title };
}

// ---- App JWT (RS256) -------------------------------------------------------

function b64url(data) {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function pemToDer(pem) {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der;
}

/*TEST-EXTRACT:pkcs8*/
/** Wrap a PKCS#1 DER RSA key ("BEGIN RSA PRIVATE KEY") as PKCS#8, which
 * is what WebCrypto importKey accepts: prepend the PKCS#8 header —
 * SEQUENCE { INTEGER 0, SEQUENCE { OID rsaEncryption, NULL },
 * OCTET STRING { <pkcs1 der> } }. Lengths use the long (0x82) form. */
function wrapPkcs1ToPkcs8(der) {
  const algId = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00,
  ]);
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const octet = new Uint8Array(4 + der.length);
  octet[0] = 0x04;
  octet[1] = 0x82;
  octet[2] = (der.length >> 8) & 0xff;
  octet[3] = der.length & 0xff;
  octet.set(der, 4);
  const bodyLen = version.length + algId.length + octet.length;
  const out = new Uint8Array(4 + bodyLen);
  out[0] = 0x30;
  out[1] = 0x82;
  out[2] = (bodyLen >> 8) & 0xff;
  out[3] = bodyLen & 0xff;
  out.set(version, 4);
  out.set(algId, 4 + version.length);
  out.set(octet, 4 + version.length + algId.length);
  return out;
}
/*END-EXTRACT:pkcs8*/

async function appJwt(app) {
  const pem = app?.pem;
  if (!pem) throw new Error("stored app record has no pem");
  const der = pemToDer(pem);
  const pkcs8 = pem.includes("RSA PRIVATE KEY")
    ? wrapPkcs1ToPkcs8(der)
    : der;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: String(app.id) }),
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

async function installationToken(app, installationId) {
  const jwt = await appJwt(app);
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "gitpp-app-receiver",
      },
    },
  );
  if (!res.ok) throw new Error(`access_tokens HTTP ${res.status}`);
  const body = await res.json();
  if (!body.token) throw new Error("access_tokens response had no token");
  return body.token;
}

// ---- Tarball extraction ----------------------------------------------------

/*TEST-EXTRACT:tar*/
function tarField(bytes, off, len) {
  let end = off;
  const max = off + len;
  while (end < max && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(off, end));
}

/** Parse a ustar archive into [{name, text}] for regular files. Handles
 * the 155-byte prefix field, GNU longname ('L') and pax ('x') path
 * overrides — GitHub/codeload tarballs use all three. */
function parseTar(bytes) {
  const entries = [];
  let offset = 0;
  let pendingName = null;
  while (offset + 512 <= bytes.length) {
    const name = tarField(bytes, offset, 100);
    if (!name) break;
    const sizeText = tarField(bytes, offset + 124, 12).trim();
    const size = sizeText ? parseInt(sizeText, 8) || 0 : 0;
    const type = String.fromCharCode(bytes[offset + 156] || 48);
    const prefix = tarField(bytes, offset + 345, 155);
    let fullName = prefix ? `${prefix}/${name}` : name;
    if (pendingName) {
      fullName = pendingName;
      pendingName = null;
    }
    const dataStart = offset + 512;
    const data = bytes.subarray(dataStart, dataStart + size);
    if (type === "x") {
      // pax extended header: "<len> key=value\n" records; honour path.
      const text = new TextDecoder().decode(data);
      let i = 0;
      while (i < text.length) {
        const sp = text.indexOf(" ", i);
        if (sp < 0) break;
        const recLen = parseInt(text.slice(i, sp), 10);
        if (!recLen || recLen <= 0) break;
        const rec = text.slice(sp + 1, i + recLen - 1);
        const eq = rec.indexOf("=");
        if (eq > 0 && rec.slice(0, eq) === "path") {
          pendingName = rec.slice(eq + 1);
        }
        i += recLen;
      }
    } else if (type === "L") {
      pendingName = new TextDecoder().decode(data).replace(/\0+$/, "");
    } else if (type === "0" || type === "\0" || type === "") {
      entries.push({ name: fullName, text: new TextDecoder().decode(data) });
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}
/*END-EXTRACT:tar*/

async function gunzip(bytes) {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const RECORD_PATH = /(^|\/)\.gitpp\/records\/[^/]+\.json$/;
const PROJECT_PATH = /(^|\/)\.gitpp\/project\.json$/;

async function fetchRecords(token, repo, sha) {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/tarball/${sha}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "gitpp-app-receiver",
      },
      redirect: "follow",
    },
  );
  if (!res.ok) throw new Error(`tarball HTTP ${res.status}`);
  const gz = new Uint8Array(await res.arrayBuffer());
  const entries = parseTar(await gunzip(gz));
  const records = [];
  let project = null;
  for (const e of entries) {
    if (RECORD_PATH.test(e.name)) {
      const parsed = JSON.parse(e.text);
      if (Array.isArray(parsed)) records.push(...parsed);
      else records.push(parsed);
    } else if (PROJECT_PATH.test(e.name)) {
      try {
        project = JSON.parse(e.text);
      } catch {
        project = null;
      }
    }
  }
  return { records, project };
}

// ---- The loop ---------------------------------------------------------------

async function appendRing(env, entry) {
  let ring = [];
  try {
    const raw = await env.CREDS.get("events");
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) ring = parsed;
  } catch {
    ring = [];
  }
  ring.push(entry);
  ring = ring.slice(-20);
  await env.CREDS.put("events", JSON.stringify(ring));
}

async function deriveAndPost(env, app, { repo, sha, installationId }) {
  const log = (action, detail) =>
    appendRing(env, {
      t: new Date().toISOString(),
      event: "derive",
      repo,
      sha: sha.slice(0, 7),
      action,
      ...(detail ? { detail: String(detail).slice(0, 120) } : {}),
    }).catch(() => {});
  const dedupeKey = `derived:${repo}:${sha}`;
  try {
    if (await env.CREDS.get(dedupeKey)) {
      await log("skipped-duplicate");
      return;
    }
    // Claim the commit before working: push and check_suite for the same
    // sha arrive as separate deliveries, and the second must find this.
    await env.CREDS.put(dedupeKey, "inflight", { expirationTtl: 86400 });
    const instId = installationId ?? app.installation_id;
    if (!instId) throw new Error("no installation id in payload or store");
    const token = await installationToken(app, instId);
    const { records, project } = await fetchRecords(token, repo, sha);
    if (records.length === 0) {
      await log("skipped-no-records");
      return;
    }
    const projectName =
      (typeof project?.project === "string" && project.project) || repo;
    const { text, title } = renderReport(records, projectName);
    const summary =
      text.split("\n").find((l) => l.includes("records ·")) ?? title;
    const res = await fetch(`https://api.github.com/repos/${repo}/check-runs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
        "user-agent": "gitpp-app-receiver",
      },
      body: JSON.stringify({
        name: "git.pp state",
        head_sha: sha,
        status: "completed",
        conclusion: "neutral",
        output: { title, summary, text: text.slice(0, 65535) },
      }),
    });
    if (!res.ok) {
      throw new Error(`check-runs HTTP ${res.status}: ${(await res.text()).slice(0, 80)}`);
    }
    const created = await res.json();
    await env.CREDS.put(dedupeKey, `posted:${created.id}`, {
      expirationTtl: 86400,
    });
    await log("posted", `check ${created.id}`);
  } catch (err) {
    // Release the claim so a rerequested suite can retry, then record.
    try {
      const cur = await env.CREDS.get(dedupeKey);
      if (cur === "inflight") await env.CREDS.delete(dedupeKey);
    } catch {}
    await log("failed", err?.message ?? err);
  }
}

/** Decide whether a verified event triggers derivation, and run it
 * behind the ack. Returns nothing; never throws. */
function maybeDerive(env, ctx, app, event, payload) {
  let sha = null;
  if (event === "push") {
    sha = payload?.after ?? null;
    if (!sha || /^0+$/.test(sha)) return;
  } else if (event === "check_suite") {
    if (!["requested", "rerequested"].includes(payload?.action ?? "")) return;
    sha = payload?.check_suite?.head_sha ?? null;
    if (!sha) return;
  } else {
    return;
  }
  const repo = payload?.repository?.full_name ?? null;
  if (!repo) return;
  const installationId = payload?.installation?.id ?? null;
  const job = deriveAndPost(env, app, { repo, sha, installationId }).catch(
    () => {},
  );
  if (ctx?.waitUntil) ctx.waitUntil(job);
  return job;
}


export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const registered = (await storedApp(env)) !== null;
      return Response.json({
        status: registered ? "live" : "dark",
        app: "gitpp-app",
        registered,
      });
    }
    if (url.pathname === "/" && request.method === "GET") {
      return landingPage();
    }
    if (url.pathname === "/setup/callback") {
      return setupCallback(url, env);
    }
    if (url.pathname === "/webhook" && request.method === "POST") {
      return webhook(request, env, ctx);
    }
    if (url.pathname === "/events" && request.method === "GET") {
      return events(env);
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },
};
