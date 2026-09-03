# CI/CD Workflows

## Architecture

```
check.yml   workflow_call → check: format · lint · typecheck · knip · unit tests
                                   · build → Codecov upload
                          → e2e:   Playwright smoke (parallel with check)
pr.yml      pull_request  → check.yml → auto-merge (Dependabot)
deploy.yml  push to main  → check.yml → build (BASE_PATH) → deploy to GitHub Pages
```

`check.yml` is a reusable (`workflow_call`) workflow holding the single definition of
"did this tree pass" — everything `pnpm run check` covers locally, e2e included,
which is the equivalence to preserve when adding anything: a check belongs in
both or in neither. Both other workflows call it, so a PR and a `main` push are
held to the same bar and the list cannot drift between them. `check` runs each
check as its own step, rather than chaining them into one command — so the
failing step names itself in the Actions UI, and the steps are conditioned to
keep going after one fails, so a single run reports every failure instead of
stopping at the first. (They do stop depending on a successful `pnpm install`,
which would otherwise red all of them at once.) Note that `package.json`'s
`pnpm run ci` is **not** what runs here, despite its name: it is the one-command
form the Cloudflare Pages build uses, and `pnpm run check` is the local
repairing counterpart. Neither is this workflow's copy of the gate — nothing in
CI stands these steps up as a single script, which is the whole point.

The Playwright suite is a second job inside `check.yml` rather than more steps on
`check`, so it runs in parallel with the rest and a failure still says `e2e`
instead of hiding inside a long step list. It builds its own `dist`, since a
separate runner has none to reuse — which is why `E2E_SKIP_BUILD`, the local
chain's shortcut, has no counterpart in CI.

`pr.yml` gates pull requests with `check.yml`; `deploy.yml`
verifies and ships to GitHub Pages on every push to `main`. It calls `check.yml`
first — so a commit pushed straight to `main`, never having been a PR, still gets
the full suite including e2e before it ships — then builds again in its own job.
That second build is not redundant work repeated for its own sake: what ships
needs `BASE_PATH` set for the project-site subpath, which the check build has no
reason to carry. The real cost of this layout is not that second build but the
gate itself: every `main` push — a Dependabot auto-merge included — now runs the
full suite with e2e, which the old deploy pipeline skipped. That double run per
merged PR is the price of holding a direct push to the same bar as a PR.

Neither file is called `ci.yml`, and that is the point: CI is not what tells them
apart — both run the same gate — so they are named for the event that starts them.
`pr.yml` therefore does not run on `main` pushes at all; `deploy.yml` handles that
commit, gate included. `check.yml` also takes a `workflow_dispatch`, so "run every
check against this ref" is available without going through either.

## Dependabot auto-merge → deploy

`pr.yml` merges a green Dependabot PR using `secrets.AUTOMERGE_TOKEN` (a dedicated
token, **not** the default `GITHUB_TOKEN`) so the resulting push to `main`
triggers `deploy.yml`. A push made with `GITHUB_TOKEN` would not — GitHub never
lets a `GITHUB_TOKEN` push start another workflow.

> `AUTOMERGE_TOKEN` must live in **Dependabot** secrets (Settings → Secrets and
> variables → Dependabot), not Actions secrets — Dependabot-triggered runs only
> see the Dependabot secret store.

`AUTOMERGE_TOKEN` is a fine-grained PAT scoped to this repository with
`contents: read/write` and `pull requests: read/write` permissions (or a classic
PAT with `repo` scope). The same PAT as InTheGreenYet's can be reused only if
its repository access list includes this repo. Fine-grained PATs expire (max
1 year) — an expired token makes auto-merge silently stop merging while CI
stays green, so track the expiry date. A red Dependabot PR (typically
peer-dependency skew) is left for a human; there is no auto-repair job.

## Coverage → Codecov

The `test:ci` step writes two reports — `coverage/lcov.info` and
`test-report.junit.xml` (test results) — and both are uploaded through
`codecov/codecov-action@v7`. Thresholds, PR comment and the ignore list live in
`codecov.yml`; the measured scope — `src/lib/**/*.ts` only, because there is no
component-test layer — is set in `vitest.config.ts`.

Both uploads live in `check.yml`, so every caller gets them: a PR uploads its own
reports through `pr.yml`, and the `main` baseline those are diffed against is the
upload from `deploy.yml`'s call — the only run of the suite on the default branch.

> `CODECOV_TOKEN` is an **Actions** secret (Settings → Secrets and variables →
> Actions) — unlike `AUTOMERGE_TOKEN`. A Dependabot PR therefore cannot read it, so
> the upload no-ops there; `fail_ci_if_error: false` on both steps is what keeps
> that from failing an otherwise green bump.

Both upload steps carry `if: ${{ !cancelled() }}` so a failing `Build` step still
ships the reports the tests already produced — on `main` in particular, dropping
them would leave the next PR diffed against a stale baseline.
