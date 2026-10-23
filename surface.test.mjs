// surface.test.mjs — extraction + fixture harness for the Mapping B
// surface path in worker.js (and a Mapping A regression on the real
// demo set). The worker's core slice — vendored fold engine through
// the end of the file, minus the export — is extracted and imported
// with fetch and KV stubbed, then driven through maybeDerive with
// synthetic webhook payloads, exactly as the live webhook drives it.
// No network, no Cloudflare. Run: bun surface.test.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";

// ---- extract the worker core ----------------------------------------------
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const start = src.indexOf("/*TEST-EXTRACT:core*/");
const end = src.indexOf("export default");
if (start < 0 || end < 0 || end < start) {
  throw new Error("TEST-EXTRACT:core marker or export default not found");
}
const slicePath = `${tmpdir()}/gitpp-surface-slice-${process.pid}.mjs`;
writeFileSync(
  slicePath,
  src.slice(start, end) +
    "\n;globalThis.__api = { maybeDerive, derive, renderReport, gateRecordFile, validateSurface, surfaceDeclares, applyDeclarationGate, pickWinnerId, renderSurfaceReport };\n",
);
await import(slicePath);
const api = globalThis.__api;

// ---- tiny tar writer (names kept < 100 bytes: no prefix field) ------------
function tarFile(name, text) {
  const data = Buffer.from(text, "utf8");
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8);
  header.write("0000000\0", 108, 8);
  header.write("0000000\0", 116, 8);
  header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, 12);
  header.write("00000000000\0", 136, 12);
  header.write("        ", 148, 8);
  header.write("0", 156, 1);
  header.write("ustar\0", 257, 6);
  header.write("00", 263, 2);
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  const pad = (512 - (data.length % 512)) % 512;
  return Buffer.concat([header, data, Buffer.alloc(pad)]);
}
function tarball(files) {
  const parts = Object.entries(files).map(([rel, text]) =>
    tarFile(`repo-top/${rel}`, text),
  );
  parts.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(parts));
}

// ---- stubs ------------------------------------------------------------------
class KVStub {
  constructor() {
    this.m = new Map();
  }
  async get(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  async put(k, v) {
    this.m.set(k, String(v));
  }
  async delete(k) {
    this.m.delete(k);
  }
  async list({ prefix }) {
    return {
      keys: [...this.m.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name })),
      list_complete: true,
    };
  }
}

const posted = []; // parsed check-run POST bodies, in order
const tarballs = new Map(); // sha -> gz Buffer
const refTips = new Map(); // repo -> { sha, time } | null

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes("/access_tokens")) {
    return Response.json({
      token: "test-installation-token",
      expires_at: new Date(Date.now() + 3600e3).toISOString(),
    });
  }
  let m = u.match(/\/repos\/(.+)\/tarball\/([0-9a-f]{40})$/);
  if (m) {
    const gz = tarballs.get(m[2]);
    if (!gz) return new Response("no tarball", { status: 404 });
    return new Response(new Uint8Array(gz), { status: 200 });
  }
  m = u.match(/\/repos\/(.+)\/git\/ref\/heads\/gitpp%2Fstate$/);
  if (m) {
    const tip = refTips.get(m[1]);
    if (!tip) return new Response("not found", { status: 404 });
    return Response.json({ object: { sha: tip.sha } });
  }
  if (u.includes("/check-runs?check_name=")) {
    return Response.json({ total_count: 0, check_runs: [] });
  }
  m = u.match(/\/repos\/(.+)\/commits\/([0-9a-f]{40})$/);
  if (m) {
    const tip = [...refTips.values()].find((t) => t && t.sha === m[2]);
    return Response.json({
      commit: { committer: { date: tip?.time ?? "2026-10-22T00:00:00Z" } },
    });
  }
  if (u.endsWith("/check-runs") && opts.method === "POST") {
    const body = JSON.parse(opts.body);
    posted.push(body);
    return Response.json({ id: 9000 + posted.length }, { status: 201 });
  }
  throw new Error("unstubbed fetch: " + u);
};

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const app = {
  id: 5419092,
  pem: privateKey.export({ type: "pkcs1", format: "pem" }),
  installation_id: 42,
};
const env = { CREDS: new KVStub() };

