import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { updateSettings } from '@/db/repositories/settings'
import { startOrder } from '@/db/repositories/orders'
import { getOpenShift, openShift } from '@/db/repositories/shifts'
import { setPagerSender, resetPagerSender } from '@/features/pager/pagerDrivers'
import { buildPagerFrame } from '@/features/pager/pagerProtocol'
import { processPagerQueue } from '@/features/pager/pagerEngine'
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

async function readyOrder(queueNumber: number | null): Promise<string> {
  const shift =
    (await getOpenShift()) ?? (await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 100000 }))
  const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Kasir', shiftId: shift.id })
  await db.orders.update(order.id, { lifecycleStatus: 'READY', queueNumber })
  return order.id
}

describe('processPagerQueue', () => {
  it('memanggil pager memakai queueNumber lalu menandai pagerCalledAt (sekali saja)', async () => {
    await updateSettings({ pagerConfig: PAGER_ON })
    const id = await readyOrder(5)

    await processPagerQueue()
    expect(sent).toHaveLength(1)
    expect(Array.from(sent[0])).toEqual(Array.from(buildPagerFrame(TEMPLATE, 5)))
    expect((await db.orders.get(id))?.pagerCalledAt).toBeTypeOf('number')

    await processPagerQueue()
    expect(sent).toHaveLength(1) // tidak dipanggil lagi
  })

  it('tidak memanggil bila pager nonaktif', async () => {
    await updateSettings({ pagerConfig: { ...PAGER_ON, connectionType: 'none' } })
    await readyOrder(5)
    await processPagerQueue()
    expect(sent).toHaveLength(0)
  })

  it('tidak memanggil bila autoCallOnReady mati', async () => {
    await updateSettings({ pagerConfig: { ...PAGER_ON, autoCallOnReady: false } })
    await readyOrder(5)
    await processPagerQueue()
    expect(sent).toHaveLength(0)
  })

  it('melewati order yang sudah dipanggil perangkat lain', async () => {
    await updateSettings({ pagerConfig: PAGER_ON })
    const id = await readyOrder(5)
    await db.orders.update(id, { pagerCalledAt: Date.now() - 1000 })
    await processPagerQueue()
    expect(sent).toHaveLength(0)
  })

  it('melewati order di luar rentang nomor pager', async () => {
    await updateSettings({ pagerConfig: { ...PAGER_ON, maxPagerNumber: 10 } })
    await readyOrder(25)
    await readyOrder(null)
    await processPagerQueue()
    expect(sent).toHaveLength(0)
  })

  it('tidak menandai pagerCalledAt bila pengiriman gagal', async () => {
    await updateSettings({ pagerConfig: PAGER_ON })
    const id = await readyOrder(5)
    resetPagerSender()
    setPagerSender(async () => {
      throw new Error('port serial tidak terbuka')
    })
    await processPagerQueue()
    expect((await db.orders.get(id))?.pagerCalledAt ?? null).toBeNull()
  })
})
