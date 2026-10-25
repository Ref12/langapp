// Earlier builds registered a Periodic Background Sync for backups. Nothing backs up automatically any more, so every page
// load removes that registration from phones that already have it. Backups run only from the Back up now buttons.
export async function removeBackgroundBackupRegistrations(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return
    const registration = await navigator.serviceWorker.getRegistration() as (ServiceWorkerRegistration & { periodicSync?: { unregister(tag: string): Promise<void> } }) | undefined
    await registration?.periodicSync?.unregister('backup')
  } catch { /* not supported or not allowed: nothing to remove */ }
}
