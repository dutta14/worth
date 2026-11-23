# Navigation: sidebar accordions

**Status:** Shipped. First-level sections moved from in-page tab bars into the sidebar.

## Decision

First-level sections live in the sidebar as accordions. Second-level views stay in the page, on the right of the page header.

- **First level (sidebar):** the sections of Planning, Wealth and Cashflow. Each of these three sidebar items is an accordion group with sub-items.
- **Second level (in page, right side):** controls that change the view of one section. Examples: Wealth Dashboard data-view tabs, Allocation Breakdown / My Allocation, Growth Savings / Income, Cashflow M / Q / H and Aggregated / Detailed. These did not move.
- Home, Drive, User Guide and Settings have no sections, so they remain plain links.

Why: the page header carried two tab bars (first level on the left, second level on the right), which made the hierarchy hard to read and pushed the page title and controls around. The sidebar already names the top-level areas, so the sections belong under them. Each section is now reachable and visible from anywhere without first opening its parent page.

## Groups and routes

The single source of truth is `src/components/sidebarNavConfig.ts` (`NAV_GROUPS`). The sidebar renders from it and route matching lives next to it, mirroring how the old tab bars derived their active tab.

| Group (page) | Sub-item | Path | Also active on |
|---|---|---|---|
| Planning (`goal`) | Goals | `/goal/plans` | `/goal`, `/goal/plans/:id` |
| | Leverage | `/goal/leverage` | |
| | Pay Down | `/goal/paydown` | |
| | FIRE Calculator | `/goal/calculator` | |
| | Taxes | `/taxes` | `/taxes/*` |
| Wealth (`net-worth`) | Dashboard | `/net-worth/dashboard` | `/net-worth/dashboard/*` and any `/net-worth` path no other sub-item claims |
| | Allocation | `/net-worth/allocation` | `/net-worth/allocation/*` |
| | Growth | `/net-worth/growth` | `/net-worth/growth/*` |
| | Review | `/net-worth/review` | `/net-worth/review/:year` |
| Cashflow (`budget`) | Overview | `/budget/cashflow` | `/budget`, any `/budget/*` not claimed below |
| | Spreadsheet | `/budget/spreadsheet` | |
| | Groups | `/budget/groups` | |
| | Transactions | `/transactions` | `/transactions/*` |

Which group is active still comes from `currentPage` in `App.tsx`. The active sub-item comes from the pathname.

## Behavior

- **Header:** one `<button>` per group with the group name as its accessible name, `aria-expanded`, `aria-controls` (set while the list is rendered) and a decorative chevron that rotates when open (disabled under `prefers-reduced-motion`).
- **Click when the route is outside the group:** navigate to the group's default sub-item (Goals, Dashboard, Overview) and expand the group.
- **Click when the route is inside the group:** toggle expanded or collapsed, no navigation.
- **Sub-items:** a `<ul>` of real links (`href`, so open in new tab and copy link work). Rendered only while expanded, so collapsed items are not focusable. The active one has `aria-current="page"`; the group header of the active group has `aria-current="true"`. Exactly one element has `aria-current="page"`.
- **Auto-expand:** the group containing the current route expands whenever the route enters it (deep links, search results, in-page links). Groups are independent, so several can be open.
- **Persistence:** open groups are stored in localStorage under `sidebar-open-groups` (validated list of group ids; corrupt or unknown values are ignored). The first run has only the active group open. On load the active group is always open.
- **Collapsed rail (56px):** only group icons are shown, with the existing `title` tooltip. No chevrons or sub-items. Clicking a group icon navigates to its default sub-item unless the route is already inside the group.
- **Mobile (overlay sidebar):** following a link or a header click that navigates closes the sidebar. A header click that only toggles does not.
- **Keyboard:** Enter and Space toggle a header; Tab goes header, its sub-items (when open), then the next item. Focus stays on the activated link because the sidebar does not remount on navigation.

## Page headers after the change

Planning, Wealth, Cashflow and Transactions page headers keep their `h1` and their right-side controls. The left tab bar, `PlanningTabs`, `CashflowTabs`, `src/styles/SectionTabs.css` and the focus-restoration state that existed only because switching tabs remounted pages were removed.

## Out of scope

- Second-level controls (see above).
- Sidebar search, Home, Drive, User Guide, Settings.
- Changing any route, redirect or deep link.

## Tests

- Unit: `src/components/SidebarNavigation.test.tsx`, `src/components/sidebarNavConfig.test.ts`, `src/App.test.tsx` (mobile close behavior), `src/utils/storage.test.ts`.
- E2E: `e2e/sidebar-accordion.spec.ts` plus the page objects in `e2e/pages/`.
