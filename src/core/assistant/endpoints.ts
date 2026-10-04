import {
  aiConnectionInputSchema, aiConnectionSchema, aiEndpointNameSchema, aiEndpointSchema, MAX_AI_ENDPOINTS,
  type AIConnection, type AIConnectionInput, type AIEndpoint,
} from './contracts'
import { db } from '../database'
import { omit } from '../omit'

// Endpoints live in db.aiEndpoints. The 'assistant' row of db.aiConnections is the active
// endpoint's working copy (tagged with endpointId/name); all AI consumers keep reading that row.

const trimUrl = (input: AIConnectionInput): AIConnectionInput => ({ ...input, baseUrl: input.baseUrl.replace(/\/+$/, '') })
const tables = () => [db.aiConnections, db.aiEndpoints]

function cleanInput(input: AIConnectionInput): AIConnectionInput {
  const parsed = trimUrl(aiConnectionInputSchema.parse(input))
  const { headers, ...rest } = parsed
  return headers && headers.length ? { ...rest, headers } : rest
}

function uniqueName(name: string, taken: AIEndpoint[]): string {
  const names = new Set(taken.map(endpoint => endpoint.name.toLowerCase()))
  if (!names.has(name.toLowerCase())) return name
  for (let n = 2; ; n++) {
    const candidate = `${name.slice(0, 70)} ${n}`
    if (!names.has(candidate.toLowerCase())) return candidate
  }
}

