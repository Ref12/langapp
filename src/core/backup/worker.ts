import { runInWorker, type BackupRequest, type PauseMessage } from './host'

// Dedicated worker for a backup run (Back up now, or an automatic run at a boundary): the whole run happens here,
// off the page's main thread. The page can ask it to pause; it stops at its next safe point.
let paused = false
self.onmessage = (event: MessageEvent<BackupRequest | PauseMessage>) => {
  if ('pause' in event.data) { paused = true; return }
  void runInWorker(event.data, () => paused).then(reply => (self as unknown as Worker).postMessage(reply))
}
