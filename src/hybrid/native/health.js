/* Herstelgegevens uit Apple Gezondheid (HealthKit) of Health Connect
   (Android), alleen in de eigen app.

   Verwachte plugin: @capgo/capacitor-health (window.Capacitor.Plugins.Health):
     isAvailable(), requestAuthorization({ read }), readSamples({ dataType,
     startDate, endDate, limit }) -> { samples: [{ value, startDate, endDate }] }
   De namen van de gegevenssoorten staan in TYPES; controleer ze bij het
   bouwen van de eigen app tegen de versie van de plugin (docs/hybrid/03-NATIVE.md).

   Alleen lezen, alleen op verzoek van de gebruiker (knop bij de check-in), en
   alleen drie getallen: HRV, rusthartslag en slaapuren van afgelopen nacht. */
import { plugin } from "./platform.js";

export const TYPES = { hrv: "heartRateVariability", rhr: "restingHeartRate", sleep: "sleep" };

const H = () => plugin("Health");

export async function healthAvailable() {
  const h = H();
  if (!h) return false;
  try {
    const r = typeof h.isAvailable === "function" ? await h.isAvailable() : { available: true };
    return !!(r && (r.available ?? r.isAvailable ?? true));
  } catch (e) {
    return false;
  }
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/* Slaap: som van de slaapsegmenten (niet "in bed" of "wakker") in het
   venster van 18:00 gisteren tot 12:00 vandaag. */
export function sleepHours(samples) {
  let ms = 0;
  for (const s of samples || []) {
    const kind = String(s.sleepState || s.state || s.value || "").toLowerCase();
    if (/awake|wakker|inbed|in_bed/.test(kind)) continue;
    const a = Date.parse(s.startDate);
    const b = Date.parse(s.endDate);
    if (isFinite(a) && isFinite(b) && b > a) ms += b - a;
  }
  return ms ? Math.round((ms / 3600000) * 2) / 2 : null;
}

export async function readRecovery(now = new Date()) {
  const h = H();
  if (!h) return null;
  await h.requestAuthorization({ read: Object.values(TYPES) });
  const end = now.toISOString();
  const morning = new Date(now);
  morning.setHours(12, 0, 0, 0);
  const evening = new Date(morning.getTime() - 18 * 3600000);
  const dayAgo = new Date(now.getTime() - 24 * 3600000).toISOString();
  const read = async (dataType, startDate, endDate = end) => {
    try {
      const r = await h.readSamples({ dataType, startDate, endDate, limit: 500 });
      return (r && (r.samples || r.data)) || [];
    } catch (e) {
      return [];
    }
  };
  const [hrv, rhr, sleep] = await Promise.all([read(TYPES.hrv, dayAgo), read(TYPES.rhr, dayAgo), read(TYPES.sleep, evening.toISOString(), morning.toISOString())]);
  const num = (xs) => xs.map((s) => Number(s.value)).filter((v) => isFinite(v) && v > 0);
  const out = {
    hrv: num(hrv).length ? Math.round(mean(num(hrv))) : null,
    rhr: num(rhr).length ? Math.round(Math.min(...num(rhr))) : null,
    sleepH: sleepHours(sleep),
  };
  return out.hrv || out.rhr || out.sleepH ? out : null;
}
