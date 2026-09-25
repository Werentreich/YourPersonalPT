/* Opslag voor een zelfstandige deploy (Netlify e.d.): localStorage op het
   toestel, anders tijdelijk geheugen, en met een Nexa-account daarnaast
   online in Supabase (zie src/sync.js). Binnen de Claude-weergave bestaat
   window.storage al; dan blijft die ongemoeid. */
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./src/App.jsx";
import { createSync } from "./src/sync.js";

function localStore() {
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
  return {
    persistent: !!LS,
    get: (k) => (LS ? LS.getItem(k) : k in mem ? mem[k] : null),
    set: (k, v) => {
      if (LS) LS.setItem(k, v);
      else mem[k] = v;
    },
    remove: (k) => {
      if (LS) LS.removeItem(k);
      else delete mem[k];
    },
    keys: () => (LS ? Object.keys(LS) : Object.keys(mem)),
  };
}

async function boot() {
  if (typeof window !== "undefined" && !window.storage) {
    try {
      const sync = createSync(localStore());
      window.storage = sync.storage;
      window.nexaSync = sync.api;
      await sync.ready;
    } catch (e) {
      /* zonder account verder: alleen opslag op het apparaat */
      const local = localStore();
      window.storage = {
        mode: local.persistent ? "device" : "memory",
        async get(k) {
          const v = local.get(k);
          if (v == null) throw new Error("niet gevonden");
          return { key: k, value: v };
        },
        async set(k, v) {
          local.set(k, v);
          return { key: k, value: v };
        },
        async delete(k) {
          local.remove(k);
          return { key: k, deleted: true };
        },
        async list(prefix = "") {
          return { keys: local.keys().filter((x) => x.startsWith(prefix)) };
        },
      };
    }
  }
  createRoot(document.getElementById("root")).render(React.createElement(App));
}

boot();
