/* Schermen van fase 1: Vandaag, Log, Voortgang en het atletenprofiel. */
import React, { useMemo, useState } from "react";
import { C, R, Section, Row, Reveal, TBtn } from "../../App.jsx";
import { K } from "../theme.js";
import { SPORTS, fmtDuration, fmtKm, fmtPace, localISO, mondayOf, dayNum, isoOfNum, pillarOf, hyroxTotal } from "../engine/model.js";
import { sessionLoad, fitnessSeries, formStatus, weekSummary, weeklySeries, intensityDistribution, strengthRecords, runRecords, pieceRecords, benchmarkRecords, durationOf } from "../engine/load.js";
import { blocksOf, blockHeader, blockResult, sessionVolume, titleOf } from "../engine/blocks.js";
import { hrZones, hrAnchors, runPaceZones, powerZones, swimZones, rowZones, runThresholdPace, ZONE_NAMES } from "../engine/zones.js";
import { Card, Contours, Eyebrow, HIcon, PillarDot, Field, NumInput, DurationInput, Choice, Stat, dateLabel } from "./kit.jsx";
import { FitnessChart, FormChart, WeekBars, IntensityBar, PillarMini } from "./charts.jsx";
import { EX_INDEX } from "./session.jsx";

const H1 = ({ children }) => (
  <h1 className="disp text-[34px] leading-none" style={{ color: C.ink, fontWeight: 600 }}>
    {children}
  </h1>
);

/* Korte regel met de belangrijkste cijfers van een sessie. */
export function sessionFacts(s) {
  const dur = durationOf(s);
  const bits = [];
  if (s.kind === "duur") {
    if (s.distanceM) bits.push(fmtKm(s.distanceM));
    if (dur) bits.push(fmtDuration(dur));
    const p = fmtPace(s.sport, s.durationSec, s.distanceM);
    if (p) bits.push(p);
    if (s.avgHr) bits.push(`${s.avgHr} bpm`);
    const iv = blocksOf(s).find((b) => b.type === "interval");
    if (iv) bits.push(blockHeader(iv));
    return bits.join(" · ");
  }
  if (s.kind === "hyrox") {
    const t = hyroxTotal(s);
    if (t) bits.push(fmtDuration(t));
  }
  const bl = blocksOf(s);
  if (bl.length) {
    const main = bl.find((b) => b.type !== "sets" && b.type !== "vrij");
    if (main) {
      bits.push(blockHeader(main, { withName: !(s.kind === "wod" && !s.title && main.name) }));
      const r = blockResult(main);
      if (r) bits.push(r);
    }
    const sets = bl.filter((b) => b.type === "sets").reduce((a, b) => a + (b.items || []).reduce((x, e) => x + (e.sets || []).filter((y) => y && (y.reps || y.kg)).length, 0), 0);
    if (sets) bits.push(`${sets} sets`);
    const v = sessionVolume(bl);
    for (const [k, d] of Object.entries(v.sport)) bits.push(`${fmtKm(d)} ${SPORTS[k].label.toLowerCase()}`);
    if (!main && v.tonnage) bits.push(`${Math.round(v.tonnage).toLocaleString("nl-NL")} kg totaal`);
  }
  if (!bits.length && dur) bits.push(fmtDuration(dur, { long: true }));
  return bits.join(" · ");
}

function SessionRow({ s, profile, onOpen }) {
  const L = sessionLoad(s, profile, EX_INDEX);
  const pillar = pillarOf(s);
  return (
    <button onClick={() => onOpen(s)} className="tap w-full text-left flex items-center gap-3 px-4 py-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
      <span aria-hidden="true" style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: K[pillar].fill }} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm truncate" style={{ color: C.ink, fontWeight: 600 }}>
          {titleOf(s)}
        </span>
        <span className="block text-xs truncate tnum" style={{ color: C.muted }}>
          {dateLabel(s.date)} · {sessionFacts(s) || K[pillar].label}
        </span>
      </span>
      <span className="text-right shrink-0">
        <span className="block text-sm tnum" style={{ color: C.ink, fontWeight: 600 }}>
          {L.srpe || "–"}
        </span>
        <span className="block text-[11px]" style={{ color: C.muted }}>
          belasting{L.rpeEst && L.srpe ? "*" : ""}
        </span>
      </span>
    </button>
  );
}

