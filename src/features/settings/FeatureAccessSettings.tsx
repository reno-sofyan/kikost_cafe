import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings, updateSettings } from '@/db/repositories/settings'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { featuresForBusinessType } from '@/lib/businessType'
import { ROLE_LABELS } from '@/lib/permissions'
import { ALL_ROLES, lockedRolesFor, NAV_ITEM_DEFS, resolveNavItems, type NavAccessConfig, type NavKey } from '@/lib/navAccess'
import { Icon } from '@/components/ui/Icon'
import { useSessionStore } from '@/state/sessionStore'
import { toast } from '@/state/toastStore'
import type { Role } from '@/types/domain'

interface Draft {
  enabled: boolean
  roles: Role[]
}

/**
 * Pengaturan → Fitur & Akses: memilih menu samping yang dipakai usaha ini dan
 * peran mana yang boleh membukanya. Tersimpan di pengaturan (ikut sinkron ke
 * semua tablet). Pemilik selalu bisa membuka menu yang aktif; Pengaturan selalu
 * aktif untuk Pemilik & Administrator supaya tak ada yang terkunci di luar.
 */
export function FeatureAccessSettings() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const settings = useLiveQuery(() => getSettings(), [])
  const [draft, setDraft] = useState<Record<NavKey, Draft> | null>(null)

  useEffect(() => {
    if (!settings) return
    const items = resolveNavItems(settings, featuresForBusinessType(settings.businessType))
    setDraft(Object.fromEntries(items.map((i) => [i.key, { enabled: i.enabled, roles: i.roles }])) as Record<NavKey, Draft>)
  }, [settings])

  if (!settings || !draft) return null
  const features = featuresForBusinessType(settings.businessType)

  function update(key: NavKey, patch: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, [key]: { ...d[key], ...patch } } : d))
  }

  function toggleRole(key: NavKey, role: Role) {
    const roles = draft![key].roles
    update(key, { roles: roles.includes(role) ? roles.filter((r) => r !== role) : ALL_ROLES.filter((r) => r === role || roles.includes(r)) })
  }

  function resetDefaults() {
    const items = resolveNavItems({ navAccess: {} }, features)
    setDraft(Object.fromEntries(items.map((i) => [i.key, { enabled: i.enabled, roles: i.roles }])) as Record<NavKey, Draft>)
  }

  async function save() {
    // Hanya simpan yang berbeda dari bawaan, supaya menu yang tak disentuh tetap
    // mengikuti jenis usaha bila Jenis Usaha diganti kemudian.
    const defaults = resolveNavItems({ navAccess: {} }, features)
    const navAccess: NavAccessConfig = {}
    for (const d of defaults) {
      const row = draft![d.key]
      const rule: NavAccessConfig[NavKey] = {}
      if (row.enabled !== d.enabled) rule.enabled = row.enabled
      if (row.roles.join() !== d.roles.join()) rule.roles = row.roles
      if (Object.keys(rule).length) navAccess[d.key] = rule
    }
    await updateSettings({ navAccess })
    const off = NAV_ITEM_DEFS.filter((d) => !draft![d.key].enabled).map((d) => d.label)
    await recordAuditLog({
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'settings.navAccess',
      entityType: 'settings',
      entityId: 'singleton',
      details: `Fitur & akses menu diubah.${off.length ? ` Tidak dipakai: ${off.join(', ')}.` : ' Semua menu dipakai.'}`,
    })
    toast.success('Fitur & akses disimpan — berlaku di semua tablet setelah sinkron.')
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h2 className="text-lg font-bold text-ink-50">Fitur &amp; Akses</h2>
        <p className="mt-1 text-sm text-ink-300">
          Pilih menu samping yang dipakai, lalu centang peran yang boleh membukanya. Menu yang dimatikan hilang dari semua akun. Pemilik selalu bisa
          membuka menu yang aktif.
        </p>
      </div>

      <div className="card divide-y divide-ink-800 overflow-hidden">
        {NAV_ITEM_DEFS.map((def) => {
          const row = draft[def.key]
          const locked = lockedRolesFor(def)
          const notForType = def.feature && !features[def.feature]
          return (
            <div key={def.key} className={`flex flex-wrap items-center gap-x-4 gap-y-3 p-4 ${row.enabled ? '' : 'bg-ink-900/60'}`}>
              <div className="flex min-w-[14rem] flex-1 items-center gap-3">
                <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ${row.enabled ? 'bg-brand-600/12 text-brand-600' : 'bg-ink-800 text-ink-500'}`}>
                  <Icon name={def.icon} size={20} />
                </span>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${row.enabled ? 'text-ink-50' : 'text-ink-400'}`}>{def.label}</p>
                  <p className="text-xs text-ink-400">
                    {def.description}
                    {notForType && <span className="text-accent-500"> Bawaan mati untuk jenis usaha ini.</span>}
                  </p>
                </div>
              </div>

              <label className={`flex flex-none items-center gap-2 text-sm ${def.required ? 'text-ink-500' : 'text-ink-200'}`} title={def.required ? 'Menu wajib' : undefined}>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`Pakai menu ${def.label}`}
                  className="h-5 w-5"
                  checked={row.enabled}
                  disabled={def.required}
                  onChange={(e) => update(def.key, { enabled: e.target.checked })}
                />
                {row.enabled ? 'Dipakai' : 'Tidak dipakai'}
              </label>

              <div className="flex w-full flex-wrap gap-1.5 pl-[3.25rem]" aria-label={`Peran yang boleh membuka ${def.label}`}>
                {ALL_ROLES.map((role) => {
                  const isLocked = locked.includes(role)
                  const on = row.roles.includes(role) || isLocked
                  return (
                    <button
                      key={role}
                      type="button"
                      aria-pressed={on}
                      disabled={!row.enabled || isLocked}
                      onClick={() => toggleRole(def.key, role)}
                      title={isLocked ? 'Selalu punya akses' : undefined}
                      className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                        on ? 'border-brand-500 bg-brand-600 text-white' : 'border-ink-600 bg-ink-900 text-ink-300 hover:border-ink-400'
                      } ${!row.enabled ? 'opacity-40' : isLocked ? 'opacity-70' : ''}`}
                    >
                      {on && <Icon name="check" size={12} />}
                      {ROLE_LABELS[role]}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => void save()}>
          Simpan
        </button>
        <button className="btn-secondary" onClick={resetDefaults}>
          Kembalikan ke Bawaan
        </button>
      </div>
    </div>
  )
}
