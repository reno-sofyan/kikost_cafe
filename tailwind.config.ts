import type { Config } from 'tailwindcss'

/**
 * Sistem warna Kione POS.
 *
 * Aplikasi memakai kanvas terang (tablet kasir sering dipakai di ruangan
 * terang), jadi dua konvensi skala berlaku di sini — keduanya DISENGAJA:
 *
 * 1. Skala `ink` TERBALIK: 50 = teks paling gelap, 950 = kanvas aplikasi.
 *    Nomor makin tinggi = makin terang.
 *
 * 2. Skala warna semantik (`brand`, `success`, `accent`) memakai peran, bukan
 *    kecerahan: 400 = teks/ikon di kanvas terang (kontras >= 4.5:1),
 *    500 = garis/border/ring & isian kecil, 600 = isian solid (aman dengan
 *    teks putih) sekaligus basis tint (`bg-*-600/15`), 700 = hover/tekan.
 *
 * Setiap nilai di bawah sudah dicek rasio kontrasnya terhadap kanvas (#f1f5f9)
 * dan putih. Kalau menambah nilai baru, cek dulu — teks kecil di layar kasir
 * yang silau adalah masalah nyata, bukan detail kosmetik.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Netral dingin (slate). 50 = teks utama, 900 = kartu, 950 = kanvas.
        ink: {
          50: '#0f172a', // teks utama — 16.3:1 di kanvas
          100: '#1e293b',
          200: '#475569', // teks sekunder — 6.9:1
          300: '#64748b', // teks redup — 4.3:1
          400: '#94a3b8', // placeholder / disabled
          500: '#cbd5e1', // garis halus
          600: '#e2e8f0', // border
          700: '#eef2f7', // pembatas / permukaan tombol sekunder
          800: '#f4f7fb', // permukaan terangkat / hover
          900: '#ffffff', // kartu
          950: '#f1f5f9', // kanvas aplikasi
        },
        // Warna produk Kione — indigo. Sama dengan gradien pada logo (500 -> 600).
        brand: {
          400: '#4f46e5', // teks & ikon aksen — 5.7:1
          500: '#6366f1', // border, ring fokus, garis
          600: '#4338ca', // isian tombol utama — teks putih 7.9:1
          700: '#3730a3', // hover / tekan, judul pekat
        },
        // Hijau untuk status positif (shift aktif, LUNAS, langkah selesai).
        success: {
          400: '#065f46', // teks tegas di atas tint — 7.0:1
          500: '#047857', // teks, ikon, titik status — 5.0:1
          600: '#059669', // isian solid & basis tint
        },
        // Amber untuk sorotan sekunder (favorit, cetak ulang, menunggu).
        accent: {
          400: '#b45309', // teks — 4.6:1
          500: '#d97706', // ikon (bintang favorit) — non-teks, 2.9:1
          600: '#f59e0b', // isian & basis tint
          700: '#92400e', // teks pekat — 6.5:1
        },
        // Merah bahaya. Skala ini juga memakai peran, bukan kecerahan:
        // 50/200/900 = terang (latar tint & teks di atas merah pekat),
        // 100/300/400/500 = teks, 600/700/800 = isian pekat, 950 = paling gelap.
        red: {
          50: '#fef2f2', // teks di atas isian merah pekat
          100: '#b91c1c',
          200: '#fecaca',
          300: '#991b1b', // teks tegas — 7.6:1
          400: '#b91c1c', // teks standar — 5.9:1
          500: '#dc2626', // teks & titik status — 4.4:1
          600: '#dc2626', // hover tombol bahaya
          700: '#b91c1c', // isian tombol bahaya — teks putih 6.5:1
          800: '#991b1b', // isian toast error — teks putih 7.6:1
          900: '#fef2f2', // latar tint paling terang
          950: '#7f1d1d',
        },
        // Amber peringatan — peran sama dengan skala merah di atas.
        yellow: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#92400e', // teks tegas — 6.5:1
          400: '#b45309', // teks standar — 4.6:1
          500: '#92400e',
          600: '#f59e0b', // border & titik status
          700: '#78350f',
          800: '#fef3c7',
          900: '#fffbeb', // latar tint
          950: '#451a03',
        },
      },
      fontFamily: {
        // Satu keluarga huruf untuk seluruh aplikasi. Judul dibedakan lewat
        // bobot + tracking (lihat `h1..h3` di index.css), bukan lewat serif —
        // lebih netral untuk produk yang dipakai bermacam jenis usaha.
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
        display: [
          'Inter',
          'ui-sans-serif',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 6px 16px -6px rgba(15, 23, 42, 0.10)',
        pop: '0 8px 30px -8px rgba(15, 23, 42, 0.22)',
      },
      spacing: {
        touch: '3.25rem',
      },
    },
  },
  plugins: [],
} satisfies Config
