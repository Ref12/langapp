import wordLabels from '../../data/v2/profile-word-labels.generated.json'
import { cardId, parseUnitRef, unitRef } from '../study/contracts'
import { type ProfileSnapshot, type ProfileYaml } from './contracts'

const labelsById = new Map(wordLabels.map(word => [word.id, word.lb]))
const idsByLabel = new Map(wordLabels.map(word => [word.lb, word.id]))

function wordLabel(id: string): string {
  const label = labelsById.get(id)
  if (!label) throw new Error('A saved vocabulary entry has no export label.')
  return label
}

function wordId(lb: string): string {
  const id = idsByLabel.get(lb)
  if (!id) throw new Error('The profile contains an unknown vocabulary label.')
  return id
}

export function toProfileYaml(snapshot: ProfileSnapshot): ProfileYaml {
  const { knowledge } = snapshot
  return {
    ...snapshot,
    knowledge: {
      ...knowledge,
      words: knowledge.words.map(({ wordId, ...word }) => ({ ...word, lb: wordLabel(wordId) })),
      sessions: knowledge.sessions.map(session => ({
        ...session,
        questions: session.questions.map(({ wordId, options, ...question }) => ({
          ...question, lb: wordLabel(wordId), options: options.map(wordLabel),
        })),
      })),
      attempts: knowledge.attempts.map(({ wordId, answerId, ...attempt }) => ({
        ...attempt, lb: wordLabel(wordId), answerLb: wordLabel(answerId),
      })),
      study: {
        ...knowledge.study,
        knowledge: knowledge.study.knowledge.map(({ ref, ...entry }) => {
          if (ref !== unitRef(entry.kind, entry.lb)) throw new Error('The knowledge entry has inconsistent labels.')
          return entry
        }),
        cards: knowledge.study.cards.map(({ id, ref, ...card }) => {
          if (id !== cardId(ref, card.domain)) throw new Error('The study card has inconsistent labels.')
          return { ...card, ...parseUnitRef(ref) }
        }),
      },
    },
  }
}

export function fromProfileYaml(snapshot: ProfileYaml): ProfileSnapshot {
  const { knowledge } = snapshot
  return {
    ...snapshot,
    knowledge: {
      ...knowledge,
      words: knowledge.words.map(({ lb, ...word }) => ({ ...word, wordId: wordId(lb) })),
      sessions: knowledge.sessions.map(session => ({
        ...session,
        questions: session.questions.map(({ lb, options, ...question }) => ({
          ...question, wordId: wordId(lb), options: options.map(wordId),
        })),
      })),
      attempts: knowledge.attempts.map(({ lb, answerLb, ...attempt }) => ({
        ...attempt, wordId: wordId(lb), answerId: wordId(answerLb),
      })),
      study: {
        ...knowledge.study,
        knowledge: knowledge.study.knowledge.map(entry => ({ ...entry, ref: unitRef(entry.kind, entry.lb) })),
        cards: knowledge.study.cards.map(({ kind, lb, ...card }) => {
          const ref = unitRef(kind, lb)
          return { ...card, ref, id: cardId(ref, card.domain) }
        }),
      },
    },
  }
}
