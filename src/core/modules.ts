import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface LearningModuleManifest {
  id: string
  version: string
  label: string
  description: string
  path: string
  icon: LucideIcon
  requiredAIOperations: string[]
  component: ComponentType
}

export function defineLearningModule(
  manifest: LearningModuleManifest,
): LearningModuleManifest {
  return manifest
}
