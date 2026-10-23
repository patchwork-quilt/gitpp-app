// gitpp-app — the GitHub App receiver for git.pp.
//
// LIVE: the GitHub App this receiver serves is registered — gitpp-app,
// app 5419092, owned by the patchwork-quilt org — and installed on
// patchwork-quilt/gitpp-demo-quilt. Its record (id, webhook secret,
// private key, installation id) lives in the CREDS KV namespace under
// "app"; no secret value ever appears in a response or a log.
//
// The honest dark state remains for fresh deployments: until a
// registration callback stores an App record in CREDS, /health
// answers {"status":"dark",...} and the webhook endpoint answers
// 503 "not configured" — that is the honest state, not an error.
//
// What this file does:
//   GET  /               landing page + the manifest a fork would
//                        register with. The page renders the exact
//                        manifest JSON, so a human sees precisely what
//                        a registration click would create.
//   GET|POST /setup/callback?code=...
//                        the manifest-flow conversion: exchanges the
//                        temporary code and stores the FULL conversion
//                        JSON in CREDS under "app". The rendered page
//                        shows only success, the app id, its html_url,
//                        and the owner login. REFUSES (409) when an
//                        "app" record already exists — replacing a
//                        live app's credentials must be a deliberate
//                        operator action (clear the store first),
//                        never a side effect of a stray redirect.
//   POST /webhook        signature-verified event intake. The webhook
//                        secret is read from the stored CREDS "app"
//                        record. Verified events are appended to the
//                        event log in CREDS — one key per entry,
//                        "evt:<timestamp>:<rand>", read via /events —
//                        and answered 202; push / check_suite events
//                        then trigger derivation behind the ack (see
//                        DERIVATION LOOP below): the repo's .gitpp
//                        records are fetched as a tarball, gated,
//                        folded, and posted back as an advisory Check.
//   GET  /events         the recorded event log, as JSON (last 20,
//                        newest last). Public by design for the
//                        dogfood phase (see README).
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

