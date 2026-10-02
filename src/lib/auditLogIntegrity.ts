// Rantai hash untuk `auditLogs` — mendeteksi (bukan mencegah) entri yang
// diubah/dihapus lewat akses langsung ke IndexedDB, di luar aplikasi ini
// (mis. staf tak jujur membuka DevTools untuk menghapus jejak void yang
// mereka setujui sendiri). Tabel Dexie biasa tidak punya proteksi apa pun
// terhadap ini — siapa pun dengan akses ke tablet bisa mengedit baris
// langsung. Rantai hash tidak mencegahnya (tidak mungkin dicegah murni di
// klien), tapi membuatnya TERDETEKSI: mengubah/menghapus satu entri membuat
// hash entri itu dan SEMUA entri setelahnya di perangkat yang sama tidak
// cocok lagi saat diverifikasi ulang.
//
// Di-scope PER PERANGKAT (`deviceId`), bukan satu rantai global lintas semua
// entri: aplikasi ini offline-first, tiap tablet menulis audit log-nya sendiri
// sebelum sempat sinkron, jadi tidak ada urutan tunggal yang pasti sampai
// semua perangkat tersinkron ke server.

import type { AuditLogEntry } from '@/types/domain'

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Bentuk KANONIK yang dihash — urutan field eksplisit, sama alasannya dengan
 *  `canonicalLicenseBytes` di license.ts: tidak boleh bergantung pada urutan
 *  key objek JS, yang tidak dijamin stabil. Termasuk `deviceSeq` supaya nomor
 *  urut itu sendiri juga tak bisa diubah diam-diam tanpa merusak hash. */
function canonicalEntryText(entry: Omit<AuditLogEntry, 'hash'>): string {
  return JSON.stringify({
    id: entry.id,
    userId: entry.userId,
    userName: entry.userName,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    details: entry.details,
    createdAt: entry.createdAt,
    deviceId: entry.deviceId,
    deviceSeq: entry.deviceSeq,
    prevHash: entry.prevHash,
  })
}

export async function computeEntryHash(entry: Omit<AuditLogEntry, 'hash'>): Promise<string> {
  return sha256Hex(canonicalEntryText(entry))
}

// ---- Penunjuk ujung rantai per perangkat (localStorage) ----
//
// `recordAuditLog` butuh tahu "hash + nomor urut entri terakhir YANG DITULIS
// PERANGKAT INI" untuk entri berikutnya. Mencarinya lewat query tabel (mis.
// entri ber-`createdAt` terbesar) TIDAK bisa diandalkan: beberapa entri bisa
// punya `createdAt` yang sama persis (resolusi milidetik, beberapa aksi
// tercatat di siklus event-loop yang sama) — dasi seri begitu bisa memilih
// entri yang salah sebagai "terakhir". Penunjuk O(1) yang diperbarui tepat
// saat entri ditulis (bukan ditebak belakangan dari data yang ada) tidak kena
// masalah ini sama sekali.

const CHAIN_HEAD_PREFIX = 'kione.auditChainHead.'

export interface ChainHead {
  hash: string
  seq: number
}

export function getLastChainHead(deviceId: string): ChainHead | null {
  try {
    const raw = localStorage.getItem(CHAIN_HEAD_PREFIX + deviceId)
    return raw ? (JSON.parse(raw) as ChainHead) : null
  } catch {
    return null
  }
}

export function setLastChainHead(deviceId: string, head: ChainHead): void {
  try {
    localStorage.setItem(CHAIN_HEAD_PREFIX + deviceId, JSON.stringify(head))
  } catch {
    /* localStorage tidak tersedia — entri berikutnya mulai rantai baru (prevHash null), bukan error fatal */
  }
}

export type ChainVerdict = 'ok' | 'broken' | 'unverifiable'

export interface ChainCheckResult {
  entryId: string
  verdict: ChainVerdict
}

