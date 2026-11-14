/* Tailwind voor Nexa. De typeschaal is die van het design system
   (docs/DESIGN-SYSTEM.md): de kleinste lopende tekst is 13 px in plaats van
   12 px, omdat het grootste deel van de app in die maat staat. */
module.exports = {
  content: ["./src/App.jsx", "./src/ui/**/*.{js,jsx}", "./src/perf/**/*.{js,jsx}", "./src/hybrid/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontSize: {
        xs: ["13px", { lineHeight: "18px" }],
        sm: ["14.5px", { lineHeight: "21px" }],
      },
      screens: { xs: "400px" },
    },
  },
  corePlugins: { preflight: true },
};
