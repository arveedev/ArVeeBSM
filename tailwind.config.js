/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        neutral: {
          950: '#0A0A0A',
          900: '#171717',
          800: '#262626',
        },
        brand: {
          neon: '#00FFA3',
          amber: '#F59E0B',
          crimson: '#EF4444',
        }
      },
    },
  },
  plugins: [],
}
