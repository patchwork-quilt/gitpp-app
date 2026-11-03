# Contest day — the M2 live-day receipt

**The day:** 2026-10-23, in `SuperInstance/gitpp-dogfood-day1`. Five agents
wrote colliding git.pp records on five branches of one repository; a referee
merged their pull requests in an order nobody chose; after every merge, the
App's `git.pp state` Check on the merged commit was compared against an
independent local fold of the same tree.

**Headline, re-verified rather than restated: 10/10.** Five branch Checks and
five merge Checks. In the run that produced this page (2026-11-03), each of
those ten trees was re-folded locally with gitpp-action's `fold.mjs` and the
result was compared against the posted Check: counts, derived state, and
conflict lines matched in every case. The repository holds three more
`git.pp state` Checks — the referee's write-up commit and the two day-2
merges — and all three were re-folded the same way and also match: **13/13
trees** in total. Where the *wording* of the report differs between the App's
renderer and the Action's copy of it, this page says so instead of rounding
it away.

Every number here traces to a repository, a commit, or a Check id. Facts that
could not be re-derived from public artefacts are written **UNVERIFIED** with
the gap named. Nothing in this file is transcribed from the referee's prose
without having been re-checked against the repos; where a claim is the
referee's alone, it is attributed to them.

---

## The day in one screen

### Before the run

Base state on `main`: the seed commit `e72a162` (5 records — `genesis`,
`task-freeze-a`, `task-oncall-a`, `task-flag-a`, `witness-1`) and the README
fix `273dc76`. A delivery-control push `10b6333` followed, and its Check
`120167229259` read *"5 records · 6 keys · 0 conflict(s) · 0 orphan(s)"* —
read back from the check-runs API in this run, verbatim. The pipeline was
known to answer correctly on a tree with no collisions before any writer
arrived, so a later mismatch could have been a collision and not a
disconnection.

### The five writers

Each writer worked on its own branch and opened its own pull request. The
role names are the pull requests' own titles; the branches, PR numbers, and
head commits are the repository's.

| Role (PR title) | Branch | PR | Branch head | Records added | Claim |
|---|---|---|---|---|---|
| CAPTAIN | `agent/captain` | #3 | `3baee3b` | `override-freeze` (override, parents [`task-freeze-a`]) | `release.freeze` = none — "freeze lifted, ship it" |
| LATECOMER | `agent/late` | #1 | `5369296` | `override-oncall` (override, parents [`genesis`]) | `oncall.primary` = jonas |
| FREEZE-EXTENDER | `agent/freeze` | #4 | `a255b71` | `task-freeze-b` (task, parents [`task-freeze-a`]) | `release.freeze` = billing-v2 2026-10-19..2026-10-27 |
| FLAG-FLIPPER | `agent/flag` | #2 | `d8e84e3` | `task-flag-b` (task) + `witness-flag` (witness) | `feature.new_checkout` = canary |
| ONCALL-SWAP | `agent/oncall` | #5 | `1e42c36` | `task-oncall-b` (task, parents [`task-oncall-a`]) | `oncall.primary` = mara |

Branch heads confirmed in this run: `git rev-parse origin/agent/captain` is
`3baee3b1ab68fb85078d17032ce374f6aad0aaeb`, and likewise for the other four;
each is also the commit that introduced that branch's record files.

Each branch's own Check, and the local re-fold of that branch tree, agree —
1 conflict on every branch, and the branch's claim wins on its own branch:

| Branch | Head | Check id | Counts (Check and re-fold) | The branch's own verdict |
|---|---|---|---|---|
| `agent/captain` | `3baee3b` | `120167878842` | 6 records · 6 keys · 1 conflict · 0 orphans | `release.freeze` = none — winner `override-freeze` |
| `agent/late` | `5369296` | `120167858319` | 6 records · 6 keys · 1 conflict · 0 orphans | `oncall.primary` = jonas — winner `override-oncall` |
| `agent/freeze` | `a255b71` | `120167970357` | 6 records · 6 keys · 1 conflict · 0 orphans | `release.freeze` = billing-v2 2026-10-19..2026-10-27 — winner `task-freeze-b` |
| `agent/flag` | `d8e84e3` | `120167861695` | 7 records · 6 keys · 1 conflict · 0 orphans | `feature.new_checkout` = canary — winner `task-flag-b` |
| `agent/oncall` | `1e42c36` | `120167972654` | 6 records · 6 keys · 1 conflict · 0 orphans | `oncall.primary` = mara — winner `task-oncall-b` |

