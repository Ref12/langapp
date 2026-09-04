import { MessageCircle } from 'lucide-react'
import { defineLearningModule } from '../../core/modules'
import { ConversationPage } from './ConversationPage'

export const conversationModule = defineLearningModule({
  id: 'conversation',
  version: '0.1.0',
  label: 'Conversation',
  description: 'Talk with AI while learned items are woven into responses.',
  path: '/modules/conversation',
  icon: MessageCircle,
  requiredAIOperations: [
    'conversation.generateTurn',
    'language.analyzeText',
  ],
  component: ConversationPage,
})
