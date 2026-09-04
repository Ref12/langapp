import { useState, type FormEvent, type ReactNode } from 'react'
import { Languages } from 'lucide-react'
import { useActiveProfile } from '../core/activeProfile'
import { createLanguageProfile } from '../core/profiles'
import type { TargetLanguage } from '../core/domain'

export function ProfileGate({ children }: { children: ReactNode }) {
  const profile = useActiveProfile()
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguage>('zh')
  const [dailyLimit, setDailyLimit] = useState(5)
  const [saving, setSaving] = useState(false)

  if (profile === undefined) {
    return <div className="page-center">Loading your local workspace…</div>
  }

  if (profile) return children

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    await createLanguageProfile(targetLanguage, dailyLimit)
    setSaving(false)
  }

  return (
    <main className="onboarding">
      <section className="onboarding-card">
        <div className="brand-mark" aria-hidden="true">
          <Languages />
        </div>
        <p className="eyebrow">Welcome to LinguaWeave</p>
        <h1>Learn in the things you already read.</h1>
        <p className="lede">
          Choose your first language profile. Your data stays in this browser.
        </p>
        <form onSubmit={submit} className="form-stack">
          <label>
            Target language
            <select
              value={targetLanguage}
              onChange={(event) =>
                setTargetLanguage(event.target.value as TargetLanguage)
              }
            >
              <option value="zh">Mandarin</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
            </select>
          </label>
          <label>
            New items per day
            <input
              type="number"
              min={1}
              max={30}
              value={dailyLimit}
              onChange={(event) => setDailyLimit(Number(event.target.value))}
            />
          </label>
          <button className="primary-button" disabled={saving}>
            {saving ? 'Creating profile…' : 'Start learning'}
          </button>
        </form>
      </section>
    </main>
  )
}
