// The legacy word-list labels (id -> lb) that profiles export. Only the Chinese data has them; a build for another language folds the import away (like packs.ts).
import zhWordLabels from '../../data/v2/profile-word-labels.generated.json'

declare const __PACK_DATA__: string

export const legacyWordLabels: { id: string; lb: string }[] = typeof __PACK_DATA__ === 'undefined' || __PACK_DATA__ === 'all' || __PACK_DATA__ === 'zh' ? zhWordLabels : []
