import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight, BookOpen, BookText, MessageCircle } from 'lucide-react'
import { useActiveProfile } from '../core/activeProfile'
import { db } from '../core/database'
import { HashLink } from '../components/HashLink'

export function DashboardPage() {
  const profile = useActiveProfile()
  const stats = useLiveQuery(async () => {
    if (!profile) return null
    const [texts, threads, states] = await Promise.all([
      db.libraryItems.where('profileId').equals(profile.id).count(),
      db.conversationThreads.where('profileId').equals(profile.id).count(),
      db.userItemStates.where('profileId').equals(profile.id).toArray(),
    ])
    return {
      texts,
      threads,
      learning: states.filter((state) => state.tier === 'learning').length,
      familiar: states.filter((state) => state.tier === 'familiar').length,
      mastered: states.filter((state) => state.tier === 'mastered').length,
    }
  }, [profile?.id])

  return (
    <div className="page">
      <header className="page-header hero-header">
        <div>
          <p className="eyebrow">{profile?.name ?? 'Your language'}</p>
          <h1>Build fluency through context.</h1>
          <p className="lede">
            Read what interests you, talk about what matters, and keep one
            shared record of what you know.
          </p>
        </div>
      </header>

      <section className="stat-grid" aria-label="Learning summary">
        <div className="stat-card">
          <strong>{stats?.learning ?? 0}</strong>
          <span>Learning</span>
        </div>
        <div className="stat-card">
          <strong>{stats?.familiar ?? 0}</strong>
          <span>Familiar</span>
        </div>
        <div className="stat-card">
          <strong>{stats?.mastered ?? 0}</strong>
          <span>Mastered</span>
        </div>
      </section>

      <section className="action-grid">
        <HashLink className="action-card reading-action" to="/modules/reading">
          <BookOpen />
          <div>
            <h2>Read something</h2>
            <p>{stats?.texts ?? 0} texts in your library</p>
          </div>
          <ArrowRight />
        </HashLink>
        <HashLink
          className="action-card conversation-action"
          to="/modules/conversation"
        >
          <MessageCircle />
          <div>
            <h2>Start a conversation</h2>
            <p>{stats?.threads ?? 0} saved conversations</p>
          </div>
          <ArrowRight />
        </HashLink>
        <HashLink className="action-card dictionary-action" to="/dictionary">
          <BookText />
          <div>
            <h2>Open Dictionary</h2>
            <p>Review every tracked learning item</p>
          </div>
          <ArrowRight />
        </HashLink>
      </section>
    </div>
  )
}
