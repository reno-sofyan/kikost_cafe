import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DrawerNeedsEscPosPrinterError, openCashDrawer, openCashDrawerForPayment } from './cashDrawer'
import { buildEscPosDrawerKick } from './escpos'
import { PrinterNotConfiguredError, resetEscPosSender, setEscPosSender } from './printerDrivers'
import { savePrinter } from '@/db/repositories/printers'
import { getSettings, updateSettings } from '@/db/repositories/settings'
import { resetLocalDb } from '@/test/db'

const actor = { userId: 'u1', userName: 'Pemilik' }
let sent: Uint8Array[] = []

async function addCashierPrinter(connectionType: 'bluetooth' | 'browser' = 'bluetooth') {
  await savePrinter(
    {
      name: 'Kasir',
      station: 'cashier',
      connectionType,
      bluetoothAddress: connectionType === 'bluetooth' ? 'AA:BB' : null,
      bluetoothName: null,
      networkHost: null,
      networkPort: null,
      paperSize: '58mm',
      active: true,
      fallbackPrinterId: null,
    },
    actor,
  )
}

/** Pemicu laci jalan di latar; tunggu sampai rantai async-nya selesai. */
const settle = () => new Promise((r) => setTimeout(r, 50))

describe('laci kasir', () => {
  beforeEach(async () => {
    await resetLocalDb()
    sent = []
    setEscPosSender(async (_t, bytes) => {
      sent.push(bytes)
    })
  })
  afterEach(() => resetEscPosSender())

  it('pulsa ESC p ke pin 2 & pin 5 tanpa mencetak', () => {
    expect(Array.from(buildEscPosDrawerKick())).toEqual([0x1b, 0x70, 0, 25, 250, 0x1b, 0x70, 1, 25, 250])
  })

  it('membuka laci lewat printer kasir', async () => {
    await addCashierPrinter()
    await openCashDrawer()
    expect(sent).toEqual([buildEscPosDrawerKick()])
  })

  it('menolak bila tak ada printer kasir / printer browser', async () => {
    await expect(openCashDrawer()).rejects.toBeInstanceOf(PrinterNotConfiguredError)
    await addCashierPrinter('browser')
    await expect(openCashDrawer()).rejects.toBeInstanceOf(DrawerNeedsEscPosPrinterError)
  })

  it('otomatis hanya untuk pembayaran yang memuat tunai', async () => {
    await addCashierPrinter()
    openCashDrawerForPayment(['qris'])
    await settle()
    expect(sent).toHaveLength(0)
    openCashDrawerForPayment(['qris', 'cash'])
    await settle()
    expect(sent).toHaveLength(1)
  })

  it('tidak membuka bila dimatikan di pengaturan', async () => {
    await addCashierPrinter()
    await updateSettings({ printerConfig: { ...(await getSettings()).printerConfig, openDrawerOnCash: false } })
    openCashDrawerForPayment(['cash'])
    await settle()
    expect(sent).toHaveLength(0)
  })
})