/**
 * Verifikasi rantai hash SATU perangkat. `entries` HARUS berisi entri milik
 * satu `deviceId` yang sama, terurut `deviceSeq` MENAIK (lama → baru) —
 * pemanggil (`verifyAuditLog`) yang menjamin ini.
 *
 * `unverifiable` = entri lama dari sebelum fitur ini ada (`hash: null`) —
 * bukan indikasi manipulasi, hanya tak punya data untuk diperiksa.
 * `broken` = hash tidak cocok dengan isi entri, ATAU `prevHash`-nya tidak
 * cocok dengan hash entri sebelumnya — salah satunya cukup untuk menandai
 * seluruh rantai SETELAH titik itu juga perlu diperiksa ulang dari sana.
 */
export async function verifyDeviceChain(entries: AuditLogEntry[]): Promise<ChainCheckResult[]> {
  const results: ChainCheckResult[] = []
  let expectedPrevHash: string | null | undefined // undefined = titik mulai tak diketahui, terima prevHash apa pun

  for (const entry of entries) {
    if (entry.hash == null) {
      results.push({ entryId: entry.id, verdict: 'unverifiable' })
      expectedPrevHash = undefined // rantai berikutnya boleh mulai dari titik ini
      continue
    }

    const prevMatches = expectedPrevHash === undefined || entry.prevHash === expectedPrevHash
    const recomputed = await computeEntryHash(entry)
    const hashMatches = recomputed === entry.hash

    results.push({ entryId: entry.id, verdict: prevMatches && hashMatches ? 'ok' : 'broken' })
    // Rantai berikutnya diperiksa terhadap hash yang DIHITUNG ULANG, bukan yang
    // tersimpan di entri ini — kalau isinya diam-diam diedit tanpa memperbarui
    // field `hash`-nya (jalan pintas paling malas untuk menutupi jejak), efek
    // "rusak"-nya harus menjalar ke SEMUA entri setelahnya, bukan berhenti di
    // entri yang diedit saja. Memakai `entry.hash` (nilai tersimpan) di sini akan
    // membuat entri-entri setelahnya tetap tervalidasi "ok" walau leluhurnya
    // sudah terbukti dipalsukan — melemahkan seluruh tujuan rantai ini.
    expectedPrevHash = recomputed
  }

  return results
}

export interface AuditLogIntegritySummary {
  totalEntries: number
  okCount: number
  brokenCount: number
  unverifiableCount: number
  /** id entri pertama yang terdeteksi rusak per perangkat, untuk ditunjuk di UI. */
  brokenEntryIds: string[]
}

/** Verifikasi seluruh audit log, dikelompokkan per `deviceId` (lihat catatan di atas berkas). */
export async function verifyAuditLog(allEntries: AuditLogEntry[]): Promise<AuditLogIntegritySummary> {
  const byDevice = new Map<string, AuditLogEntry[]>()
  for (const entry of allEntries) {
    const key = entry.deviceId ?? '__legacy__'
    const list = byDevice.get(key) ?? []
    list.push(entry)
    byDevice.set(key, list)
  }

  const summary: AuditLogIntegritySummary = { totalEntries: allEntries.length, okCount: 0, brokenCount: 0, unverifiableCount: 0, brokenEntryIds: [] }
  for (const entries of byDevice.values()) {
    // `deviceSeq` (bukan `createdAt`) menentukan urutan verifikasi — lihat
    // catatan "Penunjuk ujung rantai" di atas soal kenapa createdAt tak cukup.
    // Entri lama (`deviceSeq: null`) diurutkan berdasar createdAt di antara
    // sesamanya, ditaruh sebelum entri baru (yang selalu ber-deviceSeq).
    entries.sort((a, b) => {
      if (a.deviceSeq != null && b.deviceSeq != null) return a.deviceSeq - b.deviceSeq
      if (a.deviceSeq == null && b.deviceSeq == null) return a.createdAt - b.createdAt
      return a.deviceSeq == null ? -1 : 1
    })
    const results = await verifyDeviceChain(entries)
    for (const r of results) {
      if (r.verdict === 'ok') summary.okCount += 1
      else if (r.verdict === 'unverifiable') summary.unverifiableCount += 1
      else {
        summary.brokenCount += 1
        summary.brokenEntryIds.push(r.entryId)
      }
    }
  }
  return summary
}
