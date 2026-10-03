/* Nexa-account: bewaart de app-gegevens online in Supabase, zodat ze een
   herinstallatie of een nieuwe telefoon overleven.

   Het apparaat blijft de eerste opslag: de app leest en schrijft altijd
   lokaal en werkt dus ook zonder internet. Is de gebruiker ingelogd, dan
   gaat elke wijziging kort daarna naar de tabel nexa_data (een rij per
   opslagsleutel, beveiligd met row level security) en worden nieuwere
   gegevens van andere apparaten opgehaald. Per sleutel wint de laatste
   wijziging, met één uitzondering: bij het inloggen op een apparaat gaan de
   gegevens uit het account voor, want een vers geïnstalleerde app heeft
   alleen standaardwaarden. */
import { AuthClient } from "@supabase/auth-js";
import { PostgrestClient } from "@supabase/postgrest-js";

export const SB_URL = "https://lrtkedstyhfnwaxylyue.supabase.co";
export const SB_KEY = "sb_publishable_QixrjzoNV-Kd1ng-BkmCyg_oIl11AJ8"; // publiceerbare sleutel, bedoeld voor in de app
const TABLE = "nexa_data";
const PREFIX = "macroverdeling:"; // alleen app-gegevens synchroniseren, geen sessie of hulpgegevens
const META_KEY = "nexa:sync-meta";
const PUSH_DELAY = 1500;
const BILLING_KEY = "nexa:billing"; // laatst bekende abonnementsstatus, voor gebruik zonder internet
/* In de eigen app (Capacitor) draait de code niet op de site zelf: dan naar
   het volledige adres (de functies staan die herkomst toe). */
const NATIVE = typeof window !== "undefined" && !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform());
const BILLING_URL = `${NATIVE ? "https://nexa-performance.netlify.app" : ""}/.netlify/functions/billing`;
const SUB_TABLE = "nexa_subscriptions";
export const ACTIVE_STATUSES = ["trialing", "active", "past_due", "comp"];
const BOOT_TIMEOUT = 3500;
/* Versie van de toestemmingstekst (AVG art. 9: uitdrukkelijke toestemming
   voor gezondheidsgegevens). Bij een nieuwe versie vraagt de app opnieuw. */
export const CONSENT_VERSION = "2026-10-01";

const FRIENDLY = {
  invalid_credentials:
    "E-mailadres of wachtwoord klopt niet. Weet u het wachtwoord niet meer, of bewaarde uw telefoon het bij een ander webadres? Gebruik dan Wachtwoord vergeten.",
  email_not_confirmed: "Bevestig eerst uw e-mailadres via de link in de mail die u heeft gekregen.",
  user_already_exists: "Er bestaat al een account met dit e-mailadres. Log in.",
  email_exists: "Er bestaat al een account met dit e-mailadres. Log in.",
  weak_password: "Dit wachtwoord is te zwak. Kies minstens 8 tekens.",
  same_password: "Kies een ander wachtwoord dan het huidige.",
  email_address_invalid: "Dit e-mailadres is ongeldig.",
  email_address_not_authorized: "Naar dit e-mailadres kan nog geen mail worden verstuurd. Gebruik het e-mailadres van uw Supabase-account.",
  over_email_send_rate_limit: "Er zijn te veel mails verstuurd. Probeer het over een uur opnieuw.",
  over_request_rate_limit: "Te veel pogingen achter elkaar. Probeer het over een paar minuten opnieuw.",
  signup_disabled: "Nieuwe accounts aanmaken staat uit.",
  session_expired: "Uw sessie is verlopen. Log opnieuw in.",
};

const friendly = (e) => {
  const code = e && e.code;
  const err = new Error(
    (code && FRIENDLY[code]) ||
      (e && e.name === "AuthRetryableFetchError" ? "Geen verbinding. Controleer uw internet en probeer het opnieuw." : (e && e.message) || "Er ging iets mis.")
  );
  err.code = code;
  return err;
};

const isOffline = (e) =>
  (typeof navigator !== "undefined" && navigator.onLine === false) ||
  (e && (e.name === "TypeError" || e.name === "AuthRetryableFetchError" || /fetch|network|Failed to/i.test(e.message || "")));

