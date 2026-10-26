# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

- `npm run dev` serves on http://localhost:3000.
- `npm run generate` after changing the API in `backend/http/api.ts`: writes `openapi.json` and from it the JS clients (`packages/js/src/generated/`, `app/_lib/api/`) and the Python client. All generated code is committed; CI fails when it is stale. Needs Node ≥ 22.18 (`.nvmrc`) and uv.

## Architecture

- `app/` is the Next.js UI and routes; all server logic is in `backend/` (ADR 0003), code used by both in `shared/`. Every POST is a backend route handler (ADR 0005).
- Storage is one interface, `backend/storage/types.ts`: file system (default), SQLite or PostgreSQL via Kysely, chosen by `NOTEFEED_STORAGE`. The contract suite `backend/storage/contract.ts` runs against every backend (ADR 0023); images go to the image store (ADR 0024).
- Use the words in `CONTEXT.md`, not its _Avoid_ ones.

## Production (notefeed.me)

- `../notefeed-stacks` (public): the server's compose files (notefeed, PostgreSQL 17, the Versity S3 gateway for images, Caddy) and the backup scripts `dump.sh` and `copy-images.sh`.
- `../notefeed-ansible` (private, secrets in an Ansible vault): provisions the Hetzner server, the dump timers and the restic copy to the Storage Box.
- `../infra-stacks` and `../infra-ansible` (3D-Bruckner): the shared monitoring server (Prometheus, Loki, Grafana, Uptime Kuma, Authentik) and noticebox, which receives the notefeed.me report forms.

## Tests

Run every test locally, as often as useful, always through `scripts/quiet.sh`: it keeps the whole output in a log file and prints only the failures, the summary and the log's path (about 30 lines whatever the run prints), so a long run costs little context. Time is cheap, tokens are not. Grep the log for details instead of rerunning.

- Unit tests, typecheck and lint: `scripts/quiet.sh npm test`, `scripts/quiet.sh npm run typecheck`, `scripts/quiet.sh npm run lint`.
- Client packages: `scripts/quiet.sh sh -c 'cd packages/js && npm ci && npm run build && npm test'` and `scripts/quiet.sh sh -c 'cd packages/python && uv run --locked --extra test pytest -q'`.
- e2e: `scripts/quiet.sh npm run test:e2e`.
- A single test run to debug one failure may go directly (`npx vitest run <path> -t <name>`, `npx playwright test -g <name>`); every broad run goes through `scripts/quiet.sh`.
- Docker builds are left to CI.

CI is still the gate, and I decide when a branch is finished and when it is merged. When a branch seems finished, ask me before doing anything with it: do not push it, open the PR or merge on your own. These rules override any skill (executing-plans, finishing-a-development-branch, ship-pr) that says to merge or finish on its own; a `/ccp:ship-pr` request is the go-ahead for push and PR only, not for the merge. When I say to, push it, open the PR and wait for CI (`gh pr checks <number> --watch`), then tell me the result and stop: I review the PR. Merge only when I say "merge". When I do, look at the CI status of the branch's latest commit: if it ran green, merge; do not run it again. Run CI and wait only if it has not run on the latest state; and if it is red, tell me which jobs and wait for my answer instead of merging. If something fails, read the failed job's log first (`gh run view <run> --log-failed`) and reproduce locally only when that is not enough.

## Releases

A `vX.Y.Z` tag is a release: see the `release` skill (`.claude/skills/release/SKILL.md`) before bumping versions or tagging.
Every release's notes go onto notefeed.me's reserved `releases` feed (https://notefeed.me/r/releases): CI posts them once the GitHub release exists; check, and post by hand when it did not.
When something changes for people who use notefeed (a release, a new plan, a change on notefeed.me), write a short post on the reserved `blog` feed (https://notefeed.me/r/blog), linking to the release; the skill says how.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`notefeed/notefeed`) with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels, unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root and ADRs in `docs/adr/`. See `docs/agents/domain.md`.
