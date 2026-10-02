import { describe, expect, it } from 'vitest'
import { computeEntryHash, verifyAuditLog, verifyDeviceChain } from './auditLogIntegrity'
import type { AuditLogEntry } from '@/types/domain'

async function makeChain(deviceId: string, n: number): Promise<AuditLogEntry[]> {
  const entries: AuditLogEntry[] = []
  let prevHash: string | null = null
  for (let i = 0; i < n; i++) {
    const unsigned = {
      id: `e${i}`,
      userId: 'u1',
      userName: 'Kasir',
      action: `action.${i}`,
      entityType: 'order',
      entityId: `o${i}`,
      details: `detail ${i}`,
      createdAt: 1000 + i, // sengaja sama utuh di berbagai test createdAt bisa tabrakan — deviceSeq yang menjamin urutan
      deviceId,
      deviceSeq: i + 1,
      prevHash,
    }
    const hash = await computeEntryHash(unsigned)
    entries.push({ ...unsigned, hash })
    prevHash = hash
  }
  return entries
}

describe('verifyDeviceChain', () => {
  it('rantai yang tidak diubah selalu ok', async () => {
    const chain = await makeChain('dev-1', 5)
    const results = await verifyDeviceChain(chain)
    expect(results.every((r) => r.verdict === 'ok')).toBe(true)
  })

  it('mengubah isi satu entri (tanpa memperbarui field hash-nya) menandai entri itu SENDIRI dan tepat satu entri setelahnya', async () => {
    // Skenario realistis: staf mengedit `details` langsung lewat DevTools tanpa
    // tahu/mau repot menghitung ulang hash-nya. Terdeteksi di DUA titik: entri
    // yang diedit (hash-nya sendiri tak cocok lagi) DAN entri setelahnya (prevHash
    // milik entri itu menunjuk hash LAMA #2 yang sudah tak berlaku). Entri lebih
    // jauh lagi (#4) kembali "ok" karena isinya sendiri utuh & rantainya sendiri
    // konsisten dari #3 — inilah kenapa satu manipulasi kecil selalu bisa
    // dipersempit lokasinya, tanpa perlu menjalar tak terbatas untuk berguna.
    // Penyerang yang ingin membuat SELURUH rantai tampak sah lagi harus menulis
    // ulang hash setiap entri dari titik ini sampai entri paling akhir.
    const chain = await makeChain('dev-1', 5)
    chain[2] = { ...chain[2], details: 'DIUBAH diam-diam lewat DevTools' } // hash-nya sengaja TIDAK ikut diperbarui
    const results = await verifyDeviceChain(chain)
    expect(results[0].verdict).toBe('ok')
    expect(results[1].verdict).toBe('ok')
    expect(results[2].verdict).toBe('broken') // hash entri ini sendiri tak cocok lagi
    expect(results[3].verdict).toBe('broken') // prevHash-nya menunjuk hash lama entri #2 yang sudah tak berlaku
    expect(results[4].verdict).toBe('ok') // rantainya sendiri (dari #3) tetap utuh & konsisten
  })

  it('menghapus satu entri di tengah menandai TEPAT satu titik putus, lalu rantai pulih (entri sesudahnya konsisten dengan tetangganya sendiri)', async () => {
    const chain = await makeChain('dev-1', 5)
    chain.splice(2, 1) // hapus entri index 2 — entri index 3 (sekarang index 2) prevHash-nya "menggantung"
    const results = await verifyDeviceChain(chain)
    expect(results[0].verdict).toBe('ok')
    expect(results[1].verdict).toBe('ok')
    expect(results[2].verdict).toBe('broken') // prevHash entri ini menunjuk entri yang sudah dihapus — TITIK PUTUSnya
    expect(results[3].verdict).toBe('ok') // tapi isinya sendiri tak disentuh, jadi tervalidasi lagi dari sini
  })

  it('entri lama (hash null, pra-fitur ini) ditandai unverifiable, bukan broken', async () => {
    const legacy: AuditLogEntry = {
      id: 'legacy-1', userId: 'u1', userName: 'Kasir', action: 'order.void', entityType: 'order',
      entityId: 'o0', details: 'entri lama', createdAt: 500, deviceId: null, deviceSeq: null, prevHash: null, hash: null,
    }
    const chain = await makeChain('dev-1', 2)
    const results = await verifyDeviceChain([legacy, ...chain])
    expect(results[0].verdict).toBe('unverifiable')
    expect(results[1].verdict).toBe('ok') // entri baru pertama boleh mulai rantai baru setelah entri lama
    expect(results[2].verdict).toBe('ok')
  })

  it('rantai kosong tidak melempar', async () => {
    expect(await verifyDeviceChain([])).toEqual([])
  })
})

describe('verifyAuditLog — pengelompokan per perangkat', () => {
  it('rantai dua perangkat berbeda diverifikasi independen — kerusakan di satu tidak memengaruhi yang lain', async () => {
    const deviceA = await makeChain('dev-a', 3)
    const deviceB = await makeChain('dev-b', 3)
    deviceA[1] = { ...deviceA[1], details: 'DIUBAH' } // rusak khusus di perangkat A

    const summary = await verifyAuditLog([...deviceA, ...deviceB])

    expect(summary.totalEntries).toBe(6)
    expect(summary.brokenCount).toBe(2) // entri #1 & #2 milik dev-a
    expect(summary.okCount).toBe(4) // dev-a entri #0 + seluruh dev-b (3)
    expect(summary.brokenEntryIds).toEqual(['e1', 'e2'])
  })

  it('tidak peduli urutan input — mengurutkan ulang per deviceSeq sebelum verifikasi', async () => {
    const chain = await makeChain('dev-1', 4)
    const shuffled = [chain[2], chain[0], chain[3], chain[1]]
    const summary = await verifyAuditLog(shuffled)
    expect(summary.brokenCount).toBe(0)
    expect(summary.okCount).toBe(4)
  })
})
