import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, CheckCircle2, Download, Trash2, Upload } from 'lucide-react'
import { db, clearLocalData, exportBackup, importBackup } from '../core/database'
import { createLanguageProfile } from '../core/profiles'
import { testAIConnection } from '../core/ai/provider'
import type { TargetLanguage } from '../core/domain'
import { nowIso } from '../core/ids'

export function SettingsPage() {
  const stored = useLiveQuery(() => db.aiConnections.get('default'), [])
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [newProfileLanguage, setNewProfileLanguage] =
    useState<TargetLanguage>('ja')

  useEffect(() => {
    if (!stored) return
    setBaseUrl(stored.baseUrl)
    setModel(stored.model)
    setAcknowledged(stored.warningAcknowledged)
  }, [stored])

  const saveConnection = async (event: FormEvent) => {
    event.preventDefault()
    if (!acknowledged) {
      setStatus('Acknowledge the browser-storage warning before saving.')
      return
    }
    if (!baseUrl.startsWith('https://')) {
      setStatus('Use an HTTPS API base URL.')
      return
    }
    const nextKey = apiKey || stored?.apiKey
    if (!nextKey) {
      setStatus('Enter an API key.')
      return
    }

    await db.aiConnections.put({
      id: 'default',
      baseUrl: baseUrl.replace(/\/+$/, ''),
      apiKey: nextKey,
      model,
      warningAcknowledged: true,
      configurationVersion: (stored?.configurationVersion ?? 0) + 1,
      updatedAt: nowIso(),
    })
    setApiKey('')
    setStatus('AI connection saved in this browser.')
  }

  const testConnection = async () => {
    const key = apiKey || stored?.apiKey
    if (!key) {
      setStatus('Enter or save an API key first.')
      return
    }
    setBusy(true)
    setStatus('Testing connection…')
    try {
      const message = await testAIConnection(baseUrl, key, model)
      await db.aiConnections.update('default', {
        lastTestStatus: 'success',
        lastTestMessage: message,
        lastTestedAt: nowIso(),
      })
      setStatus(message)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed.'
      if (stored) {
        await db.aiConnections.update('default', {
          lastTestStatus: 'failure',
          lastTestMessage: message,
          lastTestedAt: nowIso(),
        })
      }
      setStatus(message)
    } finally {
      setBusy(false)
    }
  }

  const downloadBackup = async () => {
    const backup = await exportBackup()
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `linguaweave-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const restoreBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      await importBackup(JSON.parse(await file.text()) as never)
      window.location.reload()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Backup restore failed.')
    }
  }

  return (
    <div className="page settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Local configuration</p>
          <h1>Settings</h1>
          <p>Your profiles, content, progress, chats, and key stay in this browser.</p>
        </div>
      </header>

      <section className="settings-section">
        <h2>AI connection</h2>
        <div className="warning-box">
          <AlertTriangle size={20} />
          <p>
            A static web app cannot securely protect a persisted API key from
            code running on this site. Use a restricted key with spending
            limits and never save it on a shared device.
          </p>
        </div>
        <form className="form-stack" onSubmit={saveConnection}>
          <label>
            API base URL
            <input
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.openai.com/v1"
              required
            />
          </label>
          <label>
            API key
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={stored?.apiKey ? 'Stored key — enter to replace' : 'API key'}
            />
          </label>
          <label>
            Model
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="gpt-4.1-mini"
              required
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            I understand this key is stored in my browser.
          </label>
          <div className="button-row">
            <button className="primary-button" type="submit">
              Save connection
            </button>
            <button type="button" onClick={testConnection} disabled={busy}>
              Test connection
            </button>
            {stored?.apiKey && (
              <button
                type="button"
                className="danger-text-button"
                onClick={async () => {
                  await db.aiConnections.delete('default')
                  setApiKey('')
                  setStatus('Stored AI connection cleared.')
                }}
              >
                Clear key
              </button>
            )}
          </div>
          {status && (
            <p className="form-status">
              {status.toLowerCase().includes('success') && <CheckCircle2 size={16} />}
              {status}
            </p>
          )}
        </form>
      </section>

      <section className="settings-section">
        <h2>Language profiles</h2>
        <div className="inline-form">
          <select
            value={newProfileLanguage}
            onChange={(event) =>
              setNewProfileLanguage(event.target.value as TargetLanguage)
            }
          >
            <option value="zh">Mandarin</option>
            <option value="ja">Japanese</option>
            <option value="ko">Korean</option>
          </select>
          <button
            onClick={() => createLanguageProfile(newProfileLanguage, 5)}
          >
            Add profile
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>Local data</h2>
        <div className="button-row">
          <button onClick={downloadBackup}>
            <Download size={17} /> Export backup
          </button>
          <label className="file-button">
            <Upload size={17} /> Import backup
            <input type="file" accept="application/json" onChange={restoreBackup} />
          </label>
          <button
            className="danger-button"
            onClick={async () => {
              if (!window.confirm('Delete all LinguaWeave data from this browser?')) {
                return
              }
              await clearLocalData()
              window.location.reload()
            }}
          >
            <Trash2 size={17} /> Delete local data
          </button>
        </div>
      </section>
    </div>
  )
}
