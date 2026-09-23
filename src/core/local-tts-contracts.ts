import { z } from 'zod'
import { edgeVoiceIdSchema, speechRateSchema } from './assistant/contracts'

export const LOCAL_TTS_PATH = '/__local/tts'
export const LOCAL_TTS_HEADER = 'x-linguaweave-local-tts'
export const LOCAL_TTS_MAX_BODY_BYTES = 16 * 1024
export const LOCAL_TTS_VOICES_PATH = `${LOCAL_TTS_PATH}/voices`
export const LOCAL_TTS_MAX_RESPONSE_BYTES = 4 * 1024 * 1024

export const edgeVoiceCatalogSchema = z.object({
  voices: z.array(z.object({
    id: edgeVoiceIdSchema,
    name: z.string().min(1).max(512),
    locale: z.string().min(1).max(100),
    gender: z.string().min(1).max(30),
  }).strict()).max(1000),
}).strict()
export type EdgeVoice = z.infer<typeof edgeVoiceCatalogSchema>['voices'][number]

export const localTtsRequestSchema = z.object({
  text: z.string().trim().min(1).max(1000).refine(
    text => Array.from(text).every(character => {
      const code = character.codePointAt(0) ?? 0
      return code === 9 || code === 10 || code === 13
        || (code >= 0x20 && code <= 0xd7ff)
        || (code >= 0xe000 && code <= 0xfffd)
        || (code >= 0x10000 && code <= 0x10ffff)
    }),
    'Text contains unsupported XML characters.',
  ),
  voice: edgeVoiceIdSchema,
  rate: z.union([speechRateSchema, z.literal(0.85)]).default(1),
}).strict()

export type LocalTtsRequest = z.infer<typeof localTtsRequestSchema>

export interface LocalTtsWordBoundary {
  text: string
  /** Seconds from the beginning of the synthesized audio, including pauses. */
  startTime: number
  /** Duration in seconds at the synthesized speaking rate. */
  duration: number
}

export interface LocalTtsResponse {
  audio: {
    contentType: 'audio/mpeg'
    base64: string
  }
  wordBoundaries: LocalTtsWordBoundary[]
}

export const localTtsResponseSchema: z.ZodType<LocalTtsResponse> = z.object({
  audio: z.object({
    contentType: z.literal('audio/mpeg'),
    base64: z.string().min(4).max(2_796_204).regex(/^[A-Za-z0-9+/]+={0,2}$/).refine(value => value.length % 4 === 0),
  }).strict(),
  wordBoundaries: z.array(z.object({
    text: z.string().min(1).max(6000),
    startTime: z.number().finite().nonnegative(),
    duration: z.number().finite().nonnegative(),
  }).strict()).max(1000),
}).strict()