function page(title, body, status = 200) {
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
      status,
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
provenance-carrying records and posts it as a Check on the pushed commit:
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
<tr><td>Checks</td><td>Write</td><td>To post the derived state as a Check run on the pushed commit.</td></tr>
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

// Exercised by the real registration of this instance (2026-10-21 —
// see README, "How this instance was registered"); each manifest code
// is single-use and issued only inside GitHub's manifest flow. The
// guard below makes the path one-shot per store: while an "app"
// record exists, the callback refuses (409) and stores nothing —
// replacing a live app's credentials is a deliberate operator action
// (clear the store first), never a side effect of a stray redirect.
// A missing or rejected code shows an error page and stores nothing.
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
  const existing = await storedApp(env);
  if (existing) {
    return page(
      "gitpp-app — already registered",
      `<h1>Already registered</h1>
<p class="warn">This instance already holds an App record (app
${esc(existing.id ?? "?")}), so this callback stored nothing.
Re-registration would silently replace a live app's credentials; if
that is really the intent, clear the <code>app</code> record from the
credential store deliberately first, then run the manifest flow
again.</p>`,
      409,
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
  // Record the delivery — one KV key per entry (see appendRing), so
  // simultaneous deliveries cannot overwrite each other. A store
  // failure here must never fail the webhook: swallow and move on.
  try {
    await appendRing(env, entry);
  } catch {}
  console.log(JSON.stringify({ app: "gitpp-app", ...entry }));
  // Derivation runs BEHIND the ack: GitHub allows webhook receivers 10
  // seconds, and minting a token + fetching a tarball + folding does not
  // belong in that window. The 202 goes out regardless of its outcome.
  maybeDerive(env, ctx, app, event, payload);
  return Response.json({ accepted: true }, { status: 202 });
}

async function events(env) {
  const out = [];
  if (env.CREDS) {
    // Legacy entries: the pre-2026-10-22 ring was one read-modify-write
    // array under "events". Those entries all predate the per-entry
    // keys below, so they merge first, in their stored order.
    try {
      const raw = await env.CREDS.get("events");
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) out.push(...parsed);
    } catch {}
    // Per-entry keys "evt:<ISO timestamp>:<rand>": list() returns keys
    // in lexicographic order, which is chronological for ISO stamps.
    try {
      let cursor;
      for (let pageN = 0; pageN < 10; pageN++) {
        const res = await env.CREDS.list({ prefix: "evt:", cursor });
        for (const k of res.keys) {
          try {
            const v = await env.CREDS.get(k.name);
            if (v) out.push(JSON.parse(v));
          } catch {}
        }
        if (res.list_complete || !res.cursor) break;
        cursor = res.cursor;
      }
    } catch {}
  }
  return Response.json(out.slice(-20));
}

/*TEST-EXTRACT:core*/
// ============================================================================
// VENDORED FOLD ENGINE — DO NOT EDIT IN THIS REPO.
//
// Source : patchwork-quilt/git.pp-ng — src/fold.ts
// Commit : e296feabc3008a79ea25e7b73f5534f9454a579c
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
  const out = Object.create(null);
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
function newStrMap() {
  return Object.create(null);
}
function setOwn(obj, k, v) {
  Object.defineProperty(obj, k, {
    value: v,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function missingIdPlaceholder(rec) {
  const r = rec;
  const normalized = {
    parents: parentsOf(rec).slice().sort(cmpCodePoints),
    kind: r.kind ?? null,
    effects: effectsOf(rec),
    reason: r.reason ?? null
  };
  return "missing-id:" + sha256Hex(pyCanonical(normalized));
}
function effectiveId(rec) {
  const id = rec.id;
  return typeof id === "string" ? id : missingIdPlaceholder(rec);
}
function indexRecords(records) {
  const ordered = [...records].sort((a, b) => {
    const byId = cmpCodePoints(effectiveId(a), effectiveId(b));
    if (byId !== 0)
      return byId;
    return cmpCodePoints(indexKey(a), indexKey(b));
  });
  const idx = newStrMap();
  for (const r of ordered) {
    idx[effectiveId(r)] = r;
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
  const indeg = newStrMap();
  const children = newStrMap();
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
  const indeg = newStrMap();
  const children = newStrMap();
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
  const parents = newStrMap();
  for (const rid of Object.keys(idx))
    parents[rid] = parentsOf(idx[rid]);
  const children = newStrMap();
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
    if (typeof idx[rid].id !== "string" || parents[rid].some((p) => !ids.has(p))) {
      work.push(rid);
    }
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
  const anc = newStrMap();
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
  const setters = newStrMap();
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
    setOwn(state, k, effectsOf(idx[winner])[k]);
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
  const parents = newStrMap();
  for (const rid of Object.keys(idx))
    parents[rid] = parentsOf(idx[rid]);
  const children = newStrMap();
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
    if (typeof idx[rid].id !== "string" || parents[rid].some((p) => !ids.has(p))) {
      work.push(rid);
    }
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
  const setters = newStrMap();
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
    setOwn(state, k, effectsOf(idx[winner])[k]);
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
  const parents = newStrMap();
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
  const parents = newStrMap();
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
  const parents = newStrMap();
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
  const parents = newStrMap();
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
  const parents = newStrMap();
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
  const parents = newStrMap();
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
      setOwn(result, rid, total - ancestorsIncl(rid).size);
  }
  return result;
}
function witnessFreshness(records) {
  const idx = indexRecords([...records]);
  const out = derive(records);
  const parents = newStrMap();
  for (const rid of Object.keys(idx))
    parents[rid] = parentsOf(idx[rid]);
  const anc = buildAncestry(out.order, parents, idx);
  const total = out.order.length;
  const result = {};
  for (const rid of out.order) {
    const kind = idx[rid].kind;
    if (kind === "witness") {
      setOwn(result, rid, total - (rowPopcount(anc, anc.pos.get(rid)) + 1));
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
//   1. mints an installation token (App JWT, RS256, from the stored PEM;
//      tokens are cached per installation while >60s of life remains);
//   2. fetches the repo tarball at the head sha in ONE call and extracts
//      any .gitpp/records/*.json + .gitpp/project.json from it;
//   3. GATES every record (plain object, sane id/parents/effects/kind —
//      a bad file is rejected BY NAME, never silently dropped, and a
//      gate reject never kills the other records' derivation);
//   4. folds the surviving records with the vendored derive();
//   5. posts the result as an advisory Check run (conclusion: neutral;
//      "failure" only when the input could not be read at all).
// Coalescing: CREDS holds an in-flight claim `inflight:<repo>:<sha>`
// (TTL 10 min) and a posted marker `posted:<repo>:<sha>` (TTL 24h),
// and every post is preceded by a GitHub-side check for an existing
// "git.pp state" run on the commit — so push + check_suite for one
// commit yield ONE check run even if the KV claims race. A repo with
// no .gitpp/records surface is skipped quietly — absence is not an
// error. Derivation failures are recorded in the event log, surfaced
// as a failure Check whenever a token is held, and NEVER fail the
// webhook response.
// ============================================================================

const QUALIFICATIONS =
  "Mechanical resolution of labelled key conflicts only; the fold does " +
  "not settle semantic conflicts. Digests authenticate content, not " +
  "authorship. Arrival order is never an input.";

function fmtValue(v) {
  return typeof v === "string" ? v : JSON.stringify(v);
}

function kindOf(rec) {
  return typeof rec?.kind === "string" ? rec.kind : "witness";
}

/** Transitive ancestors of a record, within the given record set. */
function ancestorIds(id, byId) {
  const out = new Set();
  const stack = [...(byId.get(id)?.parents ?? [])];
  while (stack.length > 0) {
    const cur = String(stack.pop());
    if (out.has(cur)) continue;
    const rec = byId.get(cur);
    if (!rec) continue;
    out.add(cur);
    for (const p of rec.parents ?? []) stack.push(p);
  }
  return out;
}

/** The fold's tie-break inputs for one candidate, computed from the
 * parents graph: how many of its ancestors carry non-witness ("intent")
 * rank vs witness rank. This mirrors the vendored derive() exactly —
 * among incomparable maximal candidates of the same kind it picks the
 * MOST non-witness ancestors, then the FEWEST witness ancestors, then
 * the smallest id. (rankOf/buildAncestry in the engine count the same
 * partition over the applied set; a candidate's ancestors are all
 * applied, so the counts agree.) */
function tieBreakCounts(id, byId, ancCache) {
  if (!ancCache.has(id)) {
    const anc = ancestorIds(id, byId);
    let intent = 0;
    let wit = 0;
    for (const a of anc) {
      if (rankOf(byId.get(a)) < WITNESS_RANK) intent++;
      else wit++;
    }
    ancCache.set(id, { anc, intent, wit });
  }
  return ancCache.get(id);
}

/** Human explanation of one conflict, from the records themselves.
 * Shape ported from gitpp-action's fold.mjs; the why-strings state the
 * engine's actual rules (kind priority, ancestry supersession, and the
 * tie-break with both candidates' measured values). */
function explainConflict(conflict, byId) {
  const winner = byId.get(conflict.winner);
  const wKind = kindOf(winner);
  const ancCache = new Map();
  const winnerInfo = tieBreakCounts(conflict.winner, byId, ancCache);
  const wRank = rankOf(winner);
  const pool = [conflict.winner, ...conflict.losers].filter(
    (id) => rankOf(byId.get(id)) === wRank,
  );
  const lines = [];
  lines.push(
    `- **${conflict.key}** = ${fmtValue(winner?.effects?.[conflict.key])} ` +
      `— winner \`${conflict.winner}\` (${wKind}` +
      (winner?.reason ? `, reason: "${winner.reason}"` : "") +
      `, parents: [${(winner?.parents ?? []).join(", ")}])`,
  );
  for (const loserId of conflict.losers) {
    const loser = byId.get(loserId);
    const lKind = kindOf(loser);
    let why;
    if (rankOf(loser) > wRank) {
      why = `outranked — ${wKind} beats ${lKind} (kind priority is absolute)`;
    } else if (winnerInfo.anc.has(loserId)) {
      why = "superseded — the winner descends from it";
    } else {
      const dominators = pool
        .filter(
          (id) =>
            id !== loserId &&
            tieBreakCounts(id, byId, ancCache).anc.has(loserId),
        )
        .sort(cmpCodePoints);
      if (dominators.length > 0) {
        why =
          `superseded — its descendant \`${dominators[0]}\` also sets ` +
          "this key, and a descendant's claim displaces its ancestor's";
      } else {
        const li = tieBreakCounts(loserId, byId, ancCache);
        why =
          "lost the tie-break among incomparable candidates of the same kind " +
          `(intent ancestors: ${li.intent} vs winner's ${winnerInfo.intent}; ` +
          `then fewest witness ancestors: ${li.wit} vs winner's ${winnerInfo.wit}; ` +
          "then smallest id)";
      }
    }
    lines.push(
      `  - loser \`${loserId}\` (${lKind}) set ${fmtValue(loser?.effects?.[conflict.key])} — ${why}; preserved in the record`,
    );
  }
  return lines;
}

const ADVISORY =
  "> Advisory — a mechanical derivation under the fold's rules, not an " +
  "approval. A winner means precedence, not correctness or " +
  "authorisation. This Check never gates a merge.";

const RULE_ORDER =
  "> How a winner is chosen: kind first (override beats task beats witness); within a kind, a record that descends from a rival supersedes it; any remaining tie breaks on ancestry — ancestors are all transitive ancestors, counted once each, excluding the record itself: most intent ancestors (task and override records) wins, then fewest witness ancestors, then smallest id. A record's reason is its author's note, never an input to the fold.";

/** GitHub caps check-run output text at 65,535 chars; assemble to stay
 * under 65,000, truncating the State list first, then Conflicts, then
 * the rejected-input list, then Orphans — each cut marked in place.
 * The qualifications blockquote is always the final text. */
const MAX_TEXT = 65000;
const TRUNC_MARKER = (n) =>
  `… ${n} more entries truncated in this view; the derivation itself is complete`;

function renderReport(records, project, opts = {}) {
  const out = derive(records);
  const rejects = opts.rejects ?? [];
  const byId = new Map(records.map((r) => [String(r.id), r]));
  const TITLE_PREFIX = "git.pp state — ";
  let title = project ? TITLE_PREFIX + project : "git.pp state";
  if (title.length > 255) {
    title = TITLE_PREFIX + String(project).slice(0, 255 - TITLE_PREFIX.length);
  }
  const counts =
    `${records.length} records · ${Object.keys(out.state).length} keys · ` +
    `${out.conflicts.length} conflict(s) · ${out.orphans.length} orphan(s)`;
  const scope = opts.sha ? `Commit \`${opts.sha.slice(0, 7)}\` · ${counts}` : counts;
  const head = [`# ${title}`, "", ADVISORY, RULE_ORDER, "", scope];
  const rejectFileCount = new Set(rejects.map((r) => r.file)).size;
  const rejectLines = rejects.map(
    (r) =>
      `- \`${r.file}\`${r.index !== undefined ? ` (element ${r.index})` : ""} — ${r.error}`,
  );
  const stateLines = Object.keys(out.state)
    .sort()
    .map((key) => `- \`${key}\` = ${fmtValue(out.state[key])}`);
  const conflictBlocks = out.conflicts.map((c) => explainConflict(c, byId));
  const orphanLines = out.orphans.map((o) => `- \`${o}\``);

  let dropRejects = 0;
  let dropState = 0;
  let dropConflicts = 0;
  let dropOrphans = 0;
  const build = () => {
    const lines = [...head];
    if (rejectLines.length > 0) {
      lines.push(
        "",
        `## Rejected input — ${rejectFileCount} file(s) did not contribute`,
        "",
        ...rejectLines.slice(0, rejectLines.length - dropRejects),
      );
      if (dropRejects > 0) lines.push(TRUNC_MARKER(dropRejects));
    }
    lines.push("", "## State", "");
    lines.push(...stateLines.slice(0, stateLines.length - dropState));
    if (dropState > 0) lines.push(TRUNC_MARKER(dropState));
    const keptBlocks = conflictBlocks.slice(
      0,
      conflictBlocks.length - dropConflicts,
    );
    if (conflictBlocks.length > 0) {
      lines.push("", "## Conflicts (losers preserved)", "");
      for (const b of keptBlocks) lines.push(...b);
      if (dropConflicts > 0) lines.push(TRUNC_MARKER(dropConflicts));
    }
    const keptOrphans = orphanLines.slice(0, orphanLines.length - dropOrphans);
    if (orphanLines.length > 0) {
      lines.push("", "## Orphans (excluded from state)", "", keptOrphans.join("\n"));
      if (dropOrphans > 0) lines.push(TRUNC_MARKER(dropOrphans));
    }
    lines.push("", `> ${QUALIFICATIONS}`);
    return lines.join("\n") + "\n";
  };
  let text = build();
  while (text.length > MAX_TEXT && dropState < stateLines.length) {
    dropState++;
    text = build();
  }
  while (text.length > MAX_TEXT && dropConflicts < conflictBlocks.length) {
    dropConflicts++;
    text = build();
  }
  while (text.length > MAX_TEXT && dropRejects < rejectLines.length) {
    dropRejects++;
    text = build();
  }
  while (text.length > MAX_TEXT && dropOrphans < orphanLines.length) {
    dropOrphans++;
    text = build();
  }
  return { text, out, title, summary: scope };
}

/** The failure report: used when the records surface exists but could
 * not be read at all (every file rejected), and for defensive catches
 * of other derivation errors. Names every rejected file and says how
 * records must look. */
function renderFailureText({ rejects = [], error = null, sha = "" } = {}) {
  const title = "git.pp state — could not derive";
  const rejectLines = rejects.map(
    (r) =>
      `- \`${r.file}\`${r.index !== undefined ? ` (element ${r.index})` : ""} — ${r.error}`,
  );
  let drop = 0;
  const build = () => {
    const lines = [`# ${title}`, "", ADVISORY, ""];
    if (sha) lines.push(`Commit \`${sha.slice(0, 7)}\` · could not derive`, "");
    lines.push("## What went wrong", "");
    if (error) lines.push(`- Derivation failed: ${String(error).slice(0, 300)}`);
    lines.push(...rejectLines.slice(0, rejectLines.length - drop));
    if (drop > 0) lines.push(TRUNC_MARKER(drop));
    lines.push(
      "",
      "Records are JSON files under `.gitpp/records/` — each file a plain " +
        "object (or an array of them) with a non-empty string `id`, and " +
        "optionally `parents` (an array of record ids), `kind` (a string), " +
        "and `effects` (an object of key → value). See the record " +
        "description in the gitpp-app README: " +
        "https://github.com/patchwork-quilt/gitpp-app#the-model",
      "",
      `> ${QUALIFICATIONS}`,
    );
    return lines.join("\n") + "\n";
  };
  let text = build();
  while (text.length > MAX_TEXT && drop < rejectLines.length) {
    drop++;
    text = build();
  }
  const rejectFileCount = new Set(rejects.map((r) => r.file)).size;
  const summary =
    rejects.length > 0
      ? `could not derive — ${rejectFileCount} rejected file(s)`
      : "could not derive — derivation error";
  return { title, text, summary };
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

// Installation tokens live an hour; a derivation burst (push +
// check_suite + retries) should not mint one per event. Module-scope
// cache keyed by installation id, reused while >60s of life remains.
const tokenCache = new Map();

async function installationToken(app, installationId) {
  const cacheKey = String(installationId);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs - Date.now() > 60000) return cached.token;
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
  const expiresAtMs =
    Date.parse(body.expires_at ?? "") || Date.now() + 50 * 60000;
  tokenCache.set(cacheKey, { token: body.token, expiresAtMs });
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

/** Parse a ustar archive into [{name, text}] for regular files UNDER
 * .gitpp/ only — bodies of other entries are never decoded (the walk
 * advances offsets only), so a huge repo tree costs no decode time.
 * Handles the 155-byte prefix field, GNU longname ('L') and pax ('x')
 * path overrides — GitHub/codeload tarballs use all three. A base-256
 * (binary) size field is refused with a clear error instead of being
 * misread as octal, which would desync the whole walk. The optional
 * `keep` predicate selects which regular files get decoded; the
 * default keeps everything under .gitpp/ (Mapping A). The surface
 * path (Mapping B) passes its own predicate for the gitpp/state
 * branch tarball, whose files live at the branch root. */
function parseTar(bytes, keep) {
  const entries = [];
  let offset = 0;
  let pendingName = null;
  const wanted = keep ?? ((name) => /(^|\/)\.gitpp\//.test(name));
  while (offset + 512 <= bytes.length) {
    const name = tarField(bytes, offset, 100);
    if (!name) break;
    if (bytes[offset + 124] & 0x80) {
      throw new Error(
        "unsupported base-256 tar size field (binary size encoding)",
      );
    }
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
      if (wanted(fullName)) {
        entries.push({ name: fullName, text: new TextDecoder().decode(data) });
      }
      // Not under .gitpp/: skip the body entirely (offset walk only).
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
const PROPOSAL_PATH = /(^|\/)\.gitpp\/proposals\/[^/]+\.json$/;

// ---- Input gate ------------------------------------------------------------
//
// Every record file is gated individually. A file that cannot be read —
// or a record that cannot be trusted — becomes a REJECT naming its file
// (and element index, for array files) and the specific reason; rejects
// never throw, never vanish silently, and never block the surviving
// records from deriving. The gate exists so one unreadable or
// malformed file cannot abort the whole derivation (a single JSON error
// used to do exactly that) and so every exclusion is a named reject,
// never a silent drop. It deliberately does NOT reject "__proto__" ids
// or effect keys: since the engine fix for git.pp-ng issue #38
// (vendored above), those are ordinary input — an "__proto__" id is a
// referenceable record and an "__proto__" effect key is an ordinary
// state key, pinned by the upstream conformance corpus — and rejecting
// them here would silently drop records the fold is specified to
// derive.

class TooLargeError extends Error {
  constructor(which) {
    super(`too-large: ${which}`);
    this.tooLarge = true;
    this.which = which;
  }
}

const MAX_GZ_BYTES = 25 * 1024 * 1024;
const MAX_TAR_BYTES = 100 * 1024 * 1024;
const MAX_RECORD_FILES = 5000;
const MAX_RECORDS = 20000;

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function truncErr(msg) {
  const s = String(msg ?? "unknown error");
  return s.length > 120 ? s.slice(0, 120) + "…" : s;
}

function gateRecord(candidate, file, index) {
  const reject = (error) => ({
    reject: {
      file,
      ...(index !== undefined ? { index } : {}),
      error: truncErr(error),
    },
  });
  if (!isPlainObject(candidate)) {
    return reject(
      index !== undefined
        ? "array element is not a plain object"
        : "top-level JSON is not a record object or an array of records",
    );
  }
  if (typeof candidate.id !== "string" || candidate.id.length === 0) {
    return reject("record id is missing or not a non-empty string");
  }
  if (candidate.parents !== undefined) {
    if (
      !Array.isArray(candidate.parents) ||
      !candidate.parents.every((p) => typeof p === "string")
    ) {
      return reject("parents is present but is not an array of strings");
    }
  }
  if (candidate.effects !== undefined) {
    if (!isPlainObject(candidate.effects)) {
      return reject("effects is present but is not a plain object");
    }
  }
  if (candidate.kind !== undefined && typeof candidate.kind !== "string") {
    return reject("kind is present but is not a string");
  }
  return { record: candidate };
}

/** Repo-relative display path for a tar entry (strip the tarball's
 * top-level "<repo>-<sha>/" segment). */
function displayPath(name) {
  const i = name.indexOf("/");
  return i >= 0 ? name.slice(i + 1) : name;
}

/** Parse and gate one record-bearing file into the given sinks. A
 * file that does not parse becomes one reject naming the file; each
 * record inside is gated individually by gateRecord. Shared by
 * .gitpp/records/ (Mapping A), .gitpp/proposals/ (Mapping B
 * previews) and the surface branch's records/ (Mapping B landed) —
 * one gating discipline for every record this app reads. */
function gateRecordFile(text, file, records, rejects, entries) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    rejects.push({
      file,
      error: truncErr(`JSON parse failed: ${err.message}`),
    });
    return;
  }
  const items = Array.isArray(parsed)
    ? parsed.map((v, i) => [v, i])
    : [[parsed, undefined]];
  for (const [item, index] of items) {
    const gated = gateRecord(item, file, index);
    if (gated.reject) {
      rejects.push(gated.reject);
    } else {
      records.push(gated.record);
      if (entries) entries.push({ record: gated.record, file });
      if (records.length > MAX_RECORDS) {
        throw new TooLargeError(`more than ${MAX_RECORDS} parsed records`);
      }
    }
  }
}

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
  if (gz.byteLength > MAX_GZ_BYTES) {
    throw new TooLargeError(
      `compressed tarball is ${gz.byteLength} bytes (limit ${MAX_GZ_BYTES})`,
    );
  }
  const tar = await gunzip(gz);
  if (tar.byteLength > MAX_TAR_BYTES) {
    throw new TooLargeError(
      `decompressed tar is ${tar.byteLength} bytes (limit ${MAX_TAR_BYTES})`,
    );
  }
  const entries = parseTar(tar);
  const records = [];
  const rejects = [];
  const proposals = [];
  const proposalRejects = [];
  const proposalEntries = [];
  let project = null;
  let recordFileCount = 0;
  let proposalFileCount = 0;
  for (const e of entries) {
    if (RECORD_PATH.test(e.name)) {
      recordFileCount++;
      if (recordFileCount > MAX_RECORD_FILES) {
        throw new TooLargeError(`more than ${MAX_RECORD_FILES} record files`);
      }
      gateRecordFile(e.text, displayPath(e.name), records, rejects);
    } else if (PROPOSAL_PATH.test(e.name)) {
      // Mapping B proposals ride in the same tarball Mapping A already
      // fetched — collecting them costs no extra call. The Mapping A
      // path ignores them entirely; the surface path reads them via
      // the shared intake (see deriveSurfaceAndPost).
      proposalFileCount++;
      if (proposalFileCount > MAX_RECORD_FILES) {
        throw new TooLargeError(
          `more than ${MAX_RECORD_FILES} proposal files`,
        );
      }
      gateRecordFile(
        e.text,
        displayPath(e.name),
        proposals,
        proposalRejects,
        proposalEntries,
      );
    } else if (PROJECT_PATH.test(e.name)) {
      try {
        let text = e.text;
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        project = JSON.parse(text);
      } catch {
        project = null;
      }
    }
  }
  return {
    records,
    rejects,
    project,
    recordFileCount,
    proposals,
    proposalRejects,
    proposalEntries,
    proposalFileCount,
  };
}

// ---- The loop ---------------------------------------------------------------

function rand6() {
  const b = new Uint8Array(3);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Append one event-log entry as its OWN KV key
 * ("evt:<ISO timestamp>:<rand6>"). The old ring was a single
 * read-modify-write array: two simultaneous deliveries could read the
 * same array and the later write silently dropped the earlier entry.
 * Per-entry keys make appends independent; /events lists and merges.
 * Never throws — the log is a courtesy surface, not a gate. */
async function appendRing(env, entry) {
  try {
    const key = `evt:${entry.t}:${rand6()}`;
    await env.CREDS.put(key, JSON.stringify(entry));
  } catch {}
}

/** The id of an existing check run of the given name on this commit,
 * or null. This is the idempotence backstop: KV claims can race, but
 * a run GitHub already holds cannot be un-held — if one exists, never
 * post a second. The name defaults to Mapping A's "git.pp state";
 * the surface path passes "git.pp surface". */
async function existingCheckId(token, repo, sha, name = "git.pp state") {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/commits/${sha}/check-runs?check_name=${encodeURIComponent(name)}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "gitpp-app-receiver",
      },
    },
  );
  if (!res.ok) return null;
  const body = await res.json();
  if (body.total_count > 0 && body.check_runs?.[0]?.id) {
    return body.check_runs[0].id;
  }
  return null;
}

async function postCheckRun(
  token,
  repo,
  sha,
  { title, summary, text, conclusion, name = "git.pp state" },
) {
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
      name,
      head_sha: sha,
      status: "completed",
      conclusion,
      output: { title, summary, text },
    }),
  });
  if (!res.ok) {
    throw new Error(
      `check-runs HTTP ${res.status}: ${(await res.text()).slice(0, 80)}`,
    );
  }
  const created = await res.json();
  return created.id;
}

/** Post the failure Check (conclusion "failure" — the one case this app
 * uses it: input it could not read at all, or a derivation error).
 * Honours the same GitHub-side idempotence as the neutral path. */
async function postFailureCheck(token, repo, sha, failure) {
  const existing = await existingCheckId(token, repo, sha).catch(() => null);
  if (existing) return existing;
  const { title, summary, text } = renderFailureText({ ...failure, sha });
  return postCheckRun(token, repo, sha, {
    title,
    summary,
    text,
    conclusion: "failure",
  });
}

async function deriveAndPost(env, app, { repo, sha, installationId }, shared) {
  const log = (action, detail) =>
    appendRing(env, {
      t: new Date().toISOString(),
      event: "derive",
      repo,
      sha: sha.slice(0, 7),
      action,
      ...(detail ? { detail: String(detail).slice(0, 120) } : {}),
    }).catch(() => {});
  const inflightKey = `inflight:${repo}:${sha}`;
  const postedKey = `posted:${repo}:${sha}`;
  let claimed = false;
  let token = null;
  let stage = "claim";
  const releaseClaim = async () => {
    if (!claimed) return;
    claimed = false;
    try {
      await env.CREDS.delete(inflightKey);
    } catch {}
  };
  try {
    if (await env.CREDS.get(postedKey)) {
      await log("skipped-duplicate", "posted marker exists for this commit");
      return;
    }
    if (await env.CREDS.get(inflightKey)) {
      await log("skipped-duplicate", "inflight claim held for this commit");
      return;
    }
    // Claim the commit before working: push and check_suite for the same
    // sha arrive as separate deliveries, and the second must find this.
    await env.CREDS.put(inflightKey, "1", { expirationTtl: 600 });
    claimed = true;
    const instId = installationId ?? app.installation_id;
    if (!instId) throw new Error("no installation id in payload or store");
    stage = "token";
    token = await installationToken(app, instId);
    stage = "fetch";
    const fetched = await fetchRecords(token, repo, sha);
    const { records, rejects, project, recordFileCount } = fetched;
    // The tarball is already paid for: share the whole intake with
    // the surface path (Mapping B), which needs the proposals from
    // this same tree and must not fetch it a second time.
    if (shared) shared.intake = fetched;
    if (records.length === 0 && rejects.length === 0) {
      // No records surface (or only empty ones): silence, by design.
      await releaseClaim();
      await log("skipped-no-records");
      return;
    }
    if (records.length === 0 && recordFileCount > 0) {
      // A records surface exists but nothing in it could be read:
      // never silent — a failure Check naming every rejected file.
      const fid = await postFailureCheck(token, repo, sha, { rejects });
      await env.CREDS.put(postedKey, `failed:${fid}`, {
        expirationTtl: 86400,
      });
      await releaseClaim();
      await log(
        "posted",
        `failure check ${fid} — ${rejects.length} rejected input(s)`,
      );
      return;
    }
    stage = "render";
    const projectName =
      (typeof project?.project === "string" && project.project) || repo;
    const { text, title, summary } = renderReport(records, projectName, {
      sha,
      rejects,
    });
    stage = "post";
    const existing = await existingCheckId(token, repo, sha).catch(() => null);
    if (existing) {
      await env.CREDS.put(postedKey, `posted:${existing}`, {
        expirationTtl: 86400,
      });
      await releaseClaim();
      await log("skipped-duplicate", `check ${existing} already exists`);
      return;
    }
    const checkId = await postCheckRun(token, repo, sha, {
      title,
      summary,
      text,
      conclusion: "neutral",
    });
    await env.CREDS.put(postedKey, `posted:${checkId}`, {
      expirationTtl: 86400,
    });
    await releaseClaim();
    await log(
      "posted",
      `check ${checkId}` +
        (rejects.length > 0 ? ` · ${rejects.length} rejected input(s)` : ""),
    );
  } catch (err) {
    await releaseClaim();
    // Never silent: while we hold a token and the failure is not the
    // Check POST itself, surface the error as a failure Check on the
    // commit (a reader of the repo should not have to find this
    // Worker's event log to learn derivation died). If that surfacing
    // also fails, the ring entry below is the record.
    if (token && stage !== "post") {
      try {
        const fid = await postFailureCheck(token, repo, sha, {
          error: err?.message ?? String(err),
        });
        await env.CREDS.put(postedKey, `failed:${fid}`, {
          expirationTtl: 86400,
        });
        await log("failed", `${err?.message ?? err} (failure check ${fid})`);
        return;
      } catch {}
    }
    await log("failed", err?.message ?? err);
  }
}

// ---- Mapping B: declared surfaces -------------------------------------------
//
// A declared state surface for ordinary repositories (design:
// mapping-b-design/DESIGN.md). The team names a small set of
// coordination keys in surface.json at the root of an orphan branch,
// gitpp/state, and keeps records beside it in records/. This Worker
// derives that surface and posts it as a Check named "git.pp surface"
// — on the state branch tip as landed, and on working-branch commits
// as the state a merge would join, plus the effect of any proposed
// records (.gitpp/proposals/*.json) in that tree, derived separately
// and labelled as proposed, never landed.
//
// Tier 1 only: the App's permissions are unchanged and it writes
// nothing anywhere. Records reach gitpp/state by ordinary git under
// the team's own credentials.
//
// KV, beside the app record and the Mapping A keys:
//   surfinfo:<repo>          discovery cache {has, tipSha, tipTime,
//                            checkedAt} — probed at most hourly, so
//                            non-surface repos cost no per-push call.
//   surfdecl:<repo>:<tipSha> the declaration as fetched at that tip.
//   surfmanifest:<repo>      {ids, patterns, tipSha, at} from the
//                            last posted surface derivation — the
//                            history-integrity baseline (§5.2 of the
//                            design). Ids and patterns only; no state
//                            digest is pinned.
//   inflight-s:/posted-s:    the per-commit claim discipline, scoped
//                            to the surface Check so one commit can
//                            hold a "git.pp state" and a "git.pp
//                            surface" run side by side.
//
// Interaction with Mapping A (the choice, stated): a repo whose
// pushed commit carries .gitpp/records keeps exactly today's
// Mapping A behaviour, untouched. The surface path is an independent
// second derivation over independent inputs; neither reads the
// other's records.

/*TEST-EXTRACT:surface*/

const SURFACE_BRANCH = "gitpp/state";
const SURFACE_CHECK_NAME = "git.pp surface";
const SURFACE_FILE = /^[^/]+\/(surface\.json|records\/[^/]+\.json)$/;
const SURFACE_JSON_PATH = /^[^/]+\/surface\.json$/;
const SURFACE_RECORD_PATH = /^[^/]+\/records\/[^/]+\.json$/;
const SURFACE_PROBE_TTL_MS = 3600 * 1000;

const SURFACE_SCOPE =
  "This Check derives the declared coordination surface only — the " +
  "keys named in `surface.json` on `gitpp/state`. It did not read or " +
  "analyse this repository's code, and it says nothing about whether " +
  "the code merges cleanly.";

const SURFACE_QUALIFICATIONS =
  QUALIFICATIONS +
  " The surface is what its records say, written by the people and " +
  "agents named in them.";

/** Validate a parsed surface.json against the v1 schema (design
 * §2.2): version 1; a non-empty name; preview "full" (default) or
 * "proposals-only"; a non-empty keys object whose names are exact
 * keys or single trailing .* families, each with a required non-empty
 * description (the description is the legibility surface). Returns
 * { surface } — patterns in declaration order, {pattern, prefix,
 * description} with prefix null for exact keys and the dotted prefix
 * ("task.claim.") for families — or { error }. */
function validateSurface(decl) {
  const bad = (error) => ({ error });
  if (!isPlainObject(decl)) return bad("surface.json is not a JSON object");
  if (decl.version !== 1) return bad("surface.json version must be 1");
  if (typeof decl.name !== "string" || decl.name.length === 0) {
    return bad("surface.json name must be a non-empty string");
  }
  const preview = decl.preview ?? "full";
  if (preview !== "full" && preview !== "proposals-only") {
    return bad('surface.json preview must be "full" or "proposals-only"');
  }
  if (!isPlainObject(decl.keys) || Object.keys(decl.keys).length === 0) {
    return bad("surface.json keys must be a non-empty object");
  }
  const patterns = [];
  for (const [pattern, spec] of Object.entries(decl.keys)) {
    if (pattern.length === 0) {
      return bad("surface.json declares an empty key name");
    }
    let prefix = null;
    if (pattern.includes("*")) {
      if (
        !pattern.endsWith(".*") ||
        pattern.indexOf("*") !== pattern.length - 1
      ) {
        return bad(
          `key pattern "${pattern}" is not an exact name or a single trailing .* family`,
        );
      }
      prefix = pattern.slice(0, -1);
    }
    if (
      !isPlainObject(spec) ||
      typeof spec.description !== "string" ||
      spec.description.length === 0
    ) {
      return bad(
        `key "${pattern}" must declare a non-empty description — the description is what a reader of the Check sees`,
      );
    }
    patterns.push({ pattern, prefix, description: spec.description });
  }
  return { surface: { version: 1, name: decl.name, preview, patterns } };
}

/** The declaration entry governing one concrete key, or null. An
 * exact name beats a family; among families the longest prefix wins,
 * so nested families resolve deterministically. */
function surfaceDeclares(surface, key) {
  let best = null;
  for (const p of surface.patterns) {
    if (p.prefix === null) {
      if (p.pattern === key) return p;
    } else if (key.startsWith(p.prefix)) {
      if (!best || p.prefix.length > best.prefix.length) best = p;
    }
  }
  return best;
}

/** Whether a key was declared by a previous declaration's patterns
 * (the retired test, design §2.3). Patterns arrive either normalized
 * ({pattern, prefix}) or as bare strings (the manifest stores them
 * normalized; bare strings are accepted for robustness). */
function previouslyDeclared(prevPatterns, key) {
  for (const p of prevPatterns ?? []) {
    const pattern = typeof p === "string" ? p : p.pattern;
    const prefix =
      typeof p === "string"
        ? p.endsWith(".*")
          ? p.slice(0, -1)
          : null
        : p.prefix;
    if (prefix === null ? pattern === key : key.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/** Apply the declaration to gated record entries (design §2.3).
 * entries: [{record, file}] (file may be null when unknown).
 * Returns:
 *   kept          records that derive, effects filtered to declared
 *                 keys; records with no effect keys are structural
 *                 anchors (they carry ancestry, set nothing) and are
 *                 always kept — a record can only be rejected for
 *                 keys it actually sets. A record whose effect keys
 *                 ALL retired is kept the same way, as an anchor
 *                 with zero deriving effects: retirement is a
 *                 declaration change, not a record defect, and it
 *                 must not orphan the record's descendants (live
 *                 acceptance drill 4). A record whose keys were
 *                 never declared anchors nothing (fullyRejected);
 *                 rejection and retirement stay distinct;
 *   fullyRejected [{id, file, keys}] records whose effect keys are
 *                 all undeclared (and none merely retired): rejected
 *                 input, named, never silent;
 *   partialRejects [{id, file, keys}] undeclared keys stripped from
 *                 records that still derived their declared keys;
 *   retired       [{id, file, keys, partial}] keys that a previous
 *                 declaration covered and this one does not. A record
 *                 whose only keys retired derives none of them (it
 *                 stays in the graph as an anchor, above); a record
 *                 that also sets declared keys derived without them. */
function applyDeclarationGate(surface, entries, prevPatterns) {
  const kept = [];
  const fullyRejected = [];
  const partialRejects = [];
  const retired = [];
  for (const { record, file } of entries) {
    const eff = effectsOf(record);
    const keys = Object.keys(eff);
    if (keys.length === 0) {
      kept.push(record);
      continue;
    }
    const declared = {};
    const undeclared = [];
    const retiredKeys = [];
    for (const k of keys) {
      if (surfaceDeclares(surface, k)) setOwn(declared, k, eff[k]);
      else if (previouslyDeclared(prevPatterns, k)) retiredKeys.push(k);
      else undeclared.push(k);
    }
    const id = String(record.id);
    if (Object.keys(declared).length > 0) {
      kept.push({ ...record, effects: declared });
      if (undeclared.length > 0) {
        partialRejects.push({ id, file, keys: undeclared });
      }
      if (retiredKeys.length > 0) {
        retired.push({ id, file, keys: retiredKeys, partial: true });
      }
    } else if (undeclared.length > 0) {
      fullyRejected.push({
        id,
        file,
        keys: [...undeclared, ...retiredKeys],
      });
    } else {
      // Every effect key retired: the record derives none of them,
      // but it remains in the ancestry graph as a structural anchor
      // (zero deriving effects), so retiring a key cannot orphan the
      // records that descend from it. Dropping the record outright
      // took the whole subtree down when the retired key was the
      // root record's only key (live acceptance drill 4, Check
      // 120182901327: genesis dropped, claim-dock-7 and oncall-rota
      // orphaned, still-declared keys vanishing from state).
      kept.push({ ...record, effects: {} });
      retired.push({ id, file, keys: retiredKeys, partial: false });
    }
  }
  return { kept, fullyRejected, partialRejects, retired };
}

/** Setter map for a record set: key → [record ids], orphans excluded
 * (an orphan's claims do not stand, so it sets nothing). */
function settersOf(records, orphanIds) {
  const orphanSet = new Set(orphanIds);
  const m = new Map();
  for (const r of records) {
    const id = String(r.id);
    if (orphanSet.has(id)) continue;
    for ( const k of Object.keys(effectsOf(r))) {
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(id);
    }
  }
  return m;
}

/** The record the fold picks for one key among its setters, computed
 * from the parents graph the way explainConflict mirrors the engine:
 * best kind rank, then maximal (not an ancestor of a rival in the
 * pool), then the tie-break tuple (most intent ancestors, fewest
 * witness ancestors, smallest id). The harness cross-checks this
 * against derive()'s own conflict winners. */
function pickWinnerId(setterIds, byId) {
  const ancCache = new Map();
  let best = Infinity;
  for (const id of setterIds) best = Math.min(best, rankOf(byId.get(id)));
  const pool = setterIds.filter((id) => rankOf(byId.get(id)) === best);
  const maximal = pool.filter(
    (id) =>
      !pool.some(
        (other) =>
          other !== id &&
          tieBreakCounts(other, byId, ancCache).anc.has(id),
      ),
  );
  if (maximal.length === 1) return maximal[0];
  return [...maximal].sort((a, b) => {
    const ai = tieBreakCounts(a, byId, ancCache);
    const bi = tieBreakCounts(b, byId, ancCache);
    if (ai.intent !== bi.intent) return bi.intent - ai.intent;
    if (ai.wit !== bi.wit) return ai.wit - bi.wit;
    return cmpCodePoints(a, b);
  })[0];
}

/** One state line per declared key (design §4.3): exact keys always
 * appear (value and winner, or "unset"); family patterns appear once
 * per concrete key set, or once as "no keys set". Every line carries
 * the declaration's description — that text is the legibility
 * surface. Winners come from the derivation's conflicts where the
 * key was contested, else from pickWinnerId over the applied
 * setters. */
function surfaceStateLines(surface, out, records) {
  const byId = new Map(records.map((r) => [String(r.id), r]));
  const setters = settersOf(records, out.orphans);
  const conflictByKey = new Map(out.conflicts.map((c) => [c.key, c]));
  const winnerOf = (key) => {
    const ids = setters.get(key) ?? [];
    if (ids.length === 0) return null;
    const wid = conflictByKey.get(key)?.winner ?? pickWinnerId(ids, byId);
    return { id: wid, rec: byId.get(wid) };
  };
  const winText = (w) =>
    `winner \`${w.id}\` (${kindOf(w.rec)}` +
    (w.rec?.reason ? `, reason: "${w.rec.reason}"` : "") +
    ")";
  const lines = [];
  for (const p of surface.patterns) {
    if (p.prefix !== null) continue;
    const w = winnerOf(p.pattern);
    lines.push(
      w
        ? `- \`${p.pattern}\` = ${fmtValue(out.state[p.pattern])} — ${winText(w)} — ${p.description}`
        : `- \`${p.pattern}\` — unset — ${p.description}`,
    );
  }
  for (const p of surface.patterns) {
    if (p.prefix === null) continue;
    const concrete = Object.keys(out.state)
      .filter((k) => k.startsWith(p.prefix))
      .sort(cmpCodePoints);
    if (concrete.length === 0) {
      lines.push(`- \`${p.pattern}\` — no keys set — ${p.description}`);
    }
    for (const k of concrete) {
      const w = winnerOf(k);
      lines.push(
        `- \`${k}\` = ${fmtValue(out.state[k])} — ${winText(w)} — ${p.description}`,
      );
    }
  }
  return lines;
}

/** Per-proposal verdicts for a preview (design §4.3 row 5), computed
 * from the union derivation: for every declared key a kept proposal
 * sets — would win (with or without contention), would lose to a
 * named record, no change (the winner already sets this value), or
 * would not derive (orphan in the union set). A proposal identical
 * to the landed record of the same id is called out as no change. */
function proposalVerdicts(landedGate, propGate, union) {
  const lines = [];
  const unionById = new Map(union.records.map((r) => [String(r.id), r]));
  const landedById = new Map(
    landedGate.kept.map((r) => [String(r.id), r]),
  );
  const orphanSet = new Set(union.out.orphans);
  const setters = settersOf(union.records, union.out.orphans);
  const conflictByKey = new Map(union.out.conflicts.map((c) => [c.key, c]));
  const props = [...propGate.kept].sort((a, b) =>
    cmpCodePoints(String(a.id), String(b.id)),
  );
  for (const p of props) {
    const pid = String(p.id);
    const landedTwin = landedById.get(pid);
    if (landedTwin && indexKey(landedTwin) === indexKey(p)) {
      lines.push(
        `- proposal \`${pid}\` — identical to the landed record of the same id; no change if landed again`,
      );
      continue;
    }
    for (const k of Object.keys(effectsOf(p)).sort(cmpCodePoints)) {
      const v = fmtValue(effectsOf(p)[k]);
      if (orphanSet.has(pid)) {
        lines.push(
          `- proposal \`${pid}\` sets \`${k}\` = ${v} — would not derive: in the union set it is an orphan (a parent is absent from the landed records and the proposals)`,
        );
        continue;
      }
      const ids = setters.get(k) ?? [];
      const wid = conflictByKey.get(k)?.winner ?? pickWinnerId(ids, unionById);
      if (wid === pid) {
        lines.push(
          ids.length > 1
            ? `- proposal \`${pid}\` sets \`${k}\` = ${v} — would win`
            : `- proposal \`${pid}\` sets \`${k}\` = ${v} — would win; no contention`,
        );
      } else {
        const wv = effectsOf(unionById.get(wid))[k];
        lines.push(
          pyDeepEqual(wv, effectsOf(p)[k])
            ? `- proposal \`${pid}\` sets \`${k}\` = ${v} — no change if landed: \`${wid}\` already sets this value`
            : `- proposal \`${pid}\` sets \`${k}\` = ${v} — would lose to \`${wid}\``,
        );
      }
    }
  }
  return lines;
}

function fmtAge(iso, nowMs) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const sec = Math.max(0, Math.round((nowMs - t) / 1000));
  if (sec < 90) return "just now";
  const min = Math.round(sec / 60);
  if (min < 90) return `${min} minutes ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr} hours ago`;
  return `${Math.round(hr / 24)} days ago`;
}

function rejectLinesFor(gate, fileRejects, proposed) {
  const tag = proposed ? "proposed record" : "record";
  const lines = [];
  for (const r of fileRejects ?? []) {
    lines.push(
      `- \`${r.file}\`${proposed ? " (proposal)" : ""} — ${r.error}`,
    );
  }
  for (const r of gate?.fullyRejected ?? []) {
    lines.push(
      `- ${tag} \`${r.id}\`${r.file ? ` (in \`${r.file}\`)` : ""} — none of its effect keys are declared in surface.json (sets ${r.keys.map((k) => `\`${k}\``).join(", ")}); it did not derive`,
    );
  }
  for (const r of gate?.partialRejects ?? []) {
    lines.push(
      `- ${tag} \`${r.id}\`${r.file ? ` (in \`${r.file}\`)` : ""} — undeclared key(s) ${r.keys.map((k) => `\`${k}\``).join(", ")} did not derive; the rest of the record did`,
    );
  }
  return lines;
}

function retiredLinesFor(gate) {
  return (gate?.retired ?? []).map(
    (r) =>
      `- record \`${r.id}\`${r.file ? ` (in \`${r.file}\`)` : ""} — key(s) ${r.keys.map((k) => `\`${k}\``).join(", ")} were declared before and are not declared now; ` +
      (r.partial
        ? "the rest of the record derived. "
        : "the record did not derive. ") +
      "Preserved on `gitpp/state`; re-declaring the key revives it exactly as it was",
  );
}

/** Assemble the surface Check text (design §4.3 anatomy): scope
 * sentence first, advisory, rule order, basis line, the landed state
 * table with per-key descriptions, rejected and retired material by
 * name, then — previews only — the in-flight verdicts and the union
 * state as a separate, labelled derivation; conflicts and orphans
 * from the landed fold; the history-integrity line when record ids
 * vanished since the last derivation; qualifications last, always.
 * Truncation drops the union state first and the landed state last,
 * each cut marked, under the same 65,000-char budget as Mapping A. */
function renderSurfaceReport(args) {
  const { surface, mode, sha, tipSha, tipTime } = args;
  const now = args.now ?? Date.now();
  const landed = args.landed;
  const landedOut = landed.out;
  const landedById = new Map(
    landed.gate.kept.map((r) => [String(r.id), r]),
  );
  let title =
    mode === "preview"
      ? `git.pp surface — ${surface.name}, preview: what lands if these proposals do`
      : `git.pp surface — ${surface.name}, as landed`;
  if (title.length > 255) title = title.slice(0, 255);
  const age = fmtAge(tipTime, now);
  const basis =
    `Surface basis: \`gitpp/state\` at \`${String(tipSha).slice(0, 7)}\` · ` +
    (tipTime
      ? `surface last changed ${tipTime}${age ? ` (${age})` : ""}`
      : "surface last changed at an unknown time") +
    ` · ${landed.rawCount} landed record(s)`;
  const counts =
    `Commit \`${String(sha).slice(0, 7)}\` · ${landed.rawCount} landed records · ` +
    `${Object.keys(landedOut.state).length} keys · ` +
    `${landedOut.conflicts.length} conflict(s) · ${landedOut.orphans.length} orphan(s)` +
    (mode === "preview"
      ? ` · ${args.proposals.gate.rawCount} proposed record(s)`
      : "");
  const head = [
    `# ${title}`,
    "",
    SURFACE_SCOPE,
    "",
    ADVISORY,
    RULE_ORDER,
    "",
    basis,
    "",
    counts,
  ];
  const stateLines = surfaceStateLines(surface, landedOut, landed.gate.kept);
  const rejectLines = [
    ...rejectLinesFor(landed.gate, landed.fileRejects, false),
    ...(mode === "preview"
      ? rejectLinesFor(
          args.proposals.gate,
          args.proposals.gate.fileRejects,
          true,
        )
      : []),
  ];
  const retiredLines = retiredLinesFor(landed.gate);
  const verdictLines =
    mode === "preview"
      ? proposalVerdicts(landed.gate, args.proposals.gate, args.proposals.union)
      : [];
  const unionStateLines =
    mode === "preview"
      ? surfaceStateLines(
          surface,
          args.proposals.union.out,
          args.proposals.union.records,
        )
      : [];
  const conflictBlocks = landedOut.conflicts.map((c) =>
    explainConflict(c, landedById),
  );
  const orphanLines = landedOut.orphans.map((o) => `- \`${o}\``);
  const historyLines = [];
  if (args.vanished && args.vanished.ids.length > 0) {
    const ids = args.vanished.ids;
    const shown = ids.slice(0, 50);
    historyLines.push(
      `- ${ids.length} record(s) present in the surface${args.vanished.at ? ` on ${args.vanished.at}` : ""} are absent from \`gitpp/state\` at \`${String(tipSha).slice(0, 7)}\`: ${shown.map((i) => `\`${i}\``).join(", ")}${ids.length > shown.length ? ` … and ${ids.length - shown.length} more` : ""} — the branch history was rewritten or records were deleted`,
    );
  }
  let dropUnion = 0;
  let dropVerdicts = 0;
  let dropConflicts = 0;
  let dropOrphans = 0;
  let dropRetired = 0;
  let dropRejects = 0;
  let dropState = 0;
  const build = () => {
    const lines = [...head];
    lines.push("", mode === "preview" ? "## State (as landed)" : "## State", "");
    lines.push(...stateLines.slice(0, stateLines.length - dropState));
    if (dropState > 0) lines.push(TRUNC_MARKER(dropState));
    if (rejectLines.length > 0) {
      lines.push("", "## Rejected input — named, never silent", "");
      lines.push(...rejectLines.slice(0, rejectLines.length - dropRejects));
      if (dropRejects > 0) lines.push(TRUNC_MARKER(dropRejects));
    }
    if (retiredLines.length > 0) {
      lines.push("", "## Retired — declared before, not declared now", "");
      lines.push(...retiredLines.slice(0, retiredLines.length - dropRetired));
      if (dropRetired > 0) lines.push(TRUNC_MARKER(dropRetired));
    }
    if (mode === "preview") {
      lines.push(
        "",
        "## In flight — proposed records (not landed)",
        "",
        "These records are proposals in this commit's tree. They are not landed, and the state above does not include them. The verdicts and the state below come from a separate derivation over the landed records plus these proposals.",
        "",
      );
      lines.push(...verdictLines.slice(0, verdictLines.length - dropVerdicts));
      if (dropVerdicts > 0) lines.push(TRUNC_MARKER(dropVerdicts));
      lines.push(
        "",
        "### State if these proposals land — a separate derivation",
        "",
      );
      lines.push(
        ...unionStateLines.slice(0, unionStateLines.length - dropUnion),
      );
      if (dropUnion > 0) lines.push(TRUNC_MARKER(dropUnion));
    }
    const keptBlocks = conflictBlocks.slice(
      0,
      conflictBlocks.length - dropConflicts,
    );
    if (conflictBlocks.length > 0) {
      lines.push("", "## Conflicts (losers preserved)", "");
      for (const b of keptBlocks) lines.push(...b);
      if (dropConflicts > 0) lines.push(TRUNC_MARKER(dropConflicts));
    }
    const keptOrphans = orphanLines.slice(0, orphanLines.length - dropOrphans);
    if (orphanLines.length > 0) {
      lines.push("", "## Orphans (excluded from state)", "");
      lines.push(...keptOrphans);
      if (dropOrphans > 0) lines.push(TRUNC_MARKER(dropOrphans));
    }
    if (historyLines.length > 0) {
      lines.push("", "## History integrity", "", ...historyLines);
    }
    lines.push("", `> ${SURFACE_QUALIFICATIONS}`);
    return lines.join("\n") + "\n";
  };
  let text = build();
  const bump = (cond, inc) => {
    while (text.length > MAX_TEXT && cond()) {
      inc();
      text = build();
    }
  };
  bump(() => dropUnion < unionStateLines.length, () => dropUnion++);
  bump(() => dropVerdicts < verdictLines.length, () => dropVerdicts++);
  bump(() => dropConflicts < conflictBlocks.length, () => dropConflicts++);
  bump(() => dropOrphans < orphanLines.length, () => dropOrphans++);
  bump(() => dropRetired < retiredLines.length, () => dropRetired++);
  bump(() => dropRejects < rejectLines.length, () => dropRejects++);
  bump(() => dropState < stateLines.length, () => dropState++);
  return { text, title, summary: counts };
}

/** The surface failure report: a surface exists (or a push to
 * gitpp/state says one was intended) but could not be read at all —
 * the declaration does not parse, or derivation itself failed. The
 * surface path's one use of a failure conclusion, mirroring
 * Mapping A's doctrine. */
function renderSurfaceFailureText({ error = null, declError = null, sha = "" } = {}) {
  const title = "git.pp surface — could not derive";
  const lines = [`# ${title}`, "", SURFACE_SCOPE, "", ADVISORY, ""];
  if (sha) {
    lines.push(`Commit \`${String(sha).slice(0, 7)}\` · could not derive`, "");
  }
  lines.push("## What went wrong", "");
  if (declError) lines.push(`- ${declError}`);
  if (error) lines.push(`- Derivation failed: ${String(error).slice(0, 300)}`);
  lines.push(
    "",
    "A surface is a `surface.json` declaration plus `records/*.json` " +
      "on the `gitpp/state` branch — each record a plain object (or an " +
      "array of them) with a non-empty string `id`, and optionally " +
      "`parents` (an array of record ids), `kind` (a string), and " +
      "`effects` (an object of key → value). Only keys declared in " +
      "surface.json derive. See the surface description in the " +
      "gitpp-app README: " +
      "https://github.com/patchwork-quilt/gitpp-app#declared-surfaces-mapping-b",
    "",
    `> ${SURFACE_QUALIFICATIONS}`,
  );
  return {
    title,
    text: lines.join("\n") + "\n",
    summary: "could not derive — surface unreadable",
  };
}

async function ghGet(token, path) {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "gitpp-app-receiver",
    },
  });
}

/** Resolve the gitpp/state tip for a repo, through the hourly
 * discovery cache (design §6.2 delta 1): a repo with no surface
 * costs at most one probe per hour, never a call per push. A push
 * to gitpp/state itself refreshes the cache directly (see
 * deriveSurfaceAndPost), so this probe serves working-branch
 * pushes and check_suite events. */

/** The tip commit's own time (committer date, author date as
 * fallback), or null when the read fails. The basis line's "surface
 * last changed" must come from the commit itself, never from
 * whichever webhook twin happened to win the per-commit claim: a
 * push payload carries head_commit.timestamp, but a check_suite
 * payload carries no timestamp at all, so a surface derivation
 * driven by the check_suite twin rendered "at an unknown time"
 * even though the tip commit's time was always one read away
 * (live acceptance drills 2, 3, 5B). One read, only made when no
 * payload or cache supplied the time. */
async function resolveTipTime(token, repo, tipSha) {
  try {
    const cRes = await ghGet(token, `/repos/${repo}/commits/${tipSha}`);
    if (cRes.ok) {
      const cb = await cRes.json();
      return cb?.commit?.committer?.date ?? cb?.commit?.author?.date ?? null;
    }
  } catch {}
  return null;
}

async function probeSurfaceTip(env, token, repo) {
  const key = `surfinfo:${repo}`;
  try {
    const raw = await env.CREDS.get(key);
    if (raw) {
      const info = JSON.parse(raw);
      if (
        info &&
        typeof info.checkedAt === "number" &&
        Date.now() - info.checkedAt < SURFACE_PROBE_TTL_MS
      ) {
        return info;
      }
    }
  } catch {}
  const info = { has: false, tipSha: null, tipTime: null, checkedAt: Date.now() };
  const refRes = await ghGet(
    token,
    `/repos/${repo}/git/ref/heads/${encodeURIComponent(SURFACE_BRANCH)}`,
  );
  if (refRes.status === 404) {
    try {
      await env.CREDS.put(key, JSON.stringify(info), {
        expirationTtl: 3600,
      });
    } catch {}
    return info;
  }
  if (!refRes.ok) throw new Error(`surface probe HTTP ${refRes.status}`);
  const refBody = await refRes.json();
  const tipSha = refBody?.object?.sha ?? null;
  if (!tipSha) {
    try {
      await env.CREDS.put(key, JSON.stringify(info), {
        expirationTtl: 3600,
      });
    } catch {}
    return info;
  }
  info.has = true;
  info.tipSha = tipSha;
  info.tipTime = await resolveTipTime(token, repo, tipSha);
  try {
    await env.CREDS.put(key, JSON.stringify(info), { expirationTtl: 3600 });
  } catch {}
  return info;
}

/** Fetch and gate the surface at a gitpp/state tip: one tarball call
 * yields the declaration and the records together (design §2.1).
 * Returns { declStatus: "ok" | "absent" | "invalid", ... }: "absent"
 * means the branch carries no surface.json (no surface — quiet);
 * "invalid" means one exists but cannot be read (never quiet). */
async function fetchSurface(token, repo, tipSha) {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/tarball/${tipSha}`,
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
  if (!res.ok) throw new Error(`surface tarball HTTP ${res.status}`);
  const gz = new Uint8Array(await res.arrayBuffer());
  if (gz.byteLength > MAX_GZ_BYTES) {
    throw new TooLargeError(
      `compressed tarball is ${gz.byteLength} bytes (limit ${MAX_GZ_BYTES})`,
    );
  }
  const tar = await gunzip(gz);
  if (tar.byteLength > MAX_TAR_BYTES) {
    throw new TooLargeError(
      `decompressed tar is ${tar.byteLength} bytes (limit ${MAX_TAR_BYTES})`,
    );
  }
  const entries = parseTar(tar, (name) => SURFACE_FILE.test(name));
  let declText = null;
  const records = [];
  const recordEntries = [];
  const rejects = [];
  let recordFileCount = 0;
  for (const e of entries) {
    if (SURFACE_JSON_PATH.test(e.name)) {
      if (declText === null) {
        declText =
          e.text.charCodeAt(0) === 0xfeff ? e.text.slice(1) : e.text;
      }
    } else if (SURFACE_RECORD_PATH.test(e.name)) {
      recordFileCount++;
      if (recordFileCount > MAX_RECORD_FILES) {
        throw new TooLargeError(
          `more than ${MAX_RECORD_FILES} surface record files`,
        );
      }
      gateRecordFile(
        e.text,
        displayPath(e.name),
        records,
        rejects,
        recordEntries,
      );
    }
  }
  const base = { records, recordEntries, rejects, recordFileCount };
  if (declText === null) return { declStatus: "absent", ...base };
  let decl;
  try {
    decl = JSON.parse(declText);
  } catch (err) {
    return {
      declStatus: "invalid",
      declError: `surface.json does not parse: ${truncErr(err.message)}`,
      ...base,
    };
  }
  const v = validateSurface(decl);
  if (v.error) {
    return { declStatus: "invalid", declError: v.error, ...base };
  }
  return { declStatus: "ok", surface: v.surface, declRaw: decl, ...base };
}

async function readSurfaceManifest(env, repo) {
  try {
    const raw = await env.CREDS.get(`surfmanifest:${repo}`);
    if (!raw) return null;
    const m = JSON.parse(raw);
    return m && Array.isArray(m.ids) ? m : null;
  } catch {
    return null;
  }
}

/** Post the surface failure Check (conclusion "failure"), honouring
 * the same GitHub-side idempotence as the neutral path. */
async function postSurfaceFailure(token, repo, sha, failure) {
  const existing = await existingCheckId(
    token,
    repo,
    sha,
    SURFACE_CHECK_NAME,
  ).catch(() => null);
  if (existing) return existing;
  const { title, summary, text } = renderSurfaceFailureText({
    ...failure,
    sha,
  });
  return postCheckRun(token, repo, sha, {
    title,
    summary,
    text,
    conclusion: "failure",
    name: SURFACE_CHECK_NAME,
  });
}

async function deriveSurfaceAndPost(env, app, args, shared) {
  const { repo, sha } = args;
  const log = (action, detail) =>
    appendRing(env, {
      t: new Date().toISOString(),
      event: "derive-surface",
      repo,
      sha: sha.slice(0, 7),
      action,
      ...(detail ? { detail: String(detail).slice(0, 120) } : {}),
    }).catch(() => {});
  const inflightKey = `inflight-s:${repo}:${sha}`;
  const postedKey = `posted-s:${repo}:${sha}`;
  let claimed = false;
  let token = null;
  let stage = "claim";
  const releaseClaim = async () => {
    if (!claimed) return;
    claimed = false;
    try {
      await env.CREDS.delete(inflightKey);
    } catch {}
  };
  try {
    if (await env.CREDS.get(postedKey)) {
      await log("skipped-duplicate", "posted marker exists for this commit");
      return;
    }
    if (await env.CREDS.get(inflightKey)) {
      await log("skipped-duplicate", "inflight claim held for this commit");
      return;
    }
    await env.CREDS.put(inflightKey, "1", { expirationTtl: 600 });
    claimed = true;
    const instId = args.installationId ?? app.installation_id;
    if (!instId) throw new Error("no installation id in payload or store");
    stage = "token";
    token = await installationToken(app, instId);
    const isStatePush =
      args.ref === `refs/heads/${SURFACE_BRANCH}` ||
      args.headBranch === SURFACE_BRANCH;
    stage = "discover";
    let tipSha;
    let tipTime;
    if (isStatePush) {
      tipSha = sha;
      // A check_suite-driven derivation of a state-branch head has
      // no payload timestamp (see resolveTipTime): read the commit
      // itself rather than caching and rendering an unknown time.
      tipTime =
        args.headCommitTime ?? (await resolveTipTime(token, repo, tipSha));
      // The push itself is the freshest discovery there is.
      try {
        await env.CREDS.put(
          `surfinfo:${repo}`,
          JSON.stringify({
            has: true,
            tipSha,
            tipTime,
            checkedAt: Date.now(),
          }),
          { expirationTtl: 3600 },
        );
      } catch {}
    } else {
      const info = await probeSurfaceTip(env, token, repo);
      if (!info.has) {
        await releaseClaim();
        await log("skipped-no-surface");
        return;
      }
      tipSha = info.tipSha;
      // A cached discovery entry may carry a null time (written by
      // a derivation that could not resolve one); resolve it here
      // so the basis line never depends on which twin derived last.
      tipTime = info.tipTime ?? (await resolveTipTime(token, repo, tipSha));
    }
    stage = "fetch-surface";
    const surf = await fetchSurface(token, repo, tipSha);
    if (surf.declStatus === "absent") {
      await releaseClaim();
      await log(
        "skipped-no-declaration",
        "gitpp/state carries no surface.json",
      );
      return;
    }
    if (surf.declStatus === "invalid") {
      // A surface.json exists but cannot be read: never silent.
      const fid = await postSurfaceFailure(token, repo, sha, {
        declError: surf.declError,
      });
      await env.CREDS.put(postedKey, `failed:${fid}`, {
        expirationTtl: 86400,
      });
      await releaseClaim();
      await log("posted", `failure check ${fid} — invalid surface.json`);
      return;
    }
    const surface = surf.surface;
    try {
      await env.CREDS.put(
        `surfdecl:${repo}:${tipSha}`,
        JSON.stringify(surf.declRaw),
        { expirationTtl: 30 * 86400 },
      );
    } catch {}
    const manifest = await readSurfaceManifest(env, repo);
    const prevPatterns = manifest?.patterns ?? [];
    const landedGate = applyDeclarationGate(
      surface,
      surf.recordEntries,
      prevPatterns,
    );
    // Proposals: only a working-branch push can carry them, and they
    // ride in the tarball Mapping A already fetched (shared intake);
    // the surface path fetches it itself only when Mapping A did not
    // (its own duplicate path returns before fetching).
    let propGate = null;
    if (!isStatePush) {
      stage = "fetch-proposals";
      let intake = shared?.intake ?? null;
      if (!intake) intake = await fetchRecords(token, repo, sha);
      const propEntries = intake.proposalEntries ?? [];
      const propFileRejects = intake.proposalRejects ?? [];
      if (propEntries.length > 0 || propFileRejects.length > 0) {
        propGate = applyDeclarationGate(surface, propEntries, prevPatterns);
        propGate.rawCount = (intake.proposals ?? []).length;
        propGate.fileRejects = propFileRejects;
      }
    }
    let mode = "landed";
    if (propGate) {
      mode = "preview";
    } else if (!isStatePush && surface.preview === "proposals-only") {
      await releaseClaim();
      await log(
        "skipped-preview-off",
        "preview is proposals-only and this push carries no proposals",
      );
      return;
    }
    stage = "derive";
    const landedOut = derive(landedGate.kept);
    let union = null;
    if (mode === "preview") {
      // Union derivation, kept strictly separate from the landed one:
      // a proposal wins an id collision (it is the newer statement of
      // that record), and the union is rendered under its own label.
      const byId = new Map();
      for (const r of landedGate.kept) byId.set(String(r.id), r);
      for (const r of propGate.kept) byId.set(String(r.id), r);
      const unionRecords = [...byId.values()];
      union = { records: unionRecords, out: derive(unionRecords) };
    }
    // History integrity (design §5.2): ids the last posted derivation
    // saw on the branch that this landed set no longer holds. The
    // baseline is the branch's record set, gated but pre-declaration,
    // so a record rejected for undeclared keys still counts as
    // present — it is on the branch; only absence is history loss.
    const landedIds = surf.records
      .map((r) => String(r.id))
      .sort(cmpCodePoints);
    let vanished = null;
    if (manifest) {
      const nowIds = new Set(landedIds);
      const gone = manifest.ids.filter((id) => !nowIds.has(id));
      if (gone.length > 0) vanished = { ids: gone, at: manifest.at ?? null };
    }
    stage = "render";
    const { text, title, summary } = renderSurfaceReport({
      surface,
      mode,
      sha,
      tipSha,
      tipTime,
      landed: {
        gate: landedGate,
        out: landedOut,
        fileRejects: surf.rejects,
        rawCount: surf.records.length,
      },
      proposals:
        mode === "preview" ? { gate: propGate, union } : null,
      vanished,
    });
    stage = "post";
    const existing = await existingCheckId(
      token,
      repo,
      sha,
      SURFACE_CHECK_NAME,
    ).catch(() => null);
    if (existing) {
      await env.CREDS.put(postedKey, `posted:${existing}`, {
        expirationTtl: 86400,
      });
      await releaseClaim();
      await log("skipped-duplicate", `check ${existing} already exists`);
      return;
    }
    const checkId = await postCheckRun(token, repo, sha, {
      title,
      summary,
      text,
      conclusion: "neutral",
      name: SURFACE_CHECK_NAME,
    });
    await env.CREDS.put(postedKey, `posted:${checkId}`, {
      expirationTtl: 86400,
    });
    // The manifest advances only on a posted derivation.
    try {
      await env.CREDS.put(
        `surfmanifest:${repo}`,
        JSON.stringify({
          ids: landedIds,
          patterns: surface.patterns,
          tipSha,
          at: new Date().toISOString(),
        }),
      );
    } catch {}
    await releaseClaim();
    await log("posted", `check ${checkId} (${mode})`);
  } catch (err) {
    await releaseClaim();
    // Never silent while we hold a token and the failure is not the
    // Check POST itself — the same doctrine as Mapping A's loop.
    if (token && stage !== "post") {
      try {
        const fid = await postSurfaceFailure(token, repo, sha, {
          error: err?.message ?? String(err),
        });
        await env.CREDS.put(postedKey, `failed:${fid}`, {
          expirationTtl: 86400,
        });
        await log("failed", `${err?.message ?? err} (failure check ${fid})`);
        return;
      } catch {}
    }
    await log("failed", err?.message ?? err);
  }
}

/*END-EXTRACT:surface*/

/** Decide whether a verified event triggers derivation, and run it
 * behind the ack. Returns nothing; never throws. Two independent
 * derivations share the job: Mapping A ("git.pp state") first, then
 * the Mapping B surface path ("git.pp surface"), which reuses
 * Mapping A's tarball intake (the proposals ride in it) instead of
 * fetching the pushed tree a second time. Sequential, so the intake
 * is settled before the surface path looks for it; each path keeps
 * its own claim keys, failure Checks and event-log entries. */
function maybeDerive(env, ctx, app, event, payload) {
  let sha = null;
  let ref = null;
  let headBranch = null;
  let headCommitTime = null;
  if (event === "push") {
    sha = payload?.after ?? null;
    if (!sha || /^0+$/.test(sha)) return;
    ref = payload?.ref ?? null;
    headCommitTime = payload?.head_commit?.timestamp ?? null;
  } else if (event === "check_suite") {
    if (!["requested", "rerequested"].includes(payload?.action ?? "")) return;
    sha = payload?.check_suite?.head_sha ?? null;
    headBranch = payload?.check_suite?.head_branch ?? null;
    if (!sha) return;
  } else {
    return;
  }
  const repo = payload?.repository?.full_name ?? null;
  if (!repo) return;
  const installationId = payload?.installation?.id ?? null;
  const shared = {};
  const job = (async () => {
    await deriveAndPost(env, app, { repo, sha, installationId }, shared).catch(
      () => {},
    );
    await deriveSurfaceAndPost(
      env,
      app,
      { repo, sha, ref, headBranch, headCommitTime, installationId },
      shared,
    ).catch(() => {});
  })();
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
