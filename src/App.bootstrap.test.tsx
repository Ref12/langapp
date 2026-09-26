import { StrictMode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { db } from './core/database'
import { createEmptyProfile, serializeProfileYaml } from './core/profiles/codec'
import { resetProfileStorage } from './test/profile-storage'
import { LOCAL_PROFILES_PATH } from './core/profiles/local-contracts'

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('automatically loads default.yaml before showing a fresh app, including StrictMode reentry', async () => {
  await resetProfileStorage()
  window.location.hash = '#library'
  vi.stubEnv('DEV', true)
  vi.stubEnv('DEV_LOCAL_PROFILES', 'true')
  vi.stubEnv('DEV_LOCAL_SETTINGS', 'true')
  vi.stubEnv('BASE_URL', '/')
  const snapshot = createEmptyProfile({ id: 'default', name: 'default' })
  snapshot.settings.preferences.name = 'Automatically loaded'
  snapshot.settings.aiConnection = {
    baseUrl: 'https://provider.test/v1', apiKey: 'synthetic-key', model: 'test',
    nativeTools: false, structuredOutput: true, storageAcknowledged: true,
  }
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    yaml: serializeProfileYaml(snapshot), revision: 'a'.repeat(64),
  }), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetcher)
  render(<StrictMode><App /></StrictMode>)
  await screen.findByRole('heading', { name: 'Your next good read.' })
  expect(await db.preferences.get('workspace')).toMatchObject({ name: 'Automatically loaded' })
  expect(await db.aiConnections.get('assistant')).toMatchObject({ model: 'test', apiKey: 'synthetic-key' })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0][0]).toBe(`${LOCAL_PROFILES_PATH}/default`)
})
