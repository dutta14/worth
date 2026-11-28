# Contributing

## Prerequisites

- Node.js 22+ (CI runs Node 22)
- npm

## Getting Started

```bash
git clone https://github.com/<your-username>/worth.git
cd worth
npm install
npm run dev
```

Dev server runs at `http://localhost:5173` with hot reload.

### Build & Deploy

```bash
npm run build      # Production build to dist/
npm run preview    # Preview production build locally
```

Deployment is automated: every push to `main` runs `.github/workflows/ci.yml`, which builds and deploys to GitHub Pages via `actions/deploy-pages` after CI + E2E pass.

## Project Structure

```
src/
├── App.tsx                  # Root component, routing, provider composition
├── main.tsx                 # React entry point
├── types.ts                 # Shared types (PageType, FinancialGoal, GwGoal, etc.)
├── components/              # Shared UI components
│   ├── SidebarNavigation    # Main nav; Planning, Wealth and Cashflow are accordions
│   ├── sidebarNavConfig     # Single source of truth for accordion groups, children and route matching
│   ├── SidebarToggle        # Mobile sidebar toggle
│   ├── SearchModal          # Global search (⌘K) with indexed navigation
│   ├── DataSafetyBanner     # Sticky alert for failed writes, stale files and lost permission
│   ├── ErrorBoundary        # Top-level error boundary with fallback UI
│   ├── TermAbbr             # Tooltip definitions for FI terms
│   └── UndoToast            # 10-second undo notification
├── contexts/                # React context providers (see Contexts section)
│   ├── SettingsContext      # Dark mode, appearance, labs
│   ├── FileStoreContext     # File System Access API integration and demo mode
│   ├── GoalsContext         # FI + GW goal CRUD and state
│   ├── LayoutContext        # Sidebar, mobile, search modal state
│   ├── DataContext          # Accounts and balances
│   └── SafetyNetContext     # Enables the data safety net for real folders; owns banner state
├── flags/                   # Feature flag system (see Feature Flags section)
│   ├── FlagContext.tsx      # Provider: fetches config, manages overrides
│   ├── flagSystem.ts        # Resolution logic (override > rollout > default)
│   ├── flagDefinitions.ts   # Flag names and defaults
│   └── useFlag.ts           # Hook: useFlag(FLAGS.NAME) → boolean
├── search/                  # Global search (⌘K)
│   ├── searchIndex.ts       # Builds the index of pages, goals and accounts
│   └── useSearchIndexData.ts # Gathers the data the index is built from
├── hooks/
│   ├── useProfile.ts        # Profile state (name, birthday, avatar, partner)
│   ├── useNow.ts            # Current Date, refreshed on focus and visibility (no timers)
│   ├── useFocusTrap.ts      # Focus trap for modals
│   ├── usePageHideFlush.ts  # Flushes pending writes on pagehide / tab hidden
│   ├── useDarkMode.ts, useChartColors.ts, useTouchDrag.ts
│   └── useDateFilter.ts, useGrowthSettings.ts, useLeverage.ts
├── pages/
│   ├── home/                # Dashboard with draggable cards
│   │   ├── Home.tsx
│   │   ├── GoalsPeek.tsx    # Top 3 goals with progress bars
│   │   ├── NetWorthSummary, MiniCharts, AllocationBreakdown
│   │   ├── CheckIn{Strip,Card}.tsx, checkInSnooze.ts  # Monthly check-in strip
│   │   └── WelcomeGuide.tsx # First-visit onboarding
│   ├── goal/                # FI goals + withdrawal goals
│   │   ├── Goal.tsx         # Goal list page
│   │   ├── components/      # GoalForm, GoalMixer, DetailPane, FilterBar,
│   │   │                    # TrajectorySparkline, TemplatePicker
│   │   ├── data/goalTemplates.ts  # Presets: Early Retirement, Coast FI, etc.
│   │   ├── hooks/           # useFinancialGoals, useGwGoals
│   │   └── utils/           # FI math, formatting
│   ├── data/                # Accounts, balances, charts; monthStatus.ts holds the pure month-state
│   │                        # rules (missing/partial/due/stale) used by Home and Details
│   ├── budget/              # CSV-based budget tracking; monthly targets live in
│   │                        # utils/budgetTargets*.ts, hooks/useBudgetTargets.ts,
│   │                        # components/BudgetTarget{Cell,Status}.tsx; the import wizard
│   │                        # (spec docs/specs/import-wizard.md) lives in import/
│   ├── review/              # Annual Review tab under Wealth;
│   │                        # pure selectors in utils/, hooks/useAnnualReview.ts, components/Review*.tsx
│   ├── allocation/          # Asset allocation & rebalancing
│   ├── taxes/               # Tax document management
│   ├── drive/               # Hierarchical file browser
│   ├── tools/               # No page of its own; holds the FI Calculator, Savings/Growth Tracker
│   │                        # and PDF-to-CSV components and math used by Planning and Wealth
│   ├── transactions/        # Transactions page and CSV import tools
│   ├── guide/               # In-app User Guide
│   └── settings/            # Settings modal (refactored package)
├── styles/                  # CSS files (one per component/page)
│   ├── colorThemes.css      # Base :root + body.dark variables
│   └── modern-design.css    # Design system: tokens, glass sidebar, pill tabs, tables, dark layering
├── utils/
│   ├── fileStoreTypes.ts    # FileStore interface (the contract every store must satisfy)
│   ├── fileStore.ts         # FileSystemFileStore — File System Access API implementation
│   ├── memoryFileStore.ts   # MemoryFileStore — in-memory implementation for tests and demo mode
│   ├── safetyNet.ts         # Data safety net: pure types and helpers (fingerprints, backup paths, issue list)
│   ├── backupManager.ts     # Data safety net: snapshot, list, prune and restore over a small RawIO interface
│   ├── csvUtils.ts          # CSV serialization / deserialization helpers
│   ├── balanceStorage.ts    # Balance read/write against the FileStore
│   ├── handlePersistence.ts # Saves and loads the FileSystemDirectoryHandle in IndexedDB
│   └── storage.ts           # Thin localStorage wrapper for UI preferences only
└── test/
    ├── setup.ts             # Vitest global setup (jsdom, testing-library matchers)
    └── fileStoreTestUtils.tsx  # FileStoreTestProvider and makeFileStoreValue helpers
```

