import { beforeEach, describe, expect, it } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { aiConnectionSchema, type AIConnectionInput } from './contracts'
import {
  addAIEndpoint, deleteAIEndpoint, duplicateAIEndpoint, listAIEndpoints, renameAIEndpoint, setActiveAIEndpoint, updateAIEndpoint,
} from './endpoints'
import { removeAIConnection, saveAIConnection } from './store'

const a: AIConnectionInput = {
  baseUrl: 'https://a.example/v1/', apiKey: 'key-a', model: 'model-a', nativeTools: false, structuredOutput: false, storageAcknowledged: true,
}
const b: AIConnectionInput = { ...a, baseUrl: 'https://b.example/v1', apiKey: 'key-b', model: 'model-b', headers: [{ name: 'X-Team', value: 'blue' }] }
const active = () => db.aiConnections.get('assistant')

beforeEach(async () => {
  await db.delete()
  await db.open()
  await initializeWorkspace()
})

describe('AI endpoint list', () => {
  it('starts empty and makes the first added endpoint active', async () => {
    expect(await listAIEndpoints()).toEqual({ endpoints: [], activeId: undefined })
    const first = await addAIEndpoint('Home', a)
    const list = await listAIEndpoints()
    expect(list.activeId).toBe(first.id)
    expect(list.endpoints.map(endpoint => endpoint.name)).toEqual(['Home'])
    expect(await active()).toMatchObject({ endpointId: first.id, name: 'Home', baseUrl: 'https://a.example/v1', model: 'model-a' })
  })

  it('adds more endpoints without changing the active one or overwriting others', async () => {
    const first = await addAIEndpoint('Home', a)
    const second = await addAIEndpoint('Work', b)
    const list = await listAIEndpoints()
    expect(list.activeId).toBe(first.id)
    expect(list.endpoints.map(endpoint => endpoint.name)).toEqual(['Home', 'Work'])
    expect(list.endpoints[1]).toMatchObject({ id: second.id, apiKey: 'key-b', headers: [{ name: 'X-Team', value: 'blue' }] })
    expect((await active())?.apiKey).toBe('key-a')
  })

  it('switches the active endpoint and gives consumers a new revision', async () => {
    await addAIEndpoint('Home', a)
    const second = await addAIEndpoint('Work', b)
    const before = (await active())!
    await setActiveAIEndpoint(second.id)
    const after = (await active())!
    expect(aiConnectionSchema.safeParse(after).success).toBe(true)
    expect(after).toMatchObject({ endpointId: second.id, apiKey: 'key-b', model: 'model-b', headers: [{ name: 'X-Team', value: 'blue' }] })
    expect(after.revision).not.toBe(before.revision)
    expect((await listAIEndpoints()).endpoints.map(endpoint => endpoint.apiKey)).toEqual(['key-a', 'key-b'])
    await setActiveAIEndpoint((await listAIEndpoints()).endpoints[0].id)
    expect((await active())?.apiKey).toBe('key-a')
    await expect(setActiveAIEndpoint('missing')).rejects.toThrow('no longer exists')
  })

  it('edits an endpoint; the working copy only changes when it is the active one', async () => {
    const first = await addAIEndpoint('Home', a)
    const second = await addAIEndpoint('Work', b)
    await updateAIEndpoint(second.id, { ...b, model: 'edited' })
    expect((await active())?.model).toBe('model-a')
    await updateAIEndpoint(first.id, { ...a, model: 'edited-active', headers: [{ name: 'X-New', value: '1' }] }, 'Home 2')
    expect(await active()).toMatchObject({ model: 'edited-active', name: 'Home 2', headers: [{ name: 'X-New', value: '1' }] })
    const list = await listAIEndpoints()
    expect(list.endpoints.map(endpoint => [endpoint.name, endpoint.model])).toEqual([['Home 2', 'edited-active'], ['Work', 'edited']])
    await updateAIEndpoint(first.id, a)
    expect((await active())?.headers).toBeUndefined()
  })

  it('renames with unique names, case-insensitively, keeping the working copy revision', async () => {
    const first = await addAIEndpoint('Home', a)
    const second = await addAIEndpoint('Work', b)
    const revision = (await active())!.revision
    await renameAIEndpoint(first.id, 'Living room')
    expect(await active()).toMatchObject({ name: 'Living room', revision })
    await expect(renameAIEndpoint(second.id, 'living ROOM')).rejects.toThrow('already exists')
    await expect(renameAIEndpoint(second.id, '   ')).rejects.toThrow()
    await expect(addAIEndpoint('work', a)).rejects.toThrow('already exists')
  })

  it('duplicates an endpoint as an independent inactive copy with a unique name', async () => {
    const first = await addAIEndpoint('Home', b)
    const copy = await duplicateAIEndpoint(first.id)
    const again = await duplicateAIEndpoint(first.id)
    expect(copy).toMatchObject({ name: 'Home (copy)', apiKey: 'key-b', headers: [{ name: 'X-Team', value: 'blue' }] })
    expect(again.name).toBe('Home (copy) 2')
    expect(copy.id).not.toBe(first.id)
    expect((await listAIEndpoints()).activeId).toBe(first.id)
    await updateAIEndpoint(copy.id, { ...b, model: 'changed' })
    expect((await listAIEndpoints()).endpoints[0].model).toBe('model-b')
  })

  it('deleting the active endpoint activates a neighbour; deleting the last clears the connection', async () => {
    const first = await addAIEndpoint('Home', a)
    const second = await addAIEndpoint('Work', b)
    await deleteAIEndpoint(second.id)
    expect((await listAIEndpoints()).activeId).toBe(first.id)
    const third = await addAIEndpoint('Third', { ...a, model: 'model-c' })
    await deleteAIEndpoint(first.id)
    expect(await listAIEndpoints()).toMatchObject({ activeId: third.id })
    expect((await active())?.model).toBe('model-c')
    await deleteAIEndpoint(third.id)
    expect(await listAIEndpoints()).toEqual({ endpoints: [], activeId: undefined })
    expect(await active()).toBeUndefined()
  })

  it('keeps saveAIConnection and removeAIConnection working on the active endpoint', async () => {
    await saveAIConnection(a)
    expect((await listAIEndpoints()).endpoints).toHaveLength(1)
    expect((await listAIEndpoints()).endpoints[0].name).toBe('Default')
    const second = await addAIEndpoint('Work', b)
    await setActiveAIEndpoint(second.id)
    await saveAIConnection({ ...b, model: 'saved-over-active' })
    const list = await listAIEndpoints()
    expect(list.endpoints.map(endpoint => endpoint.model)).toEqual(['model-a', 'saved-over-active'])
    await removeAIConnection()
    expect((await listAIEndpoints()).endpoints.map(endpoint => endpoint.name)).toEqual(['Default'])
    expect((await active())?.model).toBe('model-a')
  })

  it('rejects invalid headers and storage acknowledgement', async () => {
    await expect(addAIEndpoint('Bad', { ...a, headers: [{ name: 'Authorization', value: 'x' }] })).rejects.toThrow()
    await expect(addAIEndpoint('Bad', { ...a, storageAcknowledged: false as never })).rejects.toThrow()
    expect((await listAIEndpoints()).endpoints).toEqual([])
  })
})

