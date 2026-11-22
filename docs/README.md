# Docs

Internal documentation for worth. The user-facing README lives at the repo root.

## Layout

- **`specs/`** — feature and design specs (architecture decisions, UI specs, redesigns)
  - `encryption-ui.md` — **superseded** — passphrase / unlock / lock screen design (removed in the File System Access migration)
  - `feature-flags-architecture.md` — flag resolution, rollout, override model
  - `goal-drawer.md` — goal detail drawer spec
  - `goals-page-redesign.md` — Goals page IA + visual redesign
  - **Shipped features** (each was built in PR-sized slices behind a temporary feature flag, since removed; see each spec's Status line):
    - `data-safety-net.md` — built and shipped: flush pending writes, visible save failures, corrupt-file protection, external-change detection, `_backups/` (priority 1)
    - `monthly-check-in.md` — guided monthly balance update, missing/stale data detection, "Partial month" handling (priority 2); built and shipped
    - `import-wizard.md` — CSV column mapping, categorization rules, duplicate guard, month splitting (priority 3); built and shipped, with the Playwright and accessibility suite in `e2e/import-wizard.spec.ts`
    - `category-budget-targets.md` — monthly targets per category group with budget-vs-actual (priority 4)
    - `annual-review.md` — one-page printable year in review with CSV download (priority 5; built and shipped)
- **`planning/`** — sprint plans, test coverage plans, roadmap docs
  - `sprint-plan.md`
  - `test-coverage-plan.md` — **partially superseded** — items covering EncryptionContext, GitHubSyncContext, ImportExportContext, and IndexedDB patterns no longer apply; see CONTRIBUTING.md for current testing guidance
- **`ideas/`** — informal idea capture (see `ideas/README.md` for the drop-in workflow)
  - `github-sync-ux-audit.md` — **superseded** — GitHub Sync was removed in the File System Access migration
- **`screenshots/`** — PNGs embedded in the root `README.md` (regenerated via `scripts/capture-screenshots.ts`)
