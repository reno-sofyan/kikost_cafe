import legacyWebView from './postcss-legacy-webview.js'

export default {
  plugins: [
    // Tailwind & autoprefixer lewat nama (dimuat PostCSS), lalu tulis ulang untuk WebView lama.
    (await import('tailwindcss')).default,
    (await import('autoprefixer')).default,
    legacyWebView,
  ],
}