describe('migration of the single saved connection', () => {
  it('turns the existing connection into the first, active endpoint on database upgrade', async () => {
    const name = 'migration-test'
    const { default: Dexie } = await import('dexie')
    const old = new Dexie(name)
    old.version(13).stores({ aiConnections: '&id' })
    await old.open()
    await old.table('aiConnections').put({ ...a, baseUrl: 'https://a.example/v1', id: 'assistant', revision: 'r1', updatedAt: 5 })
    old.close()
    const { LearningDatabase } = await import('../database')
    const upgraded = new LearningDatabase(name)
    await upgraded.open()
    expect(await upgraded.aiEndpoints.toArray()).toMatchObject([{ id: 'default', name: 'Default', order: 0, apiKey: 'key-a', model: 'model-a', revision: 'r1' }])
    expect(await upgraded.aiConnections.get('assistant')).toMatchObject({ endpointId: 'default', name: 'Default', revision: 'r1', apiKey: 'key-a' })
    upgraded.close()
    await Dexie.delete(name)
  })

  it('migrates lazily when a legacy row exists without an endpoint list', async () => {
    await db.aiConnections.put({ ...a, baseUrl: 'https://a.example/v1', id: 'assistant', revision: 'r1', updatedAt: 5 })
    expect(await listAIEndpoints()).toMatchObject({ activeId: 'default', endpoints: [{ id: 'default', name: 'Default' }] })
    await updateAIEndpoint('default', { ...a, model: 'edited' })
    expect(await db.aiEndpoints.count()).toBe(1)
    expect(await active()).toMatchObject({ endpointId: 'default', model: 'edited' })
  })
})
