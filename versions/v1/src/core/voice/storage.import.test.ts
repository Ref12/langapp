import { expect, it } from 'vitest'
import { getVoiceStorageUsage } from './storage'

it('initializes storage when imported before database backup schemas', async () => {
  expect(await getVoiceStorageUsage()).toBeGreaterThanOrEqual(0)
})
