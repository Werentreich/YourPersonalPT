/* Locatie volgen tijdens een live opname.

   - Eigen app: plugin BackgroundGeolocation
     (@capacitor-community/background-geolocation). Die blijft doorgaan met
     het scherm uit of de app op de achtergrond, met een melding in beeld
     (Android: voorgrondservice).
   - Web (PWA): navigator.geolocation.watchPosition. Werkt alleen zolang de
     app in beeld is; daarom houden we het scherm aan (Wake Lock API).

   watchLocation(onFix, onError) -> stop() */
import { plugin } from "./platform.js";

export function geoAvailable() {
  return !!plugin("BackgroundGeolocation") || (typeof navigator !== "undefined" && !!navigator.geolocation);
}

export const backgroundCapable = () => !!plugin("BackgroundGeolocation");

const ERR = {
  1: "Geen toestemming voor uw locatie. Sta locatie toe in de instellingen van uw browser of telefoon.",
  2: "Uw locatie is niet te bepalen. Ga naar buiten, met vrij zicht op de lucht.",
  3: "Het duurt te lang om uw locatie te bepalen.",
  NOT_AUTHORIZED: "Geen toestemming voor uw locatie. Sta locatie toe in de instellingen van uw telefoon.",
};

export async function watchLocation(onFix, onError) {
  const bg = plugin("BackgroundGeolocation");
  if (bg && typeof bg.addWatcher === "function") {
    const id = await bg.addWatcher(
      { backgroundTitle: "Nexa Hybrid neemt uw training op", backgroundMessage: "Tik om terug te gaan naar de app.", requestPermissions: true, stale: false, distanceFilter: 0 },
      (loc, err) => {
        if (err) return onError(ERR[err.code] || err.message || "Locatie niet beschikbaar.");
        if (loc) onFix({ lat: loc.latitude, lon: loc.longitude, acc: loc.accuracy, alt: loc.altitude, speed: loc.speed, t: loc.time || Date.now() });
      }
    );
    return () => bg.removeWatcher({ id });
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    onError("Dit apparaat geeft geen locatie door.");
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (p) => onFix({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, alt: p.coords.altitude, speed: p.coords.speed, t: p.timestamp || Date.now() }),
    (e) => onError(ERR[e.code] || "Locatie niet beschikbaar."),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
  );
  return () => navigator.geolocation.clearWatch(id);
}

/* Scherm aanhouden (web). Geeft release(). */
export async function keepAwake() {
  let lock = null;
  const req = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.wakeLock && document.visibilityState === "visible") lock = await navigator.wakeLock.request("screen");
    } catch (e) {
      lock = null; // niet ondersteund of geweigerd: opname gaat door
    }
  };
  await req();
  const onVis = () => document.visibilityState === "visible" && req();
  document.addEventListener("visibilitychange", onVis);
  return () => {
    document.removeEventListener("visibilitychange", onVis);
    if (lock) lock.release().catch(() => null);
  };
}