### The collision shape

Six records landed as colliding claims, and they meet three base setters:
nine records in all contest three keys. The base state's other three keys
(`project`, `status`, `deploy.last_seen`) were never contested by anyone:

- **`release.freeze`** — base `task-freeze-a` (billing-v2 2026-10-19..2026-10-23)
  vs CAPTAIN's `override-freeze` (none) vs FREEZE-EXTENDER's `task-freeze-b`
  (billing-v2 2026-10-19..2026-10-27).
- **`oncall.primary`** — base `task-oncall-a` (priya) vs LATECOMER's
  `override-oncall` (jonas) vs ONCALL-SWAP's `task-oncall-b` (mara).
- **`feature.new_checkout`** — base `task-flag-a` (off) vs FLAG-FLIPPER's
  `task-flag-b` (canary) and `witness-flag` (canary, a witness).

**No merge produced a git conflict.** Verified in this run: the five branch
commits add *disjoint* record files — captain one, late one, freeze one, flag
two, oncall one, no path added twice — so the merges were textual no-ops and
the collision lived entirely in the fold. That is the point of the
record-per-file layout: git never had to arbitrate; the fold did, by rule.

### The referee's merge order

Merged in this order, read from the merge commits' own timestamps and the
PR list's `mergedAt`:

| # | PR | Branch | Merged at (UTC) | Merge commit | Check id | Records · keys · conflicts · orphans |
|---|---|---|---|---|---|---|
| 1 | #3 | `agent/captain` | 2026-10-23 00:26:03 | `db62fc3` | `120168546255` | 6 · 6 · 1 · 0 |
| 2 | #1 | `agent/late` | 2026-10-23 00:26:44 | `1712073` | `120168762924` | 7 · 6 · 2 · 0 |
| 3 | #4 | `agent/freeze` | 2026-10-23 00:27:28 | `dae5e63` | `120169002367` | 8 · 6 · 2 · 0 |
| 4 | #2 | `agent/flag` | 2026-10-23 00:28:12 | `6e0ae8b` | `120169246517` | 10 · 6 · 3 · 0 |
| 5 | #5 | `agent/oncall` | 2026-10-23 00:28:56 | `ab34243` | `120169485033` | 11 · 6 · 3 · 0 |

The pull requests were *created* in the order #1 late, #2 flag, #3 captain,
#4 freeze, #5 oncall (created 00:24:05, 00:24:05, 00:24:09, 00:24:26,
00:24:28 UTC — read from the API in this run). The referee merged them in a
different order: **captain, late, freeze, flag, oncall**. Both overrides
landed *before* the task claims they eventually outranked, and the two task
claims that had won their own branches merged into trees where an override
already stood.

> **What "arrival order" can and cannot be checked against.** The *push*
> order of the five branches is not readable from the repository: the branch
> commits carry timestamps inside a seven-second window
> (00:23:55–00:24:02 UTC) at one-second resolution, and within that window
> the commit order (`late` 00:23:55, `flag` 00:23:59, `oncall` 00:23:59,
> `captain` 00:24:02, `freeze` 00:24:02) is not the same sequence as the
> PR-creation order the referee's log cites. The referee's ordering claim is
> therefore **UNVERIFIED at push granularity**; what *is* verifiable, and is
> the point of the test, is that the merge order differs from the PR creation
> order, and that arrival order is not an input to the fold — the fold's
> outcome on the merged tree is the same under either arrival sequence.

### The two claims that won their branch and lost the merge

`task-freeze-b` (FREEZE-EXTENDER) and `task-oncall-b` (ONCALL-SWAP) each won
the conflict on their own branch — the branch Check was correct for that
tree — and both lost in the merged tree, because by the time they landed an
override of the same key already stood. Confirmed in this run by re-folding
the branch trees: `agent/freeze` resolves `release.freeze` to
`task-freeze-b`; `agent/oncall` resolves `oncall.primary` to
`task-oncall-b`; in the merged tree `ab34243` both resolve to the override.

This is the property the day was built to produce, and it is the property
that held: the per-tree Check never disagreed with the fold of its own tree.

### The day-1 close

11 records, 6 keys, 3 conflicts, 0 orphans (Check `120169485033` on
`ab34243`; re-folded locally in this run — match):

- `deploy.last_seen` = green
- `feature.new_checkout` = canary
- `oncall.primary` = jonas
- `project` = harbor-ops
- `release.freeze` = none
- `status` = open

