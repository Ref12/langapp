// Publishes the site: the main app (the Lab Chinese build) at the root, the language builds at <language>/, Stable at stable/.
//   node scripts/assemble-site.mjs <main-dist> <stable-dist> <out> [<language>=<language-dist> ...]
// Each build is recognised by the service worker file it emits (src/core/storage-names.ts): Stable writes sw.js, the main app writes sw-lab.js,
// a language build writes sw-lab-<language>.js (and neither of the others). Stable's data lives under unprefixed names and the main app's under lab.*: a mix-up
// (the wrong build at the root) would make the learner's data seem to vanish, so it fails here.
// The assembly also writes what the old layout needs to go away (sources in scripts/site/):
//   - redirect pages at lab/, lab/<language>/ (the old places of the apps) that go to the new places, keeping ?query and #hash;
//   - 404.html, which sends any other old address below lab/ to the matching start page;
//   - retiring service workers at the URLs of the workers older deploys registered (sw.js at the root, lab/sw-lab.js, lab/<language>/sw-lab-<language>.js).
// Every URL it writes is relative, so the site works under /langapp/ and under /apps/lang/.
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const exists = async path => stat(path).then(() => true, () => false)
const siteSource = name => fileURLToPath(new URL('./site/' + name, import.meta.url))
const isDir = path => stat(path).then(s => s.isDirectory(), () => false)

/** The retiring worker's text for a worker whose scope is at `scopeFolder` below the root (`lab/`, `lab/ja/`, `` for the root): TARGET is relative to that scope. */
export async function retiringWorker(target) {
  return (await readFile(siteSource('retiring-sw.js'), 'utf8')).replace('__TARGET__', target)
}
/** A redirect page to `target` (a relative URL). */
export async function redirectPage(target) {
  return (await readFile(siteSource('redirect.html'), 'utf8')).replaceAll('__TARGET__', target)
}

/** Every reason the inputs cannot be published; empty when they can. */
export async function checkInputs(mainDir, stableDir, languageDirs = {}) {
  const problems = []
  for (const [label, dir] of [['Main', mainDir], ['Stable', stableDir]]) {
    if (!(await isDir(dir))) problems.push(label + ' build folder is missing: ' + dir)
    else if (!(await exists(join(dir, 'index.html')))) problems.push(label + ' build folder has no index.html: ' + dir)
  }
  if (problems.length) return problems
  const [mainSw, mainStableSw, stableSw, stableLabSw] = await Promise.all([
    exists(join(mainDir, 'sw-lab.js')), exists(join(mainDir, 'sw.js')), exists(join(stableDir, 'sw.js')), exists(join(stableDir, 'sw-lab.js')),
  ])
  if (!mainSw || mainStableSw) problems.push('The root input is not the main (Lab Chinese) build (it emits sw-lab.js and never sw.js): ' + mainDir)
  if (!stableSw || stableLabSw) problems.push('The stable/ input is not a Stable build (Stable emits sw.js and never sw-lab.js): ' + stableDir)
  const languageWorker = name => /^sw-lab-[a-z]+\.js$/.test(name)
  const mainLanguage = (await readdir(mainDir)).filter(languageWorker)
  if (mainLanguage.length) problems.push('The root input is a language build (it has ' + mainLanguage.join(', ') + '), and the root can never be one: ' + mainDir)
  if ((await readdir(stableDir)).some(languageWorker)) problems.push('The stable/ input is a language build, not Stable: ' + stableDir)
  for (const taken of ['stable', 'lab', '404.html']) {
    if (await exists(join(mainDir, taken))) problems.push("The main build already contains a '" + taken + "' entry, which would collide with the site's own: " + join(mainDir, taken))
  }
  if (await exists(join(mainDir, 'v1')) || await exists(join(stableDir, 'v1'))) problems.push('A build contains a v1/ folder; the retired old app must not be published')
  for (const [language, dir] of Object.entries(languageDirs)) {
    if (!/^[a-z]{2,3}$/.test(language) || language === 'zh' || language === 'lab') { problems.push("'" + language + "' is not a language folder (zh is the root app itself)"); continue }
    if (await exists(join(mainDir, language))) problems.push("The main build already has a '" + language + "' entry, which would collide with the language build: " + join(mainDir, language))
    if (!(await isDir(dir))) { problems.push('The ' + language + ' build folder is missing: ' + dir); continue }
    if (!(await exists(join(dir, 'index.html')))) problems.push('The ' + language + ' build folder has no index.html: ' + dir)
    const worker = 'sw-lab-' + language + '.js'
    const others = (await readdir(dir)).filter(name => /^sw(-lab(-[a-z]+)?)?\.js$/.test(name) && name !== worker)
    if (!(await exists(join(dir, worker))) || others.length) problems.push('The ' + language + ' input is not a ' + language + ' build (it emits ' + worker + ' and no other service worker' + (others.length ? '; found ' + others.join(', ') : '') + '): ' + dir)
    if (await exists(join(dir, 'v1'))) problems.push('A build contains a v1/ folder; the retired old app must not be published')
  }
  return problems
}