async function push(repo, ref, after, timestamp) {
  await api.maybeDerive(env, {}, app, "push", {
    ref,
    after,
    head_commit: { timestamp: timestamp ?? "2026-10-22T18:00:00Z" },
    repository: { full_name: repo },
    installation: { id: 42 },
  });
}
const surfaceChecks = (from) =>
  posted.slice(from).filter((p) => p.name === "git.pp surface");
const stateChecks = (from) =>
  posted.slice(from).filter((p) => p.name === "git.pp state");

// ---- assertions ---------------------------------------------------------------
let pass = 0;
let fail = 0;
function ok(cond, name) {
  if (cond) {
    pass++;
    console.log("ok -", name);
  } else {
    fail++;
    console.log("FAIL -", name);
  }
}
const eq = (a, b, name) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${name} (got ${JSON.stringify(a)})`);

// ---- fixtures -------------------------------------------------------------------
const S = (c) => c.repeat(40);
const TIP_A = S("a");
const TIP_B = S("b");
const TIP_C = S("c");
const TIP_D = S("d");
const FEAT = S("f");
const CODE1 = S("e");
const CODE2 = S("9");

const KEYS = {
  "task.claim.*": {
    description: "Claim on one task: the value is the seat working on it.",
  },
  "release.freeze": {
    description: "A freeze window while releases are frozen; unset otherwise.",
  },
  "deploy.hold": {
    description:
      "true while deploys are held, with the reason in the record's reason field.",
  },
  "oncall.primary": { description: "The seat holding the pager right now." },
};
const DECL_V1 = { version: 1, name: "ferry-ops", preview: "full", keys: KEYS };
const DECL_V2 = {
  version: 1,
  name: "ferry-ops",
  preview: "full",
  keys: Object.fromEntries(
    Object.entries(KEYS).filter(([k]) => k !== "deploy.hold"),
  ),
};
const DECL_PO = { ...DECL_V1, preview: "proposals-only" };

const J = (o) => JSON.stringify(o);
const LANDED_A = {
  "surface.json": J(DECL_V1),
  "records/genesis.json": J({
    id: "genesis",
    kind: "witness",
    parents: [],
    effects: { "deploy.hold": false },
    reason: "surface opened",
  }),
  "records/claim-dock-7.json": J({
    id: "claim-dock-7",
    kind: "task",
    parents: ["genesis"],
    effects: { "task.claim.dock-7": "agent-dockhand" },
    reason: "taking the dock-7 refit",
  }),
  "records/oncall-w43.json": J({
    id: "oncall-w43",
    kind: "task",
    parents: ["genesis"],
    effects: { "oncall.primary": "rota-lead" },
  }),
  "records/shadow-1.json": J({
    id: "shadow-1",
    kind: "task",
    parents: ["genesis"],
    effects: { "bogus.key": 1 },
  }),
  "records/mixed-1.json": J({
    id: "mixed-1",
    kind: "task",
    parents: ["genesis"],
    effects: { "deploy.hold": true, "typo.key": "x" },
    reason: "holding deploys for the storm",
  }),
};
tarballs.set(TIP_A, tarball(LANDED_A));
tarballs.set(TIP_B, tarball({ ...LANDED_A, "surface.json": J(DECL_V2) }));
tarballs.set(
  TIP_C,
  tarball({
    "surface.json": J(DECL_V1),
    "records/genesis.json": LANDED_A["records/genesis.json"],
    "records/claim-dock-7.json": LANDED_A["records/claim-dock-7.json"],
  }),
);
tarballs.set(
  FEAT,
  tarball({
    "README.md": "# ferry\n",
    ".gitpp/proposals/freeze.json": J({
      id: "freeze-1",
      kind: "override",
      parents: ["genesis"],
      effects: {
        "release.freeze": { from: "2026-10-23", to: "2026-10-27" },
      },
      reason: "storm window",
    }),
    ".gitpp/proposals/claim-steal.json": J({
      id: "claim-steal",
      kind: "task",
      parents: ["genesis"],
      effects: { "task.claim.dock-7": "agent-other" },
    }),
  }),
);
tarballs.set(
  TIP_D,
  tarball({
    "surface.json": J(DECL_PO),
    "records/genesis.json": J({
      id: "genesis",
      kind: "witness",
      parents: [],
      effects: { "oncall.primary": "rota-lead" },
    }),
  }),
);
tarballs.set(CODE1, tarball({ "README.md": "# ferry2\n" }));
tarballs.set(
  CODE2,
  tarball({
    "README.md": "# ferry2\n",
    ".gitpp/proposals/claim-x.json": J({
      id: "claim-x",
      kind: "task",
      parents: ["genesis"],
      effects: { "task.claim.dock-9": "agent-x" },
    }),
  }),
);

const REPO = "acme/ferry";
const REPO2 = "acme/ferry2";
refTips.set(REPO, { sha: TIP_A, time: "2026-10-22T17:00:00Z" });
refTips.set(REPO2, { sha: TIP_D, time: "2026-10-20T09:14:00Z" });

// ---- unit: declaration validation + key matching --------------------------------
{
  const good = api.validateSurface(DECL_V1);
  ok(!!good.surface, "validateSurface accepts the v1 declaration");
  ok(
    api
      .validateSurface({ version: 1, name: "x", keys: { a: {} } })
      .error?.includes("description"),
    "validateSurface refuses a key with no description",
  );
  ok(
    !!api.validateSurface({
      version: 1,
      name: "x",
      keys: { "task.*.x": { description: "d" } },
    }).error,
    "validateSurface refuses a non-trailing pattern",
  );
  ok(
    !!api.validateSurface({ version: 2, name: "x", keys: KEYS }).error,
    "validateSurface refuses version 2",
  );
  const s = api.validateSurface({
    version: 1,
    name: "x",
    keys: {
      "deploy.*": { description: "family" },
      "deploy.hold": { description: "exact" },
      "task.*": { description: "outer" },
      "task.claim.*": { description: "inner" },
    },
  }).surface;
  eq(
    api.surfaceDeclares(s, "deploy.hold")?.description,
    "exact",
    "exact key beats its family",
  );
  eq(
    api.surfaceDeclares(s, "task.claim.dock-9")?.description,
    "inner",
    "longest family prefix wins",
  );
  eq(api.surfaceDeclares(s, "nope.key"), null, "undeclared key matches nothing");
}

// ---- unit: pickWinnerId agrees with derive() on a genuine tie --------------------
{
  const recs = [
    { id: "genesis", kind: "witness", parents: [], effects: { project: "relay-station" } },
    { id: "task-base", kind: "task", parents: ["genesis"], effects: { "shift.lead": "ana" } },
    { id: "witness-morning", kind: "witness", parents: ["task-base"], effects: { weather: "calm" } },
    { id: "override-north", kind: "override", parents: ["task-base", "witness-morning"], effects: { "shift.lead": "noor" } },
    { id: "task-relay", kind: "task", parents: ["task-base"], effects: { "shift.lead": "ana" } },
    { id: "override-south", kind: "override", parents: ["task-relay"], effects: { "shift.lead": "sol" } },
  ];
  const out = api.derive(recs);
  const conflict = out.conflicts.find((c) => c.key === "shift.lead");
  const byId = new Map(recs.map((r) => [r.id, r]));
  const setters = recs
    .filter((r) => "shift.lead" in (r.effects ?? {}))
    .map((r) => r.id);
  eq(conflict?.winner, "override-south", "derive picks override-south in the tie");
  eq(
    api.pickWinnerId(setters, byId),
    conflict?.winner,
    "pickWinnerId agrees with derive()'s conflict winner",
  );
}

// ---- S1: landed derivation on a gitpp/state push ---------------------------------
let at = posted.length;
await push(REPO, "refs/heads/gitpp/state", TIP_A, "2026-10-22T17:00:00Z");
{
  const sc = surfaceChecks(at);
  eq(sc.length, 1, "S1: exactly one surface Check on the state tip");
  eq(stateChecks(at).length, 0, "S1: no Mapping A Check on the surface tree");
  const text = sc[0]?.output.text ?? "";
  const lines = text.split("\n");
  eq(
    sc[0]?.output.title,
    "git.pp surface — ferry-ops, as landed",
    "S1: title is the as-landed form",
  );
  ok(
    lines[2]?.startsWith("This Check derives the declared coordination surface only"),
    "S1: scope sentence is the first body line",
  );
  ok(
    text.includes("`gitpp/state` at `aaaaaaa`") &&
      text.includes("surface last changed 2026-10-22T17:00:00Z"),
    "S1: basis line names the tip sha and last-changed time",
  );
  ok(
    text.includes("`deploy.hold` = true — winner `mixed-1`"),
    "S1: deploy.hold derives to the task over the witness genesis",
  );
  ok(
    text.includes("`release.freeze` — unset — "),
    "S1: declared-but-unset key prints as unset with its description",
  );
  ok(
    text.includes("`task.claim.dock-7` = agent-dockhand") &&
      text.includes("`oncall.primary` = rota-lead"),
    "S1: family and exact keys derive",
  );
  ok(
    text.includes("`shadow-1`") && text.includes("`bogus.key`"),
    "S1: fully-undeclared record is rejected BY NAME with its key",
  );
  ok(
    text.includes("`mixed-1`") && text.includes("`typo.key`"),
    "S1: mixed record's undeclared key is named as rejected",
  );
  ok(
    !text.includes("`bogus.key` =") && !text.includes("`typo.key` ="),
    "S1: undeclared keys never reach the state table",
  );
  ok(
    text.includes("## Conflicts (losers preserved)") &&
      text.includes("loser `genesis`"),
    "S1: the deploy.hold conflict is explained with its loser",
  );
  ok(
    text.trimEnd().endsWith("agents named in them."),
    "S1: surface qualifications close the Check",
  );
  ok(
    env.CREDS.m.has(`surfmanifest:${REPO}`),
    "S1: history manifest recorded after the posted derivation",
  );
}

// ---- S4: preview on a working-branch push carrying proposals ----------------------
at = posted.length;
await push(REPO, "refs/heads/feature-x", FEAT);
let previewText = "";
{
  const sc = surfaceChecks(at);
  eq(sc.length, 1, "S4: exactly one surface Check on the feature head");
  eq(stateChecks(at).length, 0, "S4: no Mapping A Check (no records surface)");
  previewText = sc[0]?.output.text ?? "";
  eq(
    sc[0]?.output.title,
    "git.pp surface — ferry-ops, preview: what lands if these proposals do",
    "S4: title is the preview form",
  );
  ok(
    previewText.includes("## State (as landed)") &&
      previewText.includes("`release.freeze` — unset"),
    "S4: landed state is shown unchanged by the proposals",
  );
  ok(
    previewText.includes("## In flight — proposed records (not landed)"),
    "S4: in-flight section labels proposals as not landed",
  );
  ok(
    previewText.includes(
      "proposal `freeze-1` sets `release.freeze` — would win; no contention",
    ) ||
      previewText.includes("proposal `freeze-1` sets `release.freeze`") &&
        previewText.includes("would win; no contention"),
    "S4: freeze-1 verdict is would-win, no contention",
  );
  ok(
    previewText.includes(
      "proposal `claim-steal` sets `task.claim.dock-7` = agent-other — would lose to `claim-dock-7`",
    ),
    "S4: claim-steal verdict names the landed winner it loses to",
  );
  ok(
    previewText.includes("### State if these proposals land") &&
      previewText.includes('"from":"2026-10-23"'),
    "S4: union state is a separate, labelled derivation showing the freeze",
  );
}

// ---- S3: retiring a key lists its records, never drops them silently --------------
at = posted.length;
await push(REPO, "refs/heads/gitpp/state", TIP_B, "2026-10-22T19:00:00Z");
{
  const sc = surfaceChecks(at);
  eq(sc.length, 1, "S3: surface Check posts on the retired-key tip");
  const text = sc[0]?.output.text ?? "";
  ok(
    text.includes("## Retired — declared before, not declared now") &&
      text.includes("`genesis`"),
    "S3: genesis is listed under Retired when deploy.hold is undeclared",
  );
  ok(
    !text.includes("`deploy.hold` ="),
    "S3: the retired key no longer derives",
  );
  ok(
    text.includes("`mixed-1`") && text.includes("`typo.key`"),
    "S3: mixed-1 is now fully rejected and named (its other key never declared)",
  );
  ok(
    !text.includes("## History integrity"),
    "S3: no history line when no record ids vanished",
  );
}

// ---- S5: a rewrite that drops records names the vanished ids ----------------------
at = posted.length;
await push(REPO, "refs/heads/gitpp/state", TIP_C, "2026-10-22T20:00:00Z");
{
  const sc = surfaceChecks(at);
  eq(sc.length, 1, "S5: surface Check posts on the rewritten tip");
  const text = sc[0]?.output.text ?? "";
  ok(text.includes("## History integrity"), "S5: history-integrity section appears");
  ok(
    text.includes("`mixed-1`") &&
      text.includes("`oncall-w43`") &&
      text.includes("`shadow-1`"),
    "S5: the vanished record ids are named",
  );
  ok(
    text.includes("the branch history was rewritten or records were deleted"),
    "S5: the line says what the absence means",
  );
}

// ---- S7: preview proposals-only repo ----------------------------------------------
at = posted.length;
await push(REPO2, "refs/heads/gitpp/state", TIP_D, "2026-10-20T09:14:00Z");
eq(surfaceChecks(at).length, 1, "S7: landed Check posts on the proposals-only surface tip");
at = posted.length;
await push(REPO2, "refs/heads/main", CODE1);
eq(surfaceChecks(at).length, 0, "S7: proposals-only — a plain code push gets no surface Check");
at = posted.length;
await push(REPO2, "refs/heads/feature-y", CODE2);
{
  const sc = surfaceChecks(at);
  eq(sc.length, 1, "S7: proposals-only — a push carrying proposals gets the preview Check");
  ok(
    (sc[0]?.output.text ?? "").includes(
      "proposal `claim-x` sets `task.claim.dock-9` = agent-x — would win; no contention",
    ),
    "S7: the preview verdict is computed against the landed set",
  );
}

// ---- S6: Mapping A regression on the real demo set ---------------------------------
{
  const demoDir = `${process.env.HOME}/workspace/demo-quilt/.gitpp/records`;
  const recs = [];
  const rej = [];
  for (const f of readdirSync(demoDir).sort()) {
    api.gateRecordFile(
      readFileSync(`${demoDir}/${f}`, "utf8"),
      `.gitpp/records/${f}`,
      recs,
      rej,
    );
  }
  const project = JSON.parse(
    readFileSync(
      `${process.env.HOME}/workspace/demo-quilt/.gitpp/project.json`,
      "utf8",
    ),
  );
  const { out } = api.renderReport(recs, project.project, {
    sha: "0".repeat(40),
    rejects: rej,
  });
  eq(recs.length, 8, "S6: demo set gates to 8 records");
  eq(out.state["config.timeout"], 45, "S6: Mapping A still derives 45");
  const c = out.conflicts.find((x) => x.key === "config.timeout");
  eq(c?.winner, "override-1", "S6: winner is still override-1");
  eq(
    c?.losers,
    ["task-a", "task-b", "task-d"],
    "S6: losers are still task-a, task-b, task-d",
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log("\n===== SURFACE CHECK (S4 preview, verbatim) =====\n");
console.log(previewText);
process.exit(fail > 0 ? 1 : 0);
