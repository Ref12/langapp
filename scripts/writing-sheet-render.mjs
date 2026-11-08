// Review-sheet helpers: draw ordered stroke paths with stroke numbers and direction arrows, and screenshot an HTML sheet.
// Used by the Korean review sheets and the Japanese confusable-pair sheet. Offline; needs a local Chromium (CHROMIUM env or /usr/bin/chromium).
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const palette = ['#d62728', '#1f77b4', '#2ca02c', '#9467bd', '#ff7f0e', '#8c564b', '#e377c2', '#17becf', '#bcbd22', '#555555']
const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Start point and the heading at the end of an explicit M/L/Q/C path. */
export function pathEnds(path) {
  const tokens = path.match(/[MLQC]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)/g)
  const arity = { M: 2, L: 2, Q: 4, C: 6 }
  const points = []
  for (let i = 0; i < tokens.length;) {
    const op = tokens[i++]
    const values = tokens.slice(i, i + arity[op]).map(Number)
    i += arity[op]
    for (let k = 0; k < values.length; k += 2) points.push([values[k], values[k + 1]])
  }
  const end = points[points.length - 1]
  let before = points[points.length - 2]
  for (let k = points.length - 2; k >= 0 && Math.hypot(end[0] - before[0], end[1] - before[1]) < 1.5; k--) before = points[k]
  return { start: points[0], end, angle: Math.atan2(end[1] - before[1], end[0] - before[0]) }
}

/** Points along an explicit M/L/Q/C path (curves sampled), for placing a direction mark part-way along a closed loop. */
function samplePath(path) {
  const tokens = path.match(/[MLQC]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)/g)
  const arity = { M: 2, L: 2, Q: 4, C: 6 }
  const line = []
  for (let i = 0; i < tokens.length;) {
    const op = tokens[i++]
    const values = tokens.slice(i, i + arity[op]).map(Number)
    i += arity[op]
    const controls = []
    for (let k = 0; k < values.length; k += 2) controls.push([values[k], values[k + 1]])
    if (op === 'M' || op === 'L') line.push(controls[0])
    else {
      const from = line[line.length - 1]
      for (let step = 1; step <= 24; step++) {
        const t = step / 24
        let work = [from, ...controls]
        while (work.length > 1) work = work.slice(1).map((end, n) => [work[n][0] * (1 - t) + end[0] * t, work[n][1] * (1 - t) + end[1] * t])
        line.push(work[0])
      }
    }
  }
  return line
}
const arrowAt = (point, angle, colour, a = 6.5) => {
  const left = [point[0] - a * Math.cos(angle - 0.5), point[1] - a * Math.sin(angle - 0.5)]
  const right = [point[0] - a * Math.cos(angle + 0.5), point[1] - a * Math.sin(angle + 0.5)]
  return `<polygon points="${point.map(v => v.toFixed(1)).join(',')} ${left.map(v => v.toFixed(1)).join(',')} ${right.map(v => v.toFixed(1)).join(',')}" fill="${colour}"/>`
}

