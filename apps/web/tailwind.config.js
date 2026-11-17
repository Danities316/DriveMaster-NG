/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#059669",
          hover: "#047857",
          danger: {
            DEFAULT: "#e11d48",
            soft: "#ffe4e6"
          },
          ink: "#0f172a",
          link: "#047857",
          soft: "#ecfdf5"
        },
        warning: { soft: "#fef3c7" },
        canvas: "#f8fafc",
        text: "#0f172a",
        neutral: {
          900: "#0f172a",
          700: "#334155",
          500: "#64748b",
          200: "#e2e8f0"
        }
      }
    }
  },
  plugins: []
};
