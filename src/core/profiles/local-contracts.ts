import { z } from 'zod'
import { profileMetadataSchema } from './identity'

export const LOCAL_PROFILES_PATH = '/__local/profiles'
export const LOCAL_PROFILES_HEADER = 'x-linguaweave-local-profiles'
export const MAX_LOCAL_PROFILES = 500
export const profileRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const localProfileFileSchema = profileMetadataSchema.extend({ revision: profileRevisionSchema })
export const localProfileListSchema = z.object({ profiles: z.array(localProfileFileSchema).max(MAX_LOCAL_PROFILES) }).strict()
export const localProfileReadSchema = z.object({ yaml: z.string(), revision: profileRevisionSchema }).strict()
export const localProfileSaveInputSchema = z.object({
  yaml: z.string(),
  expectedRevision: profileRevisionSchema.nullable(),
}).strict()
export const localProfileSaveReplySchema = z.object({
  profile: profileMetadataSchema,
  revision: profileRevisionSchema,
}).strict()
export type LocalProfileFile = z.infer<typeof localProfileFileSchema>
export type LocalProfileSaveInput = z.infer<typeof localProfileSaveInputSchema>
