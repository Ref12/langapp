import { PageHeading } from '../shared'
import { buildWritingRoute } from '../../core/characters/writing-route'
import type { WritingGroup } from '../../core/language/writing'
import type { WritingLanguage } from '../../core/characters/language'

/** The Writing page without a character: every character the language has a guide for, in the groups the pack gives (Korean: the letters first, then the syllables). A character opens its guide. */
export function WritingList({ groups, language }: { groups: WritingGroup[]; language: WritingLanguage }) {
  const total = groups.reduce((sum, group) => sum + group.characters.length, 0)
  return <div className="writing-list">
    <PageHeading eyebrow="WRITE IT BY HAND" title="Writing">{total} guides. Choose a letter or a syllable to practise writing it.</PageHeading>
    {groups.map(group => <section key={group.id} className="writing-list-group" aria-labelledby={'writing-group-' + group.id}>
      <h2 id={'writing-group-' + group.id} className="writing-list-heading">{group.title}</h2>
      <ul className="writing-list-grid">
        {group.characters.map(character => <li key={character}>
          <a className="writing-list-item" lang={language} href={'#' + buildWritingRoute(character, 'all', { language, back: 'writing' })}>{character}</a>
        </li>)}
      </ul>
    </section>)}
  </div>
}
