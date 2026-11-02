# Legibility, measured

The public receipt for the legibility claims in the git.pp design-partner
one-pager. Both measurements were taken on 2026-10-22 under a 9-point
scoring discipline: cold readers, given only the records and the report,
were scored on prediction items (name the winner, the value, and every
loser) and on comprehension/audit items. The road's bar was **≥90%**.

## Measurement 1 — state reports (Mapping A): 88.9%, bar missed

Score: **8.0/9 = 88.9% strict** — an honest miss, recorded as one.

In the night-ferry re-run, the hard prediction items (winner, value, all
three losers, from the records alone) were exact for the second
consecutive run, and the comprehension items went 4/4. The whole
shortfall was two half-point defects:

1. **Mechanism attribution.** A reader told an ancestry story over kind
   priority — the report did not make the rule order unmissable.
   *Fix:* a rule-order line went into both renderers (gitpp-action PR #3,
   gitpp-app PR #4, merged; gitpp-action tagged v0.2).
2. **A platform misconception.** A reader believed an admin could not
   make the Check required. *Fix:* the READMEs in both repos now state
   that an admin **can** make `git.pp state` a required check — the
   advisory stance is the app's choice, not a platform limit.

The tie-break was then micro-tested on a purpose-built record set
(relay-station — the first set with a genuine same-kind incomparable
tie): audit scored 5/5, but prediction scored only 0.5/4. That earned a
precision line in the report — ancestors are all transitive ancestors,
counted once each, excluding the record itself, with "intent ancestors"
defined (gitpp-action PR #4, gitpp-app PR #5, merged). The prediction
re-run scored **4/4**.

## Measurement 2 — surface reports (Mapping B): 94.4%, bar cleared

Score: **8.5/9 = 94.4%** — the road's ≥90% bar cleared, on the same
9-point discipline. The anchor question — can a cold reader tell what
the Check is anchored to — passed from both directions. Report-text
fixes were merged in gitpp-app PR #10 and gitpp-action PR #6; the live
proof is Check 120240907268.

## Source

The full record — scoring detail, the re-runs, and the surrounding M2
evidence — lives in `DECISIONS.md` in the project's R&D repository
(patchwork-quilt/cloudflare-next-git-rd), entries "2026-10-22 — M2 FIRST
PASS" and "2026-10-22 — R&D ROUND (post-M2)". This page is a faithful
summary of those entries; the numbers above are theirs, unrounded and
unimproved.
