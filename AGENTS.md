# Prompt Hub Agent Guide

Read `DO-NOT-DEPLOY.md` and `docs/RECONCILE-20260726.md` before changing the
Worker, database contract, payment flow, generation flow, or release tooling.

## Repository truth

- Final target repository: `D:\prompt-hub`.
- Historical production checkout: `D:\canvas\prompt-hub`.
- Both trees contain user-owned uncommitted work. Never overwrite one tree with
  the other or revert changes that are outside the current task.
- While either `DO-NOT-DEPLOY.md` marker exists, do not deploy, publish, remove
  the marker, apply production migrations, or build a production Worker image.

## Working and release discipline

- Use one branch and one Git worktree per task. Do not run parallel feature work
  from a shared dirty checkout.
- Build and deploy only from a reviewed, committed SHA with a clean worktree.
  Record that SHA in the release artifact and verify it through `/health` once
  the build-version field is implemented.
- Preserve the main tree's generation idempotency, atomic credit RPC wrappers,
  and unknown-outcome refund SLA when reconciling historical production code.
- Never add an unbounded retry to a paid operation. A replay requires a stable
  upstream idempotency key or an authoritative not-found result.
- Database migrations require a backup and explicit user authorization. The
  release migrations must run in timestamp order; see
  `docs/DEPLOY-CHECKLIST.md` for the current five-file sequence.

## Documentation freshness is a completion requirement

- A behavior-changing task is incomplete until code, tests, and every affected
  document in the matrix below agree.
- Never use a dated "current" claim as evidence by itself. Verify runtime code,
  tests, bindings, and migrations; correct stale documentation in the same task.
- Clearly label production behavior separately from undeployed candidate
  behavior. Update each operational document's verification date when its facts
  are rechecked.
- Do not copy an old document forward merely to preserve detail. Remove obsolete
  model names, retry rules, response fields, and test counts when they no longer
  describe the candidate release.

## Documentation matrix

Before marking a behavior-changing task complete, update the affected docs:

- API routes, Worker bindings, runtime configuration: `docs/BACKEND.md` and
  `docs/AI-HANDOFF.md`.
- Database schema, RPCs, wallet or membership accounting:
  `docs/DATA-MODEL.md`, `docs/DATA-SECURITY.md`, and
  `docs/MEMBERSHIP-CREDITS.md` as applicable.
- Frontend bundles, source ownership, or card/image loading:
  `docs/FILE-MAP.md`, `docs/FRONTEND-SPLIT-MAP.md`, and
  `docs/CARD-LOADING.md` as applicable.
- Monitoring, operational commands, or release flow:
  `docs/OPERATIONS-MONITORING.md` and `docs/DEPLOY-CHECKLIST.md`.
- Dual-tree status, deploy freeze, or source-of-truth changes:
  `docs/RECONCILE-20260726.md` and `DO-NOT-DEPLOY.md`.

Run `npm run check:docs` after documentation changes. Documentation and tests
are release prerequisites, not follow-up work.
