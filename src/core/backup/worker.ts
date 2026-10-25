import { runInWorker, type BackupRequest } from './host'

// Dedicated worker for the "Back up now" button: the whole run happens here, off the page's main thread.
self.onmessage = (event: MessageEvent<BackupRequest>) => {
  void runInWorker(event.data).then(reply => (self as unknown as Worker).postMessage(reply))
}
