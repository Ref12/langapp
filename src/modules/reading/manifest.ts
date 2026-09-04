import { BookOpen } from 'lucide-react'
import { defineLearningModule } from '../../core/modules'
import { ReadingPage } from './ReadingPage'

export const readingModule = defineLearningModule({
  id: 'reading',
  version: '0.1.0',
  label: 'Reading',
  description: 'Read imported content with deliberate language weaving.',
  path: '/modules/reading',
  icon: BookOpen,
  requiredAIOperations: ['language.analyzeText'],
  component: ReadingPage,
})
