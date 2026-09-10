import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Label lokasi untuk pesan & log (mis. "layar Kasir"). */
  scope?: string
  /** Ditampilkan sebagai pengganti fallback bawaan. */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
}

/**
 * Menangkap error render supaya satu layar yang rusak tidak mematikan seluruh
 * POS di tengah transaksi. Fallback menjaga kasir tetap bisa memuat ulang layar
 * atau seluruh aplikasi tanpa kehilangan data (semua tersimpan di IndexedDB).
 *
 * Untuk mereset otomatis saat pindah rute, beri `key` yang berubah per rute.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary${this.props.scope ? ` ${this.props.scope}` : ''}]`, error, info.componentStack)
  }

  reset = (): void => this.setState({ error: null })

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)

    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="card max-w-md space-y-4 p-6 text-center">
          <p className="text-lg font-bold text-ink-50">
            Terjadi kesalahan{this.props.scope ? ` pada ${this.props.scope}` : ''}
          </p>
          <p className="text-sm text-ink-300">
            Data Anda aman — tersimpan di perangkat. Coba muat ulang layar ini; kalau masih bermasalah,
            muat ulang aplikasi.
          </p>
          <pre className="max-h-32 overflow-auto rounded-lg bg-ink-950 p-3 text-left text-xs text-ink-400">
            {error.message || String(error)}
          </pre>
          <div className="flex justify-center gap-2">
            <button className="btn-secondary !min-h-0 !px-4 !py-2 text-sm" onClick={this.reset}>
              Coba lagi
            </button>
            <button
              className="btn-primary !min-h-0 !px-4 !py-2 text-sm"
              onClick={() => window.location.reload()}
            >
              Muat ulang aplikasi
            </button>
          </div>
        </div>
      </div>
    )
  }
}
