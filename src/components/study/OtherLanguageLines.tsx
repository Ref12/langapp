import { useContext, useEffect, useState } from 'react'
import { cardLineFor, loadParallel, type CardLine, type ParallelLanguage } from '../../core/parallel/data'
import { OtherLanguageSetting, languagesFor } from './other-language-setting'
import { tracks } from '../../data/tracks'

const glyph = (language: ParallelLanguage) => tracks.find(track => track.language === language)!.glyph

/**
 * One small muted line per chosen language under a Chinese vocabulary card, e.g. "日 学生 がくせい · 한 학생", from the parallel
 * senses mapping, linking to that language's lesson. Loads a language's data only when the setting asks for it.
 */
export function OtherLanguageLines({ senseId }: { senseId: string }) {
  const setting = useContext(OtherLanguageSetting)
  const languages = languagesFor(setting)
  const [lines, setLines] = useState<CardLine[]>([])
  const key = languages.join()
  useEffect(() => {
    let live = true
    if (!languages.length) { setLines([]); return }
    Promise.all(languages.map(language => loadParallel(language).then(data => cardLineFor(data, senseId)))).then(
      found => { if (live) setLines(found.filter((line): line is CardLine => line !== undefined)) },
      () => { if (live) setLines([]) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, senseId])
  if (!lines.length) return null
  return <p className="small muted other-lines" data-testid="other-languages" data-assistant-exclude>
    {lines.map((line, index) => <span key={line.language}>{index > 0 && ' · '}
      <a href={`#lessons/${line.language}/${line.lesson}`} title={`Open ${line.language === 'ja' ? 'Japanese' : 'Korean'} lesson ${line.lesson}`}>
        <span lang={line.language}>{glyph(line.language)}</span> <span lang={line.language}>{line.target}</span>{line.reading && line.reading !== line.target ? <> <span lang={line.language}>{line.reading}</span></> : null}</a></span>)}
  </p>
}