/* ---------------- Vandaag ---------------- */
export function TodayView({ data, onAdd, onOpen }) {
  const { sessions, profile } = data;
  const today = localISO();
  const series = useMemo(() => fitnessSeries(sessions, profile, today, today, EX_INDEX), [sessions, profile, today]);
  const point = series[series.length - 1];
  const status = formStatus(point);
  const week = useMemo(() => weekSummary(sessions, profile, mondayOf(today), EX_INDEX), [sessions, profile, today]);
  const recent = [...sessions].sort((a, b) => (b.date + b.createdAt > a.date + a.createdAt ? 1 : -1)).slice(0, 3);
  const todays = sessions.filter((s) => s.date === today);
  return (
    <div className="space-y-4">
      <Reveal>
        <div className="flex items-end justify-between gap-3">
          <div>
            <Eyebrow>{dateLabel(today, { weekday: "long", day: "numeric", month: "long" })}</Eyebrow>
            <div className="mt-1">
              <H1>Vandaag</H1>
            </div>
          </div>
          <TBtn onClick={onAdd}>
            <span className="flex items-center gap-1.5">
              <HIcon name="plus" size={16} /> Training
            </span>
          </TBtn>
        </div>
      </Reveal>

      <Card className="px-4 pt-5 pb-4">
        <Contours />
        <div className="relative">
          <Eyebrow>Uw vorm</Eyebrow>
          <h2 className="disp text-[26px] leading-tight mt-1" style={{ color: C.ink, fontWeight: 600 }}>
            {status.label}
          </h2>
          <p className="text-sm leading-relaxed mt-1.5" style={{ color: C.muted, maxWidth: "52ch" }}>
            {status.text}
          </p>
          {point && point.ctl >= 1 && (
            <div className="grid grid-cols-3 gap-3 mt-4">
              <Stat label="Fitheid" value={Math.round(point.ctl)} />
              <Stat label="Vermoeidheid" value={Math.round(point.atl)} />
              <Stat label="Vorm" value={String(Math.round(point.tsb)).replace("-", "−")} />
            </div>
          )}
        </div>
      </Card>

      {todays.length > 0 && (
        <Card>
          <div className="px-4 pt-3.5 pb-2">
            <Eyebrow>Vandaag gedaan</Eyebrow>
          </div>
          {todays.map((s) => (
            <SessionRow key={s.id} s={s} profile={profile} onOpen={onOpen} />
          ))}
        </Card>
      )}

      <Card className="px-4 py-4">
        <div className="flex items-baseline justify-between mb-3">
          <Eyebrow>Deze week</Eyebrow>
          <span className="text-xs tnum" style={{ color: C.muted }}>
            {week.count} {week.count === 1 ? "sessie" : "sessies"} · {fmtDuration(week.minutes * 60, { long: true })}
          </span>
        </div>
        <PillarMini week={week} />
        {Object.keys(week.sports).length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs tnum" style={{ color: C.muted }}>
            {Object.entries(week.sports).map(([k, v]) => (
              <span key={k}>
                {SPORTS[k].label} <strong style={{ color: C.ink, fontWeight: 600 }}>{v.distanceM ? fmtKm(v.distanceM) : `${Math.round(v.minutes)} min`}</strong>
                {v.inBlocks > 0 && v.inBlocks < v.distanceM ? ` (${fmtKm(v.inBlocks)} in WOD's)` : v.inBlocks > 0 ? " in WOD's" : ""}
              </span>
            ))}
          </div>
        )}
      </Card>

      {sessions.length === 0 ? (
        <Card className="px-4 py-6 text-center">
          <p className="text-sm leading-relaxed mx-auto" style={{ color: C.ink, maxWidth: "40ch" }}>
            Leg uw eerste training vast. Kracht, een loop, een WOD: alles telt mee in één belastingsmaat.
          </p>
          <div className="mt-3 flex justify-center">
            <TBtn onClick={onAdd}>Eerste training vastleggen</TBtn>
          </div>
        </Card>
      ) : (
        todays.length === 0 && (
          <Card>
            <div className="px-4 pt-3.5 pb-2">
              <Eyebrow>Laatst</Eyebrow>
            </div>
            {recent.map((s) => (
              <SessionRow key={s.id} s={s} profile={profile} onOpen={onOpen} />
            ))}
          </Card>
        )
      )}
    </div>
  );
}

