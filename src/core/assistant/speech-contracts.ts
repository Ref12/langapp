import { z } from 'zod'

export const speechConnectionInputSchema = z.object({
  provider: z.literal('azure'),
  region: z.string().trim().regex(/^[a-z][a-z0-9-]{1,63}$/, 'Use an Azure Speech region identifier, such as eastus.'),
  apiKey: z.string().trim().min(1).max(4000),
  storageAcknowledged: z.literal(true),
}).strict()
export const speechConnectionSchema = speechConnectionInputSchema.extend({
  id: z.literal('assistant-speech'),
  revision: z.string().min(1).max(200),
  updatedAt: z.number().int().nonnegative(),
}).strict()

const score = z.number().finite().min(0).max(100)
export const speechAssessmentSchema = z.object({
  status: z.enum(['assessed', 'no-speech', 'incomplete']),
  accuracy: score.optional(),
  fluency: score.optional(),
  completeness: score.optional(),
  words: z.array(z.object({
    text: z.string().min(1).max(1000),
    accuracy: score.optional(),
    errorType: z.string().max(100).optional(),
    phonemes: z.array(z.object({
      text: z.string().min(1).max(512),
      accuracy: score.optional(),
    }).strict()).max(256).optional(),
  }).strict()).max(5000),
}).strict().superRefine((assessment, context) => {
  if (assessment.status === 'assessed' && (assessment.accuracy === undefined || assessment.fluency === undefined || assessment.completeness === undefined)) {
    context.addIssue({ code: 'custom', message: 'A complete speech assessment requires all three provider measurements.' })
  }
  if (assessment.status === 'no-speech' && (assessment.accuracy !== undefined || assessment.fluency !== undefined
    || assessment.completeness !== undefined || assessment.words.length)) {
    context.addIssue({ code: 'custom', message: 'A no-speech result cannot contain pronunciation scores or recognized words.' })
  }
})

export type SpeechConnectionInput = z.infer<typeof speechConnectionInputSchema>
export type SpeechConnection = z.infer<typeof speechConnectionSchema>
export type SpeechAssessment = z.infer<typeof speechAssessmentSchema>
