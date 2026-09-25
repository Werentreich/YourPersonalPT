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

const SB_URL = "https://lrtkedstyhfnwaxylyue.supabase.co";
const SB_KEY = "sb_publishable_QixrjzoNV-Kd1ng-BkmCyg_oIl11AJ8"; // publiceerbare sleutel, bedoeld voor in de app
const TABLE = "nexa_data";
const PREFIX = "macroverdeling:"; // alleen app-gegevens synchroniseren, geen sessie of hulpgegevens
const META_KEY = "nexa:sync-meta";
const PUSH_DELAY = 1500;
const BOOT_TIMEOUT = 3500;

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

  let state = { user: null, status: "uit", lastSync: meta.lastSync, error: null, recovery: false, notice: null };
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

  async function push() {
    if (!state.user) return;
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
    if (!state.user) return Promise.resolve({ changed: false });
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
    if (!state.user) return;
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
    emit({ user: { id: user.id, email: user.email }, notice: null });
    const r = await syncNow({ preferRemote });
    if (r.changed && typeof location !== "undefined") location.reload();
    return r;
  }

  const api = {
    get state() {
      return state;
    },
    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => listeners.delete(fn);
    },
    async signUp(email, password) {
      const { data, error } = await auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/` } });
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
    async signOut() {
      clearTimeout(timer);
      await push().catch(() => {});
      await auth.signOut({ scope: "local" }).catch(() => {});
      meta.user = null;
      saveMeta();
      emit({ user: null, status: "uit", error: null });
    },
    async resetPassword(email) {
      const { error } = await auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/` });
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
        emit({ user: { id: session.user.id, email: session.user.email } });
        await Promise.race([syncNow(), new Promise((r) => setTimeout(r, BOOT_TIMEOUT))]);
      }
    } catch (e) {
      /* opstarten gaat altijd door */
    }
  })();

  auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") emit({ recovery: true });
    if (event === "SIGNED_OUT" && !state.recovery) emit({ user: null, status: "uit" });
    if (event === "TOKEN_REFRESHED" && session && session.user && !state.user && !linkType) {
      emit({ user: { id: session.user.id, email: session.user.email } });
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
    });
    window.addEventListener("online", () => state.user && syncNow());
  }

  return { storage, api, ready };
}
