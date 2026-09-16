import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { registerSW } from 'virtual:pwa-register'

export function UpdatePrompt() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)
  const [updateServiceWorker, setUpdateServiceWorker] = useState<
    ((reloadPage?: boolean) => Promise<void>) | null
  >(null)

  useEffect(() => {
    const update = registerSW({
      immediate: true,
      onNeedRefresh() {
        setUpdateAvailable(true)
      },
      onOfflineReady() {
        setOfflineReady(true)
        window.setTimeout(() => setOfflineReady(false), 4_000)
      },
    })
    setUpdateServiceWorker(() => update)
  }, [])

  if (!updateAvailable && !offlineReady) return null

  return (
    <div className="update-prompt" role="status">
      {updateAvailable ? (
        <>
          <span>A new version of LinguaWeave is ready.</span>
          <button
            onClick={() => updateServiceWorker?.(true)}
            className="primary-button"
          >
            <RefreshCw size={16} /> Update now
          </button>
        </>
      ) : (
        <span>LinguaWeave is ready for offline use.</span>
      )}
    </div>
  )
}
