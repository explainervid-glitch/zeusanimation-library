/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        // ═══════════════════════════════════════════════════
        //   TEMA WARNA APLIKASI — CSS Variables
        //   Dark & Light themes defined in index.css
        // ═══════════════════════════════════════════════════

        // Background layers
        'c-base':     'var(--c-base)',
        'c-surface':  'var(--c-surface)',
        'c-raised':   'var(--c-raised)',
        'c-hover':    'var(--c-hover)',

        // Border
        'c-border':   'var(--c-border)',
        'c-border-2': 'var(--c-border-2)',

        // Text
        'c-text':     'var(--c-text)',
        'c-text-2':   'var(--c-text-2)',
        'c-text-3':   'var(--c-text-3)',
        'c-text-4':   'var(--c-text-4)',

        // Accent / brand
        'c-accent':   'var(--c-accent)',
        'c-accent-h': 'var(--c-accent-h)',
        'c-accent-d': 'var(--c-accent-d)',
        'c-on-accent':'var(--c-on-accent)',

        // Status
        'c-error':    'var(--c-error)',
        'c-error-bg': 'var(--c-error-bg)',
      }
    }
  },
  plugins: [],
}