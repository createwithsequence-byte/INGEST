/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Sora', 'system-ui', 'sans-serif'],
      },
      colors: {
        accent: '#6366f1',
        sage: '#22c55e',
        amber: '#f59e0b',
        danger: '#ef4444',
      },
    },
  },
  plugins: [],
}
