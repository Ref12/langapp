import { z } from 'zod'
import type { AIConnection } from './domain'

const aiConnectionSchema = z.object({
  id: z.literal('default'),
  baseUrl: z
    .string()
    .url()
    .refine((value) => value.startsWith('https://'), 'API URL must use HTTPS.'),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  warningAcknowledged: z.literal(true),
  configurationVersion: z.number().int().positive(),
  lastTestStatus: z.enum(['success', 'failure']).optional(),
  lastTestMessage: z.string().optional(),
  lastTestedAt: z.string().optional(),
  updatedAt: z.string(),
})

const aiSettingsEnvelopeSchema = z.object({
  format: z.literal('linguaweave-ai-settings'),
  version: z.literal(1),
  exportedAt: z.string(),
  warning: z.literal('contains-plaintext-api-key'),
  connection: aiConnectionSchema,
})

export type AISettingsEnvelope = z.infer<typeof aiSettingsEnvelopeSchema>

export function createAISettingsExport(
  connection: AIConnection,
): AISettingsEnvelope {
  return {
    format: 'linguaweave-ai-settings',
    version: 1,
    exportedAt: new Date().toISOString(),
    warning: 'contains-plaintext-api-key',
    connection: aiConnectionSchema.parse(connection),
  }
}

export function parseAISettingsImport(value: unknown): AISettingsEnvelope {
  const result = aiSettingsEnvelopeSchema.safeParse(value)
  if (!result.success) {
    throw new Error(
      `This AI settings file is invalid: ${result.error.issues
        .map((issue) => issue.message)
        .join(' ')}`,
    )
  }
  return result.data
}
