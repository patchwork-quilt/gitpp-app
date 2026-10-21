# BUDGET — the GitHub-shaped collection cost model

*This is a MODEL, not a measurement. Every number below is arithmetic
on the assumptions listed in §1, worked before the GitHub-shaped build
exists — exactly so the build's shape is chosen by the arithmetic
instead of discovered by a rate-limit wall. §5 of the road
(`github-road.md`, M1) turns this model into an instrumented
measurement; until then, nothing here should be quoted as observed.*

## 1. Assumptions

- One project = one repository whose records live as one file per
  record on a records branch (the Mapping A shape; Mapping B's
  orphan branch is the same arithmetic).
- Average record ≈ 1 KB of JSON (the poc projects run 0.6–1.3 KB per
  record; 1 KB is the round figure).
- A *derivation* = collect the full record set, fold it, post or
  update one Check run. Posting the Check costs ~2 API calls
  (create + complete) under every collection shape below.
- Budget: GitHub's primary REST limit for a GitHub App installation,
  **5,000 requests/hour**, is the ceiling that matters. *(Correction,
  2026-10-21, from the verified platform facts in the programme
  record: 5,000/hr is the documented MINIMUM for an installation
  token — it scales +50/hr per repo beyond 20 and +50/hr per org
  user beyond 20, to a 12,500/hr cap (15,000 on GHEC) — so this
  model is conservative on the primary limit. The limit that binds
  the check-posting side is the SECONDARY one: 80
  content-generating requests/minute, 500/hour. At ~900 derivations
  a day the posting budget fits only if derivation coalesces per
  commit instead of firing per event; burst coalescing is therefore
  a hard design requirement, not an optimisation.)* Secondary
  (concurrency/burst) limits exist and are *ignored* by this model —
  they only make the REST column worse.
- Traffic: 300 pull requests/day against the installation, each
  triggering ~3 derivations (opened + two synchronise pushes) =
  **900 derivations/day**. PR traffic concentrates in ~10 working
  hours, so the honest divisor is 10, not 24.
- Collection shapes compared:
  - **REST contents**: list the records directory (1 call) + one GET
    per record file (N calls) + the branch/ref resolution (1 call)
    = **N + 2 calls** before the ~2 Check calls.
  - **Clone**: one fetch operation against the git transport
    (smart-HTTP). Not a REST call at all: it does not draw on the
    5,000/hr budget. Cost moves to bytes + CPU. A warm cache fetches
    only the delta after the first clone.
  - **Tarball**: one REST call (`GET /repos/{owner}/{repo}/tarball/{ref}`,
    + redirect) + the archive bytes. On Cloudflare Workers this is
    the native clone-class shape: the runtime has no git binary, so
    "clone" in production means tarball download or an in-JS
    smart-HTTP fetch — one request and bytes, either way.

## 2. Per-derivation collection cost

| Records (N) | REST contents (calls) | Clone (ops / first-fetch bytes) | Tarball (calls / bytes) |
|---:|---:|---:|---:|
| 62    | 64    | 1 / ~62 KB + repo overhead  | 1 / ~20 KB gz |
| 250   | 252   | 1 / ~250 KB + repo overhead | 1 / ~80 KB gz |
| 1,000 | 1,002 | 1 / ~1 MB + repo overhead   | 1 / ~320 KB gz |

Bytes assume ~1 KB/record raw, gzip ≈ 0.3× on JSON. Repo overhead
(the rest of the tree, pack structure) is real but fixed per repo,
not per record — and a records-branch-only fetch avoids most of it.
Warm-cache clone/tarball fetches after the first are delta-sized.

## 3. The day, against the budget

900 derivations/day, concentrated in 10 working hours → the REST
column must fit under 5,000 calls/hour *sustained*, i.e. under
~55 calls per derivation on average — before any other API use by
the installation (Check posting included).

| Records (N) | REST calls/day | REST calls/hr (10 h day) | Verdict vs 5,000/hr |
|---:|---:|---:|---|
| 62    | 900 × 66 ≈ 59,400     | ≈ 5,940   | **Over budget on checks alone** — fails at the smallest real size |
| 250   | 900 × 254 ≈ 228,600   | ≈ 22,860  | ~4.6× over budget |
| 1,000 | 900 × 1,004 ≈ 903,600 | ≈ 90,360  | ~18× over budget |

(The +2 Check calls are counted in these rows: N + 2 collection + 2
check ≈ N + 4, rounded in the table's per-derivation figures.)

Clone-class collection under the same traffic: 900 fetch operations
+ ~1,800 Check calls/day ≈ 180 REST calls/hour — 4% of the budget,
with the real cost in bandwidth (~tens of MB/day at these sizes) and
fold CPU, both of which are ours to provision rather than GitHub's
to ration.

## 4. Conclusion

**REST-contents collection does not survive contact with the budget
at any realistic project size** — it is over the line at 62 records,
the size of the programme's own scale demo. The only collection
shape that survives is clone-class: **one fetch operation plus
bytes** (tarball on Workers; smart-HTTP where a fetch
implementation is warranted), backed by the checkpoint/delta
machinery the fold already has, so repeat derivations re-read a
frontier and a tail rather than the world. Check posting (~2 calls
per derivation) is the irreducible REST spend, and it is small.

This is why the receiver is built webhook-fed and stateless-but-
cacheable from the first commit, and why M1 measures the real
numbers before any derivation is allowed to call itself production.
