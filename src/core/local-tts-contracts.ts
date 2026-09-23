import { z } from 'zod'
import { speechRateSchema } from './assistant/contracts'

export const LOCAL_TTS_PATH = '/__local/tts'
export const LOCAL_TTS_HEADER = 'x-linguaweave-local-tts'
export const LOCAL_TTS_MAX_BODY_BYTES = 16 * 1024

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
  voice: z.string().regex(/^(?:en-US|zh-CN)-[A-Za-z][A-Za-z0-9]{0,63}Neural$/),
  rate: speechRateSchema.default(1),
}).strict()

export type LocalTtsRequest = z.infer<typeof localTtsRequestSchema>
