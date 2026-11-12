import { describe, expect, it } from 'vitest'
import { BackupError } from './backend'
import { fakeGitHub } from './fake-github'
import { GitHubBackend } from './github'
import { storageNames } from '../storage-names'

// The learner connects Lab to the same account and repository Stable already backs up to, and Lab's profile has the same id.
const target = { owner: 'me', repo: 'backups', token: 't' }
const make = (fake: ReturnType<typeof fakeGitHub>, channel: 'stable' | 'lab', language: 'zh' | 'ja' | 'ko' = 'zh') => new GitHubBackend(target, fake.fetcher, 0, storageNames(channel, language))
const files = (marker: string) => new Map(Object.entries({ 'manifest.yaml': 'cursor: 5 # ' + marker + '\n', 'profile.yaml': 'id: p1\nname: "Main"\n', 'journal/a.yaml': 'e1 ' + marker + '\n' }))
const treeOf = (fake: ReturnType<typeof fakeGitHub>) => new Map(fake.trees.get(fake.commits.get(fake.headCommit())!.tree)!)
const under = (tree: Map<string, string>, prefix: string) => new Map([...tree].filter(([path]) => path.startsWith(prefix)))

describe('Lab and Stable backups never meet', () => {
  it('leaves every file of a Stable backup untouched when Lab backs up the same profile id to the same repository', async () => {
    const fake = fakeGitHub()
    const stable = make(fake, 'stable')
    const lab = make(fake, 'lab')
    const first = await stable.publishDelta('p1', files('stable'), new Set(), 'stable backup')
    const stableBefore = under(treeOf(fake), 'profiles/')
    expect([...stableBefore.keys()].sort()).toEqual(['profiles/p1/journal/a.yaml', 'profiles/p1/manifest.yaml', 'profiles/p1/profile.yaml'])

    // Lab has nothing yet: it neither lists nor reads Stable's backup, so a restore or append cannot start from it.
    expect(await lab.listProfiles()).toEqual([])
    expect((await lab.readFiles('p1')).size).toBe(0)
    expect(await lab.listVersions('p1')).toBeDefined()

    const labFirst = await lab.publishDelta('p1', files('lab'), new Set(), 'lab backup')
    const labSecond = await lab.publishDelta('p1', new Map([['manifest.yaml', 'cursor: 9\n']]), new Set(), 'lab prunes', labFirst.remote)
    await lab.publish('p1', files('lab again'), 'lab full publish')
    expect(labSecond.removed).toBeGreaterThan(0)

    const tree = treeOf(fake)
    expect(under(tree, 'profiles/')).toEqual(stableBefore) // same paths, same blob ids
    expect([...under(tree, 'lab/').keys()].every(path => path.startsWith('lab/profiles/p1/'))).toBe(true)
    expect(under(tree, 'lab/').size).toBe(3)
    expect([...tree.keys()].filter(path => !path.startsWith('profiles/') && !path.startsWith('lab/'))).toEqual(['README.md'])

    // The two see only their own folder, and stable still reads exactly what it wrote.
    expect((await stable.readFiles('p1')).get('manifest.yaml')).toContain('stable')
    expect((await lab.readFiles('p1')).get('manifest.yaml')).toContain('lab again')
    expect((await lab.listProfiles()).map(profile => profile.id)).toEqual(['p1'])
    expect((await stable.listProfiles()).map(profile => profile.id)).toEqual(['p1'])
    expect(first.version).toBeDefined()
  })

  it('keeps a language build to lab/<language>/ and never lists its profiles from Lab Chinese or Stable', async () => {
    const fake = fakeGitHub()
    const stable = make(fake, 'stable')
    const lab = make(fake, 'lab')
    const ja = make(fake, 'lab', 'ja')
    const ko = make(fake, 'lab', 'ko')
    await stable.publishDelta('s1', files('stable'), new Set(), 'stable')
    await lab.publishDelta('l1', files('lab'), new Set(), 'lab')
    await ja.publishDelta('j1', files('ja'), new Set(), 'ja')
    await ko.publishDelta('k1', files('ko'), new Set(), 'ko')
    const tree = treeOf(fake)
    expect([...under(tree, 'lab/ja/').keys()].every(path => path.startsWith('lab/ja/profiles/j1/'))).toBe(true)
    expect(under(tree, 'lab/ja/').size).toBe(3)
    expect((await stable.listProfiles()).map(profile => profile.id)).toEqual(['s1'])
    expect((await lab.listProfiles()).map(profile => profile.id)).toEqual(['l1'])
    expect((await ja.listProfiles()).map(profile => profile.id)).toEqual(['j1'])
    expect((await ko.listProfiles()).map(profile => profile.id)).toEqual(['k1'])
    expect((await lab.readFiles('j1')).size).toBe(0)
    expect((await ja.readFiles('l1')).size).toBe(0)
  })

  it('removes only its own files when it deletes, in both directions', async () => {
    const fake = fakeGitHub()
    const stable = make(fake, 'stable')
    const lab = make(fake, 'lab')
    await lab.publishDelta('p1', files('lab'), new Set(), 'lab')
    const labBefore = under(treeOf(fake), 'lab/')
    const s1 = await stable.publishDelta('p1', files('stable'), new Set(), 'stable')
    await stable.publishDelta('p1', new Map([['manifest.yaml', 'cursor: 6\n']]), new Set(), 'stable prunes', s1.remote)
    expect(under(treeOf(fake), 'lab/')).toEqual(labBefore)
  })

  it('refuses a profile id that could leave its folder', async () => {
    const lab = make(fakeGitHub(), 'lab')
    await expect(lab.readFiles('../profiles/p1')).rejects.toBeInstanceOf(BackupError)
    await expect(lab.publishDelta('../p1', files('x'), new Set(), 'x')).rejects.toBeInstanceOf(BackupError)
  })

  it('writes Lab only under lab/ and Stable only under profiles/ for every request', async () => {
    const fake = fakeGitHub()
    await make(fake, 'lab').publishDelta('p1', files('lab'), new Set(), 'lab')
    const sent = fake.requests.filter(request => request.path === '/git/trees' && request.method === 'POST').flatMap(request => request.body?.tree ?? [])
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.every(entry => entry.path.startsWith('lab/profiles/p1/'))).toBe(true)
  })

  it('lets all four builds share one repository and branch, with the same profile id, and never touches another build\'s files', async () => {
    const fake = fakeGitHub()
    const builds = { stable: make(fake, 'stable'), lab: make(fake, 'lab'), ja: make(fake, 'lab', 'ja'), ko: make(fake, 'lab', 'ko') }
    const prefix = { stable: 'profiles/p1/', lab: 'lab/profiles/p1/', ja: 'lab/ja/profiles/p1/', ko: 'lab/ko/profiles/p1/' }
    const names = Object.keys(builds) as (keyof typeof builds)[]
    const heads: Record<string, ReturnType<typeof builds.stable.publishDelta> extends Promise<infer R> ? R : never> = {}
    for (const name of names) heads[name] = await builds[name].publishDelta('p1', files(name), new Set(), name + ' backup')
    const ownFiles = (name: keyof typeof builds) => new Map([...treeOf(fake)].filter(([path]) => {
      const owner = names.find(other => path.startsWith(prefix[other]))
      return owner === name
    }))
    const before = Object.fromEntries(names.map(name => [name, ownFiles(name)]))
    expect(names.map(name => before[name].size)).toEqual([3, 3, 3, 3])

    // Each build backs up again, prunes, and does a full publish: only its own folder moves.
    for (const name of names) {
      const second = await builds[name].publishDelta('p1', new Map([['manifest.yaml', 'cursor: 9 # ' + name + '\n']]), new Set(['journal/a.yaml']), name + ' prunes', heads[name].remote)
      expect(second.removed).toBeGreaterThan(0)
      for (const other of names.filter(other => other !== name)) expect(ownFiles(other), name + ' touched ' + other).toEqual(before[other])
      await builds[name].publish('p1', files(name + ' again'), name + ' full publish')
      for (const other of names.filter(other => other !== name)) expect(ownFiles(other), name + ' touched ' + other).toEqual(before[other])
      before[name] = ownFiles(name)
    }
    // Every build lists and reads only its own backup, and nothing lies outside the four folders but the README.
    for (const name of names) {
      expect((await builds[name].listProfiles()).map(profile => profile.id)).toEqual(['p1'])
      expect((await builds[name].readFiles('p1')).get('manifest.yaml')).toContain(name + ' again')
    }
    expect([...treeOf(fake).keys()].filter(path => !names.some(name => path.startsWith(prefix[name])))).toEqual(['README.md'])
  })
})
