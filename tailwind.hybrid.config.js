/* Tailwind voor Nexa Hybrid: de eigen bestanden plus de gedeelde
   onderdelen uit src/App.jsx. Zelfde tekstschaal en breekpunten als
   tailwind.config.js, zodat beide apps hetzelfde ogen. */
module.exports = {
  content: ["./src/hybrid/**/*.{js,jsx}", "./src/ui/**/*.{js,jsx}", "./src/App.jsx"],
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
