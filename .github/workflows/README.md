# CI/CD Workflows

## Architecture

```
ci.yml      pull_request → check · e2e · dependency-review
                         → auto-merge (Dependabot) | jules-fix (on failure)
deploy.yml  push to main → build (check:ci) → deploy to GitHub Pages
```

Two workflows: `ci.yml` gates pull requests (format, lint, typecheck, vitest,
build, Playwright e2e smoke, dependency review); `deploy.yml` builds and ships
to GitHub Pages on every push to `main`. The Pages deploy re-runs `check:ci`
itself, so a direct push to `main` is still verified before it ships.

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
