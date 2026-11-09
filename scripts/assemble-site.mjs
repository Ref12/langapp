// Publishes Stable and Lab as one site: Stable's build at the root, Lab's build under lab/.
//   node scripts/assemble-site.mjs <stable-dist> <lab-dist> <out>
// Each build is recognised by the service worker file it emits (src/core/storage-names.ts): Stable writes sw.js,
// Lab writes sw-lab.js. If the root ever served the Lab build the learner's data would seem to vanish, so a mix-up fails here.
import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const exists = async path => stat(path).then(() => true, () => false)

/** Every reason the two inputs cannot be published; empty when they can. */
export async function checkInputs(stableDir, labDir) {
  const problems = []
  for (const [label, dir] of [['Stable', stableDir], ['Lab', labDir]]) {
    if (!(await stat(dir).then(s => s.isDirectory(), () => false))) problems.push(label + ' build folder is missing: ' + dir)
    else if (!(await exists(join(dir, 'index.html')))) problems.push(label + ' build folder has no index.html: ' + dir)
  }
  if (problems.length) return problems
  const [stableSw, stableLabSw, labSw, labStableSw] = await Promise.all([
    exists(join(stableDir, 'sw.js')), exists(join(stableDir, 'sw-lab.js')), exists(join(labDir, 'sw-lab.js')), exists(join(labDir, 'sw.js')),
  ])
  if (!stableSw || stableLabSw) problems.push('The root input is not a Stable build (Stable emits sw.js and never sw-lab.js): ' + stableDir)
  if (!labSw || labStableSw) problems.push('The lab/ input is not a Lab build (Lab emits sw-lab.js and never sw.js): ' + labDir)
  if (await exists(join(stableDir, 'lab'))) problems.push("The Stable build already contains a 'lab' entry, which would collide with the Lab build: " + join(stableDir, 'lab'))
  if (await exists(join(stableDir, 'v1')) || await exists(join(labDir, 'v1'))) problems.push('A build contains a v1/ folder; the retired old app must not be published')
  return problems
}

/** Writes the site to outDir (which must not exist or be empty). Nothing is left at outDir when a check fails. */
export async function assembleSite(stableDir, labDir, outDir) {
  const [stable, lab, out] = [resolve(stableDir), resolve(labDir), resolve(outDir)]
  const problems = await checkInputs(stable, lab)
  const inside = (parent, child) => { const path = relative(parent, child); return path === '' || (!path.startsWith('..') && !isAbsolute(path)) }
  if (inside(stable, out) || inside(lab, out)) problems.push('The output folder must be outside both inputs')
  if (await exists(out) && (await readdir(out).catch(() => ['?'])).length) problems.push('The output folder exists and is not empty: ' + out)
  if (problems.length) throw new Error('Cannot assemble the site:\n- ' + problems.join('\n- '))
  const staging = out + '.assembling'
  await rm(staging, { recursive: true, force: true })
  try {
    await mkdir(staging, { recursive: true })
    await cp(stable, staging, { recursive: true })
    await cp(lab, join(staging, 'lab'), { recursive: true })
    await rm(out, { recursive: true, force: true })
    await mkdir(dirname(out), { recursive: true })
    await rename(staging, out)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [stableDir, labDir, outDir] = process.argv.slice(2)
  if (!stableDir || !labDir || !outDir) { console.error('Usage: node scripts/assemble-site.mjs <stable-dist> <lab-dist> <out>'); process.exit(2) }
  assembleSite(stableDir, labDir, outDir).then(() => console.log('Site written to ' + outDir), error => { console.error(error.message); process.exit(1) })
}