## Architecture Notes

### Data Storage

All financial data is stored as plain files in a folder the user chooses on their own disk, using the browser's File System Access API. The central abstraction is the `FileStore` interface in `src/utils/fileStoreTypes.ts`. There are two implementations:

- `FileSystemFileStore` (`src/utils/fileStore.ts`) — the production implementation. Backed by a `FileSystemDirectoryHandle`. Writes are debounced 300ms and guarded with `navigator.locks` so concurrent tabs never interleave. Cross-tab cache invalidation uses a `BroadcastChannel`.
- `MemoryFileStore` (`src/utils/memoryFileStore.ts`) — an in-memory implementation used for tests and Demo Mode.

#### Data safety net

Spec: `docs/specs/data-safety-net.md`. All protection lives in `FileSystemFileStore`, so the roughly 30 `.catch(console.error)` call sites need no change.

- **Inert until enabled.** The store behaves exactly as before (300ms debounce, no checks, no copies) until `configureSafety({ enabled: true })` is called. `SafetyNetProvider` (`src/contexts/SafetyNetContext.tsx`) does that, and only enables a store for a real folder, never in Demo Mode. The store is configured from this child provider.
- **Optional interface.** `SafetyNetStore` and `isSafetyNetStore()` live in `src/utils/fileStoreTypes.ts`. The `FileStore` contract is unchanged and `MemoryFileStore` never implements the safety API, so Demo Mode and e2e tests cannot touch a real folder.
- **What it does when enabled.** The debounce drops to 120ms. `usePageHideFlush` starts `flush()` on `pagehide` and `visibilitychange` (hidden) and asks the browser to confirm leaving only while `hasUnsavedWork()`; this is best effort, a hard close can still lose a write. A failed write keeps the edit in memory and raises a banner with a retry. Permission loss is detected on focus and offers a reconnect. A JSON file that does not parse is never overwritten: the bytes are copied to `<path>.corrupt-<stamp>` and writes to it are held until the user chooses Restore latest backup or Start fresh. On focus (throttled to every 5s) the store compares each loaded file's `lastModified` and size, then a content hash only on an mtime-only mismatch, with what this tab last read or wrote; a changed file is `stale` and writes to it are held until the user chooses Reload or Keep my version. CSV corruption is not detected, and new files appearing in a directory are only caught by the delete guard.
- **Backups.** `backupManager.ts` copies a JSON or CSV file to `_backups/` before it is overwritten or deleted: once per file per session, then at most every 6 hours, skipping bytes identical to the newest copy, always before a delete, restore or Keep my version. The newest 10 copies per file are kept (`BACKUPS_PER_FILE`). A failed copy sets `backupsHealthy` and never blocks the user's write.
- **UI.** `DataSafetyBanner` is a single sticky `role="alert"` region; the Backups list and restore live in `BackupsSection`, rendered in Settings → Data Folder. Styles use the `dsn-` prefix in `src/styles/DataSafetyNet.css`. After Reload the provider remounts the app shell through `key={epoch}` and dispatches `data-changed`.
- **Writing code that uses the store.** Keep `.catch(console.error)`; held writes reject with `FileStoreError` (`stale-blocked`, `corrupt-blocked`, `unseen-file`). Queue every write before awaiting any I/O (see `saveBalances`) so a page-hide `flush()` sees all of them.

