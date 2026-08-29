let audioContext: AudioContext | null = null

/** Bunyi notifikasi pesanan baru, dibuat lewat Web Audio API (tanpa berkas audio eksternal). */
export function playNewOrderChime(): void {
  try {
    audioContext ??= new AudioContext()
    const ctx = audioContext
    if (ctx.state === 'suspended') void ctx.resume()

    const now = ctx.currentTime
    ;[880, 1180].forEach((freq, index) => {
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = freq
      const start = now + index * 0.15
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.3, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25)
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start(start)
      oscillator.stop(start + 0.3)
    })
  } catch {
    // Audio tidak tersedia (mis. lingkungan test) - abaikan secara diam-diam.
  }
}
