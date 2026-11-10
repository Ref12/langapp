import { getPack } from '../core/language'

/** A band's name as the page shows it ("HSK 1", "Level 1"): the pack's template with the number put in, as separate text nodes. */
export function Band({ n }: { n: string | number }) {
  const [before, after = ''] = getPack().wording.band.split('{n}')
  return <>{before}{n}{after}</>
}
