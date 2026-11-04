#!/usr/bin/env node
// verify-attestation.mjs — check a git.pp derivation attestation.
//
// Dependency-free: node builtins only (fs, child_process, crypto). It
// re-folds the records at a commit with the VENDORED fold engine — the
// one in this repo's worker.js, extracted the same way the test
// harness extracts it — rebuilds the canonical attestation string, and
// verifies the Ed25519 signature against a public key file.
//
//   node scripts/verify-attestation.mjs \
//     --repo /path/to/the/records/repo \
//     --commit <sha> \
//     --pub docs/attestation-key.pub \
//     --block attestation.txt
//
//   --block   the Check's `## Attestation` block, or the whole Check
//             output (the block is found inside it). "-" or omitted
//             means stdin.
//   --repo    the repository holding the records (default: ".")
//   --commit  the commit the Check is on (default: HEAD)
//   --pub     the public key file (default: docs/attestation-key.pub)
//   --quiet   print only the verdict line (default: one verdict line,
//             plus a note per check on stderr)
//
// Exit 0 when the attestation verifies as far as it could be checked,
// 1 when it does not. The verdict line says exactly what was checked:
// a Check whose records are not at the commit (a surface Check, whose
// records live on the gitpp/state branch) still has its signature
// verified here, and says so.
//
// The report digest is recomputed over the report text's CANONICAL
// FORM — the text without the attestation section and without its
// trailing newlines, because GitHub returns a Check's output text
// without the trailing newline the Worker wrote (found live on
// 2026-11-03). The Worker applies the same rule; see
// docs/SIGNING.md, "The report digest".
//
// The canonical attestation string, as signed:
//
//   git.pp/attestation/v1
//   app: <the App's id>
//   head: <the head commit SHA>
//   records: <digest of the record set the fold consumed>
//   report: <digest of the report text>
//
// — five lines, UTF-8, no trailing newline.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
} from "node:crypto";
import { tmpdir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKER = join(HERE, "..", "worker.js");

// ---- arguments ---------------------------------------------------------------
function parseArgs(argv) {
  const out = {
    repo: ".",
    commit: "HEAD",
    pub: join(HERE, "..", "docs", "attestation-key.pub"),
    block: null,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") out.repo = argv[++i];
    else if (a === "--commit") out.commit = argv[++i];
    else if (a === "--pub") out.pub = argv[++i];
    else if (a === "--block") out.block = argv[++i];
    else if (a === "--quiet") out.quiet = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

// ---- the vendored engine, extracted from worker.js ----------------------------
// The same extraction the test harness does: the core slice of the
// Worker, from its TEST-EXTRACT marker to the export. The engine's
// canonicalisation (pyCanonical, recordLeaf, sha256Hex) is what the
// digests are defined over, so the verifier must use the engine's own
// bytes, not a re-implementation of them.
async function loadEngine() {
  const src = readFileSync(WORKER, "utf8");
  const start = src.indexOf("/*TEST-EXTRACT:core*/");
  const end = src.indexOf("export default");
  if (start < 0 || end < 0 || end < start)
    throw new Error(`worker.js: extraction markers not found (${WORKER})`);
  const slicePath = join(tmpdir(), `gitpp-verify-slice-${process.pid}.mjs`);
  writeFileSync(
    slicePath,
    src.slice(start, end) +
      "\n;globalThis.__api = { derive, indexRecords, recordLeaf, sha256Hex, cmpCodePoints, gateRecordFile, dedupeRecordEntries };\n",
  );
  await import(slicePath);
  return globalThis.__api;
}

// ---- git ---------------------------------------------------------------------
function git(repo, args, { allowFail = false } = {}) {
  const res = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    if (allowFail) return null;
    throw new Error(
      `git ${args.join(" ")} failed in ${repo}: ${(res.stderr || "").trim()}`,
    );
  }
  return res.stdout;
}

// ---- the public key ----------------------------------------------------------
// Two shapes are accepted: the raw 32-byte Ed25519 key in base64 (what
// docs/attestation-key.pub holds), or a PEM SPKI public key. Comment
// lines (a '#' prefix) are ignored, so the file can carry its own
// labelling.
function readPublicKey(path) {
  const text = readFileSync(path, "utf8");
  let raw = null;
  if (text.includes("-----BEGIN")) {
    const key = createPublicKey(text);
    const der = key.export({ type: "spki", format: "der" });
    // Ed25519 SPKI: a 12-byte header, then the 32-byte key.
    raw = new Uint8Array(der.subarray(der.length - 32));
  } else {
    const b64 = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .join("");
    raw = new Uint8Array(Buffer.from(b64, "base64"));
  }
  if (raw.length !== 32)
    throw new Error(
      `${path}: expected a 32-byte Ed25519 public key, got ${raw.length} bytes`,
    );
  const key = createPublicKey({
    format: "jwk",
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: Buffer.from(raw).toString("base64url"),
    },
  });
  const keyId = createHash("sha256")
    .update(raw)
    .digest("hex")
    .slice(0, 8);
  return { key, raw, keyId };
}

// ---- the report text's canonical form ----------------------------------------
// The report digest is taken over the report text with its trailing
// newlines stripped: GitHub stores and returns a Check run's output
// text without the trailing newline the Worker wrote, so that is the
// form both sides agree on. The Worker applies the same rule
// (canonicalReportText() in worker.js). Only trailing newline
// characters are stripped — every other byte of the text is covered.
const canonicalReportText = (text) => text.replace(/\n+$/, "");

// ---- the attestation block ----------------------------------------------------
// The block is the `## Attestation` section's bullets. The whole Check
// output may be given instead: the block is then inside it, and the
// report text around it is the body the report digest covers.
function parseBlock(input) {
  const marker = "\n## Attestation\n";
  const whole = input.includes(marker);
  let block = input;
  let body = null;
  if (whole) {
    const i = input.lastIndexOf(marker);
    const j = input.indexOf("\n> ", i);
    body = input.slice(0, i) + (j < 0 ? "" : input.slice(j));
    block = input.slice(i + marker.length, j < 0 ? input.length : j);
  }
  const field = (name) => {
    const re = new RegExp(`^- ${name}: \`([^\`]*)\`$`, "m");
    const m = block.match(re);
    return m ? m[1] : null;
  };
  return {
    whole,
    body,
    appId: field("app id"),
    head: field("head"),
    keyId: field("key id"),
    records: field("records"),
    report: field("report"),
    signature: field("signature"),
  };
}

// ---- the canonical attestation string -----------------------------------------
function canonicalString({ appId, head, records, report }) {
  return [
    "git.pp/attestation/v1",
    `app: ${appId}`,
    `head: ${head}`,
    `records: ${records}`,
    `report: ${report}`,
  ].join("\n");
}

// ---- the records at a commit ---------------------------------------------------
// The same intake the App does: read `.gitpp/records/*.json` at the
// commit, gate every record (gateRecordFile), resolve duplicate ids
// (dedupeRecordEntries), then re-fold with the vendored engine and
// rebuild the records digest over the records the fold consumed.
function recordsAtCommit(repo, sha, engine) {
  const listing = git(
    repo,
    ["ls-tree", "-r", "--name-only", sha, "--", ".gitpp/records"],
    { allowFail: true },
  );
  if (listing === null) return null;
  const files = listing
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\.gitpp\/records\/[^/]+\.json$/.test(l))
    .sort();
  const records = [];
  const rejects = [];
  const entries = [];
  for (const file of files) {
    const text = git(repo, ["show", `${sha}:${file}`]);
    engine.gateRecordFile(text, file, records, rejects, entries);
  }
  const kept = engine.dedupeRecordEntries(entries, rejects);
  return { records: kept.map((e) => e.record), rejects, files };
}

