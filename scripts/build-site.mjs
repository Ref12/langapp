import { copyFile, mkdir } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
await mkdir(new URL('dist/', root), { recursive: true })
await copyFile(new URL('index.html', root), new URL('dist/index.html', root))
await copyFile(new URL('public/sw.js', root), new URL('dist/sw.js', root))
