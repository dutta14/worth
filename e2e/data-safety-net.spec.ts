import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { NetWorthPage } from './pages/net-worth.page'
import { changeOnDisk, installFakeFsa, removeOnDisk, touchOnDisk } from './fixtures/fake-fsa'
import type { FakeFsaControls } from './fixtures/fake-fsa'

/*
 * These specs run the real FileSystemFileStore over a fake File System Access
 * handle. They do not use the shared fixture, because it forces `_e2eMode`
 * (an in-memory store) and the safety net is deliberately inert there.
 */

// A window focus runs one automatic retry, so a fault that clears itself would make these specs racy.
const PERSISTENT = 1000
const FLAGS_URL = 'https://api.github.com/repos/dutta14/worth/contents/feature-flags.json'

async function openApp(
  page: Page,
  { flagOn = true, seed = {} }: { flagOn?: boolean; seed?: Record<string, string> } = {},
) {
  await page.route(FLAGS_URL, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        content: Buffer.from(JSON.stringify({ flags: {} })).toString('base64'),
        encoding: 'base64',
      }),
    }),
  )
  await page.addInitScript(enabled => {
    if (enabled) localStorage.setItem('flag-overrides', JSON.stringify({ 'data-safety-net': true }))
  }, flagOn)
  await installFakeFsa(page, seed)
  await page.goto('/worth/#/net-worth/dashboard')
  await page.getByRole('button', { name: 'Choose Folder' }).click()
  await expect(page.locator('#main-content')).toBeVisible()
}

const disk = (page: Page, path: string) =>
  page.evaluate(p => (window as Window & { __fakeFsa?: FakeFsaControls }).__fakeFsa?.files.get(p) ?? null, path)

const fakeFsa = (page: Page) =>
  page.evaluate(() => {
    const { failCloseTimes } = (window as Window & { __fakeFsa?: FakeFsaControls }).__fakeFsa!
    return { failCloseTimes }
  })

const setFsa = (page: Page, patch: Partial<FakeFsaControls>) =>
  page.evaluate(values => Object.assign((window as Window & { __fakeFsa?: FakeFsaControls }).__fakeFsa!, values), patch)

async function addAccount(page: Page, name: string) {
  const nw = new NetWorthPage(page)
  await nw.emptyAddBtn.click()
  await expect(nw.modal).toBeVisible()
  await nw.addAccount(name, 'Chase')
  await nw.modalCloseBtn.click()
  await expect(nw.modal).toBeHidden()
}

test.describe('Data safety net: save failures', () => {
  test('shows an alert when a save fails, keeps the edit, and saves it after Try again', async ({ page }) => {
    await openApp(page)
    await setFsa(page, { failCloseTimes: PERSISTENT, failClosePath: 'accounts.json' })

    await addAccount(page, 'Rainy Day Fund')

    const alert = page.getByRole('region', { name: 'Data safety' }).getByRole('alert')
    await expect(alert).toContainText("Couldn't save changes to accounts.json.")
    expect(await disk(page, 'accounts.json')).not.toContain('Rainy Day Fund')

    await setFsa(page, { failCloseTimes: 0 })
    await page.getByRole('button', { name: 'Try again' }).click()

    await expect(alert).toBeHidden()
    await expect(page.getByRole('status').filter({ hasText: 'All changes saved.' })).toBeAttached()
    expect(await disk(page, 'accounts.json')).toContain('Rainy Day Fund')
  })

  test('keeps the banner and explains when the retry fails again', async ({ page }) => {
    await openApp(page)
    await setFsa(page, {
      failCloseTimes: PERSISTENT,
      failClosePath: 'accounts.json',
      failCloseName: 'QuotaExceededError',
    })

    await addAccount(page, 'Rainy Day Fund')
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('The disk looks full.')

    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(alert).toContainText("Still couldn't save accounts.json.")
    expect(await disk(page, 'accounts.json')).not.toContain('Rainy Day Fund')
  })

  test('has no way to dismiss the banner and reaches Try again with the keyboard alone', async ({ page }) => {
    await openApp(page)
    await setFsa(page, { failCloseTimes: PERSISTENT, failClosePath: 'accounts.json' })
    await addAccount(page, 'Rainy Day Fund')

    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert.getByRole('button')).toHaveCount(1)

    const tryAgain = page.getByRole('button', { name: 'Try again' })
    for (let i = 0; i < 60; i++) {
      if (await tryAgain.evaluate(el => el === document.activeElement)) break
      await page.keyboard.press('Tab')
    }
    await expect(tryAgain).toBeFocused()
    await setFsa(page, { failCloseTimes: 0 })
    await page.keyboard.press('Enter')

    await expect(alert).toBeHidden()
    await expect(page.locator('#main-content')).toBeFocused()
    expect(await disk(page, 'accounts.json')).toContain('Rainy Day Fund')
  })

  test('shows nothing when the flag is off', async ({ page }) => {
    await openApp(page, { flagOn: false })
    await setFsa(page, { failCloseTimes: PERSISTENT, failClosePath: 'accounts.json' })

    await addAccount(page, 'Rainy Day Fund')

    // The injected failure being consumed proves a save was attempted and rejected.
    await expect.poll(async () => (await fakeFsa(page)).failCloseTimes).toBeLessThan(PERSISTENT)
    expect(await disk(page, 'accounts.json')).not.toContain('Rainy Day Fund')
    await expect(page.getByRole('region', { name: 'Data safety' })).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: 'All changes saved.' })).toHaveCount(0)
  })
})

