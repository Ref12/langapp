import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../core/database'
import { initializeProfiles } from '../core/profiles/store'
import { resetBackupStateForTests, loadAutoSetting } from '../core/backup/state'
import { saveBackupConfig } from '../core/backup/service'
import { getActiveProfile } from '../core/profiles/store'
import * as auto from '../core/backup/auto'
import { useBackupBoundaries } from './useBackupBoundaries'
import { AutoBackupSwitch } from './AutoBackupSwitch'

function Probe({ route, open }: { route: string; open: boolean }) { useBackupBoundaries(route, open); return null }

beforeEach(async () => {
  await resetBackupStateForTests(); localStorage.clear(); await initializeProfiles(); await db.delete(); await db.open(); await initializeWorkspace()
})

describe('boundary hook', () => {
  it('opening the app is not a boundary; a page change and a session ending are', async () => {
    const spy = vi.spyOn(auto, 'atBoundary').mockResolvedValue('clean')
    const view = render(<Probe route="overview" open={false} />)
    expect(spy).not.toHaveBeenCalled()
    view.rerender(<Probe route="overview?tab=x" open={false} />)
    expect(spy).not.toHaveBeenCalled() // same page
    view.rerender(<Probe route="practice/s1" open />)
    expect(spy).toHaveBeenCalledTimes(1) // left the overview
    view.rerender(<Probe route="practice/s1" open={false} />)
    expect(spy).toHaveBeenCalledTimes(2) // the session ended
  })
})

describe('Automatic backup switch', () => {
  it('is hidden without a connection, on by default, and saves when turned off', async () => {
    render(<AutoBackupSwitch />)
    expect(screen.queryByRole('switch')).toBeNull()
    await act(async () => { await saveBackupConfig({ owner: 'me', repo: 'b', token: 't', branch: 'main' }) })
    const toggle = await screen.findByRole('switch', { name: /Automatic backup/ })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    await waitFor(async () => expect(await loadAutoSetting(getActiveProfile().id)).toBe(false))
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked())
  })
})
