import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Skala netral hangat: 50 = teks utama (paling gelap), 950 = latar aplikasi (krem).
        ink: {
          50: '#16241b',
          100: '#223629',
          200: '#33503d',
          300: '#4c6c56',
          400: '#6f8977',
          500: '#94a892',
          600: '#b7c4ac',
          700: '#d8d2ba',
          800: '#ece3cd',
          900: '#fbf8f0',
          950: '#f4ecd9',
        },
        // Hijau tua sebagai warna aksi utama/brand.
        brew: {
          400: '#3f8f68',
          500: '#256b4c',
          600: '#1a5940',
          700: '#124535',
        },
        // Hijau sekunder untuk status positif (shift aktif, saldo, dsb).
        sage: {
          400: '#6fa084',
          500: '#4d7c62',
          600: '#3c6350',
        },
        // Aksen cokelat hangat untuk highlight sekunder (favorit, lencana, dsb).
        brown: {
          400: '#c08a55',
          500: '#a06a3a',
          600: '#7c4f28',
          700: '#5c3a1e',
        },
        cream: {
          50: '#fffefb',
          100: '#fffaf0',
          200: '#f4ecd9',
        },
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      spacing: {
        touch: '3.25rem',
      },
    },
  },
  plugins: [],
} satisfies Config