/**
 * Writes the site to outDir (which must not exist or be empty). languageDirs maps a language id to its build folder (put at <id>/).
 * Nothing is left at outDir when a check fails.
 */
export async function assembleSite(mainDir, stableDir, outDir, languageDirs = {}) {
  const [main, stable, out] = [resolve(mainDir), resolve(stableDir), resolve(outDir)]
  const languages = Object.entries(languageDirs).map(([language, dir]) => [language, resolve(dir)])
  const problems = await checkInputs(main, stable, Object.fromEntries(languages))
  const inside = (parent, child) => { const path = relative(parent, child); return path === '' || (!path.startsWith('..') && !isAbsolute(path)) }
  if ([main, stable, ...languages.map(([, dir]) => dir)].some(dir => inside(dir, out))) problems.push('The output folder must be outside every input build')
  if (await exists(out) && (await readdir(out).catch(() => ['?'])).length) problems.push('The output folder exists and is not empty: ' + out)
  if (problems.length) throw new Error('Cannot assemble the site:\n- ' + problems.join('\n- '))
  const staging = out + '.assembling'
  await rm(staging, { recursive: true, force: true })
  try {
    await mkdir(staging, { recursive: true })
    await cp(main, staging, { recursive: true })
    await cp(stable, join(staging, 'stable'), { recursive: true })
    for (const [language, dir] of languages) await cp(dir, join(staging, language), { recursive: true })
    // The old places. Targets are relative to the page or worker that holds them.
    const put = async (path, text) => { await mkdir(dirname(join(staging, path)), { recursive: true }); await writeFile(join(staging, path), text) }
    await put('sw.js', await retiringWorker('./'))
    await put('lab/index.html', await redirectPage('../'))
    await put('lab/sw-lab.js', await retiringWorker('../'))
    for (const [language] of languages) {
      await put('lab/' + language + '/index.html', await redirectPage('../../' + language + '/'))
      await put('lab/' + language + '/sw-lab-' + language + '.js', await retiringWorker('../../' + language + '/'))
    }
    await put('404.html', await readFile(siteSource('not-found.html'), 'utf8'))
    await rm(out, { recursive: true, force: true })
    await mkdir(dirname(out), { recursive: true })
    await rename(staging, out)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mainDir, stableDir, outDir, ...extra] = process.argv.slice(2)
  const usage = 'Usage: node scripts/assemble-site.mjs <main-dist> <stable-dist> <out> [<language>=<language-dist> ...]'
  const languageDirs = {}
  for (const arg of extra) { const at = arg.indexOf('='); if (at < 1 || languageDirs[arg.slice(0, at)]) { console.error(usage); process.exit(2) } languageDirs[arg.slice(0, at)] = arg.slice(at + 1) }
  if (!mainDir || !stableDir || !outDir) { console.error(usage); process.exit(2) }
  assembleSite(mainDir, stableDir, outDir, languageDirs).then(() => console.log('Site written to ' + outDir), error => { console.error(error.message); process.exit(1) })
}