`FileStoreContext` (`src/contexts/FileStoreContext.tsx`) owns the active store instance and exposes `pickFolder`, `disconnect`, `enterDemo`, and `exitDemo`. Components get the store via `useFileStore()`.

The chosen folder handle is persisted in IndexedDB via `src/utils/handlePersistence.ts` so the browser can reconnect on the next visit without re-prompting.

**File layout inside the chosen folder:**

| Path                                | Content                                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `profile.json`                      | Name, birthday, partner                                                                                                                                                                                                  |
| `accounts.json`                     | Account definitions                                                                                                                                                                                                      |
| `balances/{year}.csv`               | Monthly balances (columns: `month,accountId,balance`)                                                                                                                                                                    |
| `transactions/{year}/{yyyy-mm}.csv` | Budget transactions per month                                                                                                                                                                                            |
| `budget/categories.json`            | Category groups and tracked years                                                                                                                                                                                        |
| `budget/import-formats.json`        | Saved CSV import column formats                                                                                                                                                                                          |
| `budget/category-rules.json`        | Import categorization rules (`{ schemaVersion, rules }`)                                                                                                                                                                 |
| `budget/summary-cache.json`         | Derived savings-rate summary                                                                                                                                                                                             |
| `budget/targets.json`               | Monthly targets per expense group, keyed by group id                                                                                                                                                                     |
| `goals.json`                        | `{ financialGoals, gwGoals }`                                                                                                                                                                                            |
| `_backups/`                         | Safety copies, `_backups/{path without extension}/{yyyymmddThhmmssmmmZ}[-unsaved].{json,csv}`, plus a `README.txt`. Created before a file is overwritten or deleted; the newest 10 per file are kept. No loader reads it |
| `{path}.corrupt-{stamp}`            | Byte-for-byte copy of a JSON file that failed to parse, saved next to the original No loader reads it                                                                                                                    |
| `taxes/{year}.json`                 | Tax checklist for that year                                                                                                                                                                                              |
| `taxes/templates.json`              | Reusable tax checklists                                                                                                                                                                                                  |
| `taxes/{year}/files/{filename}`     | Uploaded tax documents                                                                                                                                                                                                   |
| `allocation.json`                   | Custom allocation ratios                                                                                                                                                                                                 |
| `fi-simulations.json`               | Saved FI calculator simulations                                                                                                                                                                                          |
| `leverage.json`                     | Leverage tool data                                                                                                                                                                                                       |
| `savings-tracker-overrides.json`    | Savings/growth tracker manual overrides (also read, never written, by the Annual Review)                                                                                                                                 |
| `paydown-loans.json`                | Loan paydown tool data                                                                                                                                                                                                   |

**UI preferences in `localStorage` (not financial data):**

`darkMode`, `accentTheme`, `allowCsvImport`, `goal-view-mode`, `home-card-order`, `onboarding-dismissed`, `checkin-snooze`, `lab-pdf-to-csv`, and the feature-flag keys (`flag-rollout-cache`, `flag-overrides`, `flag-client-id`).

### Styling

