import index from '../../../data/v2/index.generated.json'
import type { PackData } from '../pack-data'

// The Chinese pack points at today's files: the v2 catalog, the shipped phrase bank and the practice dataset.
export const zhData: PackData = {
  catalog: {
    index, readingJoiner: ' ',
    bands: {
      '1': () => import('../../../data/v2/hsk-1.generated.json'),
      '2': () => import('../../../data/v2/hsk-2.generated.json'),
      '3': () => import('../../../data/v2/hsk-3.generated.json'),
      '4': () => import('../../../data/v2/hsk-4.generated.json'),
      '5': () => import('../../../data/v2/hsk-5.generated.json'),
      '6': () => import('../../../data/v2/hsk-6.generated.json'),
    },
  },
  phrases: {
    bands: {
      '1': () => import('../../../data/phrases/hsk-1.json'),
      '2': () => import('../../../data/phrases/hsk-2.json'),
      '3': () => import('../../../data/phrases/hsk-3.json'),
      '4': () => import('../../../data/phrases/hsk-4.json'),
      '5': () => import('../../../data/phrases/hsk-5.json'),
      '6': () => import('../../../data/phrases/hsk-6.json'),
    },
    index: () => import('../../../data/phrases/index.json'),
  },
  practice: {
    files: {
      accepted: { '1': () => import('../../../data/practice/accepted-hsk-1.json'), '2': () => import('../../../data/practice/accepted-hsk-2.json'), '3': () => import('../../../data/practice/accepted-hsk-3.json'), '4': () => import('../../../data/practice/accepted-hsk-4.json'), '5': () => import('../../../data/practice/accepted-hsk-5.json'), '6': () => import('../../../data/practice/accepted-hsk-6.json') },
      exchanges: { '1': () => import('../../../data/practice/exchanges-hsk-1.json'), '2': () => import('../../../data/practice/exchanges-hsk-2.json'), '3': () => import('../../../data/practice/exchanges-hsk-3.json'), '4': () => import('../../../data/practice/exchanges-hsk-4.json'), '5': () => import('../../../data/practice/exchanges-hsk-5.json'), '6': () => import('../../../data/practice/exchanges-hsk-6.json') },
      grammar: { '1': () => import('../../../data/practice/grammar-hsk-1.json'), '2': () => import('../../../data/practice/grammar-hsk-2.json'), '3': () => import('../../../data/practice/grammar-hsk-3.json'), '4': () => import('../../../data/practice/grammar-hsk-4.json'), '5': () => import('../../../data/practice/grammar-hsk-5.json'), '6': () => import('../../../data/practice/grammar-hsk-6.json') },
      conversations: { '1': () => import('../../../data/practice/conversations-hsk-1.json'), '2': () => import('../../../data/practice/conversations-hsk-2.json'), '3': () => import('../../../data/practice/conversations-hsk-3.json'), '4': () => import('../../../data/practice/conversations-hsk-4.json'), '5': () => import('../../../data/practice/conversations-hsk-5.json'), '6': () => import('../../../data/practice/conversations-hsk-6.json') },
    },
    index: () => import('../../../data/practice/index.json'),
  },
}