export function createSync(local) {
  const readMeta = () => {
    try {
      const m = JSON.parse(local.get(META_KEY) || "null");
      if (m && typeof m === "object" && m.keys) return m;
    } catch (e) {
      /* beschadigd: opnieuw beginnen */
    }
    return { keys: {}, user: null, lastSync: null };
  };
  let meta = readMeta();
  const saveMeta = () => local.set(META_KEY, JSON.stringify(meta));

  /* Kwam de pagina binnen via een link uit een mail (bevestigen of
     wachtwoord herstellen)? Die opent vaak in de browser in plaats van in de
     app op het beginscherm; daar mag nooit gesynchroniseerd worden, anders
     overschrijven lege standaardgegevens het account. */
  const params = new URLSearchParams(typeof location !== "undefined" ? (location.hash || "").replace(/^#/, "") : "");
  // let op: de link bevat ook token_type=bearer; alleen de parameter "type" zegt wat voor link het is
  const linkType = params.get("access_token") ? params.get("type") || "link" : null;

  const consentOf = (u) => {
    const c = u && u.user_metadata && u.user_metadata.consent;
    return c && c.version === CONSENT_VERSION ? c : null;
  };
  const userInfo = (u) => ({ id: u.id, email: u.email, consent: consentOf(u) });

  const auth = new AuthClient({
    url: `${SB_URL}/auth/v1`,
    headers: { apikey: SB_KEY },
    storageKey: "nexa-auth",
    storage: { getItem: (k) => local.get(k), setItem: (k, v) => local.set(k, v), removeItem: (k) => local.remove(k) },
    autoRefreshToken: true,
    persistSession: local.persistent,
    detectSessionInUrl: true,
  });

  const rest = new PostgrestClient(`${SB_URL}/rest/v1`, {
    headers: { apikey: SB_KEY },
    fetch: async (input, init = {}) => {
      const { data } = await auth.getSession();
      const headers = new Headers(init.headers || {});
      headers.set("apikey", SB_KEY);
      if (data && data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
      return fetch(input, { ...init, headers });
    },
  });

  /* Abonnement (Nexa Coach). enabled komt van de server: zolang Stripe daar
     niet is ingesteld, staat de betaalmuur uit. De laatst bekende status
     blijft op het apparaat, zodat een betalende gebruiker zonder internet
     niet wordt buitengesloten. */
  const readBilling = () => {
    try {
      const b = JSON.parse(local.get(BILLING_KEY) || "null");
      if (b && typeof b === "object") return { enabled: !!b.enabled, sub: b.sub || null, subUser: b.subUser || null, prices: b.prices || null, trialDays: b.trialDays || 7 };
    } catch (e) {
      /* opnieuw ophalen */
    }
    return { enabled: false, sub: null, subUser: null, prices: null, trialDays: 7 };
  };
  const billing0 = readBilling();

  let state = {
    user: null,
    status: "uit",
    lastSync: meta.lastSync,
    error: null,
    recovery: false,
    notice: null,
    billing: { ...billing0, checked: false, busy: false, error: null },
  };
  const listeners = new Set();
  const emit = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => {
      try {
        fn(state);
      } catch (e) {
        /* luisteraar mag de synchronisatie niet breken */
      }
    });
  };

  const appKeys = () => local.keys().filter((k) => k.startsWith(PREFIX));
  const dirty = () => {
    const out = appKeys().filter((k) => {
      const m = meta.keys[k];
      return !m || !m.sync || m.mod > m.sync;
    });
    Object.keys(meta.keys).forEach((k) => {
      if (meta.keys[k].deleted && !out.includes(k)) out.push(k);
    });
    return out;
  };

  /* Zonder uitdrukkelijke toestemming gaan er geen gezondheidsgegevens naar
     de server; de app vraagt die toestemming eerst. */
  const canSync = () => !!(state.user && state.user.consent);

  async function push() {
    if (!canSync()) return;
    const keys = dirty();
    const del = keys.filter((k) => meta.keys[k] && meta.keys[k].deleted);
    const rows = keys
      .filter((k) => !del.includes(k))
      .map((k) => {
        const value = local.get(k);
        if (value == null) return null;
        if (!meta.keys[k]) meta.keys[k] = { mod: Date.now() };
        const ts = Math.max(1, meta.keys[k].mod || 0);
        return { user_id: state.user.id, key: k, value, updated_at: new Date(ts).toISOString(), ts };
      })
      .filter(Boolean);
    if (rows.length) {
      const { error } = await rest.from(TABLE).upsert(
        rows.map(({ ts, ...r }) => r),
        { onConflict: "user_id,key" }
      );
      if (error) throw error;
      rows.forEach((r) => {
        meta.keys[r.key] = { ...meta.keys[r.key], sync: r.ts };
      });
    }
    if (del.length) {
      const { error } = await rest.from(TABLE).delete().in("key", del);
      if (error) throw error;
      del.forEach((k) => delete meta.keys[k]);
    }
    saveMeta();
  }

  async function pull({ preferRemote = false } = {}) {
    const { data, error } = await rest.from(TABLE).select("key,value,updated_at");
    if (error) throw error;
    let changed = false;
    const remote = new Set();
    (data || []).forEach((row) => {
      if (!row.key.startsWith(PREFIX)) return;
      remote.add(row.key);
      const rt = Date.parse(row.updated_at);
      const m = meta.keys[row.key];
      const localValue = local.get(row.key);
      const localMod = m ? m.mod || 0 : 0;
      if (!preferRemote && m && m.deleted && localMod > rt) return; // lokale verwijdering is nieuwer
      if (preferRemote || localValue == null || rt > localMod || (m && m.deleted)) {
        if (localValue !== row.value) {
          local.set(row.key, row.value);
          changed = true;
        }
        meta.keys[row.key] = { mod: rt, sync: rt };
      }
    });
    // eerder gesynchroniseerd maar online verdwenen: op een ander apparaat gewist
    appKeys().forEach((k) => {
      const m = meta.keys[k];
      if (!remote.has(k) && m && m.sync && m.mod <= m.sync) {
        local.remove(k);
        delete meta.keys[k];
        changed = true;
      }
    });
    saveMeta();
    return changed;
  }

  let running = null;
  function syncNow({ preferRemote = false } = {}) {
    if (!canSync()) return Promise.resolve({ changed: false });
    if (running) return running;
    emit({ status: "bezig" });
    running = (async () => {
      try {
        const changed = await pull({ preferRemote });
        await push();
        meta.lastSync = Date.now();
        saveMeta();
        emit({ status: "ok", lastSync: meta.lastSync, error: null });
        return { changed };
      } catch (e) {
        if (isOffline(e)) emit({ status: "offline", error: null });
        else emit({ status: "fout", error: (e && e.message) || "Synchroniseren mislukt." });
        return { changed: false, error: e };
      } finally {
        running = null;
      }
    })();
    return running;
  }

  let timer = null;
  const schedulePush = () => {
    if (!canSync()) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      push()
        .then(() => {
          meta.lastSync = Date.now();
          saveMeta();
          emit({ status: "ok", lastSync: meta.lastSync, error: null });
        })
        .catch((e) => emit(isOffline(e) ? { status: "offline" } : { status: "fout", error: e.message }));
    }, PUSH_DELAY);
  };

  const mark = (k, patch) => {
    if (!k.startsWith(PREFIX)) return;
    meta.keys[k] = { ...(meta.keys[k] || {}), mod: Date.now(), deleted: false, ...patch };
    saveMeta();
    schedulePush();
  };

  const storage = {
    get mode() {
      return state.user ? "nexa" : local.persistent ? "device" : "memory";
    },
    async get(k) {
      const v = local.get(k);
      if (v == null) throw new Error("niet gevonden");
      return { key: k, value: v };
    },
    async set(k, v) {
      const old = local.get(k);
      local.set(k, v);
      if (old !== v) mark(k);
      return { key: k, value: v };
    },
    async delete(k) {
      const existed = local.get(k) != null;
      local.remove(k);
      if (existed) mark(k, { deleted: true });
      return { key: k, deleted: true };
    },
    async list(prefix = "") {
      return { keys: local.keys().filter((x) => x.startsWith(prefix)) };
    },
  };

  /* Na een bewust inloggen of aanmaken: account en apparaat samenvoegen en
     de app herladen als er gegevens uit het account zijn binnengekomen. */
  async function afterLogin(user, { preferRemote }) {
    meta.user = user.id;
    saveMeta();
    emit({ user: userInfo(user), notice: null });
    refreshBilling();
    const r = await syncNow({ preferRemote });
    if (r.changed && typeof location !== "undefined") location.reload();
    return r;
  }

  const saveBilling = (b) => {
    try {
      local.set(BILLING_KEY, JSON.stringify({ enabled: b.enabled, sub: b.sub, subUser: b.subUser, prices: b.prices, trialDays: b.trialDays }));
    } catch (e) {
      /* alleen voor deze sessie */
    }
  };
  const setBilling = (patch) => {
    const b = { ...state.billing, ...patch };
    emit({ billing: b });
    saveBilling(b);
  };
  let billingAt = 0;
  async function refreshBilling() {
    billingAt = Date.now();
    try {
      const r = await fetch(BILLING_URL, { cache: "no-store" });
      const d = r.ok ? await r.json() : null;
      const patch = { checked: true, error: null };
      if (d && typeof d.enabled === "boolean") Object.assign(patch, { enabled: d.enabled, prices: d.prices || null, trialDays: d.trialDays || 7 });
      else if (r.status === 404) patch.enabled = false; // geen serverfunctie (bijvoorbeeld lokaal testen)
      if (state.user) {
        const { data, error } = await rest.from(SUB_TABLE).select("*").eq("user_id", state.user.id).maybeSingle();
        if (!error) Object.assign(patch, { sub: data || null, subUser: state.user.id });
      } else {
        Object.assign(patch, { sub: null, subUser: null });
      }
      setBilling(patch);
    } catch (e) {
      // zonder internet: laatst bekende status aanhouden
      emit({ billing: { ...state.billing, checked: true } });
    }
    return state.billing;
  }
  const accessToken = async () => {
    const { data } = await auth.getSession();
    return data && data.session ? data.session.access_token : null;
  };
  async function billingCall(body, { url = true } = {}) {
    const token = await accessToken();
    if (!token) {
      const e = new Error("Log eerst in met uw Nexa-account.");
      e.code = "inloggen";
      throw e;
    }
    let r;
    try {
      r = await fetch(BILLING_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error("Geen verbinding. Controleer uw internet en probeer het opnieuw.");
    }
    const d = await r.json().catch(() => null);
    if (!d || !d.ok || (url && !d.url)) {
      const e = new Error((d && d.message) || "Er ging iets mis. Probeer het later opnieuw.");
      e.code = d && d.code;
      throw e;
    }
    return url ? d.url : d;
  }

  /* Alle app-gegevens en hulpgegevens van dit apparaat wissen. */
  const wipeDevice = () => {
    local
      .keys()
      .filter((k) => k.startsWith(PREFIX) || k.startsWith("nexa:") || k === "nexa-auth")
      .forEach((k) => local.remove(k));
    meta = { keys: {}, user: null, lastSync: null };
  };

  const api = {
    get state() {
      return state;
    },
    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => listeners.delete(fn);
    },
    async signUp(email, password, consent) {
      const { data, error } = await auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/app/`, data: consent ? { consent: { ...consent, version: CONSENT_VERSION } } : {} } });
      if (error) throw friendly(error);
      if (data.session) {
        await afterLogin(data.session.user, { preferRemote: false });
        return { confirmed: true };
      }
      return { confirmed: false };
    },
    async signIn(email, password) {
      const { data, error } = await auth.signInWithPassword({ email, password });
      if (error) throw friendly(error);
      await afterLogin(data.user, { preferRemote: true });
      return { ok: true };
    },
    async signOut({ wipe = false } = {}) {
      clearTimeout(timer);
      await push().catch(() => {});
      await auth.signOut({ scope: "local" }).catch(() => {});
      meta.user = null;
      if (wipe) {
        wipeDevice();
        if (typeof location !== "undefined") location.reload();
        return;
      }
      saveMeta();
      emit({ user: null, status: "uit", error: null });
      setBilling({ sub: null, subUser: null });
    },
    /* Uitdrukkelijke toestemming vastleggen (bij bestaande accounts of een
       nieuwe versie van de tekst). */
    async giveConsent(consent) {
      const c = { ...consent, version: CONSENT_VERSION };
      const { data, error } = await auth.updateUser({ data: { consent: c } });
      if (error) throw friendly(error);
      emit({ user: userInfo(data.user) });
      const r = await syncNow({ preferRemote: true });
      if (r.changed && typeof location !== "undefined") location.reload();
    },
    /* Recht op inzage en overdraagbaarheid (AVG art. 15 en 20): alles wat
       de app over de gebruiker bewaart, als leesbaar JSON-bestand. */
    exportData() {
      const data = {};
      local
        .keys()
        .filter((k) => k.startsWith(PREFIX))
        .forEach((k) => {
          const v = local.get(k);
          try {
            data[k] = JSON.parse(v);
          } catch (e) {
            data[k] = v;
          }
        });
      return {
        toelichting: "Export van al uw Nexa-gegevens. Dezelfde gegevens staan in uw Nexa-account als u bent ingelogd.",
        geexporteerd: new Date().toISOString(),
        account: state.user ? { id: state.user.id, email: state.user.email, toestemming: state.user.consent } : null,
        abonnement: state.billing && state.billing.sub ? state.billing.sub : null,
        gegevens: data,
      };
    },
    /* Recht op vergetelheid (AVG art. 17). Een lopend abonnement wordt eerst
       direct gestopt; daarna verwijdert Supabase het account met alle
       gegevens (on delete cascade). */
    async deleteAccount({ wipe = true } = {}) {
      if (!state.user) throw new Error("Log eerst in.");
      const sub = state.billing && state.billing.sub;
      if (sub && sub.stripe_customer_id && ["trialing", "active", "past_due", "unpaid", "incomplete", "paused"].includes(sub.status)) {
        await billingCall({ action: "cancel_now" }, { url: false });
      }
      clearTimeout(timer);
      const { error } = await rest.rpc("delete_own_account");
      if (error) throw new Error("Verwijderen mislukt. Probeer het later opnieuw of mail ons.");
      await auth.signOut({ scope: "local" }).catch(() => {});
      if (wipe) {
        wipeDevice();
      } else {
        meta = { keys: {}, user: null, lastSync: null };
        saveMeta();
      }
      emit({ user: null, status: "uit", error: null, notice: "verwijderd" });
      setBilling({ sub: null, subUser: null });
      if (wipe && typeof location !== "undefined") location.reload();
    },
    /* Herroepen binnen 14 dagen (Europese herroepingsknop). */
    async withdraw() {
      setBilling({ busy: true, error: null });
      try {
        const d = await billingCall({ action: "withdraw" }, { url: false });
        await refreshBilling();
        setBilling({ busy: false });
        return d;
      } catch (e) {
        setBilling({ busy: false, error: e.message });
        throw e;
      }
    },
    async resetPassword(email) {
      const { error } = await auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/app/` });
      if (error) throw friendly(error);
    },
    async updatePassword(password) {
      const { error } = await auth.updateUser({ password });
      if (error) throw friendly(error);
      await auth.signOut({ scope: "local" }).catch(() => {});
      emit({ recovery: false, user: null, status: "uit", notice: "wachtwoord" });
    },
    dismissNotice() {
      emit({ notice: null });
    },
    accessToken,
    refreshBilling,
    /* Naar Stripe Checkout (proef starten of opnieuw abonneren), of direct
       upgraden van Coach naar Hybrid. extra: { from: "hybrid" } om daarna
       naar Nexa Hybrid terug te keren. */
    async checkout(plan, extra = {}) {
      setBilling({ busy: true, error: null });
      try {
        const url = await billingCall({ action: "checkout", plan, ...extra });
        location.href = url;
      } catch (e) {
        setBilling({ busy: false, error: e.message });
        throw e;
      }
    },
    /* Naar het Stripe-klantportaal: betaalgegevens, plan wisselen, opzeggen. */
    async portal(extra = {}) {
      setBilling({ busy: true, error: null });
      try {
        const url = await billingCall({ action: "portal", ...extra });
        location.href = url;
      } catch (e) {
        setBilling({ busy: false, error: e.message });
        throw e;
      }
    },
    syncNow: async () => {
      const r = await syncNow();
      if (r.changed && typeof location !== "undefined") location.reload();
      return r;
    },
  };

  /* Opstarten: bestaande sessie herstellen en de nieuwste gegevens ophalen
     voordat de app ze leest. Zonder verbinding start de app gewoon met wat
     er op het apparaat staat. */
  const ready = (async () => {
    try {
      const { data } = await auth.getSession();
      const session = data && data.session;
      if (linkType) {
        if (typeof history !== "undefined") history.replaceState(null, "", location.pathname);
        if (linkType === "recovery" && session) {
          emit({ recovery: true });
        } else {
          await auth.signOut({ scope: "local" }).catch(() => {});
          emit({ notice: "bevestigd" });
        }
        return;
      }
      if (session && session.user) {
        emit({ user: userInfo(session.user) });
        await Promise.race([syncNow(), new Promise((r) => setTimeout(r, BOOT_TIMEOUT))]);
      }
    } catch (e) {
      /* opstarten gaat altijd door */
    }
  })();

  ready.then(() => refreshBilling());

  auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") emit({ recovery: true });
    if (event === "SIGNED_OUT" && !state.recovery) emit({ user: null, status: "uit" });
    if (event === "TOKEN_REFRESHED" && session && session.user && !state.user && !linkType) {
      emit({ user: userInfo(session.user) });
    }
  });

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (!state.user) return;
      if (document.visibilityState === "hidden") {
        clearTimeout(timer);
        push().catch(() => {});
      } else if (Date.now() - (meta.lastSync || 0) > 20000) {
        api.syncNow();
      }
      if (document.visibilityState === "visible" && Date.now() - billingAt > 60000) refreshBilling();
    });
    window.addEventListener("online", () => state.user && syncNow());
  }

  return { storage, api, ready };
}
