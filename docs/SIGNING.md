# Signing the record — gitpp-app's derivation attestation

> git.pp's record was not signed. A derivation posted as a Check
> said *what* the fold decided and *why*, but nothing said *who
> produced it*: the same Check text could have come from the App, from
> a script wearing its name, or from a person typing the winners by
> hand. A competitor family of signed agent-attribution tools makes
> that gap visible, and it is a real gap.
>
> This document describes what the App now signs, how the signature is
> made and kept, what a reader can check with it, and — at some
> length, because the gap is easy to overstate — what a signature here
> does **not** prove.

## The short version

Every derivation the App posts carries a cryptographic attestation:
an Ed25519 signature over a canonical string that binds

1. **the App** — the registered GitHub App's id,
2. **the head commit** — the commit the Check is posted on,
3. **the record set** — a digest of exactly the records the fold
   consumed, and
4. **the report** — a digest of exactly the text the Check carries.

The signature is Ed25519, over WebCrypto, with a private key that lives
in a Worker secret and has never been in this repository. The public
key is published here (`docs/attestation-key.pub`) and named in every
attested Check as a **key id** — the first eight hex characters of the
public key's SHA-256 — so a reader can tell at a glance which key
signed what.

`scripts/verify-attestation.mjs` checks an attestation against a
repository and a public key, with node builtins only. The unit suite
(`surface.test.mjs`) pins the format, the round trip, and the
byte-identical no-secret behaviour.

## What is signed

One string, five lines, UTF-8, LF line separators, **no trailing
newline**. The signature covers exactly those bytes:

```
git.pp/attestation/v1
app: 5419092
head: bf4dd1de7ca0e5ec62c08e515b0b23b26d026ee5
records: 2b79c3d2ea178105859c00a06f441a26bc2c26e6d321e9749410fba7ef038048
report: b4dd64eebc6090c85f3740df47c8d8771cc4efb6d3221ee5aa90e2ec811b672c
```

The first line is the format tag: it separates this string from any
other string that might be signed, so a signature over it can only ever
be read as a git.pp attestation.

| Field | What it is |
|-------|------------|
| `app` | The registered GitHub App's numeric id — `app.id` from the manifest-conversion record the Worker stores under the `app` key (the reference instance's is `5419092`). Each registration through the manifest flow creates its own App, so this names the registration that derived the record. If the stored record carries no id, the App's slug is used instead. |
| `head` | The head commit SHA (40 hex) the Check is posted on. For a surface Check this is the commit the Check runs on — *not* the `gitpp/state` tip the records were read from; the tip is named in the report's own basis line. |
| `records` | The records digest (below). |
| `report` | The report digest (below). |

The string is built by `attestationString()` in `worker.js` (the
*DERIVATION ATTESTATION* block, after the vendored fold engine).

## The two digests

Both digests are SHA-256, computed with the vendored engine's own
`sha256Hex()` — the fold's bytes, not a second implementation of them.

### The records digest — the engine's own input digest

The record set the fold consumed is the **landed** set: the records
that were not orphaned, including the meta records (disputes and
settlements) that the retraction law reads. Orphans never fold — they
are excluded from the state by rule, and the report names them
separately — so they are not in this digest.

Over that set, the digest is the vendored engine's own construction,
the one `checkpointRoot()` builds: one line per record,

```
<record id>:<recordLeaf(record)>
```