- One CSS file per component/page in `src/styles/`.
- Dark mode via `body.dark` class.
- **Design system** — `modern-design.css` is always on. Includes Inter font (loaded in `index.html`), translucent borders, composite shadows, premium inputs, dark surface layering, glass sidebar, pill tabs, accent glow, and borderless tables. See [Design System](#design-system).
- Accent theming via `--accent` and `--accent-rgb` CSS custom properties.
- `colorThemes.css` contains only base `:root` and `body.dark` variables (the 9-color theme picker was removed).
- Responsive breakpoints: desktop (1200px+), tablet (768–1199px), mobile (≤900px sidebar collapse).

### Events

Custom DOM events for cross-component communication:

| Event                     | Source                                          | Purpose                                           |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------- |
| `data-changed`            | SafetyNetContext, useAnnualReview               | `DataContext` reloads accounts and balances       |
| `budget-changed`          | budgetStorage, TransactionImportTools           | Budget and Transactions refresh                   |
| `tax-store-changed`       | useTaxStore                                     | Tax checklist views refresh                       |
| `allocation-changed`      | allocation utils                                | Allocation views refresh                          |
| `tools-changed`           | FICalculator, SavingsGrowthTracker, useLeverage | Planning and Wealth views pick up saved tool data |
| `growth-settings-changed` | useGrowthSettings                               | Growth views pick up new settings                 |
| `labs-changed`            | LabsPane                                        | Refreshes feature gates for lab features          |

## Scripts

| Command                 | Description                                |
| ----------------------- | ------------------------------------------ |
| `npm run dev`           | Start dev server                           |
| `npm run build`         | Production build                           |
| `npm run preview`       | Preview production build                   |
| `npm test`              | Vitest in watch mode                       |
| `npm run test:run`      | Single test run (used in CI)               |
| `npm run test:coverage` | Test run with coverage report              |
| `npm run lint`          | ESLint check                               |
| `npm run lint:fix`      | ESLint auto-fix                            |
| `npm run format`        | Prettier write                             |
| `npm run format:check`  | Prettier check (used in CI)                |
| `npm run typecheck`     | TypeScript check (used in CI and pre-push) |

## Contexts

`App.tsx` composes all providers in a fixed nesting order:

```
FileStoreProvider → SettingsProvider, LayoutProvider → (FileStoreGate) →
GoalsProvider → DataProvider → FlagProvider → SafetyNetProvider → AppShell
```

Each context lives in `src/contexts/` and exports a provider + a `useXxx()` hook. Components consume state via the hooks (e.g., `useSettings()`, `useGoals()`, `useFileStore()`, `useLayout()`). Never access context values directly — always use the exported hook.

## Feature Flags

The flag system in `src/flags/` controls runtime feature rollout:

1. **Config** — `feature-flags.json` at repo root. Deployed as a static file. Fetched publicly (no auth) on app load. Admin writes (updating rollout %) require GitHub auth.
2. **Resolution order** — local override → rollout percentage → default value. Each browser gets a stable random id (`flag-client-id` in localStorage), hashed with the flag id for consistent percentage bucketing.
3. **Usage** — `const enabled = useFlag(FLAGS.SOME_FLAG)` in any component.
4. **Adding a flag** — Define in `flagDefinitions.ts` with `defineFlag()`, add rollout config to `feature-flags.json`. The registry is empty today; the two files must list the same flag ids (a test enforces it).
5. **Local override** — Set `flag-overrides` in localStorage (JSON object of `{ "flag-name": true/false }`) for development/testing.
6. **Retired flags** — The flags used while building the monthly check-in, annual review, category budget targets, data safety net, import wizard and modern design have been removed; those features are permanent.

## Design System

All design-system styles live in `src/styles/modern-design.css` and apply to the whole app; there is no flag or body class.

- Selectors start with `:root body` (for example `:root body .tab-btn`, `:root body.dark .sidebar`). That gives them the specificity needed to override the per-page stylesheets, which load after it. Don't shorten the prefix to `body`.
- Tokens (`--shadow-*`, `--fs-*`, `--radius`, translucent `--color-border`) are defined on `:root body` and `:root body.dark` in that file; use them instead of hard-coded values.
- When you add a component, style it in its own page stylesheet and use the tokens. Only put cross-cutting rules in `modern-design.css`.

## Testing

Around 258 test files under `src/`, using **Vitest** + **@testing-library/react** + **jsdom**.

### Running tests

```bash
npm test               # Watch mode (development)
npm run test:run       # Single run (CI, pre-commit)
npm run test:coverage  # With coverage report
```

### Writing tests

- Co-locate test files with source: `Component.test.tsx` next to `Component.tsx`.
- Use `@testing-library/react` queries (`getByRole`, `getByText`, `getByLabelText`).
- Global setup in `src/test/setup.ts` (jsdom, `@testing-library/jest-dom` matchers).
- Mock network requests with `msw` when testing flag fetching.
- Test file naming: `*.test.ts` or `*.test.tsx`.
- Playwright: `e2e/import-wizard.spec.ts` never hardcodes a port or origin, so it runs unchanged against `vite preview` at `/worth` in CI. `e2e/monthly-check-in.spec.ts` pins the clock with `page.clock.setFixedTime`.

**Seeding data in tests:** Do not seed `localStorage` for financial data. Use a `MemoryFileStore` and wrap the component under test with `FileStoreTestProvider`:

```tsx
import { FileStoreTestProvider, makeFileStoreValue } from '../test/fileStoreTestUtils'

const store = new MemoryFileStore()
// write your seed data into store before rendering
render(
  <FileStoreTestProvider value={makeFileStoreValue({ fileStore: store })}>
    <ComponentUnderTest />
  </FileStoreTestProvider>,
)
```

`makeFileStoreValue` accepts partial overrides and fills in sensible defaults for `isReady`, `folderName`, and the callback functions.

## CI/CD

### GitHub Actions (`.github/workflows/ci.yml`)

Runs on every push and PR to `main`. Two jobs:

1. **`build`** — `npm ci` → `npm audit --audit-level=high` → Prettier check → ESLint (`--max-warnings=0`) → Vitest → `vite build`. On push to main, uploads the `dist/` artifact for Pages.
2. **`deploy`** — Runs only on push to `main`, after `build` passes. Deploys to GitHub Pages via `actions/deploy-pages@v4`.

**Setup required:** Repository Settings → Pages → Source = "GitHub Actions".

### Pre-commit hook (`.husky/pre-commit`)

Runs automatically before each commit:

1. `npm audit --audit-level=high`
2. `npx prettier --check src/`
3. `npx eslint src/ --max-warnings=0`
4. `npx tsc --noEmit`
5. `npx vitest run`

### Deployment

Deployment is automated. Every push to `main` triggers `.github/workflows/ci.yml`, which runs lint + unit tests + build + E2E, then deploys to GitHub Pages via `actions/deploy-pages`. No manual deploy step is needed.

## Commit Conventions

- Use [Conventional Commits](https://www.conventionalcommits.org/) style: `feat:`, `fix:`, `docs:`, `chore:`, etc.
- To auto-close a GitHub issue, include `Fixes #N` in the commit **body** (not just `(#N)` in the subject line).
- The pre-commit hook enforces lint, format, and test passing — commits will fail if any check does not pass.

## Regenerating Screenshots

The `docs/screenshots/` directory contains 19 PNGs that are embedded in the README and the GitHub wiki. They are committed to the repo and serve as the source of truth for documentation — even though the files are several hundred KB each, this is intentional.

### When to regenerate

- Any UI change that affects a captured screen (Home, Goals, FIRE Calculator, Wealth, Annual Review, Cashflow, Transactions, Taxes, Drive, Settings, or the folder picker / add-account onboarding states)
- Any change to the README or wiki that surfaces a different feature or flow
- New release builds where the screenshots have drifted from the current visual design

### How to regenerate

```bash
npm run dev          # in one terminal
npm run screenshots  # in another terminal
```

`scripts/capture-screenshots.ts` seeds a fixed fake persona ("Avery Chen") into the same `MemoryFileStore` the e2e tests use (via `_e2eMode` and `window.__e2eSeedData`) and uses Playwright to capture each screen at 1440×900 @ 2× device scale. The browser clock is pinned to June 1, 2025 so the seeded May-2025 data is "last month" regardless of when the script is run. All 19 PNGs land in `docs/screenshots/`.

Pass a name to capture one image (`npx tsx scripts/capture-screenshots.ts home-light`). If the dev server picked another port, set `APP_URL` (for example `APP_URL=http://localhost:5174/worth/`).
