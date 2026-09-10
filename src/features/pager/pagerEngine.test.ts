import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { updateSettings } from '@/db/repositories/settings'
import { startOrder } from '@/db/repositories/orders'
import { getOpenShift, openShift } from '@/db/repositories/shifts'
import { setPagerSender, resetPagerSender } from '@/features/pager/pagerDrivers'
import { buildPagerFrame } from '@/features/pager/pagerProtocol'
import { processPagerQueue, getPagerPoolSnapshot } from '@/features/pager/pagerEngine'
import type { PagerConfig } from '@/types/domain'

const TEMPLATE = '02{nnn}03'

const PAGER_ON: PagerConfig = {
  connectionType: 'usb-serial',
  autoCallOnReady: true,
  baudRate: 9600,
  commandTemplateHex: TEMPLATE,
  maxPagerNumber: 30,
  interCharDelayMs: 0,
  usbDeviceId: null,
  usbDeviceLabel: null,
}

let sent: Uint8Array[] = []

beforeEach(async () => {
  await resetLocalDb()
  sent = []
  setPagerSender(async (_target, frame) => {
    sent.push(frame)
  })
})

let seq = 0
async function readyOrder(): Promise<string> {
  const shift =
    (await getOpenShift()) ?? (await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 100000 }))
  const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Kasir', shiftId: shift.id })
  // createdAt berurutan supaya penomoran coaster FIFO bisa diuji deterministik.
  seq += 1
  await db.orders.update(order.id, { lifecycleStatus: 'READY', createdAt: Date.now() + seq })
  return order.id
}

describe('processPagerQueue', () => {
  beforeEach(() => {
    seq = 0
  })

  it('memanggil coaster #1 lalu menandai pagerNumber + pagerCalledAt (sekali saja)', async () => {
    await updateSettings({ pagerConfig: PAGER_ON })
    const id = await readyOrder()

    await processPagerQueue()
    expect(sent).toHaveLength(1)
    expect(Array.from(sent[0])).toEqual(Array.from(buildPagerFrame(TEMPLATE, 1)))
    const order = await db.orders.get(id)
    expect(order?.pagerNumber).toBe(1)
    expect(order?.pagerCalledAt).toBeTypeOf('number')

    await processPagerQueue()
    expect(sent).toHaveLength(1) // tidak dipanggil lagi
  })

  it('memberi nomor coaster berurutan (FIFO) untuk beberapa order', async () => {
    await updateSettings({ pagerConfig: PAGER_ON })
    const a = await readyOrder()
    const b = await readyOrder()
    const c = await readyOrder()

    await processPagerQueue()
    expect((await db.orders.get(a))?.pagerNumber).toBe(1)
    expect((await db.orders.get(b))?.pagerNumber).toBe(2)
    expect((await db.orders.get(c))?.pagerNumber).toBe(3)
  })

  it('mendaur ulang nomor coaster setelah order diambil pelanggan', async () => {
    await updateSettings({ pagerConfig: { ...PAGER_ON, maxPagerNumber: 2 } })
    const a = await readyOrder()
    const b = await readyOrder()
    const c = await readyOrder()

    await processPagerQueue()
    expect((await db.orders.get(a))?.pagerNumber).toBe(1)
    expect((await db.orders.get(b))?.pagerNumber).toBe(2)
    // c belum kebagian coaster (kumpulan penuh) → belum dipanggil
    expect((await db.orders.get(c))?.pagerNumber ?? null).toBeNull()
    expect((await db.orders.get(c))?.pagerCalledAt ?? null).toBeNull()
    expect(sent).toHaveLength(2)

    const snapFull = await getPagerPoolSnapshot()
    expect(snapFull).toMatchObject({ enabled: true, max: 2, held: 2, waitingForCoaster: 1 })

    // a diambil pelanggan → coaster #1 bebas
    await db.orders.update(a, { lifecycleStatus: 'SERVED' })
    await processPagerQueue()
    expect((await db.orders.get(c))?.pagerNumber).toBe(1)
    expect(sent).toHaveLength(3)
    expect(Array.from(sent[2])).toEqual(Array.from(buildPagerFrame(TEMPLATE, 1)))
  })

  it('tidak memanggil bila pager nonaktif', async () => {
    await updateSettings({ pagerConfig: { ...PAGER_ON, connectionType: 'none' } })
    await readyOrder()
    await processPagerQueue()
    expect(sent).toHaveLength(0)
  })

  it('tidak memanggil bila autoCallOnReady mati', async () => {
    await updateSettings({ pagerConfig: { ...PAGER_ON, autoCallOnReady: false } })
    await readyOrder()
    await processPagerQueue()
    expect(sent).toHaveLength(0)
  })

  it('melewati order yang sudah dipanggil perangkat lain', async () => {
    await updateSettings({ pagerConfig: PAGER_ON })
    const id = await readyOrder()
    await db.orders.update(id, { pagerCalledAt: Date.now() - 1000, pagerNumber: 7 })
    await processPagerQueue()
    expect(sent).toHaveLength(0)
  })

  it('tidak menandai pagerCalledAt bila pengiriman gagal', async () => {
    await updateSettings({ pagerConfig: PAGER_ON })
    const id = await readyOrder()
    resetPagerSender()
    setPagerSender(async () => {
      throw new Error('port serial tidak terbuka')
    })
    await processPagerQueue()
    const order = await db.orders.get(id)
    expect(order?.pagerCalledAt ?? null).toBeNull()
    expect(order?.pagerNumber ?? null).toBeNull()
  })
})
