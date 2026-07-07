# Contributing — Dealer Intelligence Platform (Data Pipeline)

How our team works on this code. We contribute to the platform via a **fork**
(we have read-only access to the main repo), integrate on one branch, and hand
it up to the maintainer as a single pull request.

## Who's who

| Role | Person | Responsibility |
|------|--------|----------------|
| Maintainer (upstream) | Muthukumar | Owns `main` on the platform repo; reviews/merges our PR |
| Integrator / lead | Chirag | Owns `integration/data-pipeline`; reviews team PRs; raises the PR upstream |
| Developers | Asma, Mohana | Build features on `feat/*` branches |

## Repo model

- **`upstream`** — the main platform repo (read-only for us).
- **`origin`** — our fork (we have write access). All work happens here.
- **`integration/data-pipeline`** — our shared branch on the fork; the single branch handed upstream.
- Our fork's **`main`** is just a clean mirror of `upstream/main` — never develop on it.

```
feat/* (Asma, Mohana)  ──PR──►  integration/data-pipeline (Chirag)  ──PR──►  upstream/main (Muthukumar)
```

## First-time setup

```bash
# clone OUR fork (ask Chirag for the URL + collaborator access first)
git clone https://github.com/<fork-owner>/<repo>.git
cd <repo>

# add the upstream remote (read-only) so we can sync
git remote add upstream https://github.com/<maintainer>/<repo>.git
git fetch upstream

# local environment (any Python 3.x; no version constraint)
python -m venv .venv
source .venv/Scripts/activate             # Windows Git Bash
pip install psycopg2-binary

# local config — copy the template and set YOUR Postgres creds
cp .env.example .env        # then edit PGPASSWORD etc. NEVER commit .env

# smoke test
./run_demo.sh
```

## Branch naming

```
feat/<area>-<name>     e.g. feat/ingestion-asma, feat/lead-scoring-mohana
fix/<area>-<name>      bug fixes
chore/<what>           tooling, deps, docs
```

Keep branches small and short-lived — one feature per branch.

## Day-to-day flow

```bash
# always start from the latest integration branch
git checkout integration/data-pipeline
git pull origin integration/data-pipeline

# create your feature branch
git checkout -b feat/ingestion-asma

# ...code... then
git add -p
git commit -m "Add events source ingestion"
git push -u origin feat/ingestion-asma
```

Then open a PR on GitHub:
- **base = `integration/data-pipeline`**, compare = your `feat/*` branch
- request **Chirag** as reviewer
- merge only after review + green checks

## Keeping in sync (do this often)

The maintainer's `main` moves. The lead syncs the integration branch every few days:

```bash
git checkout integration/data-pipeline
git fetch upstream
git merge upstream/main        # merge (not rebase) on the shared branch
git push origin integration/data-pipeline
```

Developers: after the lead syncs, rebase your feature branch on the updated integration branch to stay current:

```bash
git checkout feat/ingestion-asma
git fetch origin
git rebase origin/integration/data-pipeline
```

## Handoff upstream (lead only)

When a milestone is ready, open a PR on GitHub:
- **base repo = upstream, base = `main`**
- **head = our fork's `integration/data-pipeline`**

Muthukumar reviews and merges. That single PR is the handoff.

## Rules

- **Never commit secrets.** `.env` is git-ignored; only `.env.example` is tracked. If a secret is ever committed, rotate it and rewrite history.
- **PRs go into `integration/data-pipeline`**, never directly to `upstream/main`.
- **Tests green before merge** — `python -m unittest bridge.test_mapping` and `./run_local.sh` must pass.
- **Small PRs** — easier to review, fewer conflicts.
- **Don't develop on `main`** (ours or upstream's).
