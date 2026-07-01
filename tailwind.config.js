/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        // ═══════════════════════════════════════════════════
        //   TEMA WARNA APLIKASI — Edit hex di sini saja
        // ═══════════════════════════════════════════════════

        // Background layers (dari paling gelap ke paling terang)
        'c-base':     '#09090b',   // Background utama app
        'c-surface':  '#18181b',   // Sidebar, panel
        'c-raised':   '#27272a',   // Card, input field
        'c-hover':    '#3f3f46',   // Hover state

        // Border
        'c-border':   '#27272a',   // Border tipis (divider)
        'c-border-2': '#3f3f46',   // Border tebal (card)

        // Teks (dari terang ke redup)
        'c-text':     '#f4f4f5',   // Teks utama
        'c-text-2':   '#a1a1aa',   // Teks sekunder
        'c-text-3':   '#71717a',   // Teks muted
        'c-text-4':   '#52525b',   // Teks sangat redup / ghost

        // Aksen / brand color
        'c-accent':   '#8c57ff',   // Warna aksen utama (tombol, selected)
        'c-accent-h': '#a982fc',   // Aksen saat hover
        'c-accent-d': '#9668fb',   // Aksen gelap (badge di atas aksen)
        'c-on-accent':'#fafaf9',   // Warna teks di atas background aksen

        // Status
        'c-error':    '#ef4444',   // Merah error
        'c-error-bg': '#7f1d1d',   // Background error toast
      }
    }
  },
  plugins: [],
}