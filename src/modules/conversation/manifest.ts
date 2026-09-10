import { MessageCircle } from 'lucide-react'
import { defineLearningModule } from '../../core/modules'
import { ConversationPage } from './ConversationPage'

export const conversationModule = defineLearningModule({
  id: 'conversation',
  version: '0.2.0',
  label: 'Conversation',
  description: 'Text chat with weaving, or a bilingual voice tutor with reviewed recordings and pronunciation practice.',
  path: '/modules/conversation',
  icon: MessageCircle,
  requiredAIOperations: [
    'conversation.generateTurn',
    'conversation.generateVoiceTurn',
    'language.analyzeText',
  ],
  component: ConversationPage,
})