with the ids in code-point order (`cmpCodePoints`, the engine's own
order), the lines joined with `\n`, and the whole thing hashed with
`sha256Hex()`. `recordLeaf()` is the engine's per-record digest: SHA-256
over `pyCanonical()` of the record's `{id, parents (sorted), kind,
effects, reason}`.

The one-line summary: **the records digest is `checkpointRoot()`'s
value, over the landed set.** `checkpointRoot()` computes it over the
ancestor closure of the landed frontier, and that closure *is* the
landed set — every landed record is an ancestor of some maximal landed
record — so the two agree by construction. The App computes the value
without re-running the fold a second time
(`attestationRecordsDigest()`); the unit suite pins the two to the
same number (`buildFrontierCheckpoint(records).closureRoot`).

The set that goes into it is the one the App actually folded, after
the App's own intake: every `.gitpp/records/*.json` at the commit,
gated record by record (`gateRecordFile()`) and with duplicate ids
resolved (`dedupeRecordEntries()`). For the surface path it is the
*gated* surface records at the `gitpp/state` tip — the records after
the declaration gate (`applyDeclarationGate()`), because that is what
the surface fold consumed — plus the proposals in a preview.

### The report digest — the digest of what the reader reads

`sha256Hex()` over the UTF-8 bytes of the report text as posted, with

- the attestation section itself removed, and
- the text's **trailing newlines stripped**.

That second rule is the *canonical form* of the report text, and it
exists because of what GitHub does with a Check's output: the Worker
writes the text with a trailing newline, GitHub stores and returns it
**without** that newline. Hashing the text exactly as written
therefore produced a digest that no reader could recompute from the
text GitHub hands back — the signature and the records digest
verified, and the report digest did not. That was found live, on
2026-11-03, and fixed the same day.

So the digest is taken over the form both sides agree on: the report
text, minus the section, minus the trailing newline(s). The Worker
applies the rule in `canonicalReportText()`; the verifier applies the
same one when it recomputes the digest. Only trailing newline
characters are stripped — every other byte of the report is still
covered, and the digest still changes if any character of the report
changes.

In code, the canonical form of a report `T` is:

```
canonical(T) = T without its trailing "\n" characters
```

and the report digest is `sha256Hex(canonical(report text without the
attestation section))`.

## The algorithm, and where the keys live

**Ed25519** (RFC 8032), through WebCrypto's `crypto.subtle` — the
same API Cloudflare Workers expose, with no dependency and no
hand-rolled curve arithmetic. The private key is imported as PKCS#8
(`importKey("pkcs8", …, {name: "Ed25519"})`); the signature is the
raw 64-byte Ed25519 signature, carried in the Check as base64.

| Name | Where | What |
|------|-------|------|
| `ATTESTATION_KEY` | Worker **secret** | Base64 of the PKCS#8 DER private key. Never in this repository, never in the event log, never in a log line, never in a Check. |
| `ATTESTATION_PUBLIC_KEY` | Worker binding (a plain var is fine — it is public material) | Base64 of the raw 32-byte Ed25519 public key. The same bytes are published in `docs/attestation-key.pub`. |

The key id is derived, not configured: the first eight hex characters
of SHA-256 over the raw 32-byte public key. A Check therefore names
its own signer without the Worker trusting a configured string.

**The pair is checked against itself.** Before signing, the Worker
signs a fixed probe message with the private key and verifies it with
the public key. If the two do not match — the ordinary deploy slip —
**nothing is signed**, and the misconfiguration is named in the event
log (`action: "attestation-misconfigured"`). An unverifiable receipt
is worse than no receipt, so a half-configured key never signs.

## The section in the Check

An attested Check carries this, between the report's last section and
the closing qualifications:

```
## Attestation

- app id: `5419092`
- head: `bf4dd1de7ca0e5ec62c08e515b0b23b26d026ee5`
- key id: `d4ce0b23`
- records: `2b79c3d2ea178105859c00a06f441a26bc2c26e6d321e9749410fba7ef038048`
- report: `b4dd64eebc6090c85f3740df47c8d8771cc4efb6d3221ee5aa90e2ec811b672c`
- signature: `iQNt9QfTIlmWHKIgbVrx+7JXGWHDsGlOY4Nld2pbo9QxSuf2gd86zQkyWZE+yYx…`
```

Two placement rulings, both deliberate:

- **The section sits directly above the qualifications blockquote.**
  The qualifications are the Check's last text — `renderReport()`'s
  contract says the qualifications blockquote is *always the final
  text* — so the receipt goes just above the caveat, not after it. A
  reader still ends on the caveat.
- **The section yields to the report's content.** GitHub caps a Check
  run's output at 65,536 bytes, and the App budgets 65,000
  (`MAX_TEXT`). When the section does not fit under that budget, the
  **section** goes — whole, never in part — and the Check is the
  unsigned report. The report's content is never sacrificed to keep
  the receipt. (The other defensible ruling is the opposite: reserve
  room for the section and truncate the state list to fit it. This one
  keeps the report byte-identical to the unsigned report, so the
  report digest means the same thing whether or not signing is on. A
  dropped section is not marked: a Check without a section is
  indistinguishable from one posted by an instance that does not sign
  at all, which is worth knowing when reading a large report.)

**Which Checks carry one.** The `git.pp state` Check (Mapping A) and
the `git.pp surface` Check (Mapping B) are both attested. The
*failure* Checks — the ones with a `failure` conclusion, posted when
the records could not be read at all — are not, and cannot be: nothing
was derived, so there is nothing to attest to. A failure Check says
so in its own text.

## With no signing key, nothing changes

An instance without `ATTESTATION_KEY` configured posts exactly the
report it posted before this feature: no section, no extra bytes, no
errors, no event-log entries. The unit suite pins this two ways — the
152 pre-existing assertions are unchanged and still pass, and a new
case derives the same records twice, once signed and once not, and
compares the signed report minus its section with the unsigned report
byte for byte.

## What an attestation proves — and what it does not

**It proves** that the holder of the signing key produced *this
derivation* over *these inputs*: these records, folded into this
report, on this commit, under this App's registration. Anyone holding
the key can check that the report was not edited after it was signed,
and that the records behind it are the ones named by the digest. It
is a receipt from the key holder: continuity of custody over the
record, which is exactly what the unsigned record lacked.

**It does not prove** who authored the individual records. A record's
`author` field is a claim inside the record, and the fold does not
check it; a signature over the derivation says nothing about it. It
does not prove that the records are *true* — that the claim in a
record reflects anything outside the repository. It does not prove
that the fold is *correct*: the signature attests to the outcome of
the vendored engine, not to the engine's semantics, and a bug in the
engine would be attested just as faithfully. It does not prove that
the key holder wrote the records rather than deriving them from
records someone else wrote — that is the whole point of the boundary
this document draws, and the reason the scope is stated in plain words
rather than left to the reader.

The Check says the same thing in one line, in every report, signed or
not: *"Digests authenticate content, not authorship."* The
qualifications blockquote is not decoration; it is the scope of the
signature.

## Checking an attestation

`scripts/verify-attestation.mjs` — node builtins only, no install
step, no network:

```sh
node scripts/verify-attestation.mjs \
  --repo /path/to/the/repository-with-the-records \
  --commit <sha> \
  --pub docs/attestation-key.pub \
  --block attestation.txt
```

`--block` takes the Check's `## Attestation` block, or the whole
Check output (the block is found inside it), or `-`/omitted for stdin.
`--repo` defaults to `.`, `--commit` to `HEAD`, `--pub` to
`docs/attestation-key.pub`.

The verifier does three things, and says which ones it did:

1. **It rebuilds the canonical string** from the block's own fields
   and verifies the Ed25519 signature against the public key file. It
   also checks that the block's key id is the public key's — a
   receipt that names a different key is rejected before the
   signature is even tried.
2. **It re-folds the records at the commit** with the vendored engine
   — the same extraction the test harness performs on `worker.js` —
   and recomputes the records digest from the repository's own
   `.gitpp/records/*.json`, through the App's own intake (`gateRecordFile()`,
   `dedupeRecordEntries()`). If the repository's records were edited
   after the Check was posted, the digest does not match and the
   verdict is `FAILED`.
3. **It recomputes the report digest**, but only when it was given the
   whole Check output — the block alone does not carry the text the
   digest covers. The text it hashes is the canonical form (trailing
   newlines stripped), so a Check read back from GitHub verifies
   exactly as one read from the file the Worker wrote.

Exit status is `0` when the attestation verifies as far as it could be
checked, `1` when it does not; the verdict is one line on stdout:

```
VERIFIED — git.pp attestation over bf4dd1d: signature valid (key id d4ce0b23), records digest matches the fold at bf4dd1d
```

### What the verifier cannot check

- **A surface Check's records digest.** The surface path folds the
  records at the `gitpp/state` tip, not at the commit, and it folds
  them *after* the declaration gate — and the gate's treatment of a
  retired key depends on the operator's declaration manifest (the
  `surfmanifest:` entry in the credential store), which is not in the
  repository. So for a surface Check the verifier verifies the
  signature (and the report digest, from the full text) and says
  plainly that the records digest was not recomputed. For a state
  Check, whose records are at the commit, it recomputes everything.
- **The private key.** Of course not. The verifier proves that *this*
  public key signed *this* string; it cannot say who holds the
  private half. Custody is the operator's, and the key id in every
  Check says which key was used.

## Deploying with a key

The keypair in this repository today is a **TEST** key: a throwaway
made for development, whose private half never entered this repository
and never will. `docs/attestation-key.pub` says so on its first line.

At deploy time:

1. Generate the production pair on the operator's machine —
   `node -e 'const {generateKeyPairSync}=require("node:crypto");const k=generateKeyPairSync("ed25519");console.log(k.privateKey.export({type:"pkcs8",format:"der"}).toString("base64"));console.log(k.publicKey.export({type:"spki",format:"der"}).subarray(12).toString("base64"))'`
   — the first line is the secret, the second is the public key.
2. Put the private key into the Worker secret `ATTESTATION_KEY` (a
   Cloudflare secret, not a var, not a file in this repository), and
   the public key into the `ATTESTATION_PUBLIC_KEY` binding.
3. Overwrite `docs/attestation-key.pub` with the production public
   key and the same labelling, commit it, and link it from the landing
   page.
4. Push one commit on a repository with records and read the Check:
   the `## Attestation` section must be there, and the key id must
   match the key file.

Until step 1–4 are done, the App runs exactly as it did before this
feature: no secret, no section, no errors.

## Where this lives in the code

| Piece | Where in `worker.js` |
|-------|----------------------|
| The canonical string | `attestationString()` |
| The records digest | `attestationRecordsDigest()` (over the engine's `recordLeaf()` and `sha256Hex()`) |
| The section's lines | `attestationSectionLines()` |
| Placement in the report | `insertAttestationSection()` |
| Key loading, the pair check, the key id | `attestationKeyPair()`, `attestationKeyId()` |
| Signing | `buildAttestation()` |
| The budget ruling | `attachAttestation()` |
| The two call sites | `deriveAndPost()` (Mapping A) and `deriveSurfaceAndPost()` (Mapping B) |

The vendored fold engine is untouched by all of this. The engine's
bytes are a specification (git.pp-ng DESIGN.md), refreshed by
re-vendoring and never by local edits; the attestation reads the
engine's digests and changes nothing inside it.
