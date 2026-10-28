import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { stringify } from 'yaml'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { db, initializeWorkspace } from '../database'
import { resetProfileStorage } from '../../test/profile-storage'
import { redact } from '../backup/diagnostics'
import type { AIAPIType } from './contracts'
import { fitWithin, prepareImages, redactImageData } from './images'
import { sendAssistantTurn } from './runtime'
import { createConversation, deleteThread, saveAIConnection, saveDraft } from './store'

const settings = {
  baseUrl: 'https://example.test/v1', apiKey: 'image-private-key', model: 'test-model',
  nativeTools: false, structuredOutput: false, storageAcknowledged: true as const,
}
const blocks = [{ type: 'text', markdown: 'It says 茶.' }]
function finalResponse(apiType: AIAPIType = 'chat-completions') {
  const text = stringify({ blocks }, { indentSeq: false })
  return new Response(JSON.stringify(apiType === 'responses'
    ? { status: 'completed', output: [{ type: 'message', id: 'r', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] }
    : { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }] }))
}
// Node's Blob survives fake-indexeddb's structured clone; jsdom's does not.
const jpeg = (size = 8, byte = 1) => new NodeBlob([new Uint8Array(size).fill(byte)], { type: 'image/jpeg' }) as unknown as Blob
const image = (blob = jpeg()) => ({ id: crypto.randomUUID(), blob, width: 40, height: 30, bytes: blob.size })
function mockFetch(...responses: Response[]) {
  const fetcher = vi.fn()
  responses.forEach(response => fetcher.mockResolvedValueOnce(response))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
const requestBody = (fetcher: ReturnType<typeof vi.fn>, index = 0) => JSON.parse(fetcher.mock.calls[index][1].body as string)
async function thread(draft = 'What does this say?') {
  const id = await createConversation()
  await saveDraft(id, draft)
  return id
}

beforeEach(async () => { await resetProfileStorage(); await initializeWorkspace(); await saveAIConnection(settings) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('image preparation', () => {
  it('fits the longest side to 1600 px without upscaling', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(900, 1200)).toEqual({ width: 900, height: 1200 })
    expect(fitWithin(1000, 4000)).toEqual({ width: 400, height: 1600 })
  })

  it('downscales a 4000 px image to at most 1600 px as JPEG, applying EXIF orientation', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => undefined }))
    const bitmapOptions: unknown[] = []
    vi.stubGlobal('createImageBitmap', vi.fn(async (_file: Blob, options: unknown) => {
      bitmapOptions.push(options)
      return { width: 4000, height: 3000, close: vi.fn() }
    }))
    const drawn: number[][] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      fillRect: vi.fn(), set fillStyle(_value: string) { /* ignored */ },
      drawImage: (_source: unknown, ...args: number[]) => { drawn.push(args) },
    }) as unknown as CanvasRenderingContext2D)
    const types: unknown[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, type, quality) {
      types.push([type, quality, this.width, this.height])
      callback(new Blob(['x'], { type: 'image/jpeg' }))
    })
    const [prepared] = await prepareImages([new File(['raw'], 'photo.png', { type: 'image/png' })], 0)
    expect(Math.max(prepared.width, prepared.height)).toBeLessThanOrEqual(1600)
    expect(prepared).toMatchObject({ width: 1600, height: 1200 })
    expect(prepared.blob.type).toBe('image/jpeg')
    expect(drawn[0]).toEqual([0, 0, 1600, 1200])
    expect(types[0]).toEqual(['image/jpeg', 0.85, 1600, 1200])
    expect(bitmapOptions[0]).toEqual({ imageOrientation: 'from-image' })
  })

  it('refuses more than four images and ignores non-images', async () => {
    await expect(prepareImages([jpeg()], 4)).rejects.toThrow('up to 4 images')
    expect(await prepareImages([new Blob(['x'], { type: 'text/plain' })], 0)).toEqual([])
  })
})

