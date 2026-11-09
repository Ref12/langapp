// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { listStorageNames, storageNames } from './storage-names'

/** Today's names, written out by hand. If this list changes, a learner's data moves: that must never happen by accident. */
const STABLE_TODAY = {
  databases: ['linguaweave-next', 'linguaweave-next-profile-<id>', 'linguaweave-profile-registry', 'linguaweave-backup-state'],
  localStorage: [
    'linguaweave-selected-profile', 'linguaweave-backup-config:<id>', 'practice.newItems', 'practice.newWords', 'practice.reviewCount', 'practice.unwrittenSize',
    'drills.write', 'handsfree.settings', 'linguaweave.autoListen', 'linguaweave.engine.customPresets', 'handwriting-engine',
    'media-translation-chunk-size', 'media-translation-concurrency', 'linguaweave-media-pause-after-line', 'linguaweave-media-glosses',
  ],
  sessionStorage: ['linguaweave-media-job-url:<id>'],
  caches: ['linguaweave-shell-<version>', 'linguaweave-runtime'],
  serviceWorker: 'sw.js',
  lock: 'linguaweave-backup',
  broadcast: 'linguaweave-backup',
  backupFolder: 'profiles/<id>/',
}

describe('storage names', () => {
  it("gives exactly today's names on the stable channel", () => {
    const n = storageNames('stable')
    expect([n.db.learning('default'), n.db.learning('<id>'), n.db.registry, n.db.backupState]).toEqual(STABLE_TODAY.databases)
    expect([...Object.values(n.local).map(key => key.endsWith(':') ? key + '<id>' : key)].sort()).toEqual([...STABLE_TODAY.localStorage].sort())
    expect(n.session.mediaJobUrlPrefix + '<id>').toBe(STABLE_TODAY.sessionStorage[0])
    expect([n.cache.shell('<version>'), n.cache.runtime]).toEqual(STABLE_TODAY.caches)
    expect(n.cache.shellPrefix).toBe('linguaweave-shell-')
    expect([n.serviceWorkerFile, n.lock, n.broadcast, n.backupFolder('<id>')]).toEqual([STABLE_TODAY.serviceWorker, STABLE_TODAY.lock, STABLE_TODAY.broadcast, STABLE_TODAY.backupFolder])
  })

  it('gives lab nothing in common with stable, and no stable prefix matches a lab name', () => {
    const stable = listStorageNames('stable')
    const lab = listStorageNames('lab')
    expect(lab).toHaveLength(stable.length + 2) // plus the two names only Lab has
    expect(lab.filter(name => stable.includes(name))).toEqual([])
    const stablePrefixes = ['linguaweave-shell-', 'linguaweave-backup-config:', 'linguaweave-media-job-url:', 'linguaweave-next-profile-', 'profiles/']
    for (const name of lab) for (const prefix of stablePrefixes) expect(name.startsWith(prefix), name + ' / ' + prefix).toBe(false)
    expect(storageNames('lab').db.learning('default')).not.toBe(storageNames('stable').db.learning('default'))
  })

  it('writes backups under a folder of its own', () => {
    expect(storageNames('lab').backupFolder('abc')).toBe('lab/profiles/abc/')
    expect(storageNames('stable').backupFolder('abc')).toBe('profiles/abc/')
  })
})

// Every database, cache and storage key must come from storage-names.ts, so nothing can open one under a name Stable also uses.
describe('storage access goes through storage-names', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) && !relative(root, path).split(sep).includes('test')) files.push(path)
    }
  }
  walk(root)
  const rel = (path: string) => relative(root, path).split(sep).join('/')
  const code = (path: string) => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  // The only modules that may name a stable database directly are the module itself and the read-only copy from Stable.
  const exempt = new Set(['core/storage-names.ts', 'core/profiles/stable-copy.ts'])

  it("never opens Stable's database with Lab's schema, or writes to it", () => {
    const copy = code(join(root, 'core/profiles/stable-copy.ts'))
    expect(copy).not.toMatch(/LearningDatabase|from '\.\.\/database'|from 'dexie'|new Dexie|\.version\(/)
    expect(copy).not.toMatch(/'readwrite'|'versionchange'|\.(?:put|add|delete|clear)\(|deleteDatabase\(\s*stable|createObjectStore/)
    // and nothing else imports the learning database for the Stable side: only the scratch copy in stable-import.ts opens a Lab-named database
    expect(code(join(root, 'core/profiles/stable-import.ts'))).not.toMatch(/storageNames\(\s*'stable'\s*\)/)
  })

  it('finds the sources', () => { expect(files.length).toBeGreaterThan(100) })

  it('has no literal name at a storage call', () => {
    const literal = [
      /\b(?:localStorage|sessionStorage|storage\(\)|storage\??)\s*\??\.\s*(?:getItem|setItem|removeItem)\(\s*['"`]/,
      /\bnew Dexie\(\s*['"`]/, /\bindexedDB\.(?:open|deleteDatabase)\(\s*['"`]/,
      /\bDexie\.(?:exists|delete)\(\s*['"`]/, /\bcaches\.(?:open|delete|match)\(\s*['"`]/,
      /new BroadcastChannel\(\s*['"`]/, /locks\.request\(\s*['"`]/, /serviceWorker\.register\(\s*['"`][^`'"$]*\.js/,
    ]
    const bad: string[] = []
    for (const file of files) {
      if (exempt.has(rel(file))) continue
      const text = code(file)
      if (/extends Dexie/.test(text) && /\bsuper\(\s*['"`]/.test(text)) bad.push(rel(file) + ': a Dexie class names its database itself')
      text.split('\n').forEach((line, index) => { if (literal.some(pattern => pattern.test(line))) bad.push(rel(file) + ':' + (index + 1) + ' ' + line.trim()) })
    }
    expect(bad).toEqual([])
  })

  it('imports storage-names in every file that uses a database, a cache or a storage key', () => {
    const uses = /\b(?:(?:localStorage|sessionStorage|indexedDB)\.|caches\.|new Dexie|extends Dexie|new BroadcastChannel|navigator\.locks|serviceWorker\.register)/
    const missing: string[] = []
    for (const file of files) {
      if (exempt.has(rel(file))) continue
      const text = code(file)
      // Dexie classes are reached through the modules that name them; the files that merely pass a Storage around are listed by their consumers.
      if (uses.test(text) && !/storage-names/.test(text) && !/\bStorage\b/.test(text)) missing.push(rel(file))
    }
    expect(missing).toEqual([])
  })

})