/* ---------------- Log ---------------- */
const FILTERS = [
  { value: "alles", label: "Alles" },
  { value: "kracht", label: "Kracht", dot: "kracht" },
  { value: "duur", label: "Duur", dot: "duur" },
  { value: "conditie", label: "Conditie", dot: "conditie" },
  { value: "mobiliteit", label: "Mobiliteit", dot: "mobiliteit" },
];
export function LogView({ data, onAdd, onOpen }) {
  const { sessions, profile } = data;
  const [filter, setFilter] = useState("alles");
  const list = sessions.filter((s) => filter === "alles" || pillarOf(s) === filter).sort((a, b) => (b.date + b.createdAt > a.date + a.createdAt ? 1 : -1));
  const groups = [];
  for (const s of list) {
    const m = mondayOf(s.date);
    if (!groups.length || groups[groups.length - 1].monday !== m) groups.push({ monday: m, items: [] });
    groups[groups.length - 1].items.push(s);
  }
  const thisMonday = mondayOf(localISO());
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <H1>Log</H1>
        <TBtn onClick={onAdd}>
          <span className="flex items-center gap-1.5">
            <HIcon name="plus" size={16} /> Training
          </span>
        </TBtn>
      </div>
      {sessions.length > 0 && <Choice options={FILTERS} value={filter} onChange={setFilter} ariaLabel="Filter op pijler" />}
      {groups.length === 0 && (
        <Card className="px-4 py-8 text-center">
          <p className="text-sm" style={{ color: C.muted }}>
            {sessions.length ? "Geen trainingen in deze pijler." : "Nog geen trainingen vastgelegd."}
          </p>
        </Card>
      )}
      {groups.map((g) => {
        const w = weekSummary(g.items, profile, g.monday, EX_INDEX);
        return (
          <Card key={g.monday}>
            <div className="px-4 pt-3.5 pb-2 flex items-baseline justify-between">
              <Eyebrow>{g.monday === thisMonday ? "Deze week" : `Week van ${dateLabel(g.monday, { day: "numeric", month: "long" })}`}</Eyebrow>
              <span className="text-xs tnum" style={{ color: C.muted }}>
                belasting {w.total}
              </span>
            </div>
            {g.items.map((s) => (
              <SessionRow key={s.id} s={s} profile={profile} onOpen={onOpen} />
            ))}
          </Card>
        );
      })}
      {sessions.some((s) => sessionLoad(s, profile, EX_INDEX).rpeEst) && (
        <p className="text-xs" style={{ color: C.muted }}>
          * Geschat: zonder ingevulde inspanning schat de app die uit hartslag, RIR of het soort training.
        </p>
      )}
    </div>
  );
}

