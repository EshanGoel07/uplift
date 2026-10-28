# Phase log

Built for the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026).

## Phase 0: budget guard (Oct 27–28)

- `tools/budget_guard/`: a local proxy that hard-caps API spend, meters every call,
  and refuses any non-Meta model (hackathon rule: Meta models only at runtime).
  `guarded_muse.py` reserves each Muse Code run's worst-case cost before it starts.
- Tested against fake APIs: the cap is never exceeded, including under 40
  concurrent calls and 10 concurrent agent runs.

## Phase 1a: tasks, split, risk map (Oct 28–29)

- `uplift tasks load`: 294 pre-validated sqlglot tasks from SWE-rebench (each has
  `FAIL_TO_PASS` tests and a Docker image).
- `uplift tasks split`: the newest 40 tasks are the **test** set (from 2024-10-31),
  and the 40 before them are **dev**. The snapshot the setup may learn from is
  `e81789ee9a58` (2024-10-30).
- **Leakage check:** 0/40 test fixes are present in the snapshot. Positive
  control: 22/40 *dev* fixes are detected as present, so the check really fires.
  It initially reported 0/40 for both because of a relative-path bug, which the
  control caught.
- `uplift risk`: 4,670 commits (1,776 fixes) before the snapshot, SZZ-lite over
  the newest 200 fixes, 24 co-change rules, and a source→test mapping for 27 files.
- **Held-out check of the risk map:** 70 of the 80 source files changed by
  test-period fixes (88%) were in the map's top-20% risk set. Caveat: sqlglot's
  changes concentrate in a few core files; compare against an edit-count baseline
  before claiming this.
