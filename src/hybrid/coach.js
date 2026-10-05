/* AI-coach vanuit de app: praat met de eigen functie hybrid-coach. */
import { fnUrl } from "./native/platform.js";
import { token } from "./strava.js";

export async function coachEnabled() {
  try {
    const r = await fetch(fnUrl("hybrid-coach"), { cache: "no-store" });
    const d = await r.json().catch(() => null);
    return !!(d && d.ok);
  } catch (e) {
    return false;
  }
}

export async function askCoach(payload) {
  const t = await token();
  if (!t) throw Object.assign(new Error("Log eerst in met uw Nexa-account."), { code: "inloggen" });
  let r;
  try {
    r = await fetch(fnUrl("hybrid-coach"), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(payload) });
  } catch (e) {
    throw new Error("Geen verbinding. Controleer uw internet en probeer het opnieuw.");
  }
  const d = await r.json().catch(() => null);
  if (!d || d.ok === false) throw Object.assign(new Error((d && d.message) || "De coach is even niet bereikbaar."), { code: d && d.code, status: r.status });
  return d;
}
