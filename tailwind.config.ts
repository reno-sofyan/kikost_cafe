import type { Config } from 'tailwindcss'

/**
 * Sistem warna Kinara Coffee.
 * Diturunkan dari dua warna logo: espresso #462816 & kopi susu #70422b.
 * Konvensi skala `ink` SENGAJA terbalik: 50 = teks paling gelap,
 * 950 = kanvas aplikasi (krem). Nomor tinggi = lebih terang.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Netral hangat "kertas kopi". 50 = teks utama, 900 = kartu, 950 = kanvas.
        ink: {
          50: '#2b1f16', // teks utama — espresso nyaris hitam
          100: '#3d2d20',
          200: '#574534', // teks sekunder
          300: '#7c6552', // teks redup
          400: '#a08a74', // placeholder / disabled
          500: '#c0b09a', // garis halus
          600: '#d9ccb6', // border di atas krem
          700: '#e9dfcd', // pembatas / tombol sekunder
          800: '#f2ecde', // permukaan terangkat / input
          900: '#fffdf8', // kartu
          950: '#f4ede0', // kanvas aplikasi
        },
        // Warna aksi utama / brand — cokelat kopi.
        brew: {
          400: '#8a5a3c', // hover terang / aksen ringan
          500: '#70422b', // logo (kopi susu) — link, aksen sekunder
          600: '#5a3722', // tombol utama
          700: '#462816', // logo (espresso) — hover pekat / judul
        },
        // Hijau teduh untuk status positif (shift aktif, LUNAS, langkah selesai).
        sage: {
          400: '#6f9c6a',
          500: '#4e7a49',
          600: '#3d6139',
        },
        // Karamel hangat untuk highlight sekunder (favorit, lencana).
        brown: {
          400: '#c99a63',
          500: '#b07d43',
          600: '#8a5c2e',
          700: '#6b4522',
        },
        cream: {
          50: '#fffdf8',
          100: '#fcf7ee',
          200: '#f4ede0',
        },
        // Merah bata hangat — override skala Tailwind supaya selaras dengan cokelat.
        // 300–500 = teks yang terbaca di krem; 700 = tombol; 800–900 = lencana terang.
        red: {
          50: '#fbeae5',
          100: '#a53928',
          200: '#f0cabe',
          300: '#c65f49',
          400: '#b8412e',
          500: '#a63a29',
          600: '#b34434',
          700: '#8f2e1f',
          800: '#efc9bd',
          900: '#f8e6e0',
          950: '#4a1a11',
        },
        // Amber madu hangat — override supaya tak "neon" di kanvas krem.
        yellow: {
          50: '#fbf1dc',
          100: '#f6e6c4',
          200: '#efd7a3',
          300: '#b5831f',
          400: '#9c6f18',
          500: '#8a6115',
          600: '#c89a3e',
          700: '#7a5411',
          800: '#f0e2c2',
          900: '#f8efdb',
          950: '#3d2a0c',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        display: ['Fraunces', 'ui-serif', 'Georgia', '"Times New Roman"', 'serif'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(70, 40, 22, 0.04), 0 6px 16px -6px rgba(70, 40, 22, 0.12)',
        pop: '0 8px 30px -8px rgba(70, 40, 22, 0.28)',
      },
      spacing: {
        touch: '3.25rem',
      },
    },
  },
  plugins: [],
} satisfies Config
