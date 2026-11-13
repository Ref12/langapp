// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { boxToImage, downscaleImage, dragBox, fitWithin } from './images'
import { photoReadingPrompt } from './photo-answer'

describe('crop maths', () => {
  it('maps a box in screen pixels to image pixels at a scaled display size', () => {
    expect(boxToImage({ x: 30, y: 20, width: 150, height: 100 }, { width: 300, height: 200 }, { width: 3000, height: 2000 })).toEqual({ x: 300, y: 200, width: 1500, height: 1000 })
    expect(boxToImage({ x: 10, y: 10, width: 100, height: 50 }, { width: 390, height: 292.5 }, { width: 4000, height: 3000 })).toEqual({ x: 103, y: 103, width: 1025, height: 512 })
  })
  it('the whole display is the whole image, and a box is kept inside it and at least 1 px', () => {
    expect(boxToImage({ x: 0, y: 0, width: 300, height: 200 }, { width: 300, height: 200 }, { width: 3000, height: 2000 })).toEqual({ x: 0, y: 0, width: 3000, height: 2000 })
    expect(boxToImage({ x: -20, y: -5, width: 400, height: 300 }, { width: 300, height: 200 }, { width: 3000, height: 2000 })).toEqual({ x: 0, y: 0, width: 3000, height: 2000 })
    expect(boxToImage({ x: 299.9, y: 199.9, width: 0, height: 0 }, { width: 300, height: 200 }, { width: 3000, height: 2000 }).width).toBeGreaterThanOrEqual(1)
    expect(boxToImage({ x: 5, y: 5, width: 5, height: 5 }, { width: 0, height: 0 }, { width: 800, height: 600 })).toEqual({ x: 0, y: 0, width: 800, height: 600 })
  })
  it('dragging keeps the box inside the photo and above the minimum size', () => {
    const start = { x: 50, y: 50, width: 100, height: 80 }, bounds = { width: 300, height: 200 }
    expect(dragBox(start, 'se', 500, 500, bounds)).toEqual({ x: 50, y: 50, width: 250, height: 150 })
    expect(dragBox(start, 'nw', -500, -500, bounds)).toEqual({ x: 0, y: 0, width: 150, height: 130 })
    expect(dragBox(start, 'e', -500, 0, bounds)).toEqual({ x: 50, y: 50, width: 24, height: 80 })
    expect(dragBox(start, 'move', 500, 500, bounds)).toEqual({ x: 200, y: 120, width: 100, height: 80 })
  })
})

describe('downscale after the crop', () => {
  afterEach(() => vi.unstubAllGlobals())
  function canvasMock() {
    const draw = vi.fn()
    const canvas = { width: 0, height: 0, getContext: () => ({ fillStyle: '', fillRect: vi.fn(), drawImage: draw }), toBlob: (done: (blob: Blob | null) => void) => done(new Blob(['j'], { type: 'image/jpeg' })) }
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => tag === 'canvas' ? canvas : Document.prototype.createElement.call(document, tag)) as never)
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })))
    return { canvas, draw }
  }
  it('computes the longest side of 1600 px', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(1500, 1000)).toEqual({ width: 1500, height: 1000 })
  })
  it('without a crop the whole photo is scaled to 1600 px', async () => {
    const { canvas, draw } = canvasMock()
    const result = await downscaleImage(new Blob(['x'], { type: 'image/jpeg' }))
    expect([result.width, result.height, canvas.width, canvas.height]).toEqual([1600, 1200, 1600, 1200])
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200)
  })
  it('a crop is cut from the full-size photo, then scaled', async () => {
    const { canvas, draw } = canvasMock()
    const result = await downscaleImage(new Blob(['x'], { type: 'image/jpeg' }), { x: 400, y: 300, width: 2000, height: 500 })
    expect([result.width, result.height, canvas.width, canvas.height]).toEqual([1600, 400, 1600, 400])
    expect(draw).toHaveBeenCalledWith(expect.anything(), 400, 300, 2000, 500, 0, 0, 1600, 400)
  })
  it('a small crop is not enlarged', async () => {
    const { draw } = canvasMock()
    const result = await downscaleImage(new Blob(['x'], { type: 'image/jpeg' }), { x: 10, y: 10, width: 600, height: 300 })
    expect([result.width, result.height]).toEqual([600, 300])
    expect(draw).toHaveBeenCalledWith(expect.anything(), 10, 10, 600, 300, 0, 0, 600, 300)
  })
})

describe('the reading prompt', () => {
  it('asks for a transcription only, in the pack language, and not for grading', () => {
    const prompt = photoReadingPrompt('Japanese')
    expect(prompt.system).toMatch(/Transcribe exactly the handwritten Japanese text/)
    expect(prompt.system).toMatch(/only the transcribed text/)
    expect(prompt.system).toMatch(/judge/)
  })
})