describe('sending images', () => {
  it('stores the image in assistantImages, references it by imageIds and sends text plus a data-URL part (chat completions)', async () => {
    const fetcher = mockFetch(finalResponse())
    const id = await thread()
    await sendAssistantTurn(id, { text: 'What does this say?', images: [image()] })
    const user = (await db.assistantMessages.where('threadId').equals(id).sortBy('sequence'))[0]
    expect(user.imageIds).toHaveLength(1)
    const row = await db.assistantImages.get(user.imageIds![0])
    expect(row).toMatchObject({ threadId: id, messageId: user.id, width: 40, height: 30, bytes: 8 })
    expect(row!.blob.size).toBe(8)
    const content = requestBody(fetcher).messages.at(-1).content
    expect(content[0]).toMatchObject({ type: 'text' })
    expect(JSON.parse(content[0].text).request).toBe('What does this say?')
    expect(content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AQEBAQEBAQE=' } })
    expect(requestBody(fetcher).messages[0].content).toContain("learner's own material")
  })

  it('uses input_text and input_image for the Responses API', async () => {
    await saveAIConnection({ ...settings, apiType: 'responses' })
    const fetcher = mockFetch(finalResponse('responses'))
    const id = await thread()
    await sendAssistantTurn(id, { text: 'Read this', images: [image()] })
    const content = requestBody(fetcher).input.at(-1).content
    expect(content[0].type).toBe('input_text')
    expect(content[1]).toEqual({ type: 'input_image', image_url: 'data:image/jpeg;base64,AQEBAQEBAQE=' })
  })

  it('re-sends images only for the last two learner messages; older turns say [image omitted]', async () => {
    const id = await thread('one')
    const sent = async (text: string) => {
      const fetcher = mockFetch(finalResponse())
      await sendAssistantTurn(id, { text, images: [image(jpeg(8, text.length))], preserveDraft: true })
      return requestBody(fetcher).messages as { role: string; content: unknown }[]
    }
    await sent('a')
    await sent('bb')
    const messages = await sent('ccc')
    const users = messages.filter(message => message.role === 'user')
    expect(users).toHaveLength(3)
    expect(typeof users[0].content).toBe('string')
    expect(users[0].content).toContain('[image omitted]')
    expect(Array.isArray(users[1].content)).toBe(true)
    expect(Array.isArray(users[2].content)).toBe(true)
  })

  it('shows "does not accept images" on a 400, keeps the stored images and records the failure', async () => {
    mockFetch(new Response('{}', { status: 400 }))
    const id = await thread()
    await expect(sendAssistantTurn(id, { text: 'What does this say?', images: [image()] })).rejects.toThrow('This model does not accept images')
    const messages = await db.assistantMessages.where('threadId').equals(id).sortBy('sequence')
    expect(messages[1]).toMatchObject({ status: 'failed', error: expect.stringContaining('does not accept images') })
    expect(await db.assistantImages.count()).toBe(1)
  })

  it('does not treat a 400 as an image problem when no image was sent', async () => {
    mockFetch(new Response('{}', { status: 400 }))
    const id = await thread()
    await expect(sendAssistantTurn(id)).rejects.toThrow('rejected this request')
  })
})

describe('image storage lifecycle', () => {
  it('excludes images from the backup and keeps the ids after a restore', async () => {
    mockFetch(finalResponse())
    const id = await thread()
    await sendAssistantTurn(id, { text: 'Read this', images: [image(jpeg(5000))] })
    const user = (await db.assistantMessages.where('threadId').equals(id).sortBy('sequence'))[0]
    const backup = await exportWorkspaceBackup()
    expect(backup).not.toContain('base64')
    expect(backup).toContain(user.imageIds![0])
    await restoreBackup(backup)
    expect(await db.assistantImages.count()).toBe(0)
    expect((await db.assistantMessages.get(user.id))?.imageIds).toEqual(user.imageIds)
  })

  it('deleting a conversation deletes its images', async () => {
    mockFetch(finalResponse())
    const id = await thread()
    await sendAssistantTurn(id, { text: 'Read this', images: [image(), image()] })
    expect(await db.assistantImages.count()).toBe(2)
    await deleteThread(id)
    expect(await db.assistantImages.count()).toBe(0)
  })
})

describe('diagnostics', () => {
  it('redacts image data to its byte count', () => {
    const data = btoa('x'.repeat(300))
    expect(redactImageData(`url data:image/jpeg;base64,${data} end`)).toBe('url <image 300 bytes> end')
    expect(redact(`failed: data:image/jpeg;base64,${data}`)).toBe('failed: <image 300 bytes>')
  })
})
