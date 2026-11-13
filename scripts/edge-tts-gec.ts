// Version 2 Sec-MS-GEC token, ported from edge-tts 7.3.1 (edge_tts/drm.py).
const SHA256_INITIAL = [
  0x6A09E667n,
  0xBB67AE85n,
  0x3C6EF372n,
  0xA54FF53An,
  0x510E527Fn,
  0x9B05688Cn,
  0x1F83D9ABn,
  0x5BE0CD19n,
] as const
const SHA256_STATE = [
  0xFD9FBEA2n,
  0x91243CE7n,
  0xBE499094n,
  0xCD2E1E0An,
  0x6C006F49n,
  0x04BD35ABn,
  0xFEB0A7E4n,
  0x03EFFBD2n,
] as const
const SHA256_SCHEDULE = [
  0xEB24BF9En,
  0x1558691Fn,
  0xA0C09EE2n,
  0x0CFA32BAn,
  0xA622EE8Cn,
  0xD1DD9491n,
  0xC0DD25A0n,
  0xF9E70AB6n,
  0xF0C31573n,
  0x7058CE4En,
  0x7188E606n,
  0x00E5AB33n,
  0xD258B060n,
  0x72766564n,
] as const
const SHA256_ROUND_CONSTANTS = [
  0x428A2F98n,
  0x71374491n,
  0xB5C0FBCFn,
  0xE9B5DBA5n,
  0x3956C25Bn,
  0x59F111F1n,
  0x923F82A4n,
  0xAB1C5ED5n,
  0xD807AA98n,
  0x12835B01n,
  0x243185BEn,
  0x550C7DC3n,
  0x72BE5D74n,
  0x80DEB1FEn,
  0x9BDC06A7n,
  0xC19BF174n,
  0xE49B69C1n,
  0xEFBE4786n,
  0x0FC19DC6n,
  0x240CA1CCn,
  0x2DE92C6Fn,
  0x4A7484AAn,
  0x5CB0A9DCn,
  0x76F988DAn,
  0x983E5152n,
  0xA831C66Dn,
  0xB00327C8n,
  0xBF597FC7n,
  0xC6E00BF3n,
  0xD5A79147n,
  0x06CA6351n,
  0x14292967n,
  0x27B70A85n,
  0x2E1B2138n,
  0x4D2C6DFCn,
  0x53380D13n,
  0x650A7354n,
  0x766A0ABBn,
  0x81C2C92En,
  0x92722C85n,
  0xA2BFE8A1n,
  0xA81A664Bn,
  0xC24B8B70n,
  0xC76C51A3n,
  0xD192E819n,
  0xD6990624n,
  0xF40E3585n,
  0x106AA070n,
  0x19A4C116n,
  0x1E376C08n,
  0x2748774Cn,
  0x34B0BCB5n,
  0x391C0CB3n,
  0x4ED8AA4An,
  0x5B9CCA4Fn,
  0x682E6FF3n,
  0x748F82EEn,
  0x78A5636Fn,
  0x84C87814n,
  0x8CC70208n,
  0x90BEFFFAn,
  0xA4506CEBn,
  0xBEF9A3F7n,
  0xC67178F2n,
] as const
const CS64_COEFFICIENTS: ReadonlyArray<readonly [bigint, bigint]> = [
  [0xE82E91B1n, 0xB32700D0n],
  [0x44DE24C6n, 0x88DFF51Dn],
  [0x3BEB65BCn, 0x29514038n],
  [0xC89C5933n, 0xB328CBDFn],
  [0x8D1EC211n, 0xD405B4D5n],
  [0x314EF5D5n, 0x26E55F3Cn],
  [0xE92491B1n, 0x607801C6n],
  [0xF0A5B9D5n, 0x82B2C1FBn],
  [0x06064CF3n, 0xFA51A3DAn],
  [0xDA79FA60n, 0x207CC464n],
  [0xBED20560n, 0x3C3C74F3n],
  [0x89F9C9F8n, 0xD2D14B61n],
  [0x35FA38C6n, 0xBB04A2C1n],
  [0xCB49E3C6n, 0xC5626167n],
]


