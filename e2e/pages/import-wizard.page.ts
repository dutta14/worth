import { expect, type Locator, type Page } from '@playwright/test'

type FilePayload = { name: string; mimeType: string; buffer: Buffer }

/** The import wizard dialog and the steps inside it (docs/specs/import-wizard.md, section 5). */
export class ImportWizardPage {
  readonly page: Page
  readonly dialog: Locator
  readonly fileInput: Locator
  readonly liveRegion: Locator
  readonly continueBtn: Locator
  readonly importBtn: Locator

  constructor(page: Page) {
    this.page = page
    this.dialog = page.getByRole('dialog', { name: 'Import transactions' })
    this.fileInput = page.getByTestId('import-wizard-input')
    this.liveRegion = this.dialog.locator('.iw-live')
    this.continueBtn = this.dialog.getByRole('button', { name: /^Continue/ })
    this.importBtn = this.dialog.getByRole('button', { name: /^Import \d/ })
  }

  heading(name: string | RegExp): Locator {
    return this.dialog.getByRole('heading', { name })
  }

  async pick(...files: FilePayload[]) {
    await this.fileInput.setInputFiles(files)
  }

  /** Picks the sign convention the Columns step never chooses on its own. */
  async chooseSign(label: 'Negative numbers are spending' | 'Positive numbers are spending') {
    await this.dialog.getByRole('radio', { name: label }).check()
  }

  async toReview() {
    await this.continueBtn.click()
    await expect(this.heading('Review before importing')).toBeFocused()
  }

  /** Columns with a negative-is-spending file, through to a confirmed import. */
  async importSigned(...files: FilePayload[]) {
    await this.pick(...files)
    await this.chooseSign('Negative numbers are spending')
    await this.toReview()
    await this.importBtn.click()
    await expect(this.heading('Import complete')).toBeVisible()
  }

  async close() {
    await this.dialog.getByRole('button', { name: 'Done' }).click()
    await expect(this.dialog).toBeHidden()
  }
}
