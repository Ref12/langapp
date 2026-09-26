import { ArrowRight, Grid3X3, Layers } from 'lucide-react'
import { PageHeading } from '../components/shared'

export function Games() {
  return <>
    <PageHeading eyebrow="PLAY WITH WHAT YOU KNOW" title="Games">Use your learning set in familiar puzzles. Games are saved in this profile and stay separate from lesson scores and review schedules.</PageHeading>
    <div className="experience-grid two-columns">
      <section className="experience-card"><Layers size={28} className="accent" /><h2>Word Mahjong</h2>
        <p>Clear layered tile configurations by matching characters, pinyin, and English meanings. Uses vocabulary you have introduced.</p>
        <a className="button primary" href="#games/mahjong">Play Mahjong <ArrowRight size={16} /></a>
      </section>
      <section className="experience-card"><Grid3X3 size={28} className="accent" /><h2>Character Sudoku</h2>
        <p>Classic Sudoku with characters instead of numbers. Choose a grid size and difficulty, and cross out candidates as you reason.</p>
        <a className="button primary" href="#games/sudoku">Play Sudoku <ArrowRight size={16} /></a>
      </section>
    </div>
  </>
}
