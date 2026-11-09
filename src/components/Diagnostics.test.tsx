import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Diagnostics } from './Diagnostics'
import { initializeProfiles } from '../core/profiles/store'
import { buildCommit } from '../core/storage-names'

beforeEach(async () => { await initializeProfiles() })

describe('Diagnostics build info', () => {
  it('shows Lab and the short commit, and Copy diagnostics includes them', async () => {
    render(<Diagnostics />)
    expect(screen.getByTestId('build-info')).toHaveTextContent('Lab')
    expect(screen.getByTestId('build-info')).toHaveTextContent(buildCommit())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy diagnostics' }))
    const report = JSON.parse((await screen.findByLabelText('Diagnostics report') as HTMLTextAreaElement).value)
    expect(report.app).toMatchObject({ build: 'Lab', commit: buildCommit() })
    expect(buildCommit()).toMatch(/^[0-9a-f]{7,}$|^dev$/)
  })
})