function assertNameFree(name: string, endpoints: AIEndpoint[], exceptId?: string): void {
  if (endpoints.some(endpoint => endpoint.id !== exceptId && endpoint.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('An endpoint with that name already exists. Choose another name.')
  }
}

async function readEndpoints(): Promise<AIEndpoint[]> {
  await migrateLegacyConnection()
  return (await db.aiEndpoints.orderBy('order').toArray())
}

// Covers a legacy single connection written without the endpoint list (e.g. by an older tab).
async function migrateLegacyConnection(): Promise<void> {
  if (await db.aiEndpoints.count() > 0) return
  const current = await db.aiConnections.get('assistant')
  if (!current) return
  const parsed = aiConnectionSchema.safeParse(current)
  if (!parsed.success) return
  await db.aiEndpoints.put({ ...omit(parsed.data, 'id', 'endpointId', 'name'), id: 'default', name: 'Default', order: 0 })
  await db.aiConnections.put({ ...parsed.data, endpointId: 'default', name: 'Default' })
}

async function writeMirror(endpoint: AIEndpoint | undefined): Promise<void> {
  if (!endpoint) { await db.aiConnections.delete('assistant'); return }
  await db.aiConnections.put(aiConnectionSchema.parse({ ...omit(endpoint, 'id', 'name', 'order'), id: 'assistant', endpointId: endpoint.id, name: endpoint.name, revision: crypto.randomUUID(), updatedAt: Date.now() }))
}

export interface AIEndpointList { endpoints: AIEndpoint[]; activeId: string | undefined }

// Read-only (safe inside liveQuery). Shows a not-yet-migrated single connection as the "Default" endpoint.
export async function listAIEndpoints(): Promise<AIEndpointList> {
  return db.transaction('r', tables(), async () => {
    const mirror = await db.aiConnections.get('assistant')
    let endpoints = await db.aiEndpoints.orderBy('order').toArray()
    if (!endpoints.length && mirror && aiConnectionSchema.safeParse(mirror).success) {
      endpoints = [{ ...omit(mirror, 'id', 'endpointId', 'name'), id: 'default', name: 'Default', order: 0 }]
      return { endpoints, activeId: 'default' }
    }
    const activeId = mirror?.endpointId
    return { endpoints, activeId: endpoints.some(endpoint => endpoint.id === activeId) ? activeId : undefined }
  })
}

export async function addAIEndpoint(name: string, input: AIConnectionInput, options: { activate?: boolean } = {}): Promise<AIEndpoint> {
  const safeName = aiEndpointNameSchema.parse(name)
  const value = cleanInput(input)
  return db.transaction('rw', tables(), async () => {
    const endpoints = await readEndpoints()
    if (endpoints.length >= MAX_AI_ENDPOINTS) throw new Error(`You can save at most ${MAX_AI_ENDPOINTS} endpoints.`)
    assertNameFree(safeName, endpoints)
    const endpoint = aiEndpointSchema.parse({
      ...value, id: crypto.randomUUID(), name: safeName, order: endpoints.reduce((max, item) => Math.max(max, item.order), -1) + 1,
      revision: crypto.randomUUID(), updatedAt: Date.now(),
    })
    await db.aiEndpoints.add(endpoint)
    if (options.activate || !(await db.aiConnections.get('assistant'))) await writeMirror(endpoint)
    return endpoint
  })
}

export async function updateAIEndpoint(id: string, input: AIConnectionInput, name?: string): Promise<AIEndpoint> {
  const value = cleanInput(input)
  return db.transaction('rw', tables(), async () => {
    const endpoints = await readEndpoints()
    const current = endpoints.find(endpoint => endpoint.id === id)
    if (!current) throw new Error('That endpoint no longer exists.')
    const safeName = name === undefined ? current.name : aiEndpointNameSchema.parse(name)
    assertNameFree(safeName, endpoints, id)
    const next = aiEndpointSchema.parse({ ...omit(current, 'headers'), ...value, name: safeName, revision: crypto.randomUUID(), updatedAt: Date.now() })
    await db.aiEndpoints.put(next)
    if ((await db.aiConnections.get('assistant'))?.endpointId === id) await writeMirror(next)
    return next
  })
}

export async function renameAIEndpoint(id: string, name: string): Promise<void> {
  const safeName = aiEndpointNameSchema.parse(name)
  await db.transaction('rw', tables(), async () => {
    const endpoints = await readEndpoints()
    const current = endpoints.find(endpoint => endpoint.id === id)
    if (!current) throw new Error('That endpoint no longer exists.')
    assertNameFree(safeName, endpoints, id)
    const next = { ...current, name: safeName, updatedAt: Date.now() }
    await db.aiEndpoints.put(next)
    // A rename does not change what requests are sent, so the working copy keeps its revision.
    const mirror = await db.aiConnections.get('assistant')
    if (mirror?.endpointId === id) await db.aiConnections.put({ ...mirror, name: safeName })
  })
}

export async function duplicateAIEndpoint(id: string): Promise<AIEndpoint> {
  return db.transaction('rw', tables(), async () => {
    const endpoints = await readEndpoints()
    const source = endpoints.find(endpoint => endpoint.id === id)
    if (!source) throw new Error('That endpoint no longer exists.')
    if (endpoints.length >= MAX_AI_ENDPOINTS) throw new Error(`You can save at most ${MAX_AI_ENDPOINTS} endpoints.`)
    const copy: AIEndpoint = {
      ...source, headers: source.headers?.map(header => ({ ...header })), id: crypto.randomUUID(),
      name: uniqueName(`${source.name.slice(0, 70)} (copy)`, endpoints),
      order: endpoints.reduce((max, item) => Math.max(max, item.order), -1) + 1, revision: crypto.randomUUID(), updatedAt: Date.now(),
    }
    await db.aiEndpoints.add(aiEndpointSchema.parse(copy))
    return copy
  })
}

export async function setActiveAIEndpoint(id: string): Promise<void> {
  await db.transaction('rw', tables(), async () => {
    const endpoint = (await readEndpoints()).find(item => item.id === id)
    if (!endpoint) throw new Error('That endpoint no longer exists.')
    if ((await db.aiConnections.get('assistant'))?.endpointId !== id) await writeMirror(endpoint)
  })
}

// Deleting the active endpoint activates the next remaining one (none when it was the last).
export async function deleteAIEndpoint(id: string): Promise<void> {
  await db.transaction('rw', tables(), async () => {
    const endpoints = await readEndpoints()
    const index = endpoints.findIndex(endpoint => endpoint.id === id)
    if (index < 0) return
    await db.aiEndpoints.delete(id)
    if ((await db.aiConnections.get('assistant'))?.endpointId === id) {
      const rest = endpoints.filter(endpoint => endpoint.id !== id)
      await writeMirror(rest[Math.min(index, rest.length - 1)])
    }
  })
}

// Saves into the active endpoint, creating a "Default" one when none exists.
export async function saveActiveAIConnection(input: AIConnectionInput): Promise<void> {
  const { endpoints, activeId } = await listAIEndpoints()
  if (activeId) await updateAIEndpoint(activeId, input)
  else await addAIEndpoint(uniqueName('Default', endpoints), input, { activate: true })
}

export async function removeActiveAIConnection(): Promise<void> {
  const { activeId } = await listAIEndpoints()
  if (activeId) await deleteAIEndpoint(activeId)
  else await db.aiConnections.delete('assistant')
}

export type { AIConnection }