/** One character as SVG: strokes in order, a numbered dot at each start, an arrowhead at each end. frame: [x, y, width, height] of the box to show. */
export function strokeSvg(paths, { size = 140, frame = [0, 0, 100, 100], numbers = true, arrows = true, pad = 12, outline = true } = {}) {
  const [x, y, w, h] = frame
  const height = Math.round(size * h / w)
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${height}" viewBox="${x - pad} ${y - pad} ${w + 2 * pad} ${h + 2 * pad}">`]
  if (outline) parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#ddd" stroke-width=".6" stroke-dasharray="2 2"/>`)
  const placed = []
  paths.forEach((path, index) => {
    const colour = palette[index % palette.length]
    parts.push(`<path d="${path}" fill="none" stroke="${colour}" stroke-opacity=".38" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>`)
    parts.push(`<path d="${path}" fill="none" stroke="${colour}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`)
    const { start, end, angle } = pathEnds(path)
    if (arrows) {
      parts.push(arrowAt(end, angle, colour))
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 3) {
        // A closed loop ends where it starts: also mark the heading a quarter of the way round so the direction is readable.
        const line = samplePath(path)
        const k = Math.floor(line.length / 4)
        parts.push(arrowAt(line[k], Math.atan2(line[k + 1][1] - line[k - 1][1], line[k + 1][0] - line[k - 1][0]), colour, 7.5))
      }
    }
    if (numbers) {
      // The number sits just behind the pen-down point, away from the stroke, and steps round until it clears earlier numbers,
      // so strokes that start at the same corner still show every number.
      const samples = samplePath(path)
      let ahead = samples.find(p => Math.hypot(p[0] - start[0], p[1] - start[1]) > 2) ?? [start[0] + 1, start[1]]
      const heading = Math.atan2(ahead[1] - start[1], ahead[0] - start[0])
      let spot = start, found = false
      for (let turn = 0; turn < 12 && !found; turn++) {
        // A closed loop (ㅇ) puts its number above the top pen-down point, not beside it, so the start is not mistaken for the side.
        const base = Math.hypot(end[0] - start[0], end[1] - start[1]) < 3 ? -Math.PI / 2 : heading + Math.PI
        const angle = base + (turn % 2 ? 1 : -1) * Math.ceil(turn / 2) * 0.55
        const candidate = [start[0] + 7.5 * Math.cos(angle), start[1] + 7.5 * Math.sin(angle)]
        if (placed.every(p => Math.hypot(p[0] - candidate[0], p[1] - candidate[1]) > 9.5)) { spot = candidate; found = true }
      }
      placed.push(spot)
      parts.push(`<line x1="${start[0]}" y1="${start[1]}" x2="${spot[0].toFixed(1)}" y2="${spot[1].toFixed(1)}" stroke="${colour}" stroke-width=".8"/>`)
      parts.push(`<circle cx="${start[0]}" cy="${start[1]}" r="1.6" fill="${colour}"/>`)
      parts.push(`<circle cx="${spot[0].toFixed(1)}" cy="${spot[1].toFixed(1)}" r="4.6" fill="#fff" stroke="${colour}" stroke-width=".9"/>`)
      parts.push(`<text x="${spot[0].toFixed(1)}" y="${(spot[1] + 2.4).toFixed(1)}" font-size="6.6" text-anchor="middle" fill="${colour}" font-family="sans-serif" font-weight="700">${index + 1}</text>`)
    }
  })
  parts.push('</svg>')
  return parts.join('')
}

export const cell = (svg, label, note = '') => `<figure><div class="art">${svg}</div><figcaption>${esc(label)}${note ? `<small>${esc(note)}</small>` : ''}</figcaption></figure>`
export const section = (title, cells, note = '') => `<section><h2>${esc(title)}</h2>${note ? `<p class="note">${esc(note)}</p>` : ''}<div class="grid">${cells.join('')}</div></section>`

export const sheetPage = (title, body, width = 1500) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{margin:0;padding:18px;width:${width - 36}px;font:14px/1.35 'Noto Sans CJK KR','Noto Sans CJK JP',system-ui,sans-serif;color:#222;background:#fff}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:18px 0 4px;border-bottom:1px solid #ccc}.note{margin:2px 0 6px;color:#555}
.grid{display:flex;flex-wrap:wrap;gap:10px}figure{margin:0;border:1px solid #e3e3e3;border-radius:6px;padding:4px 6px;text-align:center;background:#fafafa}
figcaption{font-size:15px;font-weight:600}figcaption small{display:block;font-weight:400;color:#666;font-size:11px}.art{line-height:0}
</style></head><body><h1>${esc(title)}</h1>${body}</body></html>`

export async function screenshotHtml(html, outPath, { width = 1500, height = 900, scale = 1, fullPage = true } = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale })
    await page.setContent(html)
    await page.screenshot({ path: outPath, fullPage })
  } finally { await browser.close() }
}

export { writeFileSync }
