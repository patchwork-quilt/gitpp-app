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
    "\n;globalThis.__api = { maybeDerive, derive, renderReport, gateRecordFile, validateSurface, surfaceDeclares, applyDeclarationGate, pickWinnerId, renderSurfaceReport, findDuplicateDeclarationKey, writeSurfinfo };\n",
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
// S22: scripted check-runs LIST responses, consumed per matching GET:
// [{ name, remaining, runs: [ids] }] — the first entry for a name with
// remaining > 0 answers; anything unscripted falls back to empty.
let checkListScript = null;
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
    if (checkListScript) {
      const name = decodeURIComponent(u.split("check_name=")[1] ?? "");
      const entry = checkListScript.find(
        (e) => e.name === name && e.remaining > 0,
      );
      if (entry) {
        entry.remaining -= 1;
        const runs = entry.runs.map((id) => ({ id }));
        return Response.json({ total_count: runs.length, check_runs: runs });
      }
    }
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

const ORPHAN_DEFINITION =
  "An orphan is a record whose parent is missing or did not itself derive.";
const SURFACE_GLOSSARY =
  "Landed records are the ones on `gitpp/state`; proposed records appear only in previews and are not landed. " +
  ORPHAN_DEFINITION;

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

// ---- fixtures for S8/S9/S10: the live dogfood-b1 shape -------------------------
const T3A = S("7");
const T3B = S("8");
const T3C = S("5");
const T4A = S("6");
const REPO3 = "acme/ferry3";
const REPO4 = "acme/ferry4";
const LANDED_B1 = {
  "records/genesis.json": J({
    id: "genesis",
    kind: "witness",
    parents: [],
    effects: { "deploy.hold": false },
  }),
  "records/claim-dock-7.json": J({
    id: "claim-dock-7",
    kind: "task",
    parents: ["genesis"],
    effects: { "task.claim.dock-7": "agent-dockhand" },
  }),
  "records/oncall-rota.json": J({
    id: "oncall-rota",
    kind: "task",
    parents: ["genesis"],
    effects: { "oncall.primary": "rota-lead" },
  }),
  "records/hold-storm.json": J({
    id: "hold-storm",
    kind: "task",
    parents: ["genesis"],
    effects: { "deploy.hold": true },
    reason: "storm coming",
  }),
};
tarballs.set(T3A, tarball({ "surface.json": J(DECL_V1), ...LANDED_B1 }));
tarballs.set(T3B, tarball({ "surface.json": J(DECL_V2), ...LANDED_B1 }));
tarballs.set(T3C, tarball({ "surface.json": J(DECL_V2), ...LANDED_B1 }));
tarballs.set(
  T4A,
  tarball({
    "surface.json": J(DECL_V1),
    "records/bad-root.json": J({
      id: "bad-root",
      kind: "task",
      parents: [],
      effects: { "bogus.key": 1 },
    }),
    "records/child-1.json": J({
      id: "child-1",
      kind: "task",
      parents: ["bad-root"],
      effects: { "oncall.primary": "agent-child" },
    }),
  }),
);
refTips.set(REPO3, { sha: T3C, time: "2026-10-22T21:30:00Z" });

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
  const basisIdx = lines.findIndex((line) => line.startsWith("Surface basis:"));
  ok(
    basisIdx >= 0 &&
      lines[basisIdx].includes("`gitpp/state` at `aaaaaaa`") &&
      lines[basisIdx].includes("tip committed 2026-10-22T17:00:00Z") &&
      lines[basisIdx].includes("5 landed record(s) · preview full"),
    "S1: basis line names the tip sha, the tip commit time, and the full landed mode",
  );
  eq(
    lines[basisIdx + 1],
    SURFACE_GLOSSARY,
    "S1: glossary sits directly under the basis line",
  );
  ok(
    text.includes("3 keys set · 1 declared unset") &&
      (sc[0]?.output.summary ?? "").includes("3 keys set · 1 declared unset"),
    "S1: counts state the set/unset rule (3 concrete keys set, release.freeze declared unset)",
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
    text.trimEnd().endsWith("The surface is what its records say.") &&
      !text.includes("written by the people"),
    "S1: surface qualifications close the Check, with no authorship clause",
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
  const previewLines = previewText.split("\n");
  const previewBasisIdx = previewLines.findIndex((line) =>
    line.startsWith("Surface basis:"),
  );
  ok(
    previewBasisIdx >= 0 &&
      previewLines[previewBasisIdx].includes("preview: proposals"),
    "S4: basis line names the proposals-preview mode that produced this report",
  );
  eq(
    previewLines[previewBasisIdx + 1],
    SURFACE_GLOSSARY,
    "S4: glossary sits directly under the basis line",
  );
  ok(
    previewText.includes("3 keys set · 1 declared unset"),
    "S4: counts state the landed set/unset rule in a preview",
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
  ok(
    text.includes("record(s) present in the surface on") &&
      !text.includes("record(s) derived"),
    "S5: the history line says present in the surface, not derived (the manifest holds ids present, derived or not)",
  );
}

// ---- S8: retiring the root record's only key must not orphan its descendants -----
// (live acceptance drill 4: genesis dropped out of the graph entirely, and
// claim-dock-7 / oncall-rota orphaned behind it)
at = posted.length;
await push(REPO3, "refs/heads/gitpp/state", T3A, "2026-10-22T21:00:00Z");
{
  const sc = surfaceChecks(at);
  eq(sc.length, 1, "S8: surface Check posts on the full declaration");
  const text = sc[0]?.output.text ?? "";
  ok(
    text.includes("`deploy.hold` = true — winner `hold-storm`") &&
      text.includes("`oncall.primary` = rota-lead") &&
      text.includes("`task.claim.dock-7` = agent-dockhand"),
    "S8: baseline state derives all three keys",
  );
}
at = posted.length;
await push(REPO3, "refs/heads/gitpp/state", T3B, "2026-10-22T21:15:00Z");
{
  const sc = surfaceChecks(at);
  eq(sc.length, 1, "S8: surface Check posts on the retire tip");
  const text = sc[0]?.output.text ?? "";
  ok(
    text.includes("## Retired — declared before, not declared now") &&
      text.includes("`genesis`") &&
      text.includes("`hold-storm`"),
    "S8: both all-retired records are listed under Retired",
  );
  ok(
    text.includes(
      "its effects did not derive, but the record still anchors its descendants. " +
        "Preserved on `gitpp/state`; re-declaring the key revives its effects exactly as they were",
    ) && !text.includes("the record did not derive"),
    "S8: the all-retired line says its effects did not derive (the record still anchors), never that the record did not derive",
  );
  ok(
    text.includes("`oncall.primary` = rota-lead") &&
      text.includes("`task.claim.dock-7` = agent-dockhand"),
    "S8: descendants of the retired root still derive their declared keys",
  );
  ok(!text.includes("`deploy.hold` ="), "S8: the retired key is absent from state");
  ok(
    text.includes("0 orphan(s)") && !text.includes("## Orphans"),
    "S8: retirement orphans nobody",
  );
  ok(text.includes("0 conflict(s)"), "S8: no phantom conflict from the anchors");
}

// ---- S9: a never-declared record anchors nothing (rejection ≠ retirement) ---------
at = posted.length;
await push(REPO4, "refs/heads/gitpp/state", T4A, "2026-10-22T21:20:00Z");
{
  const sc = surfaceChecks(at);
  eq(sc.length, 1, "S9: surface Check posts");
  const text = sc[0]?.output.text ?? "";
  ok(
    text.includes("## Rejected input — named, never silent") &&
      text.includes("`bad-root`") &&
      text.includes("`bogus.key`"),
    "S9: the never-declared record is rejected by name",
  );
  ok(
    text.includes("## Orphans (excluded from state)") &&
      text.includes("- `child-1`"),
    "S9: the rejected record's child still orphans, named",
  );
  ok(
    !text.includes("`oncall.primary` ="),
    "S9: the orphan's declared key never reaches state",
  );
}

// ---- S10: a check_suite-driven derivation resolves the tip time from the commit ---
// (live acceptance drills 2/3/5B: the check_suite twin won the claim, the
// payload carried no timestamp, and the basis line rendered unknown)
at = posted.length;
await api.maybeDerive(env, {}, app, "check_suite", {
  action: "requested",
  check_suite: { head_sha: T3C, head_branch: "gitpp/state" },
  repository: { full_name: REPO3 },
  installation: { id: 42 },
});
{
  const sc = surfaceChecks(at);
  eq(sc.length, 1, "S10: the check_suite twin posts the surface Check");
  const text = sc[0]?.output.text ?? "";
  ok(
    text.includes("tip committed 2026-10-22T21:30:00Z"),
    "S10: basis time is read from the tip commit when the payload has none",
  );
  ok(!text.includes("unknown time"), "S10: no unknown-time basis line");
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

// ---- S11: the counts segment omits "declared unset" when none are unset ------------
{
  const surface = api.validateSurface({
    version: 1,
    name: "one-key",
    preview: "full",
    keys: { "only.key": { description: "The only declared key." } },
  }).surface;
  const records = [
    {
      id: "genesis",
      kind: "witness",
      parents: [],
      effects: { "only.key": "set" },
    },
  ];
  const gate = {
    kept: records,
    fullyRejected: [],
    partialRejects: [],
    retired: [],
  };
  const report = api.renderSurfaceReport({
    surface,
    mode: "landed",
    sha: S("1"),
    tipSha: S("2"),
    tipTime: "2026-10-22T22:00:00Z",
    landed: {
      gate,
      out: api.derive(records),
      fileRejects: [],
      rawCount: records.length,
    },
    proposals: null,
    vanished: null,
  });
  ok(
    report.text.includes("1 key set · 0 conflict(s)") &&
      !report.text.includes("declared unset"),
    "S11: zero declared-unset patterns render just the keys-set count",
  );
}

// ---- S12: duplicate record ids at intake (issue #11) ------------------------------
// Same id + different content: EVERY copy is rejected by name, neither
// derives, children orphan by name, and the counts stop claiming them.
// Same id + identical content: the spec's collection-layer dedupe —
// one copy derives, silently.
const REPO5 = "acme/ferry5";
const D1 = "d1".repeat(20);
const D2 = "d2".repeat(20);
const DUP_A = {
  id: "dup-probe",
  kind: "task",
  parents: ["genesis"],
  effects: { "task.claim.dup": "from-a" },
};
tarballs.set(
  D1,
  tarball({
    "surface.json": J(DECL_V1),
    "records/genesis.json": J({
      id: "genesis",
      kind: "witness",
      parents: [],
      effects: { "deploy.hold": false },
    }),
    "records/dup-a.json": J(DUP_A),
    "records/dup-b.json": J({
      ...DUP_A,
      effects: { "task.claim.dup": "from-b" },
    }),
    "records/child-dup.json": J({
      id: "child-dup",
      kind: "task",
      parents: ["dup-probe"],
      effects: { "oncall.primary": "child-value" },
    }),
  }),
);
tarballs.set(
  D2,
  tarball({
    "surface.json": J(DECL_V1),
    "records/genesis.json": J({
      id: "genesis",
      kind: "witness",
      parents: [],
      effects: { "deploy.hold": false },
    }),
    "records/dup-a.json": J(DUP_A),
    "records/dup-b.json": J(DUP_A),
  }),
);
refTips.set(REPO5, { sha: D1, time: "2026-10-22T23:00:00Z" });
at = posted.length;
await push(REPO5, "refs/heads/gitpp/state", D1, "2026-10-22T23:00:00Z");
{
  const sc = surfaceChecks(at);
  eq(sc.length, 1, "S12: surface Check posts on the duplicate-id tip");
  const text = sc[0]?.output.text ?? "";
  ok(
    text.includes("duplicate record id `dup-probe`") &&
      text.includes("`records/dup-a.json`") &&
      text.includes("`records/dup-b.json`"),
    "S12: both files carrying the duplicated id are named",
  );
  ok(
    !text.includes("from-a") && !text.includes("from-b"),
    "S12: neither duplicate's value reaches the report",
  );
  ok(
    text.includes("## Orphans (excluded from state)") &&
      text.includes("- `child-dup`"),
    "S12: the duplicated id's child orphans by name",
  );
  ok(
    !text.includes("child-value"),
    "S12: the orphan's value never reaches state",
  );
  ok(
    text.includes("2 landed records") || text.includes("2 landed record(s)"),
    "S12: the counts claim only the records that derived (genesis + the orphan)",
  );
}
refTips.set(REPO5, { sha: D2, time: "2026-10-22T23:05:00Z" });
at = posted.length;
await push(REPO5, "refs/heads/gitpp/state", D2, "2026-10-22T23:05:00Z");
{
  const sc = surfaceChecks(at);
  eq(sc.length, 1, "S12: surface Check posts on the identical-duplicate tip");
  const text = sc[0]?.output.text ?? "";
  ok(
    text.includes("`task.claim.dup` = from-a"),
    "S12: identical duplicates dedupe — the record derives once",
  );
  ok(
    !text.includes("duplicate record id"),
    "S12: identical duplicates are silent (the spec's dedupe)",
  );
}

// ---- S12b: duplicate ids on the Mapping A path (the intake is shared) -------------
const REPO6 = "acme/ferry6";
const A1 = "a9".repeat(20);
tarballs.set(
  A1,
  tarball({
    ".gitpp/project.json": J({ project: "dup-a-path" }),
    ".gitpp/records/genesis.json": J({
      id: "genesis",
      kind: "witness",
      parents: [],
      effects: { project: "dup-a-path" },
    }),
    ".gitpp/records/dup-a.json": J({
      id: "dup-probe",
      kind: "task",
      parents: ["genesis"],
      effects: { "config.mode": "from-a" },
    }),
    ".gitpp/records/dup-b.json": J({
      id: "dup-probe",
      kind: "task",
      parents: ["genesis"],
      effects: { "config.mode": "from-b" },
    }),
    ".gitpp/records/child.json": J({
      id: "child-dup",
      kind: "task",
      parents: ["dup-probe"],
      effects: { "config.child": "x" },
    }),
  }),
);
at = posted.length;
await push(REPO6, "refs/heads/main", A1);
{
  const sc = stateChecks(at);
  eq(sc.length, 1, "S12b: Mapping A Check posts on the duplicate-id tree");
  eq(surfaceChecks(at).length, 0, "S12b: no surface Check (no surface branch)");
  const text = sc[0]?.output.text ?? "";
  ok(
    text.includes("duplicate record id `dup-probe`") &&
      text.includes("`.gitpp/records/dup-a.json`") &&
      text.includes("`.gitpp/records/dup-b.json`"),
    "S12b: the A path names both files carrying the duplicated id",
  );
  ok(
    !text.includes("config.mode"),
    "S12b: neither duplicate's key reaches A state",
  );
  ok(
    text.includes("- `child-dup`"),
    "S12b: the duplicated id's child orphans by name on the A path too",
  );
}

// ---- S13: a same-id proposal discloses the wholesale replacement (issue #12) ------
const REPO7 = "acme/ferry7";
const E1 = "e1".repeat(20);
const E2 = "e2".repeat(20);
const E3 = "e3".repeat(20);
tarballs.set(E1, tarball(LANDED_A));
tarballs.set(
  E2,
  tarball({
    "README.md": "# ferry\n",
    ".gitpp/proposals/usurp.json": J({
      id: "claim-dock-7",
      kind: "override",
      parents: ["genesis"],
      effects: { "oncall.primary": "proposal-usurper" },
      reason: "hostile takeover",
    }),
  }),
);
tarballs.set(
  E3,
  tarball({
    "README.md": "# ferry\n",
    ".gitpp/proposals/twin.json": LANDED_A["records/claim-dock-7.json"],
  }),
);
refTips.set(REPO7, { sha: E1, time: "2026-10-22T17:00:00Z" });
at = posted.length;
await push(REPO7, "refs/heads/feature-usurp", E2);
{
  const sc = surfaceChecks(at);
  eq(sc.length, 1, "S13: preview Check posts on the usurper proposal");
  const text = sc[0]?.output.text ?? "";
  ok(
    text.includes(
      "proposal `claim-dock-7` replaces the landed record of the same id wholesale",
    ) &&
      text.includes("`task.claim.dock-7` = agent-dockhand"),
    "S13: the verdict discloses the replacement and names the landed effect that would drop, with its value",
  );
  ok(
    text.includes(
      "proposal `claim-dock-7` sets `oncall.primary` = proposal-usurper — would win",
    ),
    "S13: the per-key verdict still prints for the key the proposal sets",
  );
  ok(
    text.includes("`task.claim.*` — no keys set"),
    "S13: the union state shows the dropped claim — the disclosure and the union agree",
  );
}
at = posted.length;
await push(REPO7, "refs/heads/feature-twin", E3);
{
  const sc = surfaceChecks(at);
  eq(sc.length, 1, "S13: preview Check posts on the identical-twin proposal");
  const text = sc[0]?.output.text ?? "";
  ok(
    text.includes(
      "proposal `claim-dock-7` — identical to the landed record of the same id; no change if landed again",
    ) && !text.includes("replaces the landed record"),
    "S13: an identical twin stays a plain no-change, no replacement language",
  );
}

// ---- S14: a proposal file on gitpp/state itself is named, not silent (issue #14) ---
const REPO8 = "acme/ferry8";
const F1 = "f1".repeat(20);
tarballs.set(
  F1,
  tarball({
    ...LANDED_A,
    ".gitpp/proposals/state-prop.json": J({
      id: "state-prop",
      kind: "task",
      parents: ["genesis"],
      effects: { "oncall.primary": "state-prop-value" },
    }),
  }),
);
refTips.set(REPO8, { sha: F1, time: "2026-10-22T17:00:00Z" });
at = posted.length;
await push(REPO8, "refs/heads/gitpp/state", F1, "2026-10-22T17:00:00Z");
{
  const sc = surfaceChecks(at);
  eq(sc.length, 1, "S14: landed Check posts on the state tip carrying a proposal file");
  const text = sc[0]?.output.text ?? "";
  ok(
    text.includes("proposal file(s) found on `gitpp/state`") &&
      text.includes("`.gitpp/proposals/state-prop.json`") &&
      text.includes("these were ignored"),
    "S14: the landed Check names the proposal file on the state branch and says it was ignored",
  );
  ok(
    text.includes("`oncall.primary` = rota-lead") &&
      !text.includes("state-prop-value"),
    "S14: the state-branch proposal does not derive",
  );
  ok(
    !text.includes("## In flight"),
    "S14: no preview section on a landed Check",
  );
}

// ---- S15: duplicate keys in surface.json are refused by name (issue #15) -----------
{
  const dupDeclText =
    `{"version":1,"name":"ferry-ops","preview":"full","keys":{` +
    `"task.claim.*":{"description":"claims"},` +
    `"oncall.primary":{"description":"DUP-FIRST-DESCRIPTION"},` +
    `"deploy.hold":{"description":"hold"},` +
    `"oncall.primary":{"description":"DUP-SECOND-DESCRIPTION"}}}`;
  eq(
    api.findDuplicateDeclarationKey(dupDeclText),
    "oncall.primary",
    "S15: the raw-text scan names the duplicated declaration key",
  );
  eq(
    api.findDuplicateDeclarationKey(
      dupDeclText.replace(
        '"oncall.primary":{"description":"DUP-SECOND-DESCRIPTION"}',
        '"oncall.\\u0070rimary":{"description":"DUP-SECOND-DESCRIPTION"}',
      ),
    ),
    "oncall.primary",
    "S15: an escaped spelling of the same name is still a duplicate",
  );
  eq(
    api.findDuplicateDeclarationKey(
      `{"version":1,"name":"x","keys":{"a":{"description":"decoy \\"keys\\": {\\"x\\":1,\\"x\\":2}"}}}`,
    ),
    null,
    "S15: lookalike text inside a description string is not a duplicate",
  );
  eq(
    api.findDuplicateDeclarationKey(J(DECL_V1)),
    null,
    "S15: a valid declaration has no duplicates",
  );
  const REPO9 = "acme/ferry9";
  const F2 = "f2".repeat(20);
  tarballs.set(
    F2,
    tarball({ ...LANDED_A, "surface.json": dupDeclText }),
  );
  refTips.set(REPO9, { sha: F2, time: "2026-10-22T17:00:00Z" });
  at = posted.length;
  await push(REPO9, "refs/heads/gitpp/state", F2, "2026-10-22T17:00:00Z");
  const sc = surfaceChecks(at);
  eq(sc.length, 1, "S15: exactly one surface Check on the duplicated declaration");
  eq(
    sc[0]?.conclusion,
    "failure",
    "S15: a duplicated declaration earns the failure Check, never a silent derivation",
  );
  ok(
    (sc[0]?.output.text ?? "").includes(
      'declares key "oncall.primary" more than once',
    ),
    "S15: the failure Check names the duplicated key",
  );
}

// ---- S16: key patterns are length-bounded (adversarial F8) --------------------------
{
  const tooLong = api.validateSurface({
    version: 1,
    name: "x",
    keys: { ["k".repeat(201)]: { description: "d" } },
  });
  ok(
    !!tooLong.error && tooLong.error.includes("limited to 200 characters"),
    "S16: a 201-char pattern is refused, naming the 200-char rule",
  );
  ok(
    (tooLong.error ?? "").length < 200,
    "S16: the refusal does not print the giant pattern back in full",
  );
  ok(
    !!api.validateSurface({
      version: 1,
      name: "x",
      keys: { ["k".repeat(200)]: { description: "d" } },
    }).surface,
    "S16: a 200-char pattern is still valid",
  );
}

// ---- S17: exact + family declarations render one line per key (adversarial F7) -----
{
  const surface = api.validateSurface({
    version: 1,
    name: "one-key",
    preview: "full",
    keys: {
      "oncall.primary": { description: "EXACT-DESC" },
      "oncall.*": { description: "FAMILY-DESC" },
    },
  }).surface;
  const records = [
    {
      id: "genesis",
      kind: "witness",
      parents: [],
      effects: { "oncall.primary": "rota-lead", "oncall.backup": "second" },
    },
  ];
  const gate = {
    kept: records,
    fullyRejected: [],
    partialRejects: [],
    retired: [],
  };
  const report = api.renderSurfaceReport({
    surface,
    mode: "landed",
    sha: S("1"),
    tipSha: S("2"),
    tipTime: "2026-10-22T22:00:00Z",
    landed: {
      gate,
      out: api.derive(records),
      fileRejects: [],
      rawCount: records.length,
    },
    proposals: null,
    vanished: null,
  });
  const primaryLines = report.text
    .split("\n")
    .filter((l) => l.startsWith("- `oncall.primary` ="));
  eq(
    primaryLines.length,
    1,
    "S17: a key under both an exact and a family declaration renders exactly once",
  );
  ok(
    primaryLines[0]?.includes("EXACT-DESC") &&
      !primaryLines[0]?.includes("FAMILY-DESC"),
    "S17: the single line carries the exact declaration's description",
  );
  ok(
    report.text.includes("- `oncall.backup` = second") &&
      report.text.includes("FAMILY-DESC"),
    "S17: a family-only key still renders under the family description",
  );
  const onlyExact = api.renderSurfaceReport({
    surface,
    mode: "landed",
    sha: S("1"),
    tipSha: S("2"),
    tipTime: "2026-10-22T22:00:00Z",
    landed: {
      gate,
      out: api.derive([records[0]]),
      fileRejects: [],
      rawCount: 1,
    },
    proposals: null,
    vanished: null,
  });
  ok(
    !onlyExact.text.includes("`oncall.*` — no keys set"),
    "S17: a family whose only matches are exact-governed prints no 'no keys set' line",
  );
}

// ---- S18: the discovery cache cannot regress to a superseded tip (issue #13) ------
// The F3 sequence: two rapid state pushes, a force-push restore to the
// first tip, then a working-branch push. The restore's derivation SKIPS
// (its commit already has a Check) — the refresh must still correct
// the cache, and the working Check must derive the restored tip.
const REPO10 = "acme/ferry10";
const G1 = "0a".repeat(20);
const G2 = "0b".repeat(20);
const GW = "0c".repeat(20);
tarballs.set(
  G1,
  tarball({
    "surface.json": J(DECL_V1),
    "records/genesis.json": J({
      id: "genesis",
      kind: "witness",
      parents: [],
      effects: { "deploy.hold": false },
    }),
  }),
);
tarballs.set(
  G2,
  tarball({
    "surface.json": J(DECL_V1),
    "records/genesis.json": J({
      id: "genesis",
      kind: "witness",
      parents: [],
      effects: { "deploy.hold": false },
    }),
    "records/oncall-rota.json": J({
      id: "oncall-rota",
      kind: "task",
      parents: ["genesis"],
      effects: { "oncall.primary": "rota-lead" },
    }),
  }),
);
tarballs.set(GW, tarball({ "README.md": "# ferry\n" }));
const surfinfoTip = () =>
  JSON.parse(env.CREDS.m.get(`surfinfo:${REPO10}`) ?? "{}").tipSha;
refTips.set(REPO10, { sha: G1, time: "2026-10-23T00:00:00Z" });
await push(REPO10, "refs/heads/gitpp/state", G1, "2026-10-23T00:00:00Z");
eq(surfinfoTip(), G1, "S18: the first state push caches its own tip");
refTips.set(REPO10, { sha: G2, time: "2026-10-23T00:01:00Z" });
await push(REPO10, "refs/heads/gitpp/state", G2, "2026-10-23T00:01:00Z");
eq(surfinfoTip(), G2, "S18: the second state push advances the cache");
refTips.set(REPO10, { sha: G1, time: "2026-10-23T00:00:00Z" });
at = posted.length;
await push(REPO10, "refs/heads/gitpp/state", G1, "2026-10-23T00:02:00Z");
eq(
  surfaceChecks(at).length,
  0,
  "S18: the restore push's derivation skips (its commit already has a Check)",
);
eq(
  surfinfoTip(),
  G1,
  "S18: the skipping restore job still refreshes the cache back to the restored tip",
);
at = posted.length;
await push(REPO10, "refs/heads/main", GW);
{
  const sc = surfaceChecks(at);
  eq(sc.length, 1, "S18: the working-branch push gets its as-landed Check");
  const text = sc[0]?.output.text ?? "";
  ok(
    text.includes("`gitpp/state` at `0a0a0a0`"),
    "S18: the working Check derives the restored tip, not the superseded one",
  );
  ok(
    !text.includes("0b0b0b0") && text.includes("`oncall.primary` — unset"),
    "S18: none of the superseded tip's state leaks into the working Check",
  );
}
{
  // The write guard itself: an older observation never overwrites a
  // newer one, whatever order the writes land in.
  const GREPO = "acme/guard";
  await api.writeSurfinfo(
    env,
    GREPO,
    { has: true, tipSha: G2, tipTime: null },
    5000,
  );
  await api.writeSurfinfo(
    env,
    GREPO,
    { has: true, tipSha: G1, tipTime: null },
    4000,
  );
  eq(
    JSON.parse(env.CREDS.m.get(`surfinfo:${GREPO}`)).tipSha,
    G2,
    "S18: an out-of-order (older-observation) write is refused",
  );
  await api.writeSurfinfo(
    env,
    GREPO,
    { has: true, tipSha: G1, tipTime: null },
    6000,
  );
  eq(
    JSON.parse(env.CREDS.m.get(`surfinfo:${GREPO}`)).tipSha,
    G1,
    "S18: a fresher observation still lands",
  );
}

// ---- S19: one deeply-nested value is refused by name, alone (adversarial F6) -------
{
  const deepText =
    `{"id":"deep-1","kind":"task","parents":["genesis"],"effects":{"release.freeze":` +
    `{"a":`.repeat(10000) +
    "1" +
    "}".repeat(10000) +
    `}}`;
  const recs = [];
  const rej = [];
  api.gateRecordFile(deepText, "records/deep-1.json", recs, rej);
  eq(recs.length, 0, "S19: the 10,000-deep record does not pass the gate");
  ok(
    rej.length === 1 &&
      rej[0].file === "records/deep-1.json" &&
      rej[0].error.includes("value-depth limit"),
    "S19: the gate names the file and the value-depth rule",
  );
  const shallowText =
    `{"id":"ok-1","kind":"task","parents":[],"effects":{"release.freeze":` +
    `{"a":`.repeat(50) +
    "1" +
    "}".repeat(50) +
    `}}`;
  const recs2 = [];
  const rej2 = [];
  api.gateRecordFile(shallowText, "records/ok-1.json", recs2, rej2);
  eq(
    recs2.length,
    1,
    "S19: a 50-deep value is ordinary and passes (the gate is shared, so the A path gains this too)",
  );
  const REPO11 = "acme/ferry11";
  const DP = "0d".repeat(20);
  tarballs.set(
    DP,
    tarball({
      "surface.json": J(DECL_V1),
      "records/genesis.json": J({
        id: "genesis",
        kind: "witness",
        parents: [],
        effects: { "deploy.hold": false },
      }),
      "records/deep-1.json": deepText,
      "records/oncall.json": J({
        id: "oncall-rota",
        kind: "task",
        parents: ["genesis"],
        effects: { "oncall.primary": "rota-lead" },
      }),
    }),
  );
  refTips.set(REPO11, { sha: DP, time: "2026-10-23T01:00:00Z" });
  at = posted.length;
  await push(REPO11, "refs/heads/gitpp/state", DP, "2026-10-23T01:00:00Z");
  const sc = surfaceChecks(at);
  eq(sc.length, 1, "S19: the surface Check still posts with a deep record in the set");
  eq(
    sc[0]?.conclusion,
    "neutral",
    "S19: one deep record no longer fails the whole derivation",
  );
  const text = sc[0]?.output.text ?? "";
  ok(
    text.includes("`records/deep-1.json`") &&
      text.includes("value-depth limit"),
    "S19: the Check names the deep file and the rule",
  );
  ok(
    text.includes("`oncall.primary` = rota-lead"),
    "S19: everything else on the surface still derives",
  );
}

// ---- S20: the report budget is BYTES, not characters (issue #17) -------------------
// SCALE-1 measured the char-budget failure live: at 278 landed records
// the stored text was exactly 65,536 bytes — GitHub's cap — ending
// inside the History line, qualifications amputated, after the
// renderer's 65,000-CHARACTER truncation had already engaged. This
// fixture rebuilds that shape in the harness: a family description
// heavy with multibyte text (CJK + emoji), repeated on every claim
// line, so byte length outruns char length by ~1.7x. Post-fix the
// assembled text must be ≤ 65,000 BYTES, must still end with the full
// qualifications, and must show its truncation marker.
const byteLen = (s) => new TextEncoder().encode(s).length;
const REPO_SCALE = "acme/ferry-scale";
const TIP_SCALE = S("3");
{
  const heavyDesc =
    "Claim on one task — 担当する座席の記録：その請求を行った席が、請求の間ずっと担当する 🧑‍✈️ ための宣言です。";
  const decl = {
    version: 1,
    name: "ferry-scale",
    preview: "full",
    keys: {
      "task.claim.*": { description: heavyDesc },
      "release.freeze": KEYS["release.freeze"],
      "deploy.hold": KEYS["deploy.hold"],
      "oncall.primary": KEYS["oncall.primary"],
    },
  };
  const files = {
    "surface.json": J(decl),
    "records/genesis.json": J({
      id: "genesis",
      kind: "witness",
      parents: [],
      effects: { "deploy.hold": false },
    }),
    "records/oncall-rota.json": J({
      id: "oncall-rota",
      kind: "task",
      parents: ["genesis"],
      effects: { "oncall.primary": "rota-lead" },
    }),
  };
  for (let i = 1; i <= 320; i++) {
    const n = String(i).padStart(4, "0");
    files[`records/claim-k${n}.json`] = J({
      id: `claim-k${n}`,
      kind: "task",
      parents: ["genesis"],
      effects: { [`task.claim.k${n}`]: `agent-k${n}` },
      reason: `claiming k${n} for the refit rotation`,
    });
  }
  tarballs.set(TIP_SCALE, tarball(files));
  refTips.set(REPO_SCALE, { sha: TIP_SCALE, time: "2026-10-22T17:00:00Z" });
  const atScale = posted.length;
  await push(REPO_SCALE, "refs/heads/gitpp/state", TIP_SCALE, "2026-10-22T17:00:00Z");
  const sc = surfaceChecks(atScale);
  eq(sc.length, 1, "S20: exactly one surface Check for the scale fixture");
  const text = sc[0]?.output.text ?? "";
  ok(
    (sc[0]?.output.summary ?? "").includes("322 keys set · 1 declared unset"),
    "S20: counts exact at scale (320 claims + hold + oncall set; freeze unset)",
  );
  ok(
    byteLen(text) <= 65000,
    `S20: assembled text is within the BYTE budget (got ${byteLen(text)} bytes)`,
  );
  ok(
    byteLen(text) > 63000,
    `S20: the fixture genuinely reaches the cap region (got ${byteLen(text)} bytes, ${text.length} chars)`,
  );
  ok(
    text.trimEnd().endsWith("The surface is what its records say."),
    "S20: the full qualifications blockquote survives as the final text",
  );
  ok(
    text.includes("more entries truncated in this view"),
    "S20: the truncation marker is present inside the stored text",
  );
}

// ---- S21: the same byte budget on the Mapping A renderer ----------------------------
// renderReport shares MAX_TEXT: 800 records whose values are CJK
// strings (3 bytes per char) push the untruncated text far past
// 65,536 bytes while its char count stays deceptively lower. The
// assembled report must respect the byte budget and keep the
// qualifications last.
{
  const recs = [
    { id: "genesis", kind: "witness", parents: [], effects: { project: "byte-probe" } },
  ];
  for (let i = 0; i < 800; i++) {
    recs.push({
      id: `t${i}`,
      kind: "task",
      parents: ["genesis"],
      effects: { [`key-${i}`]: "値".repeat(30) },
    });
  }
  const { text } = api.renderReport(recs, "byte-probe", { sha: "0".repeat(40) });
  ok(
    byteLen(text) <= 65000,
    `S21: Mapping A report within the BYTE budget (got ${byteLen(text)} bytes, ${text.length} chars)`,
  );
  ok(
    byteLen(text) > 63000,
    "S21: the fixture genuinely reaches the cap region",
  );
  ok(
    text.trimEnd().endsWith("did not itself derive."),
    "S21: Mapping A qualifications (with the orphan definition) survive last",
  );
  ok(
    text.includes("more entries truncated in this view"),
    "S21: the truncation marker is present",
  );
}

// ---- S22: the pre-post recheck narrows the twin window ------------------------------
// Both delivery twins can pass the KV claim and the post-render
// exists check while neither has posted yet (SCALE-1: at 300 records
// both twins posted, on both paths). postCheckRun therefore re-runs
// the exists check immediately before POSTing. Script the list GETs:
// the derive-time check sees nothing; by the pre-post recheck the
// twin's run (424242) exists. The derivation must NOT post, and must
// record the twin's id in its posted marker.
const REPO_TWIN = "acme/ferry-twin";
const TIP_TWIN = S("5");
{
  tarballs.set(TIP_TWIN, tarball(LANDED_A));
  refTips.set(REPO_TWIN, { sha: TIP_TWIN, time: "2026-10-22T17:00:00Z" });
  checkListScript = [
    { name: "git.pp surface", remaining: 1, runs: [] },
    { name: "git.pp surface", remaining: 99, runs: [424242] },
  ];
  const atTwin = posted.length;
  await push(REPO_TWIN, "refs/heads/gitpp/state", TIP_TWIN, "2026-10-22T17:00:00Z");
  checkListScript = null;
  eq(
    surfaceChecks(atTwin).length,
    0,
    "S22: no second Check posted once the twin's run exists at the pre-post recheck",
  );
  eq(
    env.CREDS.m.get(`posted-s:${REPO_TWIN}:${TIP_TWIN}`),
    "posted:424242",
    "S22: the posted marker records the twin's check id",
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
  const report = api.renderReport(recs, project.project, {
    sha: "0".repeat(40),
    rejects: rej,
  });
  const { out } = report;
  eq(recs.length, 8, "S6: demo set gates to 8 records");
  ok(
    report.text
      .trimEnd()
      .endsWith(`Arrival order is never an input. ${ORPHAN_DEFINITION}`),
    "S6: Mapping A qualifications carry the orphan definition",
  );
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
