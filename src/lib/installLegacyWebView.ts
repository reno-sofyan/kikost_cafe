// Diimpor PERTAMA di main.tsx: polyfill harus terpasang sebelum modul lain dievaluasi.
import { installLegacyWebViewSupport } from '@/lib/legacyWebView'

installLegacyWebViewSupport()