/* ---------------- Voortgang ---------------- */
const RANGES = [
  { value: 6, label: "6 weken" },
  { value: 12, label: "12 weken" },
  { value: 26, label: "6 maanden" },
];
export function ProgressView({ data }) {
  const { sessions, profile } = data;
  const [weeks, setWeeks] = useState(12);
  const today = localISO();
  const from = isoOfNum(dayNum(today) - weeks * 7 + 1);
  const series = useMemo(() => fitnessSeries(sessions, profile, from, today, EX_INDEX), [sessions, profile, from, today]);
  const wk = useMemo(() => weeklySeries(sessions, profile, Math.min(weeks, 12), today, EX_INDEX), [sessions, profile, weeks, today]);
  const dist = useMemo(() => intensityDistribution(sessions, profile, isoOfNum(dayNum(today) - 27), today), [sessions, profile, today]);
  const lifts = useMemo(() => strengthRecords(sessions).slice(0, 6), [sessions]);
  const runs = useMemo(() => runRecords(sessions), [sessions]);
  const pieces = useMemo(() => pieceRecords(sessions), [sessions]);
  const benches = useMemo(() => benchmarkRecords(sessions), [sessions]);
  if (!sessions.length)
    return (
      <div className="space-y-4">
        <H1>Voortgang</H1>
        <Card className="px-4 py-8 text-center">
          <Contours seed={1} />
          <p className="relative text-sm leading-relaxed mx-auto" style={{ color: C.ink, maxWidth: "40ch" }}>
            Zodra u traint, ziet u hier uw fitheid, vermoeidheid en vorm over de weken, plus uw records.
          </p>
        </Card>
      </div>
    );
  const hard = dist.share ? dist.share[3] : 0;
  return (
    <div className="space-y-4">
      <H1>Voortgang</H1>
      <Choice options={RANGES} value={weeks} onChange={setWeeks} ariaLabel="Periode" />

      <Card className="px-4 pt-4 pb-3">
        <Eyebrow className="mb-2">Fitheid en vermoeidheid</Eyebrow>
        <FitnessChart series={series} />
        <div className="mt-3">
          <Eyebrow className="mb-1">Vorm (fitheid min vermoeidheid)</Eyebrow>
          <FormChart series={series} />
        </div>
        <p className="text-xs mt-2 leading-relaxed" style={{ color: C.muted }}>
          Fitheid groeit langzaam met wat u wekenlang doet; vermoeidheid reageert op de laatste dagen. Is de vorm laag, dan is herstel aan de beurt.
        </p>
      </Card>

      <Card className="px-4 pt-4 pb-3">
        <Eyebrow className="mb-2">Belasting per week</Eyebrow>
        <WeekBars weeks={wk} />
      </Card>

      {dist.total > 0 && (
        <Card className="px-4 py-4">
          <Eyebrow className="mb-2">Intensiteit duurtraining, laatste 4 weken</Eyebrow>
          <IntensityBar dist={dist} />
          <p className="text-xs mt-3 leading-relaxed" style={{ color: C.muted }}>
            {dist.share[1] >= 0.75
              ? "Mooi verdeeld: het meeste rustig, het zware werk gericht. Zo bouwt u een sterke basis."
              : hard > 0.3
              ? "Veel zwaar werk. Meer rustige kilometers geven een betere basis en sneller herstel."
              : "Veel tijd in het midden. Maak rustig echt rustig, en zwaar echt zwaar."}{" "}
            Richtlijn: ongeveer 80% rustig (Seiler, 2010).
          </p>
        </Card>
      )}

      {benches.length > 0 && (
        <Card>
          <div className="px-4 pt-3.5 pb-1">
            <Eyebrow>Benchmarks</Eyebrow>
          </div>
          {benches.map((b) => (
            <div key={b.name} className="flex items-baseline justify-between gap-3 px-4 py-2.5" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm" style={{ color: C.ink }}>
                  <PillarDot pillar="conditie" /> {b.name}
                </span>
                <span className="block text-xs truncate" style={{ color: C.muted }}>
                  {b.header.replace(`${b.name}: `, "")} · {b.count}× gedaan
                </span>
              </span>
              <span className="text-sm tnum shrink-0" style={{ color: C.ink, fontWeight: 600 }}>
                {b.result} <span className="text-xs" style={{ color: C.muted, fontWeight: 400 }}>· {dateLabel(b.date, { day: "numeric", month: "short" })}</span>
              </span>
            </div>
          ))}
        </Card>
      )}

      {(runs.length > 0 || lifts.length > 0 || pieces.length > 0) && (
        <Card>
          <div className="px-4 pt-3.5 pb-1">
            <Eyebrow>Records</Eyebrow>
          </div>
          {runs.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between px-4 py-2.5" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
              <span className="flex items-center gap-2 text-sm" style={{ color: C.ink }}>
                <PillarDot pillar="duur" /> {r.label}
              </span>
              <span className="text-sm tnum" style={{ color: C.ink, fontWeight: 600 }}>
                {fmtDuration(r.est)} <span className="text-xs" style={{ color: C.muted, fontWeight: 400 }}>· {dateLabel(r.date, { day: "numeric", month: "short" })}</span>
              </span>
            </div>
          ))}
          {pieces.map((p) => (
            <div key={p.moveId + p.distanceM} className="flex items-baseline justify-between px-4 py-2.5" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
              <span className="flex items-center gap-2 text-sm" style={{ color: C.ink }}>
                <PillarDot pillar="duur" /> {fmtKm(p.distanceM)} {p.name.toLowerCase().replace(/ \(.*\)/, "")}
              </span>
              <span className="text-sm tnum" style={{ color: C.ink, fontWeight: 600 }}>
                {fmtDuration(p.sec)} <span className="text-xs" style={{ color: C.muted, fontWeight: 400 }}>· {dateLabel(p.date, { day: "numeric", month: "short" })}</span>
              </span>
            </div>
          ))}
          {lifts.map((l) => (
            <div key={l.name} className="flex items-baseline justify-between px-4 py-2.5" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
              <span className="flex items-center gap-2 text-sm min-w-0" style={{ color: C.ink }}>
                <PillarDot pillar="kracht" /> <span className="truncate">{l.name}</span>
              </span>
              <span className="text-sm tnum shrink-0" style={{ color: C.ink, fontWeight: 600 }}>
                {Math.round(l.e1rm)} kg <span className="text-xs" style={{ color: C.muted, fontWeight: 400 }}>· {l.kg} × {l.reps}</span>
              </span>
            </div>
          ))}
          <p className="px-4 pb-3 pt-1 text-xs" style={{ color: C.muted }}>
            Looptijden: snelste gemiddelde tempo over minstens die afstand. Stukken: snelste tijd in intervallen of doorlopend. Kracht: geschatte 1RM (Epley).
          </p>
        </Card>
      )}
    </div>
  );
}