// The records digest, built from the vendored engine's own
// canonicalisation: one `<id>:<recordLeaf()>` line per folded record,
// ids in code-point order, hashed with the engine's sha256Hex. Orphans
// never fold, so they are not in it.
function recordsDigest(records, orphanIds, engine) {
  const idx = engine.indexRecords([...records]);
  const orphans = new Set(orphanIds ?? []);
  const ids = Object.keys(idx)
    .filter((id) => !orphans.has(id))
    .sort(engine.cmpCodePoints);
  return engine.sha256Hex(
    ids.map((id) => `${id}:${engine.recordLeaf(idx[id])}`).join("\n"),
  );
}

// ---- main ----------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "usage: verify-attestation.mjs [--repo DIR] [--commit SHA] [--pub FILE] [--block FILE|-] [--quiet]",
    );
    return 0;
  }
  const note = (line) => {
    if (!args.quiet) console.error(line);
  };
  const fail = (why) => {
    console.log(`FAILED — ${why}`);
    return 1;
  };

  let engine;
  let pub;
  let input;
  try {
    engine = await loadEngine();
  } catch (err) {
    return fail(`cannot load the vendored engine: ${err.message}`);
  }
  try {
    pub = readPublicKey(args.pub);
  } catch (err) {
    return fail(err.message);
  }
  try {
    input =
      !args.block || args.block === "-"
        ? readFileSync(0, "utf8")
        : readFileSync(args.block, "utf8");
  } catch (err) {
    return fail(`cannot read the attestation block: ${err.message}`);
  }

  const block = parseBlock(input);
  for (const field of ["appId", "head", "records", "report", "signature"]) {
    if (!block[field]) return fail(`the block has no \`${field}\` field`);
  }
  if (block.keyId && block.keyId !== pub.keyId)
    return fail(
      `key id mismatch: the block names ${block.keyId}, the key file is ${pub.keyId}`,
    );

  // 1. the signature, over the rebuilt canonical string
  const string = canonicalString(block);
  const signatureOk = cryptoVerify(
    null,
    Buffer.from(string, "utf8"),
    pub.key,
    Buffer.from(block.signature, "base64"),
  );
  if (!signatureOk)
    return fail(
      `the signature does not verify against the public key ${pub.keyId}`,
    );
  note(`signature: valid (key id ${pub.keyId})`);

  // 2. the records digest, re-folded from the records at the commit
  let sha = null;
  try {
    sha = git(args.repo, ["rev-parse", "--verify", `${args.commit}^{commit}`], {
      allowFail: true,
    });
  } catch (err) {
    /* handled below */
  }
  if (!sha) {
    console.log(
      `VERIFIED — signature valid (key id ${pub.keyId}); the records digest was NOT recomputed: ${args.commit} is not a commit in ${args.repo}`,
    );
    return 0;
  }
  sha = sha.trim();
  let at = null;
  try {
    at = recordsAtCommit(args.repo, sha, engine);
  } catch (err) {
    console.log(
      `VERIFIED — signature valid (key id ${pub.keyId}); the records digest was NOT recomputed: ${err.message}`,
    );
    return 0;
  }
  if (!at || at.records.length === 0) {
    console.log(
      `VERIFIED — signature valid (key id ${pub.keyId}); the records digest was NOT recomputed: no .gitpp/records at ${sha.slice(0, 7)} (a surface Check's records live on the gitpp/state branch, not at the commit)`,
    );
    return 0;
  }
  const folded = engine.derive(at.records);
  const digest = recordsDigest(at.records, folded.orphans, engine);
  if (digest !== block.records)
    return fail(
      `the records digest does not match the fold at ${sha.slice(0, 7)}: the block says ${block.records.slice(0, 16)}…, the fold gives ${digest.slice(0, 16)}…`,
    );
  note(`records digest: matches the fold of ${at.records.length} record(s) at ${sha.slice(0, 7)}`);

  // 3. the report digest, when the whole Check output was given
  if (block.whole && block.body !== null) {
    const reportDigest = engine.sha256Hex(canonicalReportText(block.body));
    if (reportDigest !== block.report)
      return fail(
        `the report digest does not match the report text: the block says ${block.report.slice(0, 16)}…, the text gives ${reportDigest.slice(0, 16)}…`,
      );
    note("report digest: matches the report text");
  } else {
    note("report digest: not recomputed (the block was given without the report text)");
  }

  console.log(
    `VERIFIED — git.pp attestation over ${block.head.slice(0, 7)}: signature valid (key id ${pub.keyId}), records digest matches the fold at ${sha.slice(0, 7)}`,
  );
  return 0;
}

process.exit(await main());
