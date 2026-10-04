import { beforeEach, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { db, initializeWorkspace } from '../database'
import { addAIEndpoint, listAIEndpoints, setActiveAIEndpoint } from '../assistant/endpoints'
import { parsePlainYaml } from '../yaml'
import { createEmptyProfile, parseProfileYaml, serializeProfileYaml } from './codec'
import { PROFILE_VERSION } from './contracts'
import { populatedProfile } from './test-fixtures'
import * as store from './store'

const connection = {
  baseUrl: 'https://old.example/v1', apiKey: 'old-key', model: 'old-model', nativeTools: true, structuredOutput: false, storageAcknowledged: true as const,
}

function oldProfileYaml(version: number): string {
  const snapshot = populatedProfile()
  const raw = parsePlainYaml(serializeProfileYaml(snapshot)) as Record<string, unknown>
  const settings = raw.settings as Record<string, unknown>
  delete settings.aiEndpoints
  settings.aiConnection = connection
  return stringify({ ...raw, version })
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await initializeWorkspace()
})

describe('profile YAML with several endpoints', () => {
  it('imports a version 4 single-connection profile as one active Default endpoint', () => {
    const snapshot = parseProfileYaml(oldProfileYaml(4))
    expect(snapshot.version).toBe(PROFILE_VERSION)
    expect(snapshot.settings.aiConnection).toBeUndefined()
    expect(snapshot.settings.aiEndpoints).toEqual({ version: 1, active: 'default', endpoints: [{ ...connection, id: 'default', name: 'Default' }] })
  })

  it('exports older profiles in the new versioned shape', () => {
    const text = serializeProfileYaml(parseProfileYaml(oldProfileYaml(4)))
    const raw = parsePlainYaml(text) as { version: number; settings: Record<string, unknown> }
    expect(raw.version).toBe(PROFILE_VERSION)
    expect(raw.settings.aiConnection).toBeUndefined()
    expect(raw.settings.aiEndpoints).toMatchObject({ version: 1, active: 'default' })
    expect(text).toContain('old-key')
  })

  it('still accepts a current-version file that holds the single aiConnection, but not both shapes', () => {
    expect(parseProfileYaml(oldProfileYaml(PROFILE_VERSION)).settings.aiEndpoints?.endpoints).toHaveLength(1)
    const both = parsePlainYaml(oldProfileYaml(PROFILE_VERSION)) as { settings: Record<string, unknown> }
    both.settings.aiEndpoints = { version: 1, endpoints: [{ ...connection, id: 'x', name: 'X' }] }
    expect(() => parseProfileYaml(stringify(both))).toThrow('Invalid profile YAML')
  })

  it('round-trips endpoints, headers and the active choice through YAML', () => {
    const snapshot = createEmptyProfile({ id: 'default', name: 'default' })
    snapshot.settings.aiEndpoints = {
      version: 1, active: 'two',
      endpoints: [
        { ...connection, id: 'one', name: 'One' },
        { ...connection, id: 'two', name: 'Two', model: 'm2', headers: [{ name: 'X-Team', value: 'blue' }] },
      ],
    }
    const text = serializeProfileYaml(snapshot)
    expect(text).toContain('X-Team')
    expect(parseProfileYaml(text).settings.aiEndpoints).toEqual(snapshot.settings.aiEndpoints)
  })

  it('rejects invalid lists: unknown active, duplicate names, bad headers', () => {
    const make = (aiEndpoints: unknown) => {
      const raw = parsePlainYaml(serializeProfileYaml(createEmptyProfile({ id: 'default', name: 'default' }))) as { settings: Record<string, unknown> }
      raw.settings.aiEndpoints = aiEndpoints
      return stringify(raw)
    }
    const one = { ...connection, id: 'one', name: 'One' }
    expect(() => parseProfileYaml(make({ version: 1, active: 'nope', endpoints: [one] }))).toThrow()
    expect(() => parseProfileYaml(make({ version: 1, endpoints: [one, { ...one, id: 'two', name: 'ONE' }] }))).toThrow()
    expect(() => parseProfileYaml(make({ version: 1, endpoints: [{ ...one, headers: [{ name: 'Host', value: 'x' }] }] }))).toThrow()
    expect(() => parseProfileYaml(make({ version: 2, endpoints: [one] }))).toThrow()
  })
})

describe('profile store with several endpoints', () => {
  it('exports the whole list and restores it with the same active endpoint', async () => {
    await addAIEndpoint('Home', connection)
    const work = await addAIEndpoint('Work', { ...connection, apiKey: 'work-key', headers: [{ name: 'X-Team', value: 'blue' }] })
    await setActiveAIEndpoint(work.id)
    const text = await store.exportActiveProfile()
    expect(text).toContain('work-key')
    expect(text).toContain('X-Team')
    await db.aiEndpoints.clear()
    await db.aiConnections.clear()
    await store.restoreActiveProfile(text)
    const list = await listAIEndpoints()
    expect(list.endpoints.map(endpoint => endpoint.name)).toEqual(['Home', 'Work'])
    expect(list.activeId).toBe(work.id)
    expect(await db.aiConnections.get('assistant')).toMatchObject({ endpointId: work.id, apiKey: 'work-key', headers: [{ name: 'X-Team', value: 'blue' }] })
  })

  it('restores an older single-connection profile so the connection keeps working', async () => {
    await store.restoreActiveProfile(oldProfileYaml(4))
    expect(await listAIEndpoints()).toMatchObject({ activeId: 'default', endpoints: [{ name: 'Default', apiKey: 'old-key' }] })
    expect(await db.aiConnections.get('assistant')).toMatchObject({ id: 'assistant', apiKey: 'old-key', model: 'old-model', nativeTools: true })
  })
})
