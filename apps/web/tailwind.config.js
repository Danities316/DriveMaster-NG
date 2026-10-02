/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { brand: { DEFAULT: "#0000FF", hover: "#0000cc", ink: "#ffffff", link: "#0000cc" } }
    }
  },
  plugins: []
};