const MASK = 0xffffffffn
const rol16 = (v: bigint): bigint => { const x = v & MASK; return ((x << 16n) | (x >> 16n)) & MASK }
const ror = (v: bigint, n: bigint): bigint => ((v >> n) | (v << (32n - n))) & MASK
const sigma0 = (v: bigint): bigint => ror(v, 7n) ^ ror(v, 18n) ^ (v >> 3n)
const sigma1 = (v: bigint): bigint => ror(v, 17n) ^ ror(v, 19n) ^ (v >> 10n)
const u32be = (b: Uint8Array, o: number): bigint => BigInt(((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0)

function expandSchedule(words: bigint[], first: number): void {
  for (let i = first; i < 64; i++) {
    words.push((sigma1(words[i - 2]) + words[i - 7] + sigma0(words[i - 15]) + words[i - 16]) & MASK)
  }
}

function rounds(state: readonly bigint[], words: bigint[], first: number): bigint[] {
  let [a, b, c, d, e, f, g, h] = state
  for (let i = first; i < 64; i++) {
    const k = first === 14 && i === 14 ? 0xc9dc06a7n : SHA256_ROUND_CONSTANTS[i]
    const t1 = (h + (ror(e, 6n) ^ ror(e, 11n) ^ ror(e, 25n)) + (g ^ (e & (f ^ g))) + k + words[i]) & MASK
    const t2 = ((ror(a, 2n) ^ ror(a, 13n) ^ ror(a, 22n)) + ((a & b) | (c & (a | b)))) & MASK
    h = g; g = f; f = e; e = (d + t1) & MASK; d = c; c = b; b = a; a = (t1 + t2) & MASK
  }
  return [a, b, c, d, e, f, g, h]
}

function sha256Init(data: Uint8Array): bigint[] {
  const words: bigint[] = new Array<bigint>(14).fill(0n)
  words.push((BigInt(data[0]) << 16n) | (BigInt(data[1]) << 8n) | BigInt(data[2]))
  words.push(u32be(data, 3))
  for (let i = 16; i < 30; i++) {
    let v = SHA256_SCHEDULE[i - 16]
    if (i - 2 >= 14) v += i === 16 ? sigma1(words[i - 2]) ^ 0x000b92c0n : sigma1(words[i - 2])
    if (i - 7 >= 14) v += words[i - 7]
    if (i - 15 >= 14) v += i === 29 ? sigma0(words[i - 15]) ^ 0x059c0b80n : sigma0(words[i - 15])
    words.push(v & MASK)
  }
  words.push((sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14] + 0xc9dc06a7n - SHA256_ROUND_CONSTANTS[14]) & MASK)
  expandSchedule(words, 31)
  const working = rounds(SHA256_STATE, words, 14)
  return working.map((x, i) => (x + SHA256_INITIAL[i]) & MASK)
}

function sha256Digest(data: Uint8Array): Uint8Array {
  const length = 57 + data.length
  const pad = (((55 - length) % 64) + 64) % 64
  const padded = new Uint8Array(data.length - 7 + 1 + pad + 8)
  padded.set(data.subarray(7))
  padded[data.length - 7] = 0x80
  new DataView(padded.buffer).setBigUint64(padded.length - 8, BigInt(length) * 8n)
  let state = sha256Init(data.subarray(0, 7))
  for (let o = 0; o < padded.length; o += 64) {
    const words: bigint[] = []
    for (let i = 0; i < 16; i++) words.push(u32be(padded, o + i * 4))
    expandSchedule(words, 16)
    const working = rounds(state, words, 0)
    state = state.map((x, i) => (x + working[i]) & MASK)
  }
  const out = new Uint8Array(32)
  state.forEach((x, i) => new DataView(out.buffer).setUint32(i * 4, Number(x)))
  return out
}

function cs64Digest(data: Uint8Array, digest: Uint8Array): [bigint, bigint] {
  const dv = new DataView(digest.buffer, digest.byteOffset)
  const keyA = BigInt(dv.getUint32(0, true)) | 1n
  const keyB = BigInt(dv.getUint32(4, true)) | 1n
  const factors = [(keyA * 0x82893933n) & MASK, (keyB * 0x82893933n) & MASK]
  const terms = CS64_COEFFICIENTS.map(([c], i) => (c * factors[i % 2]) & MASK)
  const offsets = CS64_COEFFICIENTS.map(([, o]) => o)
  const bytes = new Uint8Array(1 + data.length)
  bytes.set(data, 1)
  const padded = new Uint8Array(Math.ceil(bytes.length / 8) * 8)
  padded.set(bytes)
  const pv = new DataView(padded.buffer)
  for (let i = 0; i < padded.length / 4; i++) {
    const word = BigInt(pv.getUint32(i * 4, true))
    let term = word * (i % 2 === 0 ? keyA : keyB)
    let offset = rol16(word) * (i % 2 === 0 ? 0xef0569fbn : 0xc31713dbn)
    if (i === 0) {
      term += 0xf2f90b1an * factors[0]
      offset += 0x0b1a0000n
    }
    terms.push(term & MASK)
    offsets.push(offset & MASK)
  }
  let swapAcc = 0n, swapLast = 0n, state = 0n, acc = 0n
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i], y = terms[i + 1]
    let t = rol16((offsets[i] + x) & MASK)
    let q = (t * 0x76f50f34n) & MASK
    swapAcc += (rol16(q) * 0xc3efea97n + q) & MASK
    t = rol16((offsets[i + 1] + y) & MASK)
    q = (t * 0x1881ce3cn) & MASK
    swapLast = (rol16(q) * 0x35bd1ec9n + q) & MASK
    swapAcc = (swapAcc + swapLast) & MASK

    state = (state * keyA + x) & MASK
    state = (rol16(state) * 0xcf98b111n) & MASK
    state = (rol16(state) * 0x87085b9fn) & MASK
    state = (rol16(state) * 0x12ceb96dn) & MASK
    state = (rol16(state) * 0x257e1d83n) & MASK
    acc += state
    t = (state * keyB + y) & MASK
    t = (rol16(t) * 0xa27416f5n) & MASK
    t = (rol16(t) * 0xd38396ffn) & MASK
    state = (rol16((rol16(t) * 0x7c932b89n) & MASK) * 0xbfa49f69n) & MASK
    acc = (acc + state) & MASK
  }
  return [swapLast ^ state, swapAcc ^ acc]
}

const hexLe32 = (v: bigint): string => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(Number(v))
  return b.toString('hex').toUpperCase()
}

export function secMsGecV2(unixSeconds: number, clientToken: string): string {
  let ticks = BigInt(Math.floor(unixSeconds)) + 11_644_473_600n
  ticks -= ticks % 300n
  ticks *= 10_000_000n
  const data = new TextEncoder().encode(`${ticks}${clientToken}`)
  const digest = sha256Digest(data)
  const [x, y] = cs64Digest(data, digest)
  return `${hexLe32(x)}${hexLe32(y)}-${Buffer.from(digest).toString('hex').toUpperCase()}`
}
