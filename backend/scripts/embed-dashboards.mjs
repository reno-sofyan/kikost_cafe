// Membangkitkan src/routes/{ops,owner}Dashboard.ts dari file .html sumbernya.
// Jalankan setelah mengedit HTML:  node scripts/embed-dashboards.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const routes = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'routes')

const targets = [
  {
    name: 'opsDashboard',
    constName: 'OPS_DASHBOARD_HTML',
    doc: `/**
 * HTML shell konsol operator (lihat ops.ts). Statis & tanpa data; seluruh data
 * diambil lewat fetch ber-Bearer-token ke /ops/api/*. Di-embed sebagai string
 * agar tidak perlu menyajikan file statis dari disk pada container backend.
 *
 * Sumber yang bisa dibaca manusia: backend/src/routes/opsDashboard.html
 */`,
  },
  {
    name: 'ownerDashboard',
    constName: 'OWNER_DASHBOARD_HTML',
    doc: `/**
 * HTML shell konsol Pemilik (lihat owner.ts). Statis & tanpa data; seluruh data
 * diambil lewat fetch ber-Bearer-token ke /owner/api/*.
 *
 * JANGAN diedit langsung — sumbernya backend/src/routes/ownerDashboard.html,
 * bangkitkan ulang dengan: node scripts/embed-dashboards.mjs
 */`,
  },
]

const escapeTemplate = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')

for (const t of targets) {
  const html = readFileSync(join(routes, `${t.name}.html`), 'utf8')
  writeFileSync(join(routes, `${t.name}.ts`), `${t.doc}\nexport const ${t.constName} = \`${escapeTemplate(html)}\`\n`)
  console.log(`${t.name}.ts diperbarui`)
}
