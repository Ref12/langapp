import { z } from 'zod'
import { CONTENT_VERSION } from '../../data/content-version'
import { aiConnectionInputSchema, aiEndpointsExportSchema, assistantBackupSchema } from '../assistant/contracts'
import { speechConnectionInputSchema } from '../assistant/speech-contracts'
import { BackupValidationError, validateAssistant, validateCollections, validateStudy, validateWorkspace, workspaceSchema } from '../backup-codec'
import { languageRefSchema, studyBackupSchema, unitKindSchema, unitLabelSchema } from '../study/contracts'
import { profileMetadataSchema } from './identity'
import { LANGUAGE_IDS } from '../language/ids'
import { librarySchema } from '../library/contracts'
import { mediaItemSchema, sourceEntrySchema } from '../media/contracts'
import { collectionsBackupSchema } from '../collections/contracts'

export const MAX_PROFILE_BYTES = 10 * 1024 * 1024
export const PROFILE_FORMAT = 'linguaweave-profile'
export const PROFILE_VERSION = 5
export const profileDataSchema = z.object({
  format: z.literal(PROFILE_FORMAT),
  version: z.literal(PROFILE_VERSION),
  contentVersion: z.literal(CONTENT_VERSION),
  exportedAt: z.number().int().nonnegative(),
  /** The language of the build that wrote the file; absent means Chinese (every file written before this field was Chinese, and Chinese files still leave it out so older builds read them). */
  language: z.enum(LANGUAGE_IDS).optional(),
  profile: profileMetadataSchema,
  settings: z.object({
    preferences: workspaceSchema.shape.preferences,
    // Version 5 exports the endpoint list; the single connection is the older (version 1-4) shape.
    aiConnection: aiConnectionInputSchema.optional(),
    aiEndpoints: aiEndpointsExportSchema.optional(),
    speechConnection: speechConnectionInputSchema.optional(),
  }).strict(),
  knowledge: workspaceSchema.omit({ preferences: true }).extend({ study: studyBackupSchema }).strict(),
  conversations: assistantBackupSchema,
  library: librarySchema.default([]),
  media: z.array(mediaItemSchema).max(500).default([]),
  sourceEntries: z.array(sourceEntrySchema).max(100_000).default([]),
  collections: collectionsBackupSchema.default({ collections: [], items: [], cards: [] }),
}).strict()

export const profileSnapshotSchema = profileDataSchema.superRefine((snapshot, context) => {
  try {
    const { study, ...learning } = snapshot.knowledge
    validateWorkspace({ preferences: snapshot.settings.preferences, ...learning })
    validateStudy(study)
    validateCollections(snapshot.collections)
    validateAssistant(snapshot.conversations)
    if (snapshot.settings.aiConnection && snapshot.settings.aiEndpoints) throw new Error('Both AI connection shapes present.')
  } catch (error) {
    // Only our own checks carry a message that is safe to show; anything else stays generic.
    context.addIssue({ code: 'custom', message: error instanceof BackupValidationError ? error.message : 'Profile data contains invalid relationships.' })
  }
})

export type ProfileSnapshot = z.infer<typeof profileSnapshotSchema>

const wordSchema = workspaceSchema.shape.words.element.omit({ wordId: true }).extend({ lb: unitLabelSchema })
const questionSchema = workspaceSchema.shape.sessions.element.shape.questions.element.omit({ wordId: true })
  .extend({ lb: unitLabelSchema, options: z.array(unitLabelSchema) })
const sessionSchema = workspaceSchema.shape.sessions.element.extend({ questions: z.array(questionSchema) })
const attemptSchema = workspaceSchema.shape.attempts.element.omit({ wordId: true, answerId: true })
  .extend({ lb: unitLabelSchema, answerLb: unitLabelSchema })
// A language row (ja:/ko:/...) carries its ref explicitly; a Chinese row has none and rebuilds it from kind and lb.
const studyKnowledgeSchema = studyBackupSchema.shape.knowledge.element.omit({ ref: true }).extend({ ref: languageRefSchema.optional() })
const studyCardSchema = studyBackupSchema.shape.cards.element.omit({ id: true, ref: true })
  .extend({ ref: languageRefSchema.optional(), kind: unitKindSchema.or(z.literal('source')).optional(), lb: unitLabelSchema.optional() })
  .superRefine((card, context) => {
    if (card.ref === undefined && (card.kind === undefined || card.lb === undefined)) context.addIssue({ code: 'custom', message: 'A study card needs a ref, or a kind and a label.' })
    if (card.ref !== undefined && (card.kind !== undefined || card.lb !== undefined)) context.addIssue({ code: 'custom', message: 'A study card with a ref has no kind or label.' })
  })

// The wire format uses labels; normalized snapshots retain database keys in memory.
export const profileYamlSchema = profileDataSchema.extend({
  knowledge: profileDataSchema.shape.knowledge.extend({
    words: z.array(wordSchema),
    sessions: z.array(sessionSchema),
    attempts: z.array(attemptSchema),
    study: studyBackupSchema.extend({
      knowledge: z.array(studyKnowledgeSchema),
      cards: z.array(studyCardSchema),
    }),
  }),
})
export type ProfileYaml = z.infer<typeof profileYamlSchema>