test.describe('Data safety net: leaving the page', () => {
  test('asks before leaving while a write is still in flight', async ({ page }) => {
    await openApp(page)
    await setFsa(page, { closeDelayMs: 3000 })
    await addAccount(page, 'Rainy Day Fund')

    const dialog = page.waitForEvent('dialog')
    await page.close({ runBeforeUnload: true })
    expect((await dialog).type()).toBe('beforeunload')
    await (await dialog).dismiss()
  })

  test('does not ask when everything is saved', async ({ page }) => {
    await openApp(page)
    await addAccount(page, 'Rainy Day Fund')
    await expect.poll(() => disk(page, 'accounts.json')).toContain('Rainy Day Fund')

    let prompted = false
    page.on('dialog', dialog => {
      prompted = true
      void dialog.dismiss()
    })
    await page.close({ runBeforeUnload: true })
    expect(prompted).toBe(false)
  })
})

test.describe('Data safety net: folder permission', () => {
  test('reconnects from the banner and keeps the edit', async ({ page }) => {
    await openApp(page)
    await setFsa(page, { permission: 'prompt' })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))

    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Access to your data folder was lost.')

    await addAccount(page, 'Rainy Day Fund')
    expect((await disk(page, 'accounts.json')) ?? '').not.toContain('Rainy Day Fund')

    await page.getByRole('button', { name: 'Reconnect folder' }).click()

    await expect(alert).toBeHidden()
    await expect.poll(() => disk(page, 'accounts.json')).toContain('Rainy Day Fund')
    const calls = await page.evaluate(
      () => (window as Window & { __fakeFsa?: FakeFsaControls }).__fakeFsa?.requestPermissionCalls,
    )
    expect(calls).toBe(1)
  })

  test('offers to choose the folder again when reconnecting is denied', async ({ page }) => {
    await openApp(page)
    await setFsa(page, { permission: 'prompt', grantOnRequest: false })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))

    await page.getByRole('button', { name: 'Reconnect folder' }).click()

    await expect(page.getByRole('alert')).toContainText("Access wasn't granted.")
    await expect(page.getByRole('button', { name: 'Choose folder again' })).toBeVisible()
  })

  test('shows the permission banner when a save is refused, then saves after reconnecting', async ({ page }) => {
    await openApp(page)
    await setFsa(page, { permission: 'denied' })

    await addAccount(page, 'Rainy Day Fund')
    await expect(page.getByRole('alert')).toContainText('Access to your data folder was lost.')

    await setFsa(page, { permission: 'prompt', grantOnRequest: true })
    await page.getByRole('button', { name: 'Reconnect folder' }).click()

    await expect(page.getByRole('alert')).toBeHidden()
    await expect.poll(() => disk(page, 'accounts.json')).toContain('Rainy Day Fund')
  })
})

