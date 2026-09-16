import { conversationModule } from './conversation/manifest'
import { readingModule } from './reading/manifest'

export const moduleRegistry = [readingModule, conversationModule] as const
