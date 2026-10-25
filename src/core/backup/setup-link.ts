import { applyBackup, isProfileEmpty, listBackupProfiles, loadBackupVersion, saveBackupConfig, type BackupConfig } from './service'
import { getActiveProfile } from '../profiles/store'

const PREFIX = 'backup='
const toBase64Url = (text: string) => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromBase64Url = (text: string) => {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)))
}

/** The setup URL: this app's address plus the connection in the fragment (never the query string, so it is not sent to a server). */
export function encodeSetupLink(config: BackupConfig, base = location.origin + location.pathname): string {
  const { owner, repo, branch, token } = config
  return `${base}#${PREFIX}${toBase64Url(JSON.stringify({ v: 1, owner, repo, branch, token }))}`
}

/** Reads a setup link, a bare "#backup=..." fragment or "backup=..." text. Throws a readable error for anything else. */
export function decodeSetupLink(input: string): BackupConfig {
  const index = input.indexOf('#' + PREFIX)
  const raw = index >= 0 ? input.slice(index + 1 + PREFIX.length) : input.startsWith(PREFIX) ? input.slice(PREFIX.length) : undefined
  if (raw === undefined) throw new Error('This is not a cloud backup setup code.')
  let data: unknown
  try { data = JSON.parse(fromBase64Url(raw.trim())) } catch { throw new Error('This setup code is damaged. Show a fresh one and scan again.') }
  const record = data as Record<string, unknown> | null
  if (!record || typeof record !== 'object' || record.v !== 1) throw new Error('This setup code is from a different version of the app. Show a fresh one on the other device.')
  const { owner, repo, branch, token } = record
  if (typeof owner !== 'string' || typeof repo !== 'string' || typeof token !== 'string' || !owner || !repo || !token || (branch !== undefined && typeof branch !== 'string')) {
    throw new Error('This setup code is incomplete. Show a fresh one and scan again.')
  }
  return { owner, repo, token, branch: branch || 'main' }
}

/** Fresh profile (no learning data) with a backup available restores it automatically; otherwise only connect. */
export function shouldAutoRestore(empty: boolean, backups: number): boolean { return empty && backups > 0 }

export interface SetupResult { message: string; restored: boolean }

/** Saves the connection, checks it with one GitHub call, and on an empty profile restores the latest backup. */
export async function applySetup(input: string | BackupConfig, reload: () => void = () => window.location.reload()): Promise<SetupResult> {
  const config = typeof input === 'string' ? decodeSetupLink(input) : input
  await saveBackupConfig(config)
  const name = `${config.owner}/${config.repo}`
  const profiles = await listBackupProfiles(config)
  const empty = await isProfileEmpty()
  if (!shouldAutoRestore(empty, profiles.length)) return { message: `Cloud backup connected to ${name}`, restored: false }
  const match = profiles.find(profile => profile.id === getActiveProfile().id) ?? profiles[0]
  const loaded = await loadBackupVersion(config, match.id)
  await applyBackup(loaded, config)
  reload()
  return { message: `Cloud backup connected to ${name}; restored your latest backup`, restored: true }
}

/** Removes the fragment from the address bar at once and returns it. Runs once, when this module loads. */
export function takeSetupFragment(): string | undefined {
  if (typeof location === 'undefined' || !location.hash.startsWith('#' + PREFIX)) return undefined
  const fragment = location.hash
  history.replaceState(null, '', location.pathname + location.search)
  return fragment
}
export const pendingSetupFragment = takeSetupFragment()
