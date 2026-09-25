/* Opslag voor een zelfstandige deploy (Netlify e.d.): probeert eerst het
   account van de Claude-weergave (als die er is), anders localStorage op
   het toestel, anders tijdelijk geheugen. Zie App.jsx voor hoe de app zelf
   met window.storage.mode omgaat om dit aan de gebruiker te laten zien. */
if (typeof window !== "undefined" && !window.storage) {
  let LS = null;
  try {
    const t = "__macro_test";
    window.localStorage.setItem(t, t);
    window.localStorage.removeItem(t);
    LS = window.localStorage;
  } catch (e) {
    LS = null;
  }
  const mem = {};
  window.storage = {
    async get(k) {
      const v = LS ? LS.getItem(k) : mem[k];
      if (v == null) throw new Error("niet gevonden");
      return { key: k, value: v };
    },
    async set(k, v) {
      if (LS) LS.setItem(k, v);
      else mem[k] = v;
      return { key: k, value: v };
    },
    async delete(k) {
      if (LS) LS.removeItem(k);
      else delete mem[k];
      return { key: k, deleted: true };
    },
    async list(prefix = "") {
      const keys = (LS ? Object.keys(LS) : Object.keys(mem)).filter((x) => x.startsWith(prefix));
      return { keys };
    },
  };
}

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./src/App.jsx";

createRoot(document.getElementById("root")).render(React.createElement(App));
