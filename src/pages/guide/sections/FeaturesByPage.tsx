import { FC } from 'react'
import GuideFigure from '../components/GuideFigure'

interface FeaturesByPageProps {
  screenshots: {
    home: string
    goals: string
    netWorth: string
    budget: string
    transactions: string
    taxes: string
    drive: string
    allocation: string
    growth: string
    settings: string
  }
}

const FeaturesByPage: FC<FeaturesByPageProps> = ({ screenshots }) => (
  <section className="guide-section" id="features-by-page">
    <h2>Features, by page</h2>

    <section className="guide-subsection" id="feature-home">
      <h3>Home</h3>
      <GuideFigure src={screenshots.home} alt="Home dashboard with summary cards" />
      <p>
        Your dashboard. A quick read on where things stand right now, without opening six tabs or a spreadsheet you have
        to mentally parse before coffee.
      </p>
      <h4>How to use it</h4>
      <ul className="guide-bullet-list">
        <li>Glance at current net worth and the delta from the previous month.</li>
        <li>Flip through the mini charts for Net Worth, FI vs GW, and Assets vs Liabilities.</li>
        <li>Use the goals peek to see which targets are on pace and which ones are drifting.</li>
        <li>Check the allocation bar to see where your money is actually sitting today.</li>
        <li>Drag and reorder the cards until the page matches the way you think.</li>
        <li>
          A check-in strip above the cards tells you when the latest month is missing balances or your data is getting
          old. One click opens the balance form for that month, and you can snooze the reminder for 7 days.
        </li>
      </ul>
      <p>
        <strong>One tip:</strong> Put the card you check most often in the top-left slot. The dashboard remembers the
        order, and the right first glance matters more than one more chart.
      </p>
    </section>

    <section className="guide-subsection" id="feature-goals">
      <h3>Planning</h3>
      <GuideFigure src={screenshots.goals} alt="Planning page with goals and FI calculator" />
      <p>
        Two modes live here: concrete plans and a more abstract FI calculator. One keeps you honest about named goals.
        The other answers the older, quieter question of when work becomes optional.
      </p>
      <h4>How to use it</h4>
      <ul className="guide-bullet-list">
        <li>Use the Plans tab for savings or investment goals with target amounts and dates.</li>
        <li>Duplicate a goal when you want to try a more conservative or more aggressive version.</li>
        <li>Reorder goals so the ones that matter this year stay near the top.</li>
        <li>Mix and match goals to see how they stack together.</li>
        <li>Use the Calculator tab to estimate years to financial independence from savings rate and expenses.</li>
      </ul>
      <p>
        <strong>One tip:</strong> Create one practical goal and one aspirational one. A near-term emergency fund and a
        long-term FI target make the page useful in two different time horizons.
      </p>
    </section>

    <section className="guide-subsection" id="feature-net-worth">
      <h3>Wealth</h3>
      <GuideFigure src={screenshots.netWorth} alt="Wealth page with accounts and growth chart" />
      <p>
        This is the spine of the app. The Accounts tab gives you the raw history, Allocation turns it into portfolio
        shape, and Growth lets you connect balances to income, expenses, and savings rate.
      </p>
      <h4>How to use it</h4>
      <ul className="guide-bullet-list">
        <li>In Accounts, add accounts and enter monthly balances over time.</li>
        <li>
          Details opens a guided entry for the month. Amounts are copied from the last month, every account you have not
          touched is marked, and a month with missing balances is labelled Partial month and left off the trend charts
          until it is complete.
        </li>
        <li>Switch between chart view and spreadsheet view depending on whether you want trend or detail.</li>
        <li>Hover chart points to see deltas and how a month changed relative to the prior one.</li>
        <li>Filter the accounts table when you want to isolate cash, retirement, debt, or other slices.</li>
        <li>In Allocation, create custom ratio tabs for your ideal asset mix.</li>
        <li>In Growth, log yearly income, expenses, and savings to keep the balance history grounded in behavior.</li>
        <li>
          The Review tab shows one year at a glance. Pick a year to see net worth, income, expenses, savings rate, top
          spending groups, and goal progress on one page, then print it, save it as a PDF, or download it as a CSV.
          Anything missing from your files is listed under Things to know.
        </li>
      </ul>
      <p>
        <strong>One tip:</strong> Use Accounts for what happened, Allocation for what you want, and Growth for why the
        gap exists. The three tabs make more sense when you think of them as history, target, and explanation.
      </p>
    </section>

    <section className="guide-subsection" id="feature-budget">
      <h3>Cashflow</h3>
      <GuideFigure src={screenshots.budget} alt="Cashflow page with categorized transactions" />
      <p>
        A year-based cash flow workspace that is more interested in patterns than ceremony. Import bank CSVs, clean them
        up, and look at spending from different distances.
      </p>
      <h4>How to use it</h4>
      <ul className="guide-bullet-list">
        <li>Pick a year and import bank or card CSVs, or enter transactions manually.</li>
        <li>Use the Detailed view for category-by-category breakdowns inside each group.</li>
        <li>Switch to Aggregated when you only want group totals.</li>
        <li>Use Overview to read income against expenses over time.</li>
        <li>Change the period between monthly, quarterly, and half-yearly views.</li>
        <li>
          Set a monthly target per expense group in the Aggregated view of Spreadsheet and see how each period compares.
        </li>
        <li>Use the built-in PDF → CSV converter when the bank only gives you a statement PDF.</li>
        <li>
          Import a bank CSV with any column names. Importing a bank CSV takes three steps. Choose which column is the
          date, description and amount, and whether spending is negative. Check the review, which lists new rows,
          duplicates it will skip and rows it could not read. Then import. Rows go into the month their date belongs to,
          whatever the file is called, and Undo import puts the old files back. Worth remembers the mapping for the next
          file from the same bank.
        </li>
        <li>
          Rules sort transactions for you. A rule says that a description containing, say, Starbucks belongs in Dining.
          The first matching rule wins, rules run on every import, and you can reorder, turn off or delete them from
          Rules on the Transactions tab.
        </li>
      </ul>
      <p>
        <strong>One tip:</strong> Start in Aggregated view the first time you import a messy file. It lets you find the
        categories that matter before you get lost in line items.
      </p>
    </section>

    <section className="guide-subsection" id="feature-transactions">
      <h3>Transactions</h3>
      <GuideFigure src={screenshots.transactions} alt="Transactions page with filtering and categorization" />
      <p>
        Transactions is a tab inside Cashflow, next to Overview, Spreadsheet, and Groups. It is for the raw stream of
        money in and out, with filtering and categorization that helps you clean things up before they become a
        reporting habit.
      </p>
      <h4>How to use it</h4>
      <ul className="guide-bullet-list">
        <li>Open the Transactions tab to review the raw list apart from the yearly rollups.</li>
        <li>Filter the list when you want to isolate one account, merchant, or category pattern.</li>
        <li>Categorize or recategorize items before they pollute your longer-term summaries.</li>
        <li>Use it as the place for cleanup work, not just for reading totals.</li>
        <li>
          The ⋯ More actions menu on this tab has Import, Rules and Apply rules to uncategorized. Open a row&apos;s
          category menu and choose Always categorize merchants like this to create a rule from it.
        </li>
      </ul>
      <p>
        <strong>One tip:</strong> Treat the Transactions tab as the inbox and the other Cashflow tabs as the monthly
        summary. One is where you fix the raw data, the other is where you look for meaning.
      </p>
    </section>

    <section className="guide-subsection" id="feature-taxes">
      <h3>Taxes</h3>
      <GuideFigure src={screenshots.taxes} alt="Taxes page with checklist and document uploads" />
      <p>
        A yearly tax binder without the actual binder. Checklists, uploads, linked accounts, and reusable templates, all
        organized by year.
      </p>
      <h4>How to use it</h4>
      <ul className="guide-bullet-list">
        <li>Move between tax years with the year navigation.</li>
        <li>Upload W-2s, 1099s, receipts, and whatever else tends to arrive at inconvenient times.</li>
        <li>Work through the checklist and mark items done as they land.</li>
        <li>Use linked-account suggestions when you want the app to help connect documents to the right places.</li>
        <li>Save or import templates so each year does not start from a blank page.</li>
      </ul>
      <p>
        <strong>One tip:</strong> Build next year&apos;s template the week you finish this year&apos;s return. Your
        future self will still remember what was annoying.
      </p>
    </section>

    <section className="guide-subsection" id="feature-drive">
      <h3>Drive</h3>
      <GuideFigure src={screenshots.drive} alt="Drive page with file browser and uploads" />
      <p>
        Drive is the app&apos;s file browser for uploaded documents. It gives you one place to browse the practical
        debris of personal finance, with enough structure to make it useful instead of decorative.
      </p>
      <h4>How to use it</h4>
      <ul className="guide-bullet-list">
        <li>Browse uploaded files and folders with breadcrumbs.</li>
        <li>Sort and filter when the list gets noisy.</li>
        <li>Open CSV previews before you decide what to keep or rename.</li>
        <li>
          Use it as the home for tax files, imported budget data, and other uploads that should stay close to the rest
          of the app.
        </li>
      </ul>
      <p>
        <strong>One tip:</strong> Rename files while they still mean something to you. “Statement.pdf” is readable today
        and useless six months from now.
      </p>
    </section>

    <section className="guide-subsection" id="feature-settings">
      <h3>Settings</h3>
      <GuideFigure src={screenshots.settings} alt="Settings page with data folder and appearance options" />
      <p>Profile, data folder, appearance, and the slightly more dangerous switches all live here.</p>
      <h4>How to use it</h4>
      <ul className="guide-bullet-list">
        <li>See and change your connected data folder in Data Folder.</li>
        <li>Toggle dark mode and accent preferences in Appearance.</li>
        <li>Explore Labs when you are curious.</li>
        <li>
          Data Folder lists the safety copies kept in <code>_backups</code> and restores one after you confirm.
        </li>
      </ul>
      <p>
        <strong>One tip:</strong> Back up your data folder regularly. Copy it to an external drive or a synced cloud
        folder. A backup you understand is a better safety net than one you have not tested.
      </p>
    </section>
  </section>
)

export default FeaturesByPage
