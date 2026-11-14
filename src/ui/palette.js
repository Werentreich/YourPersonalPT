/* Opdrachtpalet: zoeken in schermen, secties en acties (zuiver, zonder React).

   Een opdracht is { id, label, group, hint?, keywords?, run }. Zoeken is
   vergevingsgezind: hoofdletters en accenten tellen niet, elk zoekwoord moet
   ergens in het label of de trefwoorden voorkomen, en een treffer aan het
   begin van het label of van een woord weegt zwaarder. */

export const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

export function scoreCommand(cmd, query) {
  const q = norm(query).trim();
  if (!q) return 1;
  const label = norm(cmd.label);
  const hay = `${label} ${norm(cmd.keywords)} ${norm(cmd.group)}`;
  let score = 0;
  for (const w of q.split(/\s+/)) {
    const i = hay.indexOf(w);
    if (i < 0) return 0;
    if (label.startsWith(w)) score += 6;
    else if (new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(label)) score += 4;
    else if (label.includes(w)) score += 2;
    else score += 1;
  }
  return score;
}

/* Gefilterd en gesorteerd; zonder zoekterm de opgegeven volgorde. */
export function filterCommands(commands, query, limit = 40) {
  const q = norm(query).trim();
  const scored = (commands || []).map((c, i) => ({ c, i, s: scoreCommand(c, q) })).filter((x) => x.s > 0);
  if (q) scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.slice(0, limit).map((x) => x.c);
}

/* Groepen in volgorde van eerste voorkomen: [{ group, items }]. */
export function groupCommands(list) {
  const out = [];
  for (const c of list) {
    let g = out.find((x) => x.group === c.group);
    if (!g) out.push((g = { group: c.group, items: [] }));
    g.items.push(c);
  }
  return out;
}

/* Secties per scherm, voor "ga naar". Titels komen overeen met de koppen
   (data-section); een titel die met … eindigt is een begin (voorvoegsel). */
export const SECTIONS = {
  eten: ["Dagindeling…", "Variatie deze week", "Boodschappen voor de week", "Mijn maaltijden", "Eigen producten"],
  plan: ["Gewicht en bijsturen", "Wekelijkse check-in", "Lichaamssamenstelling", "Meerwekenplan", "Wanneer welke fase", "Hormonale gezondheid", "Slaap", "Slaaptips", "Micronutriënten per dag"],
  profiel: ["Uw sport", "Weergave", "Account", "Gezin en coaching", "Weekschema", "Lichaamsgegevens", "Dagelijkse activiteit", "Doel", "Handmatig bijstellen", "Privacy en gegevens"],
};