/* ---------------- Atletenprofiel en zones ---------------- */
const pace = (sec) => fmtDuration(sec);
function ZoneTable({ title, rows }) {
  if (!rows) return null;
  return (
    <div className="px-4 py-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
      <div className="text-xs mb-1.5" style={{ color: C.muted, fontWeight: 500 }}>
        {title}
      </div>
      <div className="grid gap-y-1 text-sm tnum" style={{ gridTemplateColumns: "1fr auto" }}>
        {rows.map(([name, val], i) => (
          <React.Fragment key={name}>
            <span style={{ color: C.ink }}>
              <span className="tnum" style={{ color: C.muted }}>
                Z{i + 1}
              </span>{" "}
              {name}
            </span>
            <span style={{ color: C.ink }}>{val}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export function AthleteSection({ profile, setProfile }) {
  const hz = hrZones(profile);
  const an = hrAnchors(profile);
  const rz = runPaceZones(profile.run5k);
  const pz = powerZones(profile.ftp);
  const sz = swimZones(profile.css100);
  const roz = rowZones(profile.row2k);
  const thr = runThresholdPace(profile.run5k);
  return (
    <>
      <Section title="Atleet" sub="Hoe meer u invult, hoe preciezer de belasting en de zones. Weet u iets niet, laat het leeg: de app schat verstandig.">
        <div className="px-4 py-4 space-y-4" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
          {profile.fromNexa && (
            <p className="text-xs" style={{ color: C.muted }}>
              Geslacht, leeftijd en gewicht zijn overgenomen uit Nexa.
            </p>
          )}
          <Field label="Geslacht" hint="Voor de hartslagformule (TRIMP).">
            <Choice options={[{ value: "man", label: "Man" }, { value: "vrouw", label: "Vrouw" }]} value={profile.sex} onChange={(v) => setProfile({ sex: v })} ariaLabel="Geslacht" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Geboortejaar">
              <NumInput value={profile.birthYear} onChange={(v) => setProfile({ birthYear: v })} step="1" ariaLabel="Geboortejaar" />
            </Field>
            <Field label="Gewicht">
              <NumInput value={profile.weight} onChange={(v) => setProfile({ weight: v })} unit="kg" ariaLabel="Gewicht" />
            </Field>
            <Field label="Max. hartslag" hint={an.estimatedMax ? `geschat: ${an.hrMax}` : null}>
              <NumInput value={profile.hrMax} onChange={(v) => setProfile({ hrMax: v })} unit="bpm" step="1" ariaLabel="Maximale hartslag" />
            </Field>
            <Field label="Rusthartslag" hint="'s ochtends, liggend">
              <NumInput value={profile.hrRest} onChange={(v) => setProfile({ hrRest: v })} unit="bpm" step="1" ariaLabel="Rusthartslag" />
            </Field>
            <Field label="Drempelhartslag" hint="LTHR, uit een test">
              <NumInput value={profile.lthr} onChange={(v) => setProfile({ lthr: v })} unit="bpm" step="1" ariaLabel="Drempelhartslag" />
            </Field>
            <Field label="5 km hardlopen" hint={thr ? `drempeltempo ${pace(thr)} /km` : "beste tijd, recent"}>
              <DurationInput value={profile.run5k} onChange={(v) => setProfile({ run5k: v })} placeholder="mm:ss" ariaLabel="5 kilometer tijd" />
            </Field>
            <Field label="FTP fietsen">
              <NumInput value={profile.ftp} onChange={(v) => setProfile({ ftp: v })} unit="W" step="1" ariaLabel="FTP" />
            </Field>
            <Field label="2 km roeien">
              <DurationInput value={profile.row2k} onChange={(v) => setProfile({ row2k: v })} placeholder="m:ss" ariaLabel="2 kilometer roeitijd" />
            </Field>
            <Field label="CSS zwemmen" hint="tempo per 100 m">
              <DurationInput value={profile.css100} onChange={(v) => setProfile({ css100: v })} placeholder="m:ss" ariaLabel="Critical swim speed per 100 meter" />
            </Field>
          </div>
        </div>
      </Section>
      {(hz || rz || pz || sz || roz) && (
        <Section title="Zones" accent="var(--tide-fill)" sub="Uitgerekend uit uw profiel. Ze passen zich aan zodra u nieuwe waarden invult.">
          <ZoneTable
            title={hz ? `Hartslag (${hz.method === "lthr" ? "drempelhartslag" : hz.method === "reserve" ? "hartslagreserve" : "% van max"})` : ""}
            rows={hz && hz.zones.map((z, i) => [z.name, i === 0 ? `< ${z.hi}` : i === 4 ? `≥ ${z.lo}` : `${z.lo}–${z.hi - 1}`])}
          />
          <ZoneTable title="Hardlopen (tempo per km)" rows={rz && rz.map((z) => [z.name, `${pace(z.fast)}–${pace(z.slow)}`])} />
          <ZoneTable title="Fietsen (vermogen)" rows={pz && pz.map((z, i) => [z.name, i === 0 ? `< ${z.hi} W` : `${z.lo}–${z.hi} W`])} />
          <ZoneTable title="Roeien (per 500 m)" rows={roz && roz.map((z) => [z.name, `${pace(z.fast)}–${pace(z.slow)}`])} />
          <ZoneTable title="Zwemmen (per 100 m)" rows={sz && sz.map((z) => [z.name, `${pace(z.fast)}–${pace(z.slow)}`])} />
        </Section>
      )}
    </>
  );
}
