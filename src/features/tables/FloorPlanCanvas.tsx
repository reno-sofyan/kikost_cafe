import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { setTablePosition, TABLE_STATUS_LABELS } from '@/db/repositories/tables'
import { STATUS_COLORS, STATUS_DOT } from '@/features/tables/tableStatusStyles'
import type { CafeTable } from '@/types/domain'

const TILE_W = 15 // % lebar kanvas
const TILE_H = 22 // % tinggi kanvas
const COLS = 6

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** Posisi jatuh-belakang untuk meja yang belum pernah digeser (posX/posY null) —
 *  grid otomatis, murni tampilan, tak disimpan sampai benar-benar digeser sekali. */
function fallbackPos(index: number): { x: number; y: number } {
  const col = index % COLS
  const row = Math.floor(index / COLS)
  return { x: col * TILE_W + 1, y: row * (TILE_H + 4) + 4 }
}

interface Props {
  tables: CafeTable[]
  /** Tap tanpa geser (mis. untuk buka QR/ubah meja) — dibedakan dari drag lewat ambang gerak kecil. */
  onTap: (table: CafeTable) => void
}

/** Kanvas denah bebas-geser (mode "Susun Denah"). Koordinat disimpan sebagai
 *  persentase kanvas (bukan piksel) supaya proporsional di lebar layar apa pun. */
export function FloorPlanCanvas({ tables, onTap }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const movedRef = useRef(false)

  const posFor = useCallback(
    (table: CafeTable, index: number): { x: number; y: number } =>
      table.posX != null && table.posY != null ? { x: table.posX, y: table.posY } : fallbackPos(index),
    [],
  )

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>, table: CafeTable, index: number) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragId(table.id)
      movedRef.current = false
      setDragPos(posFor(table, index))
    },
    [posFor],
  )

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragId || !canvasRef.current) return
    movedRef.current = true
    const rect = canvasRef.current.getBoundingClientRect()
    const x = clamp(((e.clientX - rect.left) / rect.width) * 100 - TILE_W / 2, 0, 100 - TILE_W)
    const y = clamp(((e.clientY - rect.top) / rect.height) * 100 - TILE_H / 2, 0, 100 - TILE_H)
    setDragPos({ x, y })
  }, [dragId])

  const handlePointerUp = useCallback(
    (table: CafeTable) => {
      if (dragId === table.id) {
        if (movedRef.current && dragPos) {
          void setTablePosition(table.id, dragPos.x, dragPos.y)
        } else {
          onTap(table)
        }
      }
      setDragId(null)
      setDragPos(null)
    },
    [dragId, dragPos, onTap],
  )

  return (
    <div
      ref={canvasRef}
      className="relative h-[380px] w-full rounded-2xl border-2 border-dashed border-ink-700 bg-ink-950/30"
    >
      {tables.map((table, i) => {
        const isDragging = dragId === table.id
        const pos = isDragging && dragPos ? dragPos : posFor(table, i)
        return (
          <button
            key={table.id}
            onPointerDown={(e) => handlePointerDown(e, table, i)}
            onPointerMove={handlePointerMove}
            onPointerUp={() => handlePointerUp(table)}
            style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: `${TILE_W}%` }}
            className={`absolute flex touch-none select-none flex-col items-center gap-0.5 rounded-xl border p-2 text-center transition-transform ${STATUS_COLORS[table.status]} ${
              isDragging ? 'z-10 scale-105 shadow-lg' : ''
            }`}
          >
            <span className="line-clamp-1 text-sm font-semibold leading-none">{table.name}</span>
            <span className="flex items-center gap-1 text-[0.65rem] font-medium">
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[table.status]}`} />
              {TABLE_STATUS_LABELS[table.status]}
            </span>
          </button>
        )
      })}
      {tables.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-500">Tidak ada meja di area ini</p>
      )}
    </div>
  )
}
