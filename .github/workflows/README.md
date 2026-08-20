# CI/CD Workflows

## Architecture

```
ci.yml      pull_request → check · e2e · dependency-review
                         → auto-merge (Dependabot) | jules-fix (on failure)
deploy.yml  push to main → build (check:ci) → deploy to GitHub Pages
                         → Codecov baseline upload (see below)
```

Two workflows: `ci.yml` gates pull requests (format, lint, typecheck, vitest,
build, Playwright e2e smoke, dependency review); `deploy.yml` builds and ships
to GitHub Pages on every push to `main`. The Pages deploy re-runs `check:ci`
itself, so a direct push to `main` is still verified before it ships.

`ci.yml` deliberately does **not** run on `main` pushes. It has nothing to add
there: `deploy.yml` already runs the same `check:ci` on that commit, and the PR
run already covered the tree — a second full chain per push would just double
the cost of every auto-merged Dependabot bump.

## Dependabot auto-merge → deploy

`ci.yml` merges a green Dependabot PR using `secrets.AUTOMERGE_TOKEN` (a dedicated
token, **not** the default `GITHUB_TOKEN`) so the resulting push to `main`
triggers `deploy.yml`. A push made with `GITHUB_TOKEN` would not — GitHub never
lets a `GITHUB_TOKEN` push start another workflow.

> `AUTOMERGE_TOKEN` and `JULES_API_KEY` must live in **Dependabot** secrets
> (Settings → Secrets and variables → Dependabot), not Actions secrets —
> Dependabot-triggered runs only see the Dependabot secret store.

`AUTOMERGE_TOKEN` is a fine-grained PAT scoped to this repository with
`contents: read/write` and `pull requests: read/write` permissions (or a classic
PAT with `repo` scope). The same PAT as InTheGreenYet's can be reused only if
its repository access list includes this repo. Fine-grained PATs expire (max
1 year) — an expired token makes auto-merge silently stop merging while CI
stays green, so track the expiry date.

The `jules-fix` job asks Google Jules to repair a failing Dependabot PR
(typically peer-dependency skew). It needs `JULES_API_KEY` in Dependabot
secrets; without it the job fails, which is harmless but noisy — delete the job
if Jules is not wanted here.

## Coverage → Codecov

`check:ci`'s `test:ci` step writes two reports — `coverage/lcov.info` and
`test-report.junit.xml` (test results) — and both are uploaded through
`codecov/codecov-action@v7`. Thresholds, PR comment and the ignore list live in
`codecov.yml`; the measured scope — `src/lib/**/*.ts` only, because there is no
component-test layer — is set in `vitest.config.ts`.

Which workflow uploads depends on the branch, and the split is the point:
`ci.yml`'s `check` uploads the PR's own reports, while the `main` baseline the
PR is diffed against comes from **`deploy.yml`**, because that is the only job
that runs `check:ci` on `main`. Reusing it means the baseline costs no extra CI
time; the trade is that the Codecov steps are duplicated across the two files,
so a change to one has to be mirrored in the other.

> `CODECOV_TOKEN` is an **Actions** secret (Settings → Secrets and variables →
> Actions) — unlike the two above. A Dependabot PR therefore cannot read it, so
> the upload no-ops there; `fail_ci_if_error: false` on both steps is what keeps
> that from failing an otherwise green bump.

Every upload step carries `if: ${{ !cancelled() }}` so a failure later in
`check:ci` (the `build` step) still ships the reports the tests already
produced — on `main` in particular, dropping them would leave the next PR with
a stale baseline.
