import { languageNames } from '../domain'
import { requestChatCompletion } from './provider'
import {
  analyzeTextInputSchema,
  analyzeTextOutputSchema,
  generateTurnInputSchema,
  generateTurnOutputSchema,
  type AnalyzeTextInput,
  type AnalyzeTextOutput,
  type GenerateTurnInput,
  type GenerateTurnOutput,
} from './schemas'

function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] ?? content
  const objectStart = candidate.indexOf('{')
  const objectEnd = candidate.lastIndexOf('}')
  if (objectStart < 0 || objectEnd < objectStart) {
    throw new Error('The AI response did not contain valid JSON.')
  }
  return JSON.parse(candidate.slice(objectStart, objectEnd + 1))
}

const operations = {
  'language.analyzeText': {
    input: analyzeTextInputSchema,
    output: analyzeTextOutputSchema,
    async execute(input: AnalyzeTextInput, signal?: AbortSignal) {
      if (input.maximumNewItems === 0) return { candidates: [] }

      const language = languageNames[input.targetLanguage]
      const knownItems = input.knownItems
        .map(
          (item) =>
            `${item.id}: ${item.sourceText} => ${item.targetText} (${item.romanization}; ${item.gloss})`,
        )
        .join('\n')
      const content = await requestChatCompletion(
        [
          {
            role: 'system',
            content:
              'You identify context-aware learning spans for a language learner. Return JSON only. Never translate a span if its meaning is ambiguous in context.',
          },
          {
            role: 'user',
            content: `Annotate every contextually valid occurrence of the known items below. Also select up to ${input.maximumNewItems} useful new English words or short phrases for a ${language} learner. Romanization style: ${input.romanization}.

Return:
{"candidates":[{"itemId":"known id when applicable","sourceText":"exact source slice","start":0,"end":5,"targetText":"native form","romanization":"romanization","gloss":"short English gloss","itemType":"word"}]}

Offsets are zero-based UTF-16 indices into the exact text. Verify text.slice(start,end) equals sourceText.

KNOWN ITEMS:
${knownItems || '(none)'}

TEXT:
${input.text}`,
          },
        ],
        signal,
      )

      return analyzeTextOutputSchema.parse(extractJson(content))
    },
  },
  'conversation.generateTurn': {
    input: generateTurnInputSchema,
    output: generateTurnOutputSchema,
    async execute(input: GenerateTurnInput, signal?: AbortSignal) {
      const language = languageNames[input.targetLanguage]
      const content = await requestChatCompletion(
        [
          {
            role: 'system',
            content: `You are a friendly conversation partner helping an English speaker learn ${language}. Respond primarily in clear, natural English. Do not perform diglot substitutions yourself; the application applies them after your response.`,
          },
          ...input.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
        signal,
      )

      return { content }
    },
  },
}

export type AIOperationId = keyof typeof operations

export async function invokeAIOperation(
  id: 'language.analyzeText',
  input: AnalyzeTextInput,
  signal?: AbortSignal,
): Promise<AnalyzeTextOutput>
export async function invokeAIOperation(
  id: 'conversation.generateTurn',
  input: GenerateTurnInput,
  signal?: AbortSignal,
): Promise<GenerateTurnOutput>
export async function invokeAIOperation(
  id: AIOperationId,
  input: AnalyzeTextInput | GenerateTurnInput,
  signal?: AbortSignal,
): Promise<AnalyzeTextOutput | GenerateTurnOutput> {
  const operation = operations[id] as {
    input: { parse: (value: unknown) => unknown }
    output: { parse: (value: unknown) => unknown }
    execute: (value: never, signal?: AbortSignal) => Promise<unknown>
  }
  const validatedInput = operation.input.parse(input)
  const output = await operation.execute(validatedInput as never, signal)
  return operation.output.parse(output) as AnalyzeTextOutput | GenerateTurnOutput
}
