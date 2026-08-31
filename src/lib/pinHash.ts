// Hashing PIN memakai PBKDF2-SHA256 lewat WebCrypto (tersedia di browser & WebView Android).
// PIN tidak pernah disimpan dalam bentuk plain text.

const PBKDF2_ITERATIONS = 150_000
const HASH_LENGTH_BITS = 256

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function generateSalt(): string {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return toHex(salt.buffer)
}

async function derivePinHash(pin: string, saltHex: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ])
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: fromHex(saltHex) as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_LENGTH_BITS,
  )
  return toHex(derivedBits)
}

export async function hashPin(pin: string): Promise<{ hash: string; salt: string }> {
  const salt = generateSalt()
  const hash = await derivePinHash(pin, salt)
  return { hash, salt }
}

export async function verifyPin(pin: string, salt: string, expectedHash: string): Promise<boolean> {
  const candidate = await derivePinHash(pin, salt)
  return timingSafeEqual(candidate, expectedHash)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,8}$/.test(pin)
}
