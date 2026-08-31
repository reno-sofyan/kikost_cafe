import { formatTime } from '@/lib/datetime'
import type { Order, OrderItem } from '@/types/domain'

const ORDER_TYPE_LABELS: Record<Order['type'], string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
}

export function printKitchenTicket(order: Order, items: OrderItem[], tableName?: string): void {
  const rows = items
    .map((item) => {
      const mods = item.modifiers.map((m) => `<div class="sub">${m.groupName}: ${m.optionName}</div>`).join('')
      const note = item.notes ? `<div class="sub">Catatan: ${item.notes}</div>` : ''
      return `<div class="item"><div class="qty">${item.qty}x</div><div><div class="name">${item.productName}</div>${mods}${note}</div></div>`
    })
    .join('')

  const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  @page { size: 80mm auto; margin: 2mm; }
  body { width: 76mm; font-family: 'Courier New', monospace; margin: 0; }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  h1 { font-size: 16px; margin: 4px 0; }
  hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
  .item { display: flex; gap: 8px; padding: 4px 0; border-bottom: 1px dotted #999; }
  .qty { font-weight: 700; font-size: 14px; min-width: 28px; }
  .name { font-weight: 700; font-size: 13px; }
  .sub { font-size: 11px; padding-left: 4px; }
</style></head>
<body>
  <div class="center bold"><h1>ORDER DAPUR</h1></div>
  <div>No: ${order.orderNumber}</div>
  <div>Waktu: ${formatTime(Date.now())}</div>
  <div>Tipe: ${ORDER_TYPE_LABELS[order.type]}${tableName ? ` (${tableName})` : ''}</div>
  <hr />
  ${rows}
</body></html>`

  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  document.body.appendChild(frame)
  const doc = frame.contentWindow?.document
  if (!doc) return
  doc.open()
  doc.write(html)
  doc.close()
  setTimeout(() => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => document.body.removeChild(frame), 2000)
  }, 200)
}
