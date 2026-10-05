/* Agenda vanuit de app: abonnementslink ophalen en .ics downloaden. */
import { fnUrl } from "./native/platform.js";
import { token } from "./strava.js";

export async function calendarLink(v) {
  const t = await token();
  if (!t) throw Object.assign(new Error("Log eerst in met uw Nexa-account."), { code: "inloggen" });
  let r;
  try {
    r = await fetch(fnUrl("hybrid-calendar"), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ action: "link", v }) });
  } catch (e) {
    throw new Error("Geen verbinding. Controleer uw internet en probeer het opnieuw.");
  }
  const d = await r.json().catch(() => null);
  if (!d || d.ok === false) throw Object.assign(new Error((d && d.message) || "De agenda-koppeling is even niet bereikbaar."), { code: d && d.code });
  return d;
}

/* .ics-bestand aanbieden. iPhone/iPad: opent "Voeg toe aan Agenda". */
export function downloadICS(text, name = "nexa-hybrid.ics") {
  const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
