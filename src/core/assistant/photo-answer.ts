import { type AIConnectionInput } from './contracts'
import { blobToDataUrl } from './images'
import { AITransportError, AssistantCancelledError, createAssistantModelClient, type TutorMessage } from '../ai/provider'

/** A photo is read in one request; a slow model is cut off after this. */
export const PHOTO_READ_TIMEOUT_MS = 30_000
export const PHOTO_READ_ERROR = "Couldn't read the photo. Try again with more light, or type the answer."
const MAX_READING_LENGTH = 400

/** The words sent with the photo (pinned in __prompts__/P15-photo-answer.txt). The model transcribes only; the app checks the answer. */
export function photoReadingPrompt(languageName: string): { system: string; user: string } {
  return {
    system: `You read handwriting from a photo for a learner of ${languageName}. Transcribe exactly the handwritten ${languageName} text in the photo, character for character. Do not correct mistakes, translate, explain, add pinyin or other readings, or judge the answer. Reply with only the transcribed text on one line and nothing else. If there is no readable handwriting, reply with an empty line.`,
    user: `Transcribe the handwritten ${languageName} in this photo.`,
  }
}

/**
 * Reads the handwriting in one photo: one request to the learner's AI connection (the same client and endpoint settings the Assistant uses; chat completions
 * send an image_url part, responses an input_image part). The photo exists only in memory, as a data URL inside this request; nothing is stored.
 */
export async function readHandwritingPhoto(connection: AIConnectionInput, photo: Blob, languageName: string, signal?: AbortSignal): Promise<string> {
  try {
    const prompt = photoReadingPrompt(languageName)
    const dataUrl = await blobToDataUrl(photo)
    const messages: TutorMessage[] = [
      { role: 'system', content: prompt.system },
      { role: 'user', content: [{ type: 'text', text: prompt.user }, { type: 'image', dataUrl }] },
    ]
    // No lookup tools for a transcription, whatever the connection allows the Assistant.
    const client = createAssistantModelClient({ ...connection, nativeTools: false } as AIConnectionInput, messages)
    const completion = await client.complete([], { signal, timeoutMs: PHOTO_READ_TIMEOUT_MS, plainText: true })
    if (completion.kind !== 'reply') throw new AITransportError(PHOTO_READ_ERROR)
    const block = completion.reply.blocks[0]
    const text = block?.type === 'text' ? block.markdown.replace(/^```\w*\n?|\n?```$/g, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).join(' ') : ''
    if (!text || text.length > MAX_READING_LENGTH) throw new AITransportError(PHOTO_READ_ERROR)
    return text
  } catch (error) {
    if (error instanceof AssistantCancelledError) throw error
    throw new Error(PHOTO_READ_ERROR)
  }
}
