/* Tailwind voor Nexa Hybrid: de eigen bestanden plus de gedeelde
   onderdelen uit src/App.jsx. */
module.exports = {
  content: ["./src/hybrid/**/*.{js,jsx}", "./src/App.jsx"],
  theme: { extend: {} },
  corePlugins: { preflight: true },
};