The referee's write-up commit `2a9c1d7` — the commit that added
`RESULTS.md` — carries its own Check, `120170080462`, and it reads the same
way: *"11 records · 6 keys · 3 conflict(s) · 0 orphan(s)"*. Re-folded here
too: match. A write-up that changes no records cannot change the state, and
the Check says so.

---

## The final record set

The repository's record set as it stands on `main` today: **13 records**,
enumerated from the files themselves (`.gitpp/records/*.json` at
`SuperInstance/gitpp-dogfood-day1`), not from any prose.

| Record id | Kind | Written by | Parents | Effects | First appears in |
|---|---|---|---|---|---|
| `genesis` | witness | base state (seed) | — | `project` = harbor-ops, `status` = open | `e72a162` |
| `task-freeze-a` | task | base state (seed) | `genesis` | `release.freeze` = billing-v2 2026-10-19..2026-10-23 | `e72a162` |
| `task-oncall-a` | task | base state (seed) | `genesis` | `oncall.primary` = priya | `e72a162` |
| `task-flag-a` | task | base state (seed) | `genesis` | `feature.new_checkout` = off | `e72a162` |
| `witness-1` | witness | base state (seed) | `task-freeze-a`, `task-oncall-a`, `task-flag-a` | `deploy.last_seen` = green | `e72a162` |
| `override-freeze` | override | CAPTAIN (`agent/captain`) | `task-freeze-a` | `release.freeze` = none | `3baee3b` |
| `override-oncall` | override | LATECOMER (`agent/late`) | `genesis` | `oncall.primary` = jonas | `5369296` |
| `task-freeze-b` | task | FREEZE-EXTENDER (`agent/freeze`) | `task-freeze-a` | `release.freeze` = billing-v2 2026-10-19..2026-10-27 | `a255b71` |
| `task-flag-b` | task | FLAG-FLIPPER (`agent/flag`) | `task-flag-a` | `feature.new_checkout` = canary | `d8e84e3` |
| `witness-flag` | witness | FLAG-FLIPPER (`agent/flag`) | `task-flag-b` | `feature.new_checkout` = canary | `d8e84e3` |
| `task-oncall-b` | task | ONCALL-SWAP (`agent/oncall`) | `task-oncall-a` | `oncall.primary` = mara | `1e42c36` |
| `task-season-winter` | task | day-2 writer (`day2/winter-timetable`, PR #6) | `genesis` | `schedule.season` = winter | `e6910f2` |
| `override-oncall-winter` | override | day-2 writer (`day2/oncall-winter`, PR #7) | `override-oncall` | `oncall.primary` = sanna | `cb838cc` |

Eleven of these are the live day; the last two were added on day 2
(2026-10-26) and are included here because "the final record set" means the
repository's current set, and the last merge Check in the repository is the
day-2 one — see below.

> **On authorship.** A git.pp record carries an id, a kind, parents, effects,
> and a reason — **no author field**. Read from the files, a record does not
> say who wrote it. The "Written by" column above is *derived*: for each
> record, the commit that first introduced that file (`git log
> --diff-filter=A`) and the branch and pull request it arrived on. The role
> names (CAPTAIN, LATECOMER, …) are the pull requests' own titles. Every one
> of those commits was authored by the same account, `SuperInstance agent
> <superinstance-agent@example.com>` — five roles, one machine credential.
> So the receipt can say *which claim arrived on which branch*, and cannot
> say *which human or agent was behind it*. That is the fold's own limit,
> stated in its closing line: *"Digests authenticate content, not
> authorship."*

---

## The final derived state — re-folded in this run

The record set at the repository's last merge commit (`779c836`, PR #7,
`day2/oncall-winter`) was extracted from git, folded locally with
gitpp-action's `fold.mjs` (the Action at `71b3690`, v0.4.1), and compared
against the Check the App posted on that same commit. **The commands, and
their output, verbatim:**

```console
$ git clone https://github.com/SuperInstance/gitpp-dogfood-day1.git
$ git clone https://github.com/patchwork-quilt/gitpp-action.git
$ mkdir -p refold && cd gitpp-dogfood-day1
$ git archive 779c836 .gitpp/records | tar -x -C ../refold
$ cd ../gitpp-action
$ GITHUB_SHA=779c836e45f374aa6488cfc30b2ed88d683f1b63 \
    bun run fold.mjs --records ../refold/.gitpp/records --project harbor-ops
# git.pp state — harbor-ops
> Advisory — a mechanical derivation under the fold's rules, not an approval. A winner means precedence, not correctness or authorisation. This report never gates a merge.
> How a winner is chosen: kind first (override beats task beats witness); within a kind, a record that descends from a rival supersedes it; any remaining tie breaks on ancestry — ancestors are all transitive ancestors, counted once each, excluding the record itself: most intent ancestors (task and override records) wins, then fewest witness ancestors, then smallest id. A record's reason is its author's note, never an input to the fold.

Commit `779c836` · 13 records · 7 keys · 3 conflict(s) · 0 orphan(s)

## State

- `deploy.last_seen` = green
- `feature.new_checkout` = canary
- `oncall.primary` = sanna
- `project` = harbor-ops
- `release.freeze` = none
- `schedule.season` = winter
- `status` = open

## Conflicts (losers preserved)

- **feature.new_checkout** = canary — winner `task-flag-b` (task, reason: "enable canary", parents: [task-flag-a])
  - loser `task-flag-a` (task) set off — superseded — the winner descends from it; preserved in the record
  - loser `witness-flag` (witness) set canary — outranked — task beats witness (kind priority is absolute); preserved in the record
- **oncall.primary** = sanna — winner `override-oncall-winter` (override, reason: "winter rota: sanna takes primary while jonas is on leave", parents: [override-oncall])
  - loser `override-oncall` (override) set jonas — superseded — the winner descends from it; preserved in the record
  - loser `task-oncall-a` (task) set priya — outranked — override beats task (kind priority is absolute); preserved in the record
  - loser `task-oncall-b` (task) set mara — outranked — override beats task (kind priority is absolute); preserved in the record
- **release.freeze** = none — winner `override-freeze` (override, reason: "captain: freeze lifted, ship it", parents: [task-freeze-a])
  - loser `task-freeze-a` (task) set billing-v2 2026-10-19..2026-10-23 — outranked — override beats task (kind priority is absolute); preserved in the record
  - loser `task-freeze-b` (task) set billing-v2 2026-10-19..2026-10-27 — outranked — override beats task (kind priority is absolute); preserved in the record

> Mechanical resolution of labelled key conflicts only; the fold does not settle semantic conflicts. Digests authenticate content, not authorship. Arrival order is never an input. An orphan is a record whose parent is missing or did not itself derive.
```

The Check it is compared against, read from the API:

```console
$ gh api repos/SuperInstance/gitpp-dogfood-day1/check-runs/121825082829 --jq .output.text
```

**Verdict: MATCH.** The Check (`121825082829`, conclusion `neutral`, on
commit `779c836`) and the local re-fold agree on the counts line
(`13 records · 7 keys · 3 conflict(s) · 0 orphan(s)`), on all seven derived
state values, and on all three conflict blocks — winner, value, kind, reason,
parents, and every preserved loser.

The two texts are not byte-identical, and the difference is worth naming
rather than hiding. The full diff is:

```
2,3c2
< 
< > Advisory — … This Check never gates a merge.
---
> > Advisory — … This report never gates a merge.
32d30
< 
```

Three differences, none of them about the derivation:

1. A blank line after the title, and one at the end (formatting).
2. The App's renderer closes with *"This **Check** never gates a merge."*
   (`worker.js`, the `ADVISORY` constant); the Action's copy of the same
   text says *"This **report** never gates a merge."* (`fold.mjs`). One word,
   two renderers, no difference in what was derived.
3. Nothing else. Every count, every state value, every conflict line, every
   loser is identical.

A third, independent implementation agrees as well: the day-1 repository's
own `tools/fold.py` (a labelled minimal port of the derive semantics, not
the upstream engine) re-derives the same state and the same three conflicts,
and its regenerated snapshot is byte-identical to the committed
`harbor_ops/derived-state.json` (`python3 tools/derive.py` leaves a clean
working tree; `python3 -m unittest discover -s tests` → `Ran 12 tests … OK`).

---

## All thirteen trees, re-derived

Every tree with a `git.pp state` Check in the repository was re-folded
locally in this run and compared against its posted Check. "State" and
"conflicts" are compared as the rendered blocks, not by eye.

| Tree | Commit | Check id | Counts | State | Conflicts |
|---|---|---|---|---|---|
| `agent/captain` | `3baee3b` | `120167878842` | MATCH | MATCH | MATCH |
| `agent/late` | `5369296` | `120167858319` | MATCH | MATCH | MATCH |
| `agent/freeze` | `a255b71` | `120167970357` | MATCH | MATCH | MATCH |
| `agent/flag` | `d8e84e3` | `120167861695` | MATCH | MATCH | MATCH |
| `agent/oncall` | `1e42c36` | `120167972654` | MATCH | MATCH | MATCH |
| merge #3 captain | `db62fc3` | `120168546255` | MATCH | MATCH | MATCH |
| merge #1 late | `1712073` | `120168762924` | MATCH | MATCH | MATCH |
| merge #4 freeze | `dae5e63` | `120169002367` | MATCH | MATCH | MATCH |
| merge #2 flag | `6e0ae8b` | `120169246517` | MATCH | MATCH | MATCH |
| merge #5 oncall | `ab34243` | `120169485033` | MATCH | MATCH | MATCH |
| referee's write-up | `2a9c1d7` | `120170080462` | MATCH | MATCH | MATCH |
| merge #6 winter timetable | `c524c08` | `121824647658` | MATCH | MATCH | MATCH |
| merge #7 on-call winter | `779c836` | `121825082829` | MATCH | MATCH | MATCH |

**13/13 on counts, state, and conflicts. 10/10 on the day itself.**

Compared as *whole reports*, the two day-2 checks match the local re-fold
byte-for-byte once the advisory line and blank lines are set aside; the
eleven day-1-vintage checks do not, and the reason is dated, not mysterious:
the App's report prose changed twice on 2026-10-23 *after* the day-1 checks
were posted — `3a36bea` at 00:33:55 UTC (the rule-order line gained its
counting convention) and `732b3de` at 04:28:21 UTC (the closing line gained
the sentence about orphans). The day-1 checks (posted 00:24–00:30 UTC) carry
the older wording; the day-2 checks (2026-10-26) carry the wording the
Action still ships. The derivation itself is unaffected — the changed
sentences are the report's explanation of the rules, not the rules.

---

## Verify this yourself

```console
# 1. Get the three repositories.
$ git clone https://github.com/SuperInstance/gitpp-dogfood-day1.git
$ git clone https://github.com/patchwork-quilt/gitpp-action.git
$ git clone https://github.com/patchwork-quilt/gitpp-app.git

# 2. Re-fold the final record set (the tree of the last merge commit).
$ mkdir -p refold && cd gitpp-dogfood-day1
$ git archive 779c836 .gitpp/records | tar -x -C ../refold
$ cd ../gitpp-action
$ GITHUB_SHA=779c836e45f374aa6488cfc30b2ed88d683f1b63 \
    bun run fold.mjs --records ../refold/.gitpp/records --project harbor-ops \
    > ../refold/local-fold.txt

# 3. Read the Check the App posted on that commit, and compare.
$ gh api repos/SuperInstance/gitpp-dogfood-day1/check-runs/121825082829 --jq .output.text \
    > ../refold/check-text.txt
$ diff ../refold/check-text.txt ../refold/local-fold.txt
# Expect: one blank line, the word "Check" vs "report", one trailing blank line.

# 4. Check the day's own history, branch by branch and merge by merge.
$ cd ../gitpp-dogfood-day1
$ git log --merges --date=iso-strict --pretty=format:'%h %ad %s'
$ git log --diff-filter=A --format='%h %s' -- .gitpp/records/

# 5. Read any tree's Check yourself.
$ gh api repos/SuperInstance/gitpp-dogfood-day1/commits/ab34243/check-runs \
    --jq '.check_runs[] | "\(.id) \(.name) \(.conclusion) \(.output.summary)"'

# 6. The repository's own third implementation, and its snapshot.
$ python3 tools/derive.py      # -> "folded 13 records -> harbor_ops/derived-state.json"
$ python3 -m unittest discover -s tests
```

`bun` is required for step 2 (the Action is a bun/TypeScript project;
`bun` 1.3.1 was used for this run). Steps 3–6 need `gh` and a Python 3
interpreter.

---

## Honest limits

What this day does **not** prove, stated as plainly as what it does:

- **One team, one repository, one record shape.** Five writers on one repo
  whose record set today is thirteen records across seven keys, three of them
  contested, is a demonstration scale, not a production workload. Nothing here
  says how the fold behaves on thousands of records, on deeply chained
  ancestries, or on a repository where the same key is claimed by hundreds of
  writers.
- **Synthetic load, and a synthetic cast.** The five writers were role
  labels — CAPTAIN, LATECOMER, FREEZE-EXTENDER, FLAG-FLIPPER, ONCALL-SWAP —
  on pull requests whose titles say so, and all of them pushed from a single
  machine credential. This tests the *derivation* against concurrent
  claims; it does not test five independent humans or five independent
  agents, and it cannot: the records carry no author field, and a
  record's ancestry says what it descends from, never who is honest.
- **The claim was never contested by a human.** The referee chose the merge
  order and compared the results, but no one with a stake in the outcome
  reviewed the Check text and disagreed with it. A mismatch here would have
  been a loud, mechanical failure; a *wrong-but-consistent* fold — a rule
  that is deterministic and still not what the team meant — would have
  passed all thirteen comparisons unnoticed.
- **The Checks are advisory, and were never a gate.** Every Check in this
  receipt concludes `neutral`; nothing blocked a merge, and an admin could
  have made `git.pp state` required but did not. The repository's own CI
  workflow (`unittest`) is a separate thing, and it *failed* on every day-2
  commit that added a record — the two branch commits `e6910f2` and
  `cb838cc` and the two merge commits `c524c08` and `779c836` — because the
  shipped snapshot had not yet been regenerated for the new records:
  `test_shipped_snapshot_matches_fresh_fold` failed on the merge commit
  with the shipped state missing `schedule.season` while a fresh fold had
  it. It passed once the close-out commit regenerated the snapshot (run
  `40394594457` on `5309507`, success — verified in this run), and the
  suite passes today (`Ran 12 tests … OK`). That failure is instructive
  rather than embarrassing: the App's Check said nothing about the
  snapshot, because the App's Check is about records, and only the
  snapshot's own consistency test caught the drift. The day-1 merges have
  no `unittest` run at all — CI did not exist in the repository yet on
  2026-10-23.
- **The day-1 record set is now only a prefix of the current one.** Two
  day-2 records were added and superseded `oncall.primary` from jonas to
  sanna. The 10/10 result was measured on the 11-record set; the 13-record
  set was checked too (12/12 trees), but the *narrative* of the live day —
  two claims that won their branch and lost the merge — describes the
  2026-10-23 close, not today's `main`.
- **One engine, two copies, one word apart.** The App's renderer and the
  Action's vendored copy of the fold are separate code bases. They agreed
  on every derivation in this receipt, and their report prose differs by a
  single word ("Check" / "report") and a blank line. That is a fact about
  this pair of copies at these commits, not a guarantee that they will
  agree in prose later — only that the *derivation* did not depend on the
  wording.
- **The referee's delivery accounting is not re-checkable.** The run's
  API-call accounting — 11 pushes, 11 Checks, "4 App REST calls per posted
  Check", "≥22 deliveries", "≈44 app REST calls" — is labelled `[derived]`
  in the referee's own log, and the delivery ring that would have settled
  it is operator-only since v0.3.0 with entries expiring 30 days after they
  are written. **UNVERIFIED from public artefacts**, and no attempt is made
  here to restate it as fact. The same applies to the referee's note that
  two of five agents had their first push remote-rejected with no reason in
  the output: a rejected push leaves no trace in the repository, so that
  incident is **UNVERIFIED**.
- **What was checked, and how, is stated above; what was merely read is
  attributed.** Numbers in the tables that came from the check-runs API,
  from git, or from a re-fold performed during this run are verifiable from
  the links and commands given. The referee's characterisations — that the
  merge order was "unkind on purpose", that the delivery control was
  "before the run", that `witness-flag`'s loss is "bookkeeping" — are the
  referee's reading of the same evidence, quoted as such.

---

## Sources

- `SuperInstance/gitpp-dogfood-day1` — the day's repository: records
  (`.gitpp/records/`), the referee's log (`RESULTS.md`), the project's own
  fold port and snapshot (`tools/fold.py`, `harbor_ops/derived-state.json`),
  the merge history, and the pull requests #1–#7.
- `patchwork-quilt/gitpp-action` — `fold.mjs` and the vendored engine
  (`lib/fold.ts`), used for every re-fold in this receipt, at `71b3690`
  (v0.4.1).
- `patchwork-quilt/gitpp-app` — the App whose renderer produced the Checks
  (`worker.js`), and `docs/evidence/legibility.md`, the tone model for the
  limits section above.
- The Checks themselves, read through the check-runs API: `120167229259`
  (delivery control), `120167878842`, `120167858319`, `120167970357`,
  `120167861695`, `120167972654` (branch), `120168546255`,
  `120168762924`, `120169002367`, `120169246517`, `120169485033` (merge),
  `120170080462` (the referee's write-up commit), `121824647658` and
  `121825082829` (day-2 merges).

*Written 2026-11-03 by a build seat, from the repositories and the Checks
alone — no number in this file is taken on trust.*