test.describe('Data safety net: backups', () => {
  const backupPaths = (page: Page, dir: string) =>
    page.evaluate(
      prefix =>
        [...((window as Window & { __fakeFsa?: FakeFsaControls }).__fakeFsa?.files.keys() ?? [])]
          .filter(path => path.startsWith(prefix))
          .sort(),
      `${dir}/`,
    )

  async function openDataFolderSettings(page: Page) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('tab', { name: 'Data Folder' }).click()
    return dialog
  }

  test('copies the previous file into _backups on the first change and not again in the same session', async ({
    page,
  }) => {
    await openApp(page, { seed: { 'accounts.json': '[]' } })

    await addAccount(page, 'Rainy Day Fund')
    await expect.poll(() => disk(page, 'accounts.json')).toContain('Rainy Day Fund')

    const copies = await backupPaths(page, '_backups/accounts')
    expect(copies).toHaveLength(1)
    expect(copies[0]).toMatch(/^_backups\/accounts\/\d{8}T\d{9}Z\.json$/)
    expect(await disk(page, copies[0])).toBe('[]')
    expect(await disk(page, '_backups/README.txt')).toContain('automatic copies made by worth')

    const nw = new NetWorthPage(page)
    await nw.openAccountsModal()
    await nw.addAccount('Emergency Fund', 'Chase')
    await expect.poll(() => disk(page, 'accounts.json')).toContain('Emergency Fund')
    expect(await backupPaths(page, '_backups/accounts')).toHaveLength(1)
  })

  test('lists the copies in Settings and restores one, refreshing the page behind it', async ({ page }) => {
    await openApp(page, { seed: { 'accounts.json': '[]' } })
    await addAccount(page, 'Rainy Day Fund')
    await expect.poll(() => disk(page, 'accounts.json')).toContain('Rainy Day Fund')
    await expect.poll(() => backupPaths(page, '_backups/accounts')).toHaveLength(1)

    const dialog = await openDataFolderSettings(page)
    await expect(dialog.getByRole('heading', { name: 'Backups' })).toBeVisible()
    await expect(dialog.getByLabel('File')).toHaveValue('accounts.json')
    await expect(dialog.getByRole('listitem')).toHaveCount(1)

    await dialog.getByRole('button', { name: /^Restore accounts\.json from / }).click()
    await expect(dialog.getByRole('button', { name: 'Restore this copy' })).toBeFocused()
    await dialog.getByRole('button', { name: 'Restore this copy' }).click()

    await expect(dialog.getByRole('status').filter({ hasText: /^Restored accounts\.json from / })).toBeVisible()
    expect(await disk(page, 'accounts.json')).toBe('[]')
    // The version that was replaced is kept too.
    await expect(dialog.getByRole('listitem')).toHaveCount(2)
    const copies = await backupPaths(page, '_backups/accounts')
    expect(copies).toHaveLength(2)
    const contents = await Promise.all(copies.map(path => disk(page, path)))
    expect(contents.some(text => text?.includes('Rainy Day Fund'))).toBe(true)

    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByText('No accounts yet')).toBeVisible()
  })

  test('shows the empty state before anything has been backed up', async ({ page }) => {
    await openApp(page)
    const dialog = await openDataFolderSettings(page)
    await expect(dialog.getByText('No backups yet. Copies appear the first time a file is changed.')).toBeVisible()
    expect(await backupPaths(page, '_backups')).toHaveLength(0)
  })

  test('keeps the save and warns in Settings when the backup copy fails', async ({ page }) => {
    await openApp(page, { seed: { 'accounts.json': '[]' } })
    await page.evaluate(() => {
      const fsa = (window as Window & { __fakeFsa?: FakeFsaControls }).__fakeFsa
      if (fsa) {
        const originalSet = fsa.files.set.bind(fsa.files)
        fsa.files.set = (path, value) => {
          if (path.startsWith('_backups/accounts/')) throw new DOMException('disk full', 'QuotaExceededError')
          return originalSet(path, value)
        }
      }
    })

    await addAccount(page, 'Rainy Day Fund')
    await expect.poll(() => disk(page, 'accounts.json')).toContain('Rainy Day Fund')
    await expect(page.getByRole('alert')).toHaveCount(0)

    const dialog = await openDataFolderSettings(page)
    await expect(
      dialog.getByText("The last backup copy couldn't be saved. Your changes were saved normally."),
    ).toBeVisible()
  })

  test('has no Backups section and writes no _backups folder when the flag is off', async ({ page }) => {
    await openApp(page, { flagOn: false, seed: { 'accounts.json': '[]' } })
    await addAccount(page, 'Rainy Day Fund')
    await expect.poll(() => disk(page, 'accounts.json')).toContain('Rainy Day Fund')

    const dialog = await openDataFolderSettings(page)
    await expect(dialog.getByRole('heading', { name: 'Data Folder' })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Backups' })).toHaveCount(0)
    expect(await backupPaths(page, '_backups')).toHaveLength(0)
  })
})

