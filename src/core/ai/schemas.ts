import { z } from 'zod'

export const weaveCandidateSchema = z.object({
  itemId: z.string().optional(),
  sourceText: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  targetText: z.string().min(1),
  romanization: z.string(),
  gloss: z.string().min(1),
  itemType: z
    .enum(['word', 'phrase', 'idiom', 'construction', 'sentence-pattern'])
    .default('word'),
})

export const analyzeTextOutputSchema = z.object({
  candidates: z.array(weaveCandidateSchema),
})

export const analyzeTextInputSchema = z.object({
  text: z.string().min(1).max(20_000),
  targetLanguage: z.enum(['zh', 'ja', 'ko']),
  romanization: z.string().min(1),
  maximumNewItems: z.number().int().min(0).max(50),
  knownItems: z
    .array(
      z.object({
        id: z.string(),
        sourceText: z.string(),
        targetText: z.string(),
        romanization: z.string(),
        gloss: z.string(),
      }),
    )
    .max(500),
})

export const generateTurnInputSchema = z.object({
  targetLanguage: z.enum(['zh', 'ja', 'ko']),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(20_000),
      }),
    )
    .min(1)
    .max(100),
})

export const generateTurnOutputSchema = z.object({
  content: z.string().min(1),
})

export type AnalyzeTextInput = z.infer<typeof analyzeTextInputSchema>
export type AnalyzeTextOutput = z.infer<typeof analyzeTextOutputSchema>
export type GenerateTurnInput = z.infer<typeof generateTurnInputSchema>
export type GenerateTurnOutput = z.infer<typeof generateTurnOutputSchema>
