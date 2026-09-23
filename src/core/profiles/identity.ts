import { z } from 'zod'

export const DEFAULT_PROFILE_ID = 'default'
export const profileIdSchema = z.union([z.literal(DEFAULT_PROFILE_ID), z.string().uuid().transform(id => id.toLowerCase())])
export const profileMetadataSchema = z.object({
  id: profileIdSchema,
  name: z.string().trim().min(1).max(80),
}).strict()
export type ProfileMetadata = z.infer<typeof profileMetadataSchema>
