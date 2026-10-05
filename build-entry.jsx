/* Opstart van Nexa. De opslaglaag (apparaat, geheugen of Nexa-account)
   staat in src/boot.jsx en wordt gedeeld met Nexa Hybrid. */
import App from "./src/App.jsx";
import { boot } from "./src/boot.jsx";

boot(App);
