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
//                        capped ring in CREDS under "events" (202).
//                        No derivation yet — that is the next M1 step.
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
    "gitpp-app — not yet registered",
    `<h1>gitpp-app</h1>
<p><strong>Status: the GitHub App does not exist yet.</strong> This page is
its future home and its registration desk. The receiver behind it is live
but dark: it cannot accept webhooks until the App below is created and its
credentials land in this Worker's store automatically.</p>
<p>gitpp-app will bring git.pp to GitHub: when agents and humans complete
work concurrently against the same shared state — configuration keys, task
claims, release freezes — it derives one deterministic state from their
provenance-carrying records and posts it as a Check on the pull request:
the winning value, the preserved losers, and the ancestry that decided.
It resolves labelled key conflicts mechanically; it does not settle
semantic conflicts.</p>
<h2>What the button creates</h2>
<p>Clicking the button below sends the manifest shown here — exactly this
JSON, nothing hidden — to GitHub's App Manifest flow <strong>on the
patchwork-quilt organisation's page</strong>, so the app will be owned by
the patchwork-quilt org, not by a personal account. GitHub will ask you to
confirm creating an app with this name, these permissions, and these
events:</p>
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
<p><button type="submit">Create the gitpp-app GitHub App</button></p>
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

async function webhook(request, env) {
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
  // No derivation yet: accepting and recording is the whole job until
  // M1's derivation step lands.
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

export default {
  async fetch(request, env) {
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
      return webhook(request, env);
    }
    if (url.pathname === "/events" && request.method === "GET") {
      return events(env);
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },
};