test.describe('Data safety net: corrupt files', () => {
  const CORRUPT = '[{"id":1,"name":"Half a fil'
  const BACKUP_PATH = '_backups/accounts/20261101T120000000Z.json'
  const BACKUP = JSON.stringify([
    {
      id: 1,
      name: 'Backup Savings',
      type: 'liquid',
      owner: 'primary',
      status: 'active',
      goalType: 'gw',
      nature: 'asset',
      allocation: 'cash',
    },
  ])

  const keys = (page: Page, prefix: string) =>
    page.evaluate(
      p =>
        [...((window as Window & { __fakeFsa?: FakeFsaControls }).__fakeFsa?.files.keys() ?? [])]
          .filter(path => path.startsWith(p))
          .sort(),
      prefix,
    )

  const commitsTo = (page: Page, path: string) =>
    page.evaluate(
      p =>
        ((window as Window & { __fakeFsa?: FakeFsaControls }).__fakeFsa?.commits ?? []).filter(c => c.path === p)
          .length,
      path,
    )

  const banner = (page: Page) => page.getByRole('region', { name: 'Data safety' })

  test('keeps the broken file untouched, holds edits, and restores the latest backup', async ({ page }) => {
    await openApp(page, { seed: { 'accounts.json': CORRUPT, [BACKUP_PATH]: BACKUP } })

    const alert = banner(page).getByRole('alert')
    await expect(alert).toContainText("Couldn't read accounts.json.")
    await expect(alert).toContainText("Changes to it won't be saved until you choose how to continue.")
    const [copy] = await keys(page, 'accounts.json.corrupt-')
    expect(copy).toMatch(/^accounts\.json\.corrupt-\d{8}T\d{9}Z$/)
    await expect(alert).toContainText(`saved a copy as ${copy}.`)
    expect(await disk(page, copy)).toBe(CORRUPT)
    expect(await disk(page, 'accounts.json')).toBe(CORRUPT)
    await expect(page.getByText('No accounts yet')).toBeVisible()

    await addAccount(page, 'Rainy Day Fund')
    await page.waitForTimeout(600)

    expect(await commitsTo(page, 'accounts.json')).toBe(0)
    expect(await disk(page, 'accounts.json')).toBe(CORRUPT)
    await expect(alert).toBeVisible()

    await page.getByRole('button', { name: 'Restore latest backup' }).click()

    await expect(alert).toBeHidden()
    await expect(
      page.getByRole('status').filter({ hasText: /^accounts\.json restored from the backup of / }),
    ).toBeAttached()
    await expect(page.locator('#main-content')).toBeFocused()
    expect(await disk(page, 'accounts.json')).toBe(BACKUP)
    expect(await disk(page, copy)).toBe(CORRUPT)
    // The edit that was held is kept, not discarded.
    const unsaved = (await keys(page, '_backups/accounts/')).filter(path => path.endsWith('-unsaved.json'))
    expect(unsaved).toHaveLength(1)
    expect(await disk(page, unsaved[0])).toContain('Rainy Day Fund')

    const nw = new NetWorthPage(page)
    await nw.openAccountsModal()
    await expect(nw.modal).toContainText('Backup Savings')
  })

  test('starts fresh by saving the held edit and leaves the unreadable copy in the folder', async ({ page }) => {
    await openApp(page, { seed: { 'accounts.json': CORRUPT, [BACKUP_PATH]: BACKUP } })
    await expect(banner(page).getByRole('alert')).toContainText("Couldn't read accounts.json.")
    await addAccount(page, 'Rainy Day Fund')
    expect(await commitsTo(page, 'accounts.json')).toBe(0)

    await page.getByRole('button', { name: 'Start fresh' }).click()

    await expect(page.getByRole('alert')).toBeHidden()
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'accounts.json replaced. The unreadable copy is still in your folder.' }),
    ).toBeAttached()
    await expect.poll(() => disk(page, 'accounts.json')).toContain('Rainy Day Fund')
    const [copy] = await keys(page, 'accounts.json.corrupt-')
    expect(await disk(page, copy)).toBe(CORRUPT)

    const nw = new NetWorthPage(page)
    await nw.openAccountsModal()
    await nw.addAccount('Emergency Fund', 'Chase')
    await expect.poll(() => disk(page, 'accounts.json')).toContain('Emergency Fund')
  })

  test('hides Restore when there is no valid backup, and Start fresh still works', async ({ page }) => {
    await openApp(page, { seed: { 'accounts.json': CORRUPT } })

    const alert = banner(page).getByRole('alert')
    await expect(alert).toContainText("Couldn't read accounts.json.")
    await expect(page.getByRole('button', { name: 'Restore latest backup' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Start fresh' })).toBeVisible()

    await page.getByRole('button', { name: 'Start fresh' }).click()
    await expect(alert).toBeHidden()
    expect(await disk(page, 'accounts.json')).toBe(CORRUPT)
    await addAccount(page, 'Rainy Day Fund')
    await expect.poll(() => disk(page, 'accounts.json')).toContain('Rainy Day Fund')
  })

  test('resolves with the keyboard alone', async ({ page }) => {
    await openApp(page, { seed: { 'accounts.json': CORRUPT, [BACKUP_PATH]: BACKUP } })
    const restore = page.getByRole('button', { name: 'Restore latest backup' })
    await expect(restore).toBeVisible()

    for (let i = 0; i < 60; i++) {
      if (await restore.evaluate(el => el === document.activeElement)) break
      await page.keyboard.press('Tab')
    }
    await expect(restore).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page.getByRole('alert')).toBeHidden()
    expect(await disk(page, 'accounts.json')).toBe(BACKUP)
  })

  test('treats a zero-byte accounts.json as missing: no banner, no copy', async ({ page }) => {
    await openApp(page, { seed: { 'accounts.json': '' } })

    await expect(page.getByText('No accounts yet')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(await keys(page, 'accounts.json.corrupt-')).toEqual([])

    await addAccount(page, 'Rainy Day Fund')
    await expect.poll(() => disk(page, 'accounts.json')).toContain('Rainy Day Fund')
  })

  test('behaves as before when the flag is off: no banner, no copy, the next save replaces the file', async ({
    page,
  }) => {
    await openApp(page, { flagOn: false, seed: { 'accounts.json': CORRUPT } })

    await expect(page.getByText('No accounts yet')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(await keys(page, 'accounts.json.corrupt-')).toEqual([])

    await addAccount(page, 'Rainy Day Fund')
    await expect.poll(() => disk(page, 'accounts.json')).toContain('Rainy Day Fund')
    expect(await keys(page, 'accounts.json.corrupt-')).toEqual([])
    expect(await keys(page, '_backups/')).toEqual([])
  })
})

test.describe('Data safety net: external changes', () => {
  const OTHER_COMPUTER = JSON.stringify([
    {
      id: 1,
      name: 'Backup Savings',
      type: 'liquid',
      owner: 'primary',
      status: 'active',
      goalType: 'gw',
      nature: 'asset',
      allocation: 'cash',
    },
  ])

  const keys = (page: Page, prefix: string) =>
    page.evaluate(
      p =>
        [...((window as Window & { __fakeFsa?: FakeFsaControls }).__fakeFsa?.files.keys() ?? [])]
          .filter(path => path.startsWith(p))
          .sort(),
      prefix,
    )

  const commitsTo = (page: Page, path: string) =>
    page.evaluate(
      p =>
        ((window as Window & { __fakeFsa?: FakeFsaControls }).__fakeFsa?.commits ?? []).filter(c => c.path === p)
          .length,
      path,
    )

  const banner = (page: Page) => page.getByRole('region', { name: 'Data safety' })
  const external = (page: Page) =>
    banner(page)
      .getByRole('status')
      .filter({ hasText: /changed on disk|deleted outside this tab/ })
  const focusWindow = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')))

  test('flags a file changed elsewhere, holds edits, and Reload shows the disk version', async ({ page }) => {
    await openApp(page, { seed: { 'accounts.json': '[]' } })
    await changeOnDisk(page, 'accounts.json', OTHER_COMPUTER)
    await focusWindow(page)

    const status = external(page)
    await expect(status).toContainText('accounts.json changed on disk.')
    await expect(status).toContainText('Saving to it is paused so nothing gets overwritten.')
    await expect(page.getByRole('alert')).toHaveCount(0)

    await addAccount(page, 'Rainy Day Fund')
    await page.waitForTimeout(600)
    expect(await commitsTo(page, 'accounts.json')).toBe(0)
    expect(await disk(page, 'accounts.json')).toBe(OTHER_COMPUTER)

    await page.getByRole('button', { name: 'Reload' }).click()

    await expect(status).toBeHidden()
    await expect(
      page.getByRole('status').filter({ hasText: 'Reloaded from disk. Any unsaved edits were kept in _backups.' }),
    ).toBeAttached()
    await expect(page.locator('#main-content')).toBeFocused()
    expect(await disk(page, 'accounts.json')).toBe(OTHER_COMPUTER)
    expect(await commitsTo(page, 'accounts.json')).toBe(0)
    const unsaved = (await keys(page, '_backups/accounts/')).filter(path => path.endsWith('-unsaved.json'))
    expect(unsaved).toHaveLength(1)
    expect(await disk(page, unsaved[0])).toContain('Rainy Day Fund')

    const nw = new NetWorthPage(page)
    await nw.openAccountsModal()
    await expect(nw.modal).toContainText('Backup Savings')
    await expect(nw.modal).not.toContainText('Rainy Day Fund')
  })

  test('Keep my version saves the edit and leaves the other version in _backups', async ({ page }) => {
    await openApp(page, { seed: { 'accounts.json': '[]' } })
    await changeOnDisk(page, 'accounts.json', OTHER_COMPUTER)
    await focusWindow(page)
    await expect(external(page)).toContainText('accounts.json changed on disk.')

    await addAccount(page, 'Rainy Day Fund')
    await page.waitForTimeout(600)
    expect(await commitsTo(page, 'accounts.json')).toBe(0)

    await page.getByRole('button', { name: 'Keep my version' }).click()

    await expect(
      page.getByRole('status').filter({ hasText: 'Saved your version. The previous version is in _backups.' }),
    ).toBeAttached()
    await expect(external(page)).toHaveCount(0)
    await expect.poll(() => disk(page, 'accounts.json')).toContain('Rainy Day Fund')
    const copies = await keys(page, '_backups/accounts/')
    const contents = await Promise.all(copies.map(path => disk(page, path)))
    expect(contents).toContain(OTHER_COMPUTER)
  })

  test('Keep my version with no edit writes the tab version back over the changed file', async ({ page }) => {
    await openApp(page, { seed: { 'accounts.json': OTHER_COMPUTER } })
    await expect(page.getByText('No accounts yet')).toHaveCount(0)
    await changeOnDisk(page, 'accounts.json', '[]')
    await focusWindow(page)
    await expect(external(page)).toContainText('accounts.json changed on disk.')

    await page.getByRole('button', { name: 'Keep my version' }).click()

    await expect
      .poll(async () => JSON.parse((await disk(page, 'accounts.json')) ?? 'null'))
      .toEqual(JSON.parse(OTHER_COMPUTER))
    const copies = await keys(page, '_backups/accounts/')
    expect(await Promise.all(copies.map(path => disk(page, path)))).toContain('[]')
  })

  test('ignores a file whose modified time moved but whose content did not', async ({ page }) => {
    await openApp(page, { seed: { 'accounts.json': '[]' } })
    await touchOnDisk(page, 'accounts.json')
    await focusWindow(page)
    await page.waitForTimeout(600)

    await expect(page.getByRole('region', { name: 'Data safety' })).toHaveCount(0)
    await addAccount(page, 'Rainy Day Fund')
    await expect.poll(() => disk(page, 'accounts.json')).toContain('Rainy Day Fund')
  })

  test('blocks the save instead of overwriting when the file changed and no focus event ran', async ({ page }) => {
    await openApp(page, { seed: { 'accounts.json': '[]' } })
    await changeOnDisk(page, 'accounts.json', OTHER_COMPUTER)

    await addAccount(page, 'Rainy Day Fund')

    await expect(external(page)).toContainText('accounts.json changed on disk.')
    expect(await disk(page, 'accounts.json')).toBe(OTHER_COMPUTER)
    expect(await commitsTo(page, 'accounts.json')).toBe(0)
  })

  test('reports a deleted file, and Reload shows the empty state', async ({ page }) => {
    await openApp(page, { seed: { 'accounts.json': OTHER_COMPUTER } })
    await removeOnDisk(page, 'accounts.json')
    await focusWindow(page)

    await expect(external(page)).toContainText('accounts.json was deleted outside this tab. Saving to it is paused.')
    await page.getByRole('button', { name: 'Reload' }).click()

    await expect(page.getByText('No accounts yet')).toBeVisible()
    await expect(external(page)).toHaveCount(0)
    expect(await disk(page, 'accounts.json')).toBeNull()
  })

  test('recreates a deleted file when you keep your version', async ({ page }) => {
    await openApp(page, { seed: { 'accounts.json': OTHER_COMPUTER } })
    await removeOnDisk(page, 'accounts.json')
    await focusWindow(page)
    await expect(external(page)).toContainText('accounts.json was deleted outside this tab.')

    await page.getByRole('button', { name: 'Keep my version' }).click()

    await expect
      .poll(async () => JSON.parse((await disk(page, 'accounts.json')) ?? 'null'))
      .toEqual(JSON.parse(OTHER_COMPUTER))
  })

  test('does not delete a balances file that this tab never loaded', async ({ page }) => {
    const CSV = 'month,accountId,balance\n2025-06,1,500\n'
    await openApp(page, {
      seed: { 'accounts.json': OTHER_COMPUTER, 'balances/2026.csv': 'month,accountId,balance\n2026-01,1,1000\n' },
    })
    await changeOnDisk(page, 'balances/2025.csv', CSV)

    const nw = new NetWorthPage(page)
    await nw.spreadsheetTab.click()
    await nw.addEntryBtn.click()
    await nw.addEntryContinueBtn.click()
    await nw.getInlineBalanceInput(0).fill('200')
    await nw.inlineSaveBtn.click()

    await expect(external(page)).toContainText('changed on disk')
    expect(await disk(page, 'balances/2025.csv')).toBe(CSV)
  })

  test('resolves with the keyboard alone and moves focus to the page', async ({ page }) => {
    await openApp(page, { seed: { 'accounts.json': '[]' } })
    await changeOnDisk(page, 'accounts.json', OTHER_COMPUTER)
    await focusWindow(page)
    const reload = page.getByRole('button', { name: 'Reload' })
    await expect(reload).toBeVisible()

    for (let i = 0; i < 60; i++) {
      if (await reload.evaluate(el => el === document.activeElement)) break
      await page.keyboard.press('Tab')
    }
    await expect(reload).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page.getByRole('button', { name: 'Reload' })).toHaveCount(0)
    await expect(page.locator('#main-content')).toBeFocused()
  })

  test('does nothing when the flag is off: no banner, and the next save replaces the file', async ({ page }) => {
    await openApp(page, { flagOn: false, seed: { 'accounts.json': '[]' } })
    await changeOnDisk(page, 'accounts.json', OTHER_COMPUTER)
    await focusWindow(page)
    await page.waitForTimeout(600)
    await expect(page.getByRole('region', { name: 'Data safety' })).toHaveCount(0)

    await addAccount(page, 'Rainy Day Fund')
    await expect.poll(() => disk(page, 'accounts.json')).toContain('Rainy Day Fund')
    expect(await keys(page, '_backups/')).toEqual([])
  })
})
