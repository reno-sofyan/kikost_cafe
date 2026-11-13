import { useEffect, useRef, useState } from 'react'
import { resolveScanCode } from '@/db/repositories/retail'
import { useBarcodeScanner } from '@/features/retail/useBarcodeScanner'
import { DEFAULT_WEDGE_CONFIG, readWedgeConfig, writeWedgeConfig, type WedgeConfig, type WedgeScan } from '@/lib/barcodeWedge'
import { formatRupiah } from '@/lib/currency'
import { toast } from '@/state/toastStore'

interface TestResult {
  scan: WedgeScan
  at: number
  match: string | null
}

/** Ketikan mentah terakhir — untuk mendiagnosis pemindai yang tak terdeteksi. */
interface RawBurst {
  text: string
  gaps: number[]
  ended: string
}

/**
 * Pengaturan → Pemindai Barcode (per perangkat). Untuk pemindai USB/Bluetooth mode
 * keyboard (HID), termasuk pemindai laser 1D dengan stand auto-sense.
 */
export function ScannerSettings() {
  const [config, setConfig] = useState<WedgeConfig>(() => readWedgeConfig())
  const [results, setResults] = useState<TestResult[]>([])
  const [raw, setRaw] = useState<RawBurst | null>(null)
  const burst = useRef<{ text: string; times: number[] }>({ text: '', times: [] })

  useBarcodeScanner((code, { scan }) => {
    void resolveScanCode(code).then((m) => {
      const match = m ? `${m.product.name}${m.sellUnit ? ` · ${m.sellUnit.name}` : ''}${m.weighed ? ` · ${m.qty} ${m.product.unit}` : ''} — ${formatRupiah(m.sellUnit?.price ?? m.product.price)}` : null
      setResults((r) => [{ scan, at: Date.now(), match }, ...r].slice(0, 6))
    })
  })

  // Perekam mentah: menampilkan apa pun yang "diketik" pemindai, walau tak lolos deteksi.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const now = performance.now()
      const b = burst.current
      if (e.key.length === 1) {
        if (b.times.length && now - b.times[b.times.length - 1]! > 400) burst.current = { text: '', times: [] }
        burst.current.text += e.key
        burst.current.times.push(now)
      } else if ((e.key === 'Enter' || e.key === 'Tab') && b.text) {
        setRaw({ text: b.text, gaps: b.times.slice(1).map((t, i) => t - b.times[i]!), ended: e.key })
        burst.current = { text: '', times: [] }
      }
    }
    // Tanpa akhiran: tampilkan setelah jeda.
    const timer = setInterval(() => {
      const b = burst.current
      if (b.text && performance.now() - b.times[b.times.length - 1]! > 500) {
        setRaw({ text: b.text, gaps: b.times.slice(1).map((t, i) => t - b.times[i]!), ended: 'tanpa akhiran' })
        burst.current = { text: '', times: [] }
      }
    }, 250)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      clearInterval(timer)
    }
  }, [])

  function save(next: WedgeConfig) {
    setConfig(next)
    writeWedgeConfig(next)
  }

  const maxGap = raw?.gaps.length ? Math.max(...raw.gaps) : 0
  const rawVerdict = !raw
    ? null
    : raw.text.length < config.minLength
      ? `Terlalu pendek (${raw.text.length} karakter) — minimal ${config.minLength}.`
      : maxGap > config.maxGapMs
        ? `Terlalu lambat untuk pemindai (jeda terlama ${Math.round(maxGap)} ms > ${config.maxGapMs} ms). Bila ini memang pemindai, naikkan batas jeda.`
        : raw.ended === 'tanpa akhiran' && config.terminator === 'auto'
          ? 'Pemindai tidak mengirim Enter/Tab di akhir kode. Pilih "Tanpa akhiran", atau atur pemindai menambahkan akhiran CR/Enter.'
          : null

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-lg font-bold text-ink-50">Pemindai Barcode</h2>
        <p className="text-sm text-ink-400">
          Untuk pemindai USB (atau Bluetooth) mode keyboard — termasuk pemindai laser 1D dengan stand auto-sense. Tidak perlu driver: kode yang dipindai langsung masuk
          ke keranjang Kasir di mana pun posisi kursor. Pengaturan di halaman ini berlaku untuk perangkat ini saja.
        </p>
      </div>

      <div className="rounded-2xl border-2 border-dashed border-brand-600/50 p-5">
        <p className="font-semibold text-ink-50">Uji pemindai</p>
        <p className="mb-3 text-sm text-ink-400">Pindai barcode barang apa saja sekarang. Tidak perlu mengetuk kolom apa pun.</p>
        {results.length === 0 ? (
          <p className="rounded-xl bg-ink-800 p-4 text-center text-sm text-ink-300">Menunggu pindaian…</p>
        ) : (
          <div className="space-y-2">
            {results.map((r, i) => (
              <div key={r.at + r.scan.code + i} className={`rounded-xl p-3 ${i === 0 ? 'bg-success-600/15' : 'bg-ink-800'}`}>
                <p className="font-mono text-lg font-semibold text-ink-50">{r.scan.code}</p>
                <p className="text-xs text-ink-300">
                  {r.scan.code.length} karakter · ±{r.scan.avgGapMs.toFixed(1)} ms/karakter · akhiran {r.scan.terminator === 'idle' ? 'tidak ada' : r.scan.terminator}
                </p>
                <p className={`mt-1 text-sm ${r.match ? 'text-success-500' : 'text-accent-500'}`}>{r.match ?? 'Terbaca, tetapi belum terdaftar sebagai produk.'}</p>
              </div>
            ))}
          </div>
        )}
        {raw && rawVerdict && (
          <div className="mt-3 rounded-xl bg-red-900/20 p-3 text-sm text-red-300">
            <p>
              Ketikan terakhir <span className="font-mono">"{raw.text.slice(0, 40)}"</span> tidak dikenali sebagai pindaian.
            </p>
            <p className="mt-1">{rawVerdict}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Akhiran kode</span>
          <select className="input-field" value={config.terminator} onChange={(e) => save({ ...config, terminator: e.target.value as WedgeConfig['terminator'] })}>
            <option value="auto">Enter atau Tab (bawaan pabrik)</option>
            <option value="none">Tanpa akhiran</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Abaikan pindaian ganda (barang sama)</span>
          <select className="input-field" value={config.dedupeMs} onChange={(e) => save({ ...config, dedupeMs: Number(e.target.value) })}>
            <option value={0}>Mati — tiap pindaian dihitung</option>
            <option value={700}>Dalam 0,7 detik</option>
            <option value={1500}>Dalam 1,5 detik</option>
            <option value={3000}>Dalam 3 detik</option>
          </select>
          <span className="mt-1 block text-xs text-ink-500">Nyalakan bila stand auto-sense kadang membaca satu barang dua kali.</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Batas jeda antar karakter (ms)</span>
          <input type="number" min={10} max={200} className="input-field" value={config.maxGapMs} onChange={(e) => save({ ...config, maxGapMs: Math.min(200, Math.max(10, Number(e.target.value) || 50)) })} />
          <span className="mt-1 block text-xs text-ink-500">Pemindai biasanya &lt; 20 ms; ketikan tangan &gt; 80 ms.</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Panjang kode minimal</span>
          <input type="number" min={1} max={30} className="input-field" value={config.minLength} onChange={(e) => save({ ...config, minLength: Math.min(30, Math.max(1, Number(e.target.value) || 4)) })} />
        </label>
      </div>
      <button
        className="btn-secondary"
        onClick={() => {
          save(DEFAULT_WEDGE_CONFIG)
          toast.success('Pengaturan pemindai dikembalikan ke bawaan.')
        }}
      >
        Kembalikan ke bawaan
      </button>

      <div className="rounded-2xl bg-ink-800 p-5 text-sm text-ink-200">
        <p className="mb-2 font-semibold text-ink-50">Memasang pemindai USB</p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            Colokkan kabel USB pemindai ke tablet. Tablet Android dengan port USB-C butuh <b>adaptor OTG (USB-C → USB-A)</b>. Pemindai berbunyi saat mendapat daya.
          </li>
          <li>
            Pemindai harus mode <b>USB HID / Keyboard</b> (bawaan pabrik). Bila tidak, pindai barcode pengaturan "USB HID Keyboard" di buku panduannya.
          </li>
          <li>
            Pastikan pemindai mengirim <b>Enter (CR)</b> di akhir kode, dan bahasa keyboard pemindai <b>US/English</b> — bila angka yang muncul acak atau berupa simbol,
            ini penyebabnya.
          </li>
          <li>
            Stand <b>auto-sense</b>: letakkan pemindai di stand, lalu sodorkan barcode ke jendela laser. Bila satu barang terbaca dua kali, nyalakan "Abaikan pindaian
            ganda" di atas atau perpanjang "same code delay" di pemindai.
          </li>
          <li>
            <b>Keyboard layar tidak muncul saat pemindai terpasang?</b> Android menganggap pemindai sebagai keyboard fisik lalu menyembunyikan keyboard layar. Nyalakan
            sekali saja, tak perlu cabut pemindai lagi:
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                Samsung (Galaxy Tab): Pengaturan → Manajemen umum → Keyboard fisik → <b>Tampilkan keyboard di layar</b>.
              </li>
              <li>
                Android lain: Setelan → Sistem → Bahasa &amp; masukan → Keyboard fisik → <b>Tampilkan keyboard virtual</b>.
              </li>
            </ul>
          </li>
          <li>Pemindai laser 1D membaca barcode batang (EAN-13, UPC, Code 128, dll.), bukan kode QR.</li>
        </ol>
      </div>
    </div>
  )
}
