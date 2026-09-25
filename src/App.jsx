import React, { useState, useMemo, useEffect, useRef } from "react";

/* =========================================================================
   MACROVERDELING - trainingsgerichte macro- en maaltijdplanner
   Rekenkern gebaseerd op openbaar gepubliceerde sportvoedingsliteratuur:
   - Mifflin-St Jeor (1990) / Katch-McArdle voor rustmetabolisme
   - ISSN position stand eiwit (Jager et al. 2017): 1,4-2,0 g/kg, hoger in deficit
   - Helms et al. (2014): 2,3-3,1 g/kg vetvrije massa bij energiebeperking
   - Schoenfeld & Aragon (2018): 0,4 g/kg eiwit per maaltijd, 3-6 maaltijden
   - Kerksick et al. (2017): koolhydraattiming rond de trainingssessie
   ========================================================================= */

/* ----------------------------- rekenkern ----------------------------- */

/* Eén plek voor het opvangen van lege of ongeldige invoer. Rekenfuncties
   horen niet om te vallen op een veld dat de gebruiker even leeggemaakt heeft. */
const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  const v = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  return Number.isFinite(v) ? v : 0;
};
const toHHMM = (min) => {
  const safe = Number.isFinite(min) ? min : 0;
  const m = ((Math.round(safe) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

function calcBMR({ sex, weight, height, age, bodyFat, useBodyFat }) {
  if (useBodyFat && bodyFat >= 4 && bodyFat <= 60) {
    return 370 + 21.6 * (weight * (1 - bodyFat / 100));
  }
  return sex === "man"
    ? 10 * weight + 6.25 * height - 5 * age + 5
    : 10 * weight + 6.25 * height - 5 * age - 161;
}

const sessionKcal = ({ met, minutes, weight }) =>
  (((met - 1) * 3.5 * weight) / 200) * minutes;

const METS = { kracht: 5.0, volume: 6.0, hiit: 8.5, duur: 9.0 };
const sum = (a) => a.reduce((x, y) => x + y, 0);

/* Verdeelt de weekcalorieën over zeven dagen.
   - trainingsdagen krijgen hun eigen verbruik terug, plus een cyclingopslag
   - een flexdag krijgt er kcal bij, de overige dagen leveren dat samen in
   - geen enkele dag zakt onder 1,05 x rustmetabolisme */
function weekEnergy(i) {
  const bmr = calcBMR(i);
  const rest = bmr * i.activityFactor;
  const sess = i.week.map((d) =>
    d.session ? sessionKcal({ met: METS[d.session.type] || 5, minutes: num(d.session.minutes, 60), weight: i.weight }) : 0
  );
  const weekTDEE = sum(sess.map((s) => rest + s));
  const tdeeAvg = weekTDEE / 7;

  const energyPerKg = i.goal === "bulk" ? 5500 : 7700;
  let delta = i.goal === "onderhoud" ? 0 : ((i.rate / 100) * i.weight * energyPerKg) / 7;
  const maxDeficit = -0.28 * tdeeAvg;
  const maxSurplus = 0.2 * tdeeAvg;
  const capped = delta < maxDeficit || delta > maxSurplus;
  delta = Math.max(maxDeficit, Math.min(maxSurplus, delta));

  const avgTarget = tdeeAvg + delta + (i.kcalAdjust || 0);

  /* Met cycling aan krijgt een trainingsdag zijn eigen verbruik terug plus een
     opslag van tien procent; rustdagen leveren dat samen in. Met cycling uit
     krijgt elke dag exact hetzelfde, ongeacht of er getraind wordt. Het
     weektotaal is in beide gevallen gelijk. */
  const extra = i.cycling ? sess.map((s) => s + (s > 0 ? 0.1 * avgTarget : 0)) : sess.map(() => 0);
  const meanExtra = sum(extra) / 7;
  const flex = i.week.map((d) => num(d.flex, 0));
  const flexTotal = sum(flex);
  const nOther = Math.max(1, 7 - flex.filter((x) => x !== 0).length);

  let kcals = extra.map((e, k) =>
    flex[k] !== 0 ? avgTarget + e - meanExtra + flex[k] : avgTarget + e - meanExtra - flexTotal / nOther
  );

  // bodem bewaken en het tekort bij de ruimste dagen weghalen
  const floorK = 1.05 * bmr;
  for (let it = 0; it < 6; it++) {
    const need = sum(kcals.map((k) => Math.max(0, floorK - k)));
    if (need < 1) break;
    kcals = kcals.map((k) => Math.max(k, floorK));
    const donors = kcals.map((k, idx) => (k > floorK + 40 && flex[idx] === 0 ? k - floorK : 0));
    const pool = sum(donors);
    if (pool < 1) break;
    kcals = kcals.map((k, idx) => k - (need * donors[idx]) / pool);
  }

  const realKgPerWeek = (sum(kcals) - weekTDEE) / energyPerKg;
  const unmetFlex = sum(kcals) - avgTarget * 7;
  return { bmr, rest, sess, tdeeAvg, avgTarget, delta, kcals, capped, realKgPerWeek, weekTDEE, unmetFlex };
}

/* Aandeel van de gewichtstoename dat als vet wordt opgeslagen.
   Neemt toe met het tempo van de bulk en met het vetpercentage zelf. */
function fatFractionGain(ratePctPerWeek, bodyFat, window) {
  const base = 0.32 + 0.66 * Math.abs(ratePctPerWeek);
  const mid = (window[0] + window[1]) / 2;
  const penalty = Math.max(0, bodyFat - mid) * 0.012;
  return Math.min(0.85, Math.max(0.35, base + penalty));
}

/* Aandeel van het gewichtsverlies dat uit vet komt. Daalt bij een hoger
   tempo en bij een al laag vetpercentage. */
function fatFractionLoss(ratePctPerWeek, bodyFat, window) {
  const r = Math.abs(ratePctPerWeek);
  const f = 0.95 - 0.12 * r - 0.025 * Math.max(0, window[0] + 3 - bodyFat);
  return Math.min(0.92, Math.max(0.55, f));
}

const BF_WINDOW = {
  man: { behoudend: [10, 15], standaard: [10, 17], ruim: [12, 20] },
  vrouw: { behoudend: [18, 24], standaard: [18, 26], ruim: [20, 29] },
};

/* Harde grenzen voor een eigen venster. De onderkant ligt ruim boven het
   essentiële vetweefsel (ongeveer 2 procent bij mannen, 8 tot 10 bij vrouwen);
   daaronder kan de app geen verantwoord plan maken. */
const BF_LIMITS = {
  man: { min: 6, max: 30, lowWarn: 8, highWarn: 22 },
  vrouw: { min: 14, max: 40, lowWarn: 16, highWarn: 32 },
};

const EXPERIENCE = [
  { id: "beginner", label: "Beginner, minder dan 1 jaar serieus trainen", rate: 0.5 },
  { id: "gevorderd", label: "Gevorderd, 1 tot 3 jaar", rate: 0.25 },
  { id: "ervaren", label: "Ervaren, meer dan 3 jaar", rate: 0.125 },
];

function phasePlan(i) {
  const horizon = Math.min(78, Math.max(4, Number(i.horizonWeeks) || 26));
  const win = i.bfWindow || [10, 17];
  const minicutRate = -Math.abs(i.minicutRate || 0.75);
  const maxMinicut = Math.max(2, Number(i.maxMinicutWeeks) || 5);
  const recovery = Math.max(1, Number(i.recoveryWeeks) || 2);
  const maxBlock = Math.max(4, Number(i.blockWeeks) || (i.goal === "bulk" ? 16 : 10));
  const maxCutBlock = 10;
  const maintWeeks = Math.max(1, Number(i.maintWeeks) || 3);

  let w = i.weight;
  let bf = i.useBodyFat ? i.bodyFat : i.sex === "man" ? 15 : 25;
  let fatMass = (w * bf) / 100;
  const startWeight = w;
  const startLean = w - fatMass;

  /* Doel van een minicut is niet de bodem van het venster maar ongeveer vier
     procentpunten onder het plafond. Verder terug lukt niet binnen enkele
     weken en hoort bij een gewone cut. */
  const minicutTarget = Math.max(win[0], win[1] - 4);

  let phase = i.goal === "onderhoud" ? "onderhoud" : i.goal;
  const advice = [];

  /* Wie boven het plafond aan een bulk begint, zet zichzelf klem: het venster
     is dan nul weken breed. Het plan begint in dat geval met een reguliere cut
     naar de bodem, niet met een minicut. */
  if (i.goal === "bulk" && bf >= win[1]) {
    phase = "cut";
    advice.push(
      `U start op ${bf.toFixed(1)}% en dat ligt op of boven het plafond van ${win[1]}%. Het plan begint daarom met een reguliere cut naar ${win[0]}%. Bulken vanaf een hoog vetpercentage levert per kilo minder spier op en verlengt de cut die er toch komt.`
    );
  } else if (i.goal === "bulk" && bf > (win[0] + win[1]) / 2) {
    advice.push(
      `Met ${bf.toFixed(1)}% zit u in de bovenste helft van uw venster. Er is nog opbouwruimte, maar reken op een minicut binnen enkele maanden.`
    );
  }

  let inPhase = 0;
  let queued = 0; // resterende weken van een tijdelijke onderhoudsfase
  let resumeTo = i.goal;
  const rows = [];
  let minicuts = 0;
  let stopReason = null;

  for (let week = 1; week <= horizon; week++) {
    bf = (fatMass / w) * 100;
    const bmr = calcBMR({ ...i, weight: w, bodyFat: bf });
    const rest = bmr * i.activityFactor;
    const sess = sum(
      i.week.map((d) => (d.session ? sessionKcal({ met: METS[d.session.type], minutes: d.session.minutes, weight: w }) : 0))
    );
    const tdee = (rest * 7 + sess) / 7;

    let kcal = tdee;
    let dw = 0;
    let note = null;

    if (phase === "bulk") {
      const rate = Math.abs(i.rate) || 0.25;
      let delta = ((rate / 100) * w * 5500) / 7;
      delta = Math.min(delta, 0.2 * tdee);
      kcal = tdee + delta;
      dw = (delta * 7) / 5500;
      const ff = fatFractionGain(rate, bf, win);
      fatMass += dw * ff;
    } else if (phase === "minicut") {
      let delta = ((minicutRate / 100) * w * 7700) / 7;
      delta = Math.max(delta, -0.28 * tdee);
      kcal = tdee + delta;
      dw = (delta * 7) / 7700;
      const ff = fatFractionLoss(minicutRate, bf, win);
      fatMass += dw * ff;
    } else if (phase === "cut") {
      const cutRate = i.goal === "bulk" ? -Math.abs(i.cutRate || 0.6) : i.rate;
      let delta = ((cutRate / 100) * w * 7700) / 7;
      delta = Math.max(delta, -0.28 * tdee);
      kcal = tdee + delta;
      dw = (delta * 7) / 7700;
      const ff = fatFractionLoss(cutRate, bf, win);
      fatMass += dw * ff;
    }

    rows.push({ week, phase, weight: w, bodyFat: bf, kcal, tdee, note });
    w += dw;
    fatMass = Math.max(1, fatMass);
    const newBf = (fatMass / w) * 100;
    inPhase++;

    const weeksLeft = horizon - week;

    if (phase === "bulk") {
      if (newBf >= win[1]) {
        if (i.minicut && weeksLeft >= 3 + recovery) {
          phase = "minicut";
          inPhase = 0;
          minicuts++;
          rows[rows.length - 1].note = `Vetpercentage raakt het plafond van ${win[1]}%: minicut inzetten.`;
        } else {
          phase = "onderhoud";
          queued = weeksLeft;
          resumeTo = "bulk";
          inPhase = 0;
          rows[rows.length - 1].note = i.minicut
            ? "Plafond bereikt, maar te weinig weken over voor een zinvolle minicut. Onderhoud tot het einde van de horizon."
            : "Plafond bereikt. Zonder minicut stopt de opbouw hier.";
        }
      } else if (inPhase >= maxBlock) {
        phase = "onderhoud";
        queued = maintWeeks;
        resumeTo = "bulk";
        inPhase = 0;
        rows[rows.length - 1].note = `${maxBlock} weken aaneengesloten in surplus: onderhoudsblok om eetlust, bloeddruk en spijsvertering te laten herstellen.`;
      }
    } else if (phase === "minicut") {
      if (newBf <= minicutTarget) {
        phase = "onderhoud";
        queued = recovery;
        resumeTo = "bulk";
        inPhase = 0;
        rows[rows.length - 1].note = `Terug op ${minicutTarget.toFixed(0)}%: ${recovery} weken onderhoud om te herstellen voordat het surplus terugkomt.`;
      } else if (inPhase >= maxMinicut) {
        phase = "onderhoud";
        queued = recovery;
        resumeTo = "bulk";
        inPhase = 0;
        rows[rows.length - 1].note = `Maximale duur van ${maxMinicut} weken bereikt. Langer maakt er een gewone cut van en kost trainingskwaliteit.`;
      }
    } else if (phase === "cut") {
      if (i.goal === "bulk") {
        // aanloopcut voorafgaand aan de bulk
        if (newBf <= win[0]) {
          phase = "onderhoud";
          queued = recovery;
          resumeTo = "bulk";
          inPhase = 0;
          rows[rows.length - 1].note = `Op ${win[0]}% aangekomen: ${recovery} weken onderhoud, daarna begint de opbouw met een schoon venster.`;
        } else if (inPhase >= maxCutBlock) {
          phase = "onderhoud";
          queued = maintWeeks;
          resumeTo = "cut";
          inPhase = 0;
          rows[rows.length - 1].note = `${maxCutBlock} weken in tekort: dieetpauze op onderhoud voordat de aanloopcut verdergaat.`;
        }
        continue;
      }
      const reached =
        (i.targetWeight != null && w <= i.targetWeight) || (i.targetBf != null && newBf <= i.targetBf);
      if (reached) {
        stopReason = "doel bereikt";
        break;
      }
      if (inPhase >= maxBlock) {
        phase = "onderhoud";
        queued = maintWeeks;
        resumeTo = "cut";
        inPhase = 0;
        rows[rows.length - 1].note = `${maxBlock} weken in tekort: onderhoudsblok om stofwisseling, hormonen en trainingskwaliteit te herstellen.`;
      }
    } else if (phase === "onderhoud") {
      queued--;
      if (queued <= 0 && i.goal !== "onderhoud") {
        phase = resumeTo;
        inPhase = 0;
      }
    }
  }

  const endBf = (fatMass / w) * 100;
  const lean = w - fatMass;
  return {
    rows,
    summary: {
      weeks: rows.length,
      startWeight,
      endWeight: w,
      gain: w - startWeight,
      lean: lean - startLean,
      fat: fatMass - (startWeight - startLean),
      startBf: (((startWeight - startLean) / startWeight) * 100),
      endBf,
      minicuts,
      maintenanceWeeks: rows.filter((r) => r.phase === "onderhoud").length,
      cutWeeks: rows.filter((r) => r.phase === "cut" || r.phase === "minicut").length,
      bulkWeeks: rows.filter((r) => r.phase === "bulk").length,
      stopReason,
      advice,
      minicutTarget,
      estimatedBf: !i.useBodyFat,
    },
  };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* Hoeveel weken kost het om vanaf hier op een vetpercentage uit te komen,
   dieetpauzes meegerekend. Wordt gebruikt om de slotcut terug te rekenen. */
function weeksToBf({ weight, fatMass, targetBf, rate, win, blockWeeks, maintWeeks }) {
  let w = weight;
  let fm = fatMass;
  let weeks = 0;
  let inBlock = 0;
  while (weeks < 70) {
    const bf = (fm / w) * 100;
    if (bf <= targetBf) break;
    if (inBlock >= blockWeeks) {
      weeks += maintWeeks;
      inBlock = 0;
      continue;
    }
    const dw = -(Math.abs(rate) / 100) * w;
    fm = Math.max(1, fm + dw * fatFractionLoss(rate, bf, win));
    w += dw;
    weeks++;
    inBlock++;
  }
  return weeks;
}

function chainPlan(i) {
  const horizon = clamp(Number(i.horizonWeeks) || 52, 8, 104);
  const win = i.bfWindow || [10, 17];
  const bulkRate = Math.abs(i.bulkRate || 0.25);
  const cutRate = Math.abs(i.cutRate || 0.6);
  const minicutRate = Math.abs(i.minicutRate || 0.75);
  const maxMinicut = clamp(Number(i.maxMinicutWeeks) || 5, 2, 8);
  const maxBulkBlock = clamp(Number(i.blockWeeks) || 16, 6, 24);
  const maxCutBlock = clamp(Number(i.cutBlockWeeks) || 10, 4, 16);
  const pauseWeeks = clamp(Number(i.maintWeeks) || 3, 1, 8);
  const recovery = 2;
  const minicutTarget = Math.max(win[0], win[1] - 4);
  const targetBf = i.targetBf != null ? Number(i.targetBf) : null;
  const shapeOnDate = i.priority === "vorm" && targetBf != null;

  let w = i.weight;
  let bf = i.useBodyFat ? i.bodyFat : i.sex === "man" ? 15 : 25;
  let fatMass = (w * bf) / 100;
  const startWeight = w;
  const startFat = fatMass;

  const rows = [];
  const advice = [];
  let phase = bf > win[1] ? "cut" : "bulk";
  let inPhase = 0;
  let queued = 0;
  let cutLength = 0;
  let resumeTo = "bulk";
  let lastCutKcal = null;
  let reverseFrom = null;
  let minicuts = 0;

  if (phase === "cut") {
    advice.push(
      `U start op ${bf.toFixed(1)}% en dat ligt boven het plafond van ${win[1]}%. Het plan begint met een cut naar ${win[0]}%, gevolgd door een opbouw van de calorieen en een onderhoudsperiode voordat de opbouwfase begint.`
    );
  }
  if (shapeOnDate) {
    advice.push(
      `De slotcut naar ${targetBf}% wordt teruggerekend vanaf week ${horizon}. Tot dat moment loopt het plan door met opbouwen.`
    );
  }

  for (let week = 1; week <= horizon; week++) {
    bf = (fatMass / w) * 100;
    const bmr = calcBMR({ ...i, weight: w, bodyFat: bf });
    const rest = bmr * i.activityFactor;
    const sess = sum(
      i.week.map((d) => (d.session ? sessionKcal({ met: METS[d.session.type], minutes: d.session.minutes, weight: w }) : 0))
    );
    const tdee = (rest * 7 + sess) / 7;
    const weeksLeft = horizon - week;

    let kcal = tdee;
    let dw = 0;

    if (phase === "bulk") {
      const delta = Math.min(((bulkRate / 100) * w * 5500) / 7, 0.2 * tdee);
      kcal = tdee + delta;
      dw = (delta * 7) / 5500;
      fatMass += dw * fatFractionGain(bulkRate, bf, win);
    } else if (phase === "cut" || phase === "minicut" || phase === "slotcut") {
      const r = phase === "minicut" ? minicutRate : cutRate;
      const delta = Math.max(((-r / 100) * w * 7700) / 7, -0.28 * tdee);
      kcal = tdee + delta;
      dw = (delta * 7) / 7700;
      fatMass += dw * fatFractionLoss(r, bf, win);
      lastCutKcal = kcal;
      cutLength++;
    } else if (phase === "reverse") {
      const stepN = Math.max(1, reverseFrom.weeks);
      kcal = reverseFrom.kcal + (tdee - reverseFrom.kcal) * ((inPhase + 1) / stepN);
      dw = 0.15;
      fatMass += dw * 0.35;
    }

    rows.push({ week, phase, weight: w, bodyFat: bf, kcal, tdee, note: null });
    w += dw;
    fatMass = Math.max(1, fatMass);
    const newBf = (fatMass / w) * 100;
    inPhase++;

    const setNote = (t) => (rows[rows.length - 1].note = t);
    const startReverse = (reason) => {
      const weeks = clamp(Math.ceil(cutLength / 6), 2, 4);
      reverseFrom = { kcal: lastCutKcal, weeks };
      phase = "reverse";
      queued = weeks;
      inPhase = 0;
      setNote(reason);
    };

    if (phase === "cut") {
      if (newBf <= win[0])
        startReverse(
          `Op ${win[0]}% aangekomen. De calorieen gaan nu in stappen omhoog naar onderhoud in plaats van in een keer; dat beperkt de vetopslag direct na een dieetfase.`
        );
      else if (inPhase >= maxCutBlock) {
        phase = "onderhoud";
        queued = pauseWeeks;
        resumeTo = "cut";
        inPhase = 0;
        setNote(`${maxCutBlock} weken in tekort: dieetpauze op onderhoud, daarna gaat de cut verder.`);
      }
    } else if (phase === "slotcut") {
      if (newBf <= targetBf) {
        setNote(`Doel van ${targetBf}% bereikt in week ${week}.`);
        break;
      }
      if (inPhase >= maxCutBlock && weeksLeft > pauseWeeks + 2) {
        phase = "onderhoud";
        queued = pauseWeeks;
        resumeTo = "slotcut";
        inPhase = 0;
        setNote(`Dieetpauze binnen de slotcut na ${maxCutBlock} weken tekort.`);
      }
    } else if (phase === "minicut") {
      if (newBf <= minicutTarget || inPhase >= maxMinicut) {
        const reachedTarget = newBf <= minicutTarget;
        phase = "onderhoud";
        queued = recovery;
        resumeTo = "bulk";
        inPhase = 0;
        cutLength = 0;
        setNote(
          reachedTarget
            ? `Terug op ${minicutTarget.toFixed(0)}%: ${recovery} weken onderhoud voordat het surplus terugkomt.`
            : `Maximale duur van ${maxMinicut} weken bereikt. Langer maakt er een gewone cut van.`
        );
      }
    } else if (phase === "reverse") {
      queued--;
      if (queued <= 0) {
        const maint = clamp(Math.round(cutLength / 2), 4, 12);
        phase = "onderhoud";
        queued = maint;
        resumeTo = "bulk";
        inPhase = 0;
        setNote(
          `Calorieen staan terug op onderhoud. Nu ${maint} weken stabiel houden, ongeveer de helft van de ${cutLength} dieetweken. Meteen in surplus gaan na een lange cut zet onevenredig veel vet aan.`
        );
        cutLength = 0;
      }
    } else if (phase === "onderhoud") {
      queued--;
      if (queued <= 0) {
        phase = resumeTo;
        inPhase = 0;
        setNote(
          resumeTo === "bulk"
            ? "Onderhoud afgerond: het surplus begint."
            : "Dieetpauze afgerond: het tekort gaat er weer in."
        );
      }
    }

    if (shapeOnDate && phase !== "slotcut" && !(phase === "onderhoud" && queued > 0) && newBf > targetBf) {
      const need = weeksToBf({
        weight: w,
        fatMass,
        targetBf,
        rate: cutRate,
        win,
        blockWeeks: maxCutBlock,
        maintWeeks: pauseWeeks,
      });
      if (weeksLeft <= need) {
        phase = "slotcut";
        resumeTo = "slotcut";
        inPhase = 0;
        cutLength = 0;
        setNote(`Nog ${weeksLeft} weken tot de einddatum en de slotcut kost er ongeveer ${need}. Vanaf hier gaat het tekort in.`);
      }
    }

    if (phase === "bulk" && newBf >= win[1]) {
      if (i.minicut !== false && weeksLeft >= 3 + recovery) {
        phase = "minicut";
        inPhase = 0;
        minicuts++;
        cutLength = 0;
        setNote(`Vetpercentage raakt het plafond van ${win[1]}%: minicut inzetten.`);
      } else {
        phase = "onderhoud";
        queued = weeksLeft;
        inPhase = 0;
        setNote("Plafond bereikt en te weinig weken over voor een minicut. Onderhoud tot het einde.");
      }
    } else if (phase === "bulk" && inPhase >= maxBulkBlock) {
      phase = "onderhoud";
      queued = pauseWeeks;
      inPhase = 0;
      setNote(`${maxBulkBlock} weken aaneengesloten in surplus: onderhoudsblok voor eetlust, spijsvertering en bloeddruk.`);
    }
  }

  const endBf = (fatMass / w) * 100;
  const count = (p) => rows.filter((r) => r.phase === p).length;
  if (shapeOnDate && endBf > targetBf + 0.5)
    advice.push(
      `Binnen ${horizon} weken komt u uit op ${endBf.toFixed(1)}% en niet op ${targetBf}%. Verleng de horizon, verhoog het cuttempo of stel het doel bij.`
    );
  return {
    rows,
    summary: {
      weeks: rows.length,
      startWeight,
      endWeight: w,
      gain: w - startWeight,
      lean: w - fatMass - (startWeight - startFat),
      fat: fatMass - startFat,
      startBf: (startFat / startWeight) * 100,
      endBf,
      minicuts,
      advice,
      phases: {
        bulk: count("bulk"),
        cut: count("cut") + count("slotcut"),
        minicut: count("minicut"),
        reverse: count("reverse"),
        onderhoud: count("onderhoud"),
      },
      estimatedBf: !i.useBodyFat,
    },
  };
}

/* Trend uit de gewichtslog: lineaire regressie over de laatste 28 dagen */
function weightTrend(entries, windowDays = 28) {
  const pts = [...entries]
    .filter((e) => e.weight > 0)
    .map((e) => ({ t: Date.parse(e.date) / 86400000, w: e.weight }))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 4) return { ok: false, n: pts.length, reason: "minstens vier metingen nodig" };

  const last = pts[pts.length - 1].t;
  const used = pts.filter((p) => last - p.t <= windowDays);
  const span = used[used.length - 1].t - used[0].t;
  if (used.length < 4 || span < 10)
    return { ok: false, n: used.length, span, reason: "minstens tien dagen aan metingen nodig" };

  const mt = sum(used.map((p) => p.t)) / used.length;
  const mw = sum(used.map((p) => p.w)) / used.length;
  const slope =
    sum(used.map((p) => (p.t - mt) * (p.w - mw))) / sum(used.map((p) => (p.t - mt) ** 2));
  const avg7 = (() => {
    const l7 = pts.filter((p) => last - p.t < 7);
    return sum(l7.map((p) => p.w)) / l7.length;
  })();
  return { ok: true, n: used.length, span, kgPerWeek: slope * 7, avg7, intercept: mw - slope * mt, mt };
}

/* Caloriecorrectie op basis van gemeten versus gepland tempo */
/* ---------------- etiket lezen ----------------
   Twee wegen naar dezelfde uitkomst: een foto die Claude analyseert, of
   etikettekst die de app zelf ontleedt. Beide vullen alleen het formulier;
   opslaan doet de gebruiker na controle. */

const LABEL_PROMPT = `Je krijgt een foto van de voedingswaardetabel op een verpakking. Geef UITSLUITEND JSON terug, zonder uitleg en zonder markdown.

{"naam": string|null, "basis": "100g"|"portie"|"beide"|"onbekend", "portieGram": number|null,
 "per100": {"kcal":number,"eiwit":number,"koolhydraten":number,"vet":number,"vezels":number}|null,
 "perPortie": {"kcal":number,"eiwit":number,"koolhydraten":number,"vet":number,"vezels":number}|null,
 "zekerheid": "hoog"|"gemiddeld"|"laag", "opmerking": string|null}

Regels:
- Alle waarden in gram, behalve kcal. Gebruik een punt als decimaalteken.
- naam: merk en productnaam zoals op de verpakking, kort. Niet verzinnen; bij twijfel null.
- Vul per100 alleen met wat de tabel in de kolom per 100 g of per 100 ml geeft.
- Staat er alleen een portiekolom, vul dan perPortie en zet portieGram op het vermelde portiegewicht in gram, anders null.
- Vezels staan op etiketten als vezels, voedingsvezel of fibre. Ontbreken ze volledig, zet 0 en meld dat in opmerking.
- Neem nooit "waarvan suikers" of "waarvan verzadigde vetzuren" als hoofdwaarde voor koolhydraten of vet.
- Is de tabel deels onleesbaar, zet zekerheid op laag en beschrijf in opmerking wat ontbreekt.`;

const blobToBase64 = (blob) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(new Error("lezen mislukt"));
    r.readAsDataURL(blob);
  });

/* Vraagt Claude om de foto te lezen. In de gepubliceerde app loopt dat via de
   sample-capability van de viewer, binnen Claude zelf via de API. */
async function readLabelWithClaude(file) {
  if (typeof window !== "undefined" && window.claude && typeof window.claude.use === "function") {
    const sample = await window.claude.use("sample");
    if (!sample) throw Object.assign(new Error("Claude is hier niet beschikbaar."), { code: "not_granted" });
    const lim = await sample.limits().catch(() => null);
    if (!lim || !lim.images) throw Object.assign(new Error("Foto's kunnen hier niet verstuurd worden."), { code: "images_unavailable" });
    return await sample.json(LABEL_PROMPT, { images: [file], modelTier: "default" });
  }
  const data = await blobToBase64(file);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: file.type || "image/jpeg", data } },
            { type: "text", text: LABEL_PROMPT },
          ],
        },
      ],
    }),
  });
  if (!r.ok) throw new Error("Analyse mislukt (" + r.status + ").");
  const d = await r.json();
  const text = (d.content || [])
    .filter((x) => x.type === "text")
    .map((x) => x.text)
    .join("\n");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

/* Ontleedt geplakte etikettekst zonder internet. Pakt per regel het eerste
   getal na het trefwoord; dat is op Europese etiketten vrijwel altijd de
   kolom per 100 g. Regels met "waarvan" worden overgeslagen. */
function parseLabelText(raw) {
  const txt = String(raw || "").toLowerCase().replace(/\u00a0/g, " ");
  const lines = txt.split(/[\n\r;|]+/).map((l) => l.trim()).filter(Boolean);
  const numAfter = (line, key) => {
    const i = line.indexOf(key);
    if (i < 0) return null;
    const m = line.slice(i + key.length).match(/(-?\d+(?:[.,]\d+)?)/);
    return m ? parseFloat(m[1].replace(",", ".")) : null;
  };
  const find = (keys, { skipWaarvan = true } = {}) => {
    for (const line of lines) {
      if (skipWaarvan && /waarvan|of which/.test(line)) continue;
      for (const k of keys) {
        if (line.includes(k)) {
          const v = numAfter(line, k);
          if (v != null) return v;
        }
      }
    }
    return null;
  };
  const kcalLine = lines.find((l) => /kcal/.test(l));
  const kcal = kcalLine ? numAfter(kcalLine.replace(/\d+\s*kj/, " "), "kcal") ?? (kcalLine.match(/(\d+(?:[.,]\d+)?)\s*kcal/) ? parseFloat(RegExp.$1.replace(",", ".")) : null) : null;
  const out = {
    kcal,
    eiwit: find(["eiwitten", "eiwit", "protein"]),
    koolhydraten: find(["koolhydraten", "koolhydraat", "carbohydrate"]),
    vet: find(["vetten", "vet", "fat"]),
    vezels: find(["voedingsvezel", "vezels", "vezel", "fibre", "fiber"]),
  };
  const portie = (() => {
    const m = txt.match(/per\s*portie[^\d]{0,12}(\d+(?:[.,]\d+)?)\s*(g|gram)/) || txt.match(/portie[^\d]{0,12}(\d+(?:[.,]\d+)?)\s*(g|gram)/);
    return m ? parseFloat(m[1].replace(",", ".")) : null;
  })();
  const per100 = /per\s*100\s*(g|ml)/.test(txt);
  const missing = ["eiwit", "koolhydraten", "vet"].filter((k) => out[k] == null);
  return { values: out, per100, portie, missing };
}

/* Etiketenergie volgens de Europese rekenregels, inclusief 2 kcal per gram
   vezels. Wijkt dit sterk af van de kcal op het etiket, dan is er iets
   misgelezen. */
const labelKcal = (v) => (v.eiwit || 0) * 4 + (v.koolhydraten || 0) * 4 + (v.vet || 0) * 9 + (v.vezels || 0) * 2;

/* ---------------- automatische piloot ----------------
   Bij de start wordt per week de fase en het tempo vastgelegd, niet de
   calorieën. Het tempo wordt uitgedrukt in procent lichaamsgewicht per week,
   zodat de app dagelijks opnieuw kan rekenen met het actuele gewicht. */
const rowRate = (r) => {
  const d = r.kcal - r.tdee;
  if (!Number.isFinite(d) || Math.abs(d) < 15) return 0;
  const perKg = d > 0 ? 5500 : 7700;
  return ((d * 7) / perKg / r.weight) * 100;
};

const snapshotPlan = (rows) =>
  rows.map((r) => ({ phase: r.phase, rate: Math.round(rowRate(r) * 1000) / 1000, note: r.note || null }));

const goalFromRate = (rate) => (rate < -0.02 ? "cut" : rate > 0.02 ? "bulk" : "onderhoud");

const DAY_MS = 86400000;
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/* Waar staat de gebruiker vandaag in zijn plan? */
function planPosition(auto, today = new Date()) {
  if (!auto || !auto.start || !Array.isArray(auto.rows) || !auto.rows.length) return { active: false };
  const start = startOfDay(new Date(auto.start + "T00:00:00"));
  if (!Number.isFinite(start.getTime())) return { active: false };
  const days = Math.floor((startOfDay(today) - start) / DAY_MS);
  if (days < 0) return { active: false, pending: true, daysToStart: -days, total: auto.rows.length };
  const week = Math.floor(days / 7);
  if (week >= auto.rows.length) return { active: false, ended: true, total: auto.rows.length };
  const row = auto.rows[week];
  // hoeveel weken zit de gebruiker al onafgebroken in deze fase
  let inPhase = 1;
  for (let k = week - 1; k >= 0 && auto.rows[k].phase === row.phase; k--) inPhase++;
  return {
    active: true,
    week,
    total: auto.rows.length,
    row,
    inPhase,
    dayInWeek: days % 7,
    weekStart: new Date(start.getTime() + week * 7 * DAY_MS),
    prev: week > 0 ? auto.rows[week - 1] : null,
    next: week + 1 < auto.rows.length ? auto.rows[week + 1] : null,
  };
}

function calorieCorrection({ trend, targetKgPerWeek, goal }) {
  if (!trend.ok) return null;
  const gap = targetKgPerWeek - trend.kgPerWeek; // positief = we verliezen te snel
  const energyPerKg = goal === "bulk" ? 5500 : 7700;
  const perDay = (gap * energyPerKg) / 7;
  const rounded = Math.round(perDay / 50) * 50;
  return { gap, perDay, rounded, meaningful: Math.abs(rounded) >= 100 };
}

function recommendedProtein({ weight, bodyFat, useBodyFat, goal }) {
  if (useBodyFat && bodyFat >= 4 && bodyFat <= 60) {
    const lbm = weight * (1 - bodyFat / 100);
    const f = goal === "cut" ? 2.6 : goal === "bulk" ? 2.2 : 2.3;
    return (lbm * f) / weight;
  }
  return goal === "cut" ? 2.2 : goal === "bulk" ? 1.8 : 1.9;
}

/* fatGrams: als gezet, ligt vet vast in grammen en vangen koolhydraten elke
   verhoging of verlaging op. Nooit onder de ondergrens per kg, en nooit
   boven 35 procent van de dagcalorieën, zodat er in een diepe cut ruimte
   blijft voor koolhydraten en training. */
function calcMacros({ weight, kcal, proteinPerKg, fatPercent, fatGrams, minFatPerKg = 0.6 }) {
  kcal = Math.max(400, num(kcal, 2000));
  const protein = Math.max(0, num(proteinPerKg, 1.8)) * weight;
  let fat =
    fatGrams != null && fatGrams > 0
      ? Math.max(minFatPerKg * weight, Math.min(fatGrams, (0.35 * kcal) / 9))
      : Math.max(((Math.min(60, Math.max(10, num(fatPercent, 25))) / 100) * kcal) / 9, minFatPerKg * weight);
  let carbKcal = kcal - protein * 4 - fat * 9;
  if (carbKcal < 0) {
    fat = Math.max(minFatPerKg * weight, (kcal - protein * 4) / 9);
    carbKcal = Math.max(0, kcal - protein * 4 - fat * 9);
  }
  const carbs = carbKcal / 4;
  return { protein, fat, carbs, kcal: protein * 4 + fat * 9 + carbs * 4 };
}

const W_CARB = { pre: 1.6, post: 1.9, normaal: 1.0 };
const W_FAT = { pre: 0.35, post: 0.45, normaal: 1.0 };
const W_PRO = { pre: 1.0, post: 1.15, normaal: 1.0 };

function planMealTimes({ wake, sleep, mealCount, training }) {
  const wakeMin = toMin(wake);
  let sleepMin = toMin(sleep);
  if (sleepMin <= wakeMin) sleepMin += 1440;

  const n = Math.max(2, Math.min(7, Math.round(num(mealCount, 4))));
  const first = wakeMin + 45;
  let last = sleepMin - 60;
  const notes = [];

  let tStart = null;
  let tEnd = null;
  if (training) {
    tStart = toMin(training.start);
    if (tStart < wakeMin) tStart += 1440;
    tEnd = tStart + Math.max(5, num(training.minutes, 60));
    if (tEnd + 45 > last) last = Math.min(sleepMin - 20, tEnd + 45);
  }

  const times = [];
  for (let k = 0; k < n; k++) times.push(first + ((last - first) * k) / (n - 1));
  const labels = new Array(n).fill("normaal");
  const fixed = new Set();

  if (training) {
    const preTarget = tStart - 90;
    const postTarget = tEnd + 30;
    const allowPre = n >= 3;
    const preCand = times.map((_, k) => k).filter((k) => times[k] <= tStart - 20);

    if (allowPre && preTarget >= first - 25 && preCand.length) {
      const best = preCand.reduce((a, b) =>
        Math.abs(times[a] - preTarget) <= Math.abs(times[b] - preTarget) ? a : b
      );
      times[best] = Math.max(first, Math.min(preTarget, tStart - 30));
      labels[best] = "pre";
      fixed.add(best);
    } else if (allowPre) {
      notes.push(
        "De training begint te kort na het opstaan voor een volwaardige maaltijd vooraf. Neem 20 tot 30 g snel eiwit en 20 tot 40 g koolhydraten vlak voor of tijdens de sessie, en trek dat af van de eerste maaltijd erna."
      );
    }

    const postCand = times.map((_, k) => k).filter((k) => !fixed.has(k));
    if (postCand.length) {
      const best = postCand.reduce((a, b) =>
        Math.abs(times[a] - postTarget) <= Math.abs(times[b] - postTarget) ? a : b
      );
      times[best] = Math.max(tEnd + 15, Math.min(postTarget, sleepMin - 20));
      labels[best] = "post";
      fixed.add(best);
    }
  }

  const anchors = [...fixed].sort((a, b) => a - b);
  let segStart = -1;
  for (const nextIdx of [...anchors, n]) {
    const k = nextIdx - segStart - 1;
    if (k > 0) {
      const prevT = segStart < 0 ? null : times[segStart];
      const nextT = nextIdx >= n ? null : times[nextIdx];
      for (let j = 0; j < k; j++) {
        const idx = segStart + 1 + j;
        if (prevT === null && nextT === null)
          times[idx] = first + ((last - first) * j) / Math.max(1, k - 1);
        else if (prevT === null) times[idx] = first + ((nextT - first) * j) / k;
        else if (nextT === null) times[idx] = prevT + ((last - prevT) * (j + 1)) / k;
        else times[idx] = prevT + ((nextT - prevT) * (j + 1)) / (k + 1);
      }
    }
    segStart = nextIdx;
  }

  const meals = times.map((t, k) => ({ time: t, label: labels[k] })).sort((a, b) => a.time - b.time);

  let tight = false;
  let wide = 0;
  for (let k = 1; k < meals.length; k++) {
    const gap = meals[k].time - meals[k - 1].time;
    if (gap < 70) tight = true;
    if (gap > 360) wide = Math.max(wide, gap);
  }
  if (tight)
    notes.push(
      "Twee maaltijden vallen dicht op elkaar. Verlaag het aantal maaltijden of verschuif de trainingstijd voor een gelijkmatiger spreiding."
    );
  if (wide)
    notes.push(
      `Er zit ongeveer ${Math.round(wide / 60)} uur tussen twee maaltijden. Werkbaar, maar een maaltijd extra maakt de eiwitinname gelijkmatiger.`
    );

  return { meals, notes, train: training ? { start: tStart, end: tEnd } : null };
}

/* opts.late: index van een maaltijd vlak voor bedtijd. Die krijgt de helft
   van het vet en een vijfde minder koolhydraten, en iets meer eiwit. Vet
   vertraagt de maaglediging en vergroot de kans op reflux in liggende
   houding; een eiwitrijke, lichte snack verstoort de slaap niet. */
/* opts.hungry: index van de maaltijd waar de gebruiker de meeste honger
   heeft. Die krijgt structureel een groter deel van koolhydraten en vet.
   opts.surplusCarbs: grammen koolhydraten boven het onderhoudsniveau; daarvan
   gaat 70 procent rechtstreeks naar de hongerigste maaltijd, zodat een
   verhoging voelbaar op één moment landt in plaats van over alles verspreid. */
function distributeMacros(meals, macros, opts = {}) {
  const late = opts.late;
  const hungry = opts.hungry;
  const LATE = { p: 1.15, c: 0.8, f: 0.5 };
  const HUNGRY = { p: 1.1, c: 1.4, f: 1.2 };
  const routed = hungry != null && opts.surplusCarbs > 0 ? Math.min(opts.surplusCarbs * 0.7, macros.carbs * 0.45) : 0;
  macros = { ...macros, carbs: macros.carbs - routed };
  const wOf = (W, k) => (m, i) => W[m.label] * (i === late ? LATE[k] : 1) * (i === hungry ? HUNGRY[k] : 1);
  const wp = wOf(W_PRO, "p");
  const wc = wOf(W_CARB, "c");
  const wf = wOf(W_FAT, "f");
  const sP = meals.reduce((s, m, i) => s + wp(m, i), 0);
  const sC = meals.reduce((s, m, i) => s + wc(m, i), 0);
  const sF = meals.reduce((s, m, i) => s + wf(m, i), 0);
  const raw = meals.map((m, i) => ({
    ...m,
    protein: (macros.protein * wp(m, i)) / sP,
    carbs: (macros.carbs * wc(m, i)) / sC,
    fat: (macros.fat * wf(m, i)) / sF,
    late: i === late,
    hungry: i === hungry,
  }));
  if (routed > 0) raw[hungry].carbs += routed;
  macros = { ...macros, carbs: macros.carbs + routed };
  for (const key of ["protein", "carbs", "fat"]) {
    const rounded = raw.map((m) => Math.round(m[key]));
    const diff = Math.round(macros[key]) - rounded.reduce((a, b) => a + b, 0);
    let idx = 0;
    raw.forEach((m, k) => {
      if (m[key] > raw[idx][key]) idx = k;
    });
    rounded[idx] += diff;
    raw.forEach((m, k) => {
      m[key] = Math.max(0, rounded[k]);
    });
  }
  return raw.map((m) => ({ ...m, kcal: m.protein * 4 + m.carbs * 4 + m.fat * 9 }));
}

function buildWarnings({ f, energy, macros, meals }) {
  const w = [];
  if (energy.capped)
    w.push(
      "Het gewenste tempo is begrensd. Een tekort boven circa 25 procent van de dagbehoefte gaat structureel ten koste van spiermassa en trainingskwaliteit."
    );
  if (energy.restDayKcal < energy.bmr)
    w.push("De rustdag zakt onder het rustmetabolisme. Verlaag het tempo of zet de koolhydraatcycling uit.");
  if (macros.fat / f.weight < 0.55)
    w.push(
      "Vet zit onder 0,55 g per kg lichaamsgewicht. Dat is de praktische ondergrens voor hormoonhuishouding en opname van vetoplosbare vitamines."
    );
  if (macros.carbs / f.weight < 2 && f.sessionsPerWeek >= 4)
    w.push(
      "Koolhydraten zitten onder 2 g per kg bij vier of meer sessies per week. Reken op verlies van trainingsvolume."
    );
  const minPerMeal = 0.35 * f.weight;
  if (meals.some((m) => m.protein < minPerMeal))
    w.push(
      `Minstens een maaltijd blijft onder ${Math.round(
        minPerMeal
      )} g eiwit, de drempel voor een volledige spiereiwitsynthese-respons. Overweeg een maaltijd minder.`
    );
  return w;
}

/* ------------------- portievertaling -------------------
   Voedingswaarden per 100 g, afgeronde standaardwaarden (NEVO / USDA FoodData Central).
   Vlees, vis, granen, peulvruchten en groenten zijn opgegeven als bereid product,
   tenzij "droog" of "rauw" in de naam staat. Merkproducten wijken af: gebruik
   "Eigen producten" om uw eigen etiketwaarden vast te leggen. */

const FOODS = {
  protein: [
    { id: "kip", label: "Kipfilet, bereid", p: 31, c: 0, f: 3.6, fib: 0, step: 10 },
    { id: "kipdij", label: "Kipdijfilet, bereid", p: 24, c: 0, f: 11, fib: 0, step: 10 },
    { id: "kalkoen", label: "Kalkoenfilet, bereid", p: 29, c: 0, f: 2, fib: 0, step: 10 },
    { id: "rund", label: "Mager rundvlees, bereid", p: 30, c: 0, f: 6, fib: 0, step: 10 },
    { id: "gehakt", label: "Rundergehakt 5% vet, bereid", p: 26, c: 0, f: 8, fib: 0, step: 10 },
    { id: "gehakt15", label: "Rundergehakt 15% vet, bereid", p: 24, c: 0, f: 15, fib: 0, step: 10 },
    { id: "varkenshaas", label: "Varkenshaas, bereid", p: 28, c: 0, f: 4, fib: 0, step: 10 },
    { id: "vleeswaren", label: "Kipfilet, vleeswaren", p: 20, c: 1, f: 2, fib: 0, step: 10 },
    { id: "kabeljauw", label: "Witvis, bereid", p: 20, c: 0, f: 0.8, fib: 0, step: 10 },
    { id: "zalm", label: "Zalm, bereid", p: 20, c: 0, f: 13, fib: 0, step: 10 },
    { id: "makreel", label: "Makreel", p: 19, c: 0, f: 16, fib: 0, step: 10 },
    { id: "haring", label: "Haring", p: 18, c: 0, f: 15, fib: 0, step: 10 },
    { id: "tonijn", label: "Tonijn in water, uitgelekt", p: 25, c: 0, f: 1, fib: 0, step: 10 },
    { id: "garnaal", label: "Garnalen, gekookt", p: 24, c: 0, f: 1, fib: 0, step: 10 },
    { id: "kwark", label: "Magere kwark", p: 10, c: 4, f: 0.3, fib: 0, step: 25 },
    { id: "kwark20", label: "Halfvolle kwark", p: 9, c: 4, f: 2.5, fib: 0, step: 25 },
    { id: "skyr", label: "Skyr", p: 11, c: 4, f: 0.2, fib: 0, step: 25 },
    { id: "hutten", label: "Hüttenkäse", p: 11, c: 3, f: 4, fib: 0, step: 25 },
    { id: "yoghurt", label: "Griekse yoghurt 2%", p: 9, c: 4, f: 2, fib: 0, step: 25 },
    { id: "melk", label: "Magere melk", p: 3.5, c: 4.8, f: 0.1, fib: 0, step: 25 },
    { id: "melk15", label: "Halfvolle melk", p: 3.5, c: 4.7, f: 1.5, fib: 0, step: 25 },
    { id: "sojadrink", label: "Sojadrink, ongezoet", p: 3.3, c: 0.8, f: 1.8, fib: 0.6, step: 25 },
    { id: "ei", label: "Ei", p: 13, c: 1, f: 10, fib: 0, unitGrams: 50, unitLabel: "ei", unitPlural: "eieren" },
    { id: "eiwit", label: "Eiwit van ei", p: 11, c: 0.7, f: 0.2, fib: 0, unitGrams: 33, unitLabel: "eiwit", unitPlural: "eiwitten" },
    { id: "whey", label: "Wheypoeder", p: 80, c: 6, f: 6, fib: 0, step: 5 },
    { id: "caseine", label: "Caseïnepoeder", p: 78, c: 5, f: 2, fib: 0, step: 5 },
    { id: "kaas20", label: "Magere kaas 20+", p: 31, c: 0, f: 13, fib: 0, step: 10 },
    { id: "mozzarella", label: "Mozzarella", p: 22, c: 1, f: 17, fib: 0, step: 10 },
    { id: "tofu", label: "Tofu", p: 13, c: 2, f: 7, fib: 1.0, step: 10 },
    { id: "tempeh", label: "Tempeh", p: 19, c: 9, f: 11, fib: 6, step: 10 },
    { id: "seitan", label: "Seitan", p: 24, c: 6, f: 1.5, fib: 0.6, step: 10 },
    { id: "sojabrok", label: "Sojabrokken, droog", p: 52, c: 18, f: 1, fib: 17, step: 10 },
    { id: "peulvrucht", label: "Linzen, gekookt", p: 9, c: 20, f: 0.4, fib: 7.9, step: 10 },
    { id: "kikkererwt", label: "Kikkererwten, gekookt", p: 9, c: 18, f: 2.6, fib: 7.6, step: 10 },
    { id: "zwartebonen", label: "Zwarte bonen, gekookt", p: 9, c: 20, f: 0.5, fib: 8.7, step: 10 },
  ],
  carb: [
    { id: "rijst", label: "Witte rijst, gekookt", p: 2.7, c: 28, f: 0.3, fib: 0.4, step: 10 },
    { id: "zilvervlies", label: "Zilvervliesrijst, gekookt", p: 2.7, c: 26, f: 1, fib: 1.8, step: 10 },
    { id: "rijstdroog", label: "Witte rijst, droog", p: 7, c: 79, f: 0.7, fib: 1.3, step: 5 },
    { id: "pasta", label: "Pasta, gekookt", p: 6, c: 31, f: 0.9, fib: 1.8, step: 10 },
    { id: "pastavk", label: "Volkorenpasta, gekookt", p: 6.5, c: 27, f: 1, fib: 4.5, step: 10 },
    { id: "pastadroog", label: "Pasta, droog", p: 12, c: 71, f: 1.5, fib: 3.0, step: 5 },
    { id: "noedels", label: "Noedels, gekookt", p: 5, c: 25, f: 1, fib: 1.2, step: 10 },
    { id: "aardappel", label: "Aardappel, gekookt", p: 2, c: 20, f: 0.1, fib: 1.8, step: 10 },
    { id: "zoeteaardappel", label: "Zoete aardappel, gekookt", p: 2, c: 21, f: 0.1, fib: 3.0, step: 10 },
    { id: "couscous", label: "Couscous, gekookt", p: 3.8, c: 23, f: 0.2, fib: 1.4, step: 10 },
    { id: "quinoa", label: "Quinoa, gekookt", p: 4.4, c: 21, f: 1.9, fib: 2.8, step: 10 },
    { id: "bulgur", label: "Bulgur, gekookt", p: 3, c: 19, f: 0.2, fib: 4.5, step: 10 },
    { id: "havermout", label: "Havermout, droog", p: 13, c: 60, f: 7, fib: 10, step: 5 },
    { id: "muesli", label: "Muesli of cruesli", p: 10, c: 62, f: 8, fib: 8, step: 5 },
    { id: "cornflakes", label: "Cornflakes", p: 7, c: 84, f: 1, fib: 3.3, step: 5 },
    { id: "brood", label: "Volkorenbrood", p: 9, c: 41, f: 3, fib: 6.5, unitGrams: 35, unitLabel: "snee", unitPlural: "sneetjes" },
    { id: "witbrood", label: "Witbrood", p: 8, c: 49, f: 2.5, fib: 2.7, unitGrams: 35, unitLabel: "snee", unitPlural: "sneetjes" },
    { id: "wrap", label: "Wrap of tortilla", p: 8, c: 50, f: 7, fib: 3.0, unitGrams: 45, unitLabel: "wrap", unitPlural: "wraps" },
    { id: "pita", label: "Pitabrood", p: 9, c: 50, f: 1.5, fib: 2.2, unitGrams: 60, unitLabel: "pita", unitPlural: "pitabroodjes" },
    { id: "rijstwafel", label: "Rijstwafel", p: 8, c: 81, f: 3, fib: 3.5, unitGrams: 7, unitLabel: "rijstwafel", unitPlural: "rijstwafels" },
    { id: "ontbijtkoek", label: "Ontbijtkoek", p: 4, c: 70, f: 1, fib: 3.5, unitGrams: 25, unitLabel: "plak", unitPlural: "plakken" },
    { id: "banaan", label: "Banaan", p: 1.1, c: 23, f: 0.3, fib: 2.6, unitGrams: 120, unitLabel: "banaan", unitPlural: "bananen" },
    { id: "appel", label: "Appel", p: 0.3, c: 12, f: 0.2, fib: 2.4, unitGrams: 150, unitLabel: "appel", unitPlural: "appels" },
    { id: "sinaasappel", label: "Sinaasappel", p: 1, c: 9, f: 0.1, fib: 2.4, unitGrams: 130, unitLabel: "sinaasappel", unitPlural: "sinaasappels" },
    { id: "bessen", label: "Blauwe bessen", p: 0.7, c: 10, f: 0.3, fib: 2.4, step: 25 },
    { id: "rozijn", label: "Rozijnen", p: 3, c: 66, f: 0.5, fib: 3.7, step: 10 },
    { id: "dadel", label: "Dadels", p: 2.5, c: 63, f: 0.4, fib: 7, step: 10 },
    { id: "honing", label: "Honing", p: 0.3, c: 82, f: 0, fib: 0, step: 5 },
    { id: "mais", label: "Mais, gekookt", p: 3.3, c: 19, f: 1.3, fib: 2.4, step: 10 },
    { id: "erwten", label: "Doperwten, gekookt", p: 5, c: 9, f: 0.4, fib: 5.5, step: 10 },
    { id: "sportdrank", label: "Sportdrank of dextrose", p: 0, c: 95, f: 0, fib: 0, step: 5 },
  ],
  fat: [
    { id: "olijfolie", label: "Olijfolie", p: 0, c: 0, f: 100, fib: 0, step: 5 },
    { id: "zonnebloemolie", label: "Zonnebloemolie", p: 0, c: 0, f: 100, fib: 0, step: 5 },
    { id: "kokosolie", label: "Kokosolie", p: 0, c: 0, f: 100, fib: 0, step: 5 },
    { id: "boter", label: "Roomboter", p: 0.9, c: 0, f: 81, fib: 0, step: 5 },
    { id: "mayo", label: "Mayonaise", p: 1, c: 2, f: 75, fib: 0, step: 5 },
    { id: "amandel", label: "Amandelen", p: 21, c: 22, f: 50, fib: 12.5, step: 5 },
    { id: "walnoot", label: "Walnoten", p: 15, c: 14, f: 65, fib: 6.7, step: 5 },
    { id: "cashew", label: "Cashewnoten", p: 18, c: 30, f: 44, fib: 3.3, step: 5 },
    { id: "pinda", label: "Pinda's", p: 26, c: 16, f: 49, fib: 8.5, step: 5 },
    { id: "pindakaas", label: "Pindakaas", p: 25, c: 20, f: 50, fib: 6, step: 5 },
    { id: "tahin", label: "Tahin", p: 17, c: 21, f: 54, fib: 9.3, step: 5 },
    { id: "lijnzaad", label: "Lijnzaad", p: 18, c: 29, f: 42, fib: 27, step: 5 },
    { id: "chia", label: "Chiazaad", p: 17, c: 42, f: 31, fib: 34, step: 5 },
    { id: "avocado", label: "Avocado", p: 2, c: 9, f: 15, fib: 6.7, step: 10 },
    { id: "olijven", label: "Olijven", p: 1, c: 3, f: 15, fib: 3.3, step: 10 },
    { id: "kaas", label: "Kaas 30+", p: 26, c: 0, f: 25, fib: 0, step: 10 },
    { id: "kaas48", label: "Kaas 48+", p: 25, c: 0, f: 32, fib: 0, step: 10 },
    { id: "roomkaas", label: "Roomkaas", p: 6, c: 4, f: 25, fib: 0, step: 10 },
    { id: "slagroom", label: "Slagroom", p: 2, c: 3, f: 35, fib: 0, step: 10 },
    { id: "chocolade", label: "Pure chocolade 85%", p: 10, c: 19, f: 50, fib: 11, step: 5 },
  ],
  overig: [
    { id: "broccoli", label: "Broccoli, gekookt", p: 3, c: 4, f: 0.4, fib: 3.3, step: 25 },
    { id: "spinazie", label: "Spinazie", p: 3, c: 1, f: 0.4, fib: 2.2, step: 25 },
    { id: "sperzieboon", label: "Sperziebonen", p: 1.8, c: 5, f: 0.2, fib: 3.2, step: 25 },
    { id: "courgette", label: "Courgette", p: 1.2, c: 3, f: 0.3, fib: 1.0, step: 25 },
    { id: "paprika", label: "Paprika", p: 1, c: 6, f: 0.3, fib: 2.1, step: 25 },
    { id: "tomaat", label: "Tomaat", p: 0.9, c: 3, f: 0.2, fib: 1.2, step: 25 },
    { id: "komkommer", label: "Komkommer", p: 0.7, c: 2, f: 0.1, fib: 0.5, step: 25 },
    { id: "wortel", label: "Wortel", p: 0.9, c: 8, f: 0.2, fib: 2.8, step: 25 },
    { id: "champignon", label: "Champignons", p: 3, c: 1, f: 0.3, fib: 1.0, step: 25 },
    { id: "ui", label: "Ui", p: 1.2, c: 8, f: 0.1, fib: 1.7, step: 10 },
    { id: "passata", label: "Tomatenblokjes of passata", p: 1.5, c: 6, f: 0.3, fib: 1.5, step: 25 },
    { id: "ketchup", label: "Ketchup", p: 1, c: 25, f: 0.1, fib: 0.3, step: 5 },
    { id: "sojasaus", label: "Sojasaus", p: 8, c: 5, f: 0, fib: 0.8, step: 5 },
  ],
};

const VEG = { id: "groente", label: "Groente, gemengd", p: 2, c: 4, f: 0.3, fib: 2.5 };

const BASE_INDEX = Object.fromEntries([
  ...Object.entries(FOODS).flatMap(([cat, arr]) => arr.map((x) => [x.id, { ...x, cat }])),
  ["groente", { ...VEG, cat: "veg", step: 25 }],
]);

/* Eigen producten van de gebruiker worden over de standaardtabel heen gelegd. */
const buildIndex = (custom) =>
  Object.fromEntries([
    ...Object.entries(BASE_INDEX),
    ...(custom || []).map((c) => [c.id, { ...c, cat: c.cat || "protein", step: c.unitGrams ? undefined : c.step || 5 }]),
  ]);

const TOL = { p: 5, c: 10, f: 6 };
const PRIO = { p: 2, c: 1, f: 1 };

function solveLS(A, b, w, lambda) {
  const n = A[0].length;
  const M = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i][j] = A.reduce((s, row, r) => s + w[r] * row[i] * row[j], 0) + (i === j ? lambda : 0);
    M[i][n] = A.reduce((s, row, r) => s + w[r] * row[i] * b[r], 0);
  }
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    if (Math.abs(M[piv][i]) < 1e-12) return null;
    [M[i], M[piv]] = [M[piv], M[i]];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const k = M[r][i] / M[i][i];
      for (let c = i; c <= n; c++) M[r][c] -= k * M[i][c];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

/* Verdeelt een macrodoel over willekeurig veel bronnen.
   Bij meer dan drie bronnen is het stelsel onderbepaald; een kleine
   regularisatie zorgt dan voor een stabiele verdeling over alle bronnen. */
function solvePortions(target, items, proteinPrio = PRIO.p) {
  const n = items.length;
  if (!n) return [];
  const w = [proteinPrio / TOL.p ** 2, PRIO.c / TOL.c ** 2, PRIO.f / TOL.f ** 2];
  const rows = [items.map((i) => i.p / 100), items.map((i) => i.c / 100), items.map((i) => i.f / 100)];
  const b = [target.p, target.c, target.f];
  const lambda = n > 3 ? 2e-4 : 0;

  let best = null;
  const limit = 1 << Math.min(n, 8);
  for (let mask = 1; mask < limit; mask++) {
    const idx = [];
    for (let i = 0; i < Math.min(n, 8); i++) if (mask & (1 << i)) idx.push(i);
    const A = rows.map((r) => idx.map((i) => r[i]));
    const x = solveLS(A, b, w, lambda);
    if (!x || x.some((v) => v < -1e-6 || !isFinite(v))) continue;
    const full = new Array(n).fill(0);
    idx.forEach((i, k) => (full[i] = Math.max(0, x[k])));
    const err =
      rows.reduce((s, r, k) => {
        const got = r.reduce((a, v, i) => a + v * full[i], 0);
        return s + w[k] * (got - b[k]) ** 2;
      }, 0) +
      (n > 3 ? 1e-6 * (n - idx.length) : 0);
    if (!best || err < best.err) best = { x: full, err };
  }
  return best ? best.x : new Array(n).fill(0);
}

const fmt = (it, grams) => {
  if (it.unitGrams) {
    const u = grams / it.unitGrams;
    const r = Math.round(u * 10) / 10;
    return `${r} ${r === 1 ? it.unitLabel : it.unitPlural} (${Math.round(grams)} g)`;
  }
  return `${Math.round(grams)} g ${it.label.toLowerCase()}`;
};

/* Zoekt ruilbare porties: welke andere bron uit dezelfde categorie levert,
   in de juiste hoeveelheid, vrijwel dezelfde macro's als deze portie?
   De afwijking wordt in kilocalorieën uitgedrukt, zodat een tekort aan vet
   even zwaar telt als het energetisch is. Alleen voorstellen die binnen
   ongeveer 15 procent van de portie blijven, komen door de zeef. */
function alternativesFor(foodId, grams, index = BASE_INDEX, count = 2) {
  const src = index[foodId];
  if (!src || !(grams > 0) || src.cat === "veg") return [];
  const target = { p: (src.p * grams) / 100, c: (src.c * grams) / 100, f: (src.f * grams) / 100 };
  const kcal = target.p * 4 + target.c * 4 + target.f * 9;
  if (kcal < 40) return [];
  const w = [PRIO.p / TOL.p ** 2, PRIO.c / TOL.c ** 2, PRIO.f / TOL.f ** 2];
  const out = [];
  Object.values(index).forEach((x) => {
    if (x.id === src.id || x.cat !== src.cat) return;
    const a = { p: x.p / 100, c: x.c / 100, f: x.f / 100 };
    const den = w[0] * a.p ** 2 + w[1] * a.c ** 2 + w[2] * a.f ** 2;
    if (!(den > 0)) return;
    const num = w[0] * target.p * a.p + w[1] * target.c * a.c + w[2] * target.f * a.f;
    const step = x.unitGrams || x.step || 5;
    const g = Math.max(step, Math.round(num / den / step) * step);
    if (g > 800) return;
    const err =
      Math.abs((x.p * g) / 100 - target.p) * 4 +
      Math.abs((x.c * g) / 100 - target.c) * 4 +
      Math.abs((x.f * g) / 100 - target.f) * 9;
    if (err / kcal > 0.15) return;
    out.push({
      food: x.id,
      grams: g,
      err,
      text: x.unitGrams
        ? `${Math.round(g / x.unitGrams)} ${Math.round(g / x.unitGrams) === 1 ? x.unitLabel : x.unitPlural}${
            x.label.toLowerCase() === x.unitLabel.toLowerCase() ? "" : " " + x.label.toLowerCase()
          }`
        : `${g} g ${x.label.toLowerCase()}`,
    });
  });
  return out.sort((a, b) => a.err - b.err).slice(0, count);
}

/* Schaalt een vaste samenstelling als geheel naar een macrodoel. Eén factor
   over alle ingrediënten, zodat de verhoudingen van het recept intact blijven. */
function scaleItems(items, target, index = BASE_INDEX) {
  const list = items.filter((it) => index[it.food]).map((it) => ({ ...index[it.food], food: it.food, grams: Math.max(0, Number(it.grams) || 0) }));
  if (!list.length) return items;
  const a = list.reduce(
    (acc, x) => ({ p: acc.p + (x.p * x.grams) / 100, c: acc.c + (x.c * x.grams) / 100, f: acc.f + (x.f * x.grams) / 100 }),
    { p: 0, c: 0, f: 0 }
  );
  /* Schaal op de beperkendste macro, zodat een bewaarde maaltijd nooit over
     het doel heen gaat. Wat overblijft vult de gebruiker aan met losse
     bronnen; dat is voorspelbaarder dan een kleinste-kwadratenpassing die
     op een van de drie fors overschiet. Macro's die het recept nauwelijks
     levert, tellen niet mee als beperking. */
  const ratios = [
    a.p >= 2 ? target.p / a.p : null,
    a.c >= 2 ? target.c / a.c : null,
    a.f >= 2 ? target.f / a.f : null,
  ].filter((x) => x != null && isFinite(x) && x > 0);
  const k = ratios.length ? Math.min(3, Math.max(0.2, Math.min(...ratios))) : 1;
  return list.map((x) => {
    const step = x.unitGrams || x.step || 5;
    return { food: x.food, grams: Math.max(0, Math.round((x.grams * k) / step) * step) };
  });
}

/* items: [{ food: id, grams: number | null }]  null betekent: door de app invullen */
function buildMealPortions({ target, items, veg, index = BASE_INDEX }) {
  const list = items
    .filter((it) => index[it.food])
    .map((it) => ({ ...index[it.food], food: it.food, fixed: it.grams != null, grams: it.grams == null ? 0 : Math.max(0, Number(it.grams)) }));
  if (veg > 0) list.push({ ...index.groente, food: "groente", fixed: true, grams: veg, auto: true });

  const contrib = (arr) =>
    arr.reduce(
      (a, x) => ({
        p: a.p + (x.p * x.grams) / 100,
        c: a.c + (x.c * x.grams) / 100,
        f: a.f + (x.f * x.grams) / 100,
        fib: a.fib + ((x.fib || 0) * x.grams) / 100,
      }),
      { p: 0, c: 0, f: 0, fib: 0 }
    );

  const fixedPart = contrib(list.filter((x) => x.fixed));
  const rest = {
    p: Math.max(0, target.p - fixedPart.p),
    c: Math.max(0, target.c - fixedPart.c),
    f: Math.max(0, target.f - fixedPart.f),
  };

  const auto = list.filter((x) => !x.fixed);

  const fill = (prio) => {
    const g = solvePortions(rest, auto, prio);
    const out = auto.map((x, i) => ({ x, grams: g[i] }));
    const unit = out.filter((o) => o.x.unitGrams);
    unit.forEach((o) => (o.grams = Math.max(0, Math.round(o.grams / o.x.unitGrams) * o.x.unitGrams)));
    const remaining = out.filter((o) => !o.x.unitGrams);
    if (unit.length && remaining.length) {
      const used = contrib([
        ...list.filter((x) => x.fixed),
        ...unit.map((o) => ({ ...o.x, grams: o.grams })),
      ]);
      const rest2 = {
        p: Math.max(0, target.p - used.p),
        c: Math.max(0, target.c - used.c),
        f: Math.max(0, target.f - used.f),
      };
      const g2 = solvePortions(rest2, remaining.map((o) => o.x), prio);
      remaining.forEach((o, i) => (o.grams = g2[i]));
    }
    remaining.forEach((o) => {
      const step = o.x.step || 5;
      o.grams = Math.max(0, Math.round(o.grams / step) * step);
    });
    return out.map((o) => o.grams);
  };

  if (auto.length) {
    let g = fill(PRIO.p);
    // Leveren de vaste bronnen al meer eiwit dan nodig, dan knijpt de eerste
    // ronde de overige bronnen dicht. In dat geval telt eiwit lichter mee,
    // zodat koolhydraten en vet wel op peil komen.
    auto.forEach((x, i) => (x.grams = g[i]));
    const p1 = contrib(list).p;
    if (p1 > target.p + 3) {
      g = fill(0.4);
      auto.forEach((x, i) => (x.grams = g[i]));
    }
  }

  const actual = contrib(list);
  actual.kcal = actual.p * 4 + actual.c * 4 + actual.f * 9;
  const gap = { p: target.p - actual.p, c: target.c - actual.c, f: target.f - actual.f };
  return {
    portions: list.map((x) => ({ ...x, text: fmt(x, x.grams) })),
    actual,
    gap,
  };
}

/* ----------------------------- constanten ----------------------------- */

const ACTIVITY = [
  { id: "zittend", label: "Zittend werk, weinig beweging", factor: 1.2 },
  { id: "licht", label: "Zittend werk, dagelijks wandelen", factor: 1.35 },
  { id: "actief", label: "Staand of lopend werk", factor: 1.5 },
  { id: "zwaar", label: "Fysiek zwaar werk", factor: 1.65 },
];

const SESSIONS = [
  { id: "kracht", label: "Krachttraining, zware sets", met: 5.0 },
  { id: "volume", label: "Bodybuilding, hoog volume", met: 6.0 },
  { id: "hiit", label: "HIIT of conditioning", met: 8.5 },
  { id: "duur", label: "Duurtraining", met: 9.0 },
];

const RATES = {
  cut: [
    { v: -0.25, label: "0,25 %/wk behoudend" },
    { v: -0.5, label: "0,5 %/wk standaard" },
    { v: -0.75, label: "0,75 %/wk stevig" },
    { v: -1.0, label: "1 %/wk agressief" },
  ],
  bulk: [
    { v: 0.125, label: "0,125 %/wk gevorderd" },
    { v: 0.25, label: "0,25 %/wk standaard" },
    { v: 0.5, label: "0,5 %/wk snel" },
  ],
  onderhoud: [{ v: 0, label: "Gewicht stabiel" }],
};

/* ------------------- micronutriënten en hormonen -------------------
   Dagrichtlijnen: Gezondheidsraad voedingsnormen en EFSA Dietary Reference
   Values voor volwassenen van 19 tot 50 jaar. */

const MICROS = [
  {
    id: "vitd",
    name: "Vitamine D",
    m: "10 µg",
    v: "10 µg",
    src: "Vette vis, eigeel, margarine, supplement",
    why: {
      man: "Een tekort gaat samen met een lager testosteronniveau. Aanvullen helpt alleen als u werkelijk tekortkomt.",
      vrouw: "Nodig voor calciumopname en botdichtheid, extra belangrijk bij een onregelmatige cyclus.",
    },
    note: "Van oktober tot april maakt de huid in Nederland vrijwel geen vitamine D aan.",
  },
  {
    id: "zink",
    name: "Zink",
    m: "9 tot 14 mg",
    v: "7 tot 11 mg",
    src: "Rundvlees, schaaldieren, kaas, noten, volkoren",
    why: {
      man: "Betrokken bij de testosteronsynthese. Een tekort verlaagt de spiegel aantoonbaar, meer dan de norm doet niets extra.",
      vrouw: "Nodig voor immuunfunctie, herstel en een regelmatige cyclus.",
    },
    note: "Fytaat uit volkoren en peulvruchten remt de opname; de hogere waarde geldt bij veel plantaardig eten.",
  },
  {
    id: "mg",
    name: "Magnesium",
    m: "350 mg",
    v: "300 mg",
    src: "Volkoren, noten, peulvruchten, groene groenten, pure chocolade",
    why: {
      man: "Ondersteunt slaapkwaliteit en spierfunctie; verlies via zweet loopt op bij veel trainen.",
      vrouw: "Ondersteunt slaapkwaliteit en spierfunctie; verlies via zweet loopt op bij veel trainen.",
    },
  },
  {
    id: "ijzer",
    name: "IJzer",
    m: "11 mg",
    v: "16 mg",
    src: "Rood vlees, peulvruchten, volkoren, groene groenten met vitamine C",
    why: {
      man: "Zelden een tekort. Suppleer niet zonder bloedwaarde, want ijzerstapeling is schadelijk.",
      vrouw: "Menstrueel verlies in combinatie met duurtraining is het meest voorkomende tekort bij sportende vrouwen.",
    },
    note: "Thee en koffie bij de maaltijd remmen de opname van plantaardig ijzer.",
  },
  {
    id: "ca",
    name: "Calcium",
    m: "950 mg",
    v: "950 mg",
    src: "Zuivel, kwark, kaas, verrijkte plantaardige dranken, groene groenten",
    why: {
      man: "Botdichtheid onder zware belasting.",
      vrouw: "Botdichtheid, en cruciaal wanneer de oestrogeenspiegel laag is of de menstruatie wegblijft.",
    },
  },
  {
    id: "jood",
    name: "Jodium",
    m: "150 µg",
    v: "150 µg",
    src: "Brood met jodiumhoudend zout, zuivel, vis",
    why: {
      man: "Stuurt de schildklier en daarmee uw stofwisseling.",
      vrouw: "Stuurt de schildklier, die direct invloed heeft op de cyclus en de vruchtbaarheid.",
    },
    note: "Zelf bakken met zeezout in plaats van bakkerszout is een veelvoorkomende oorzaak van een lage inname.",
  },
  {
    id: "omega3",
    name: "Omega 3 (EPA en DHA)",
    m: "250 tot 500 mg",
    v: "250 tot 500 mg",
    src: "Vette vis twee keer per week, of visolie of algenolie",
    why: {
      man: "Dempt ontstekingsactiviteit en ondersteunt herstel tussen sessies.",
      vrouw: "Dempt ontstekingsactiviteit en vermindert menstruatiepijn in meerdere onderzoeken.",
    },
  },
  {
    id: "folium",
    name: "Foliumzuur",
    m: "300 µg",
    v: "300 µg, 400 µg bij zwangerschapswens",
    src: "Groene groenten, peulvruchten, volkoren",
    why: {
      man: "Betrokken bij celdeling en spermakwaliteit.",
      vrouw: "Bij een zwangerschapswens vanaf vier weken vooraf 400 µg als supplement.",
    },
  },
  {
    id: "b12",
    name: "Vitamine B12",
    m: "4 µg",
    v: "4 µg",
    src: "Vlees, vis, ei, zuivel",
    why: {
      man: "Alleen een aandachtspunt bij volledig plantaardig eten; dan is suppletie verplicht.",
      vrouw: "Alleen een aandachtspunt bij volledig plantaardig eten; dan is suppletie verplicht.",
    },
  },
  {
    id: "seleen",
    name: "Selenium",
    m: "70 µg",
    v: "70 µg",
    src: "Paranoten, vis, ei, volkoren",
    why: {
      man: "Nodig voor de schildklier en voor de spermakwaliteit.",
      vrouw: "Nodig voor de schildklier.",
    },
    note: "Twee paranoten per dag zijn genoeg; meer is onnodig en bij veel meer schadelijk.",
  },
];

const HORMONE_TIPS = {
  man: {
    title: "Testosteron: wat er werkelijk toe doet",
    works: [
      "Houd uw vetpercentage ruwweg tussen 10 en 20 procent. Bij een hoog vetpercentage zet aromatase meer testosteron om in oestradiol, bij een zeer laag vetpercentage zakt de productie door het energietekort.",
      "Houd vet op minimaal 20 procent van uw calorieën. Vetarme voeding gaat in meta-analyse samen met een circa 10 tot 15 procent lager totaal testosteron (Whittaker en Wu, 2021).",
      "Slaap minimaal 7 uur. Een week met 5 uur slaap verlaagde testosteron bij jonge mannen met 10 tot 15 procent (Leproult en Van Cauter, JAMA 2011).",
      "Houd het calorietekort gematigd en bouw onderhoudsfases in. Een langdurig groot tekort drukt LH en daarmee de productie.",
      "Beperk alcohol. Zware inname verlaagt testosteron acuut en chronisch.",
      "Train met gewichten en herstel voldoende. Chronisch te veel volume zonder herstel werkt averechts.",
    ],
    myths: [
      "Tribulus terrestris, D-asparaginezuur en zogenoemde testosteronboosters: geen overtuigend effect bij gezonde mannen.",
      "Extra zink of vitamine D bij een normale bloedwaarde verhoogt testosteron niet. Alleen het opheffen van een tekort helpt.",
      "Zeer koolhydraatarm eten bij zware training verlaagt eerder de testosteron-cortisolverhouding dan dat het helpt.",
    ],
  },
  vrouw: {
    title: "Vrouwelijke hormonen: wat er werkelijk toe doet",
    works: [
      "Energiebeschikbaarheid is de belangrijkste knop. Onder 30 kcal per kg vetvrije massa verstoort de LH-pulsatiliteit, met cyclusuitval en botverlies tot gevolg (IOC-consensus REDs, 2023).",
      "Behandel uw cyclus als meetinstrument. Het wegblijven van de menstruatie is geen teken van fitheid maar van een energietekort en vraagt om ingrijpen.",
      "Houd vet op minimaal 20 tot 25 procent van uw calorieën. Steroïdhormonen worden uit cholesterol opgebouwd.",
      "Vermijd chronisch zeer lage koolhydraatinname bij een hoge trainingsbelasting; dat verhoogt cortisol en verstoort de cyclus.",
      "Bescherm het bot: calcium, vitamine D en krachttraining met belasting, zeker bij een onregelmatige cyclus.",
      "In de luteale fase ligt de energiebehoefte ongeveer 2 tot 5 procent hoger. Rond de menstruatie is extra aandacht voor ijzer verstandig.",
    ],
    myths: [
      "Diëten of trainen strikt per cyclusfase: de onderbouwing is zwak en de individuele variatie groot. Consistentie levert meer op.",
      "Krachttraining maakt vrouwen niet massief; de testosteronspiegel is daar te laag voor.",
      "Amenorroe als acceptabele prijs voor een laag vetpercentage: onjuist en op termijn schadelijk voor bot en hart.",
    ],
  },
};

const ONB = [
  { title: "Over u", sub: "Vier gegevens waarmee de app uw rustmetabolisme berekent." },
  { title: "Vetpercentage", sub: "Kies de beschrijving die het dichtst in de buurt komt. Een schatting volstaat: hiermee rekent de app op vetvrije massa, wat nauwkeuriger is dan op lichaamsgewicht." },
  { title: "Uw dag", sub: "Alles buiten uw trainingen om. Dit weegt zwaarder dan de trainingen zelf." },
  { title: "Uw training", sub: "De dagen bepalen de caloriecycling, het tijdstip bepaalt waar de koolhydraten landen." },
  { title: "Uw doel", sub: "Hierna staat uw schema klaar. Alles blijft daarna aan te passen." },
];

/* Schaal en beschrijvingen per geslacht. De niveaus en de kenmerken per niveau
   volgen de fotoreeks van BuiltLean (Marc Perry, CSCS), die op zijn beurt leunt
   op de ACE-tabel en op Gallagher et al. (AJCN 2000) voor de gezonde ranges:
   voor mannen van 20 tot 40 jaar geldt 8 tot 19 procent als gezond, voor
   vrouwen 21 tot 33 procent. Essentieel vet is ongeveer 2 procent bij mannen
   en 8 tot 10 procent bij vrouwen; dat verschil verklaart de hele verschuiving
   tussen beide schalen. */
const BF_STEPS = (sex) =>
  sex === "man"
    ? [
        { v: 7, label: "Wedstrijdconditie", hint: "Aders over vrijwel elke spier, scheiding tussen spiergroepen zichtbaar. Niet vol te houden." },
        { v: 11, label: "Zeer lean", hint: "Buikspieren zichtbaar, aders op de armen. Veeleisend maar houdbaar." },
        { v: 15, label: "Lean en fit", hint: "Contouren van spieren zichtbaar, maar geen duidelijke scheiding ertussen." },
        { v: 20, label: "Gemiddeld", hint: "Platte tot licht zachte buik, geen zichtbare buikspieren of aders." },
        { v: 25, label: "Zwaarder", hint: "Geen spierscheiding, taille duidelijk toegenomen, broek zit strak." },
        { v: 32, label: "Fors", hint: "Buik steekt over de broekrand, ook meer vet op rug en benen." },
      ]
    : [
        { v: 14, label: "Wedstrijdconditie", hint: "Spierdefinitie en aders zichtbaar. Op dit niveau blijft de menstruatie vaak weg." },
        { v: 19, label: "Zeer lean", hint: "Definitie in buik, benen en schouders, weinig vorm op heupen en billen." },
        { v: 23, label: "Atletisch", hint: "Enige definitie in de buik, vet op armen en benen aanwezig maar niet uitgesproken." },
        { v: 28, label: "Gemiddeld", hint: "Rondere heupen, billen en bovenbenen. Niet slank en niet zwaar." },
        { v: 34, label: "Zwaarder", hint: "Heupen duidelijk breder, gezicht en hals voller, vet rond de taille." },
        { v: 42, label: "Fors", hint: "Heupen merkbaar breder dan de schouders, omvang op buik, heupen en benen." },
      ];

/* Vertaalt een percentage naar hetzelfde niveau op de andere schaal, via de
   positie in de reeks. Nauwkeuriger dan er een vast aantal punten bij optellen. */
const convertBf = (value, fromSex, toSex) => {
  const from = BF_STEPS(fromSex);
  const to = BF_STEPS(toSex);
  let best = 0;
  from.forEach((x, i) => {
    if (Math.abs(x.v - value) < Math.abs(from[best].v - value)) best = i;
  });
  return to[best].v;
};

function ObRow({ label, children }) {
  return (
    <div>
      <div className="text-xs mb-1" style={{ color: C.darkMuted }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function ObSeg({ options, value, onChange }) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            className="tap flex-1 py-2.5 text-sm font-semibold"
            style={{
              background: on ? "var(--accent)" : "rgba(255,255,255,.07)",
              border: `1px solid ${on ? "var(--accent)" : C.darkLine}`,
              borderRadius: R.field,
              color: on ? "var(--on-accent)" : C.darkInk,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const PHASE_LABEL = { bulk: "opbouw", cut: "cut", slotcut: "slotcut", minicut: "minicut", reverse: "opbouw calorieën", onderhoud: "onderhoud" };
const PHASE_COLOR = {
  bulk: "var(--accent)",
  cut: "var(--danger)",
  slotcut: "var(--danger)",
  minicut: "var(--fat-fill)",
  reverse: "var(--pro-fill)",
  onderhoud: "var(--carb-fill)",
};

/* Cafeïnegrenzen volgens Gardiner et al. (Sleep Medicine Reviews 2023):
   koffie (107 mg) minstens 8,8 uur en een standaard pre-workout (217,5 mg)
   minstens 13,2 uur voor bedtijd; voor zwarte thee werd geen grens gevonden. */
const CAFFEINE = {
  geen: { label: "Geen cafeïne", hours: null },
  thee: { label: "Alleen thee", hours: null },
  koffie: { label: "Koffie", hours: 8.8 },
  preworkout: { label: "Pre-workout of energiedrank", hours: 13.2 },
};
/* Fruit en groente per dag. Gedroogd fruit telt drie keer zijn gewicht,
   omdat het vocht eruit is: 100 g rozijnen staat ongeveer gelijk aan 300 g vers.
   Ketchup en sojasaus tellen niet mee. */
const FRUIT_IDS = { banaan: 1, appel: 1, sinaasappel: 1, bessen: 1, rozijn: 3, dadel: 3 };
const VEG_IDS = {
  groente: 1, broccoli: 1, spinazie: 1, sperzieboon: 1, courgette: 1, paprika: 1, tomaat: 1,
  komkommer: 1, wortel: 1, champignon: 1, ui: 1, passata: 1, mais: 1, erwten: 1,
};
const HUNGER_MOMENTS = {
  geen: { label: "Geen voorkeur", center: null },
  ochtend: { label: "Ochtend", center: 8 * 60 },
  middag: { label: "Middag", center: 13 * 60 + 30 },
  avond: { label: "Avond", center: 18 * 60 + 30 },
  laat: { label: "Laat op de avond", center: 22 * 60 },
};

/* Kiest de maaltijd die het dichtst bij het gekozen dagdeel valt. */
const pickHungryMeal = (planMeals, moment) => {
  const c = (HUNGER_MOMENTS[moment] || {}).center;
  if (c == null || !planMeals.length) return undefined;
  let best = 0;
  const dist = (t) => {
    const d = Math.abs((t % 1440) - c);
    return Math.min(d, 1440 - d);
  };
  planMeals.forEach((m, i) => {
    if (dist(m.time) < dist(planMeals[best].time)) best = i;
  });
  return best;
};

const PRODUCE_TARGETS = {
  kuba: { label: "500 g groente en 500 g fruit", veg: 500, fruit: 500 },
  schijf: { label: "Schijf van Vijf: 250 g groente en 200 g fruit", veg: 250, fruit: 200 },
};

const SLOW_PROTEIN = ["kwark", "kwark20", "skyr", "hutten", "caseine", "melk", "melk15", "yoghurt"];

const SLEEP_GUIDE = [
  {
    title: "Voeding",
    col: "var(--carb)",
    items: [
      "Eet de laatste grote maaltijd twee tot drie uur voor bedtijd. Een grote, vette maaltijd vlak voor het slapen vergroot de kans op reflux en onrustige slaap; een lichte, eiwitrijke snack is prima.",
      "Neem voor het slapen een portie langzaam eiwit, bijvoorbeeld 300 tot 400 g kwark of hüttenkäse. Dat ondersteunt het spierherstel 's nachts zonder de slaap te verstoren.",
      "Cafeïne: koffie uiterlijk ongeveer 9 uur voor bedtijd, een pre-workout of energiedrank uiterlijk ongeveer 13 uur. Voor een kop zwarte thee werd geen grens gevonden.",
      "Alcohol laat u sneller inslapen, maar verstoort de tweede helft van de nacht en onderdrukt de REM-slaap. Ook één of twee glazen zijn meetbaar.",
      "Drink het grootste deel van uw vocht voor de avond, zodat u 's nachts niet hoeft op te staan.",
      "Een groot calorietekort maakt de slaap lichter, onder meer door honger. Houd tijdens een cut de avondmaaltijd voedzaam en schuif liever eiwit naar de avond dan dat u met een lege maag gaat slapen.",
    ],
  },
  {
    title: "Ritme",
    col: "var(--pro)",
    items: [
      "Sta elke dag binnen ongeveer een half uur op hetzelfde tijdstip op, ook in het weekend. In grote cohortstudies blijkt regelmaat minstens zo belangrijk als het aantal uren.",
      "Pak binnen een uur na het opstaan daglicht, liefst buiten. Dat zet de biologische klok en maakt u 's avonds eerder slaperig.",
      "Dim het licht en beperk schermen in het laatste uur. Houd de slaapkamer donker en koel, rond 18 graden.",
      "Avondtraining schaadt de slaap in het algemeen niet. Alleen een zware sessie die korter dan een uur voor bedtijd eindigt, vertraagt het inslapen.",
      "Mik op minimaal 7 uur slaap; wie hard traint, heeft vaak 8 uur of meer nodig.",
    ],
  },
  {
    title: "Zwak bewijs",
    col: "var(--muted)",
    items: [
      "Kiwi's, zure kersen en warme melk: kleine studies met positieve signalen, maar het bewijs is dun. Kan geen kwaad; verwacht geen groot effect.",
      "Melatonine helpt vooral bij jetlag en een verschoven ritme, nauwelijks bij gewone slaapproblemen. In Nederland zijn alleen lage doseringen vrij verkrijgbaar.",
      "Magnesium helpt alleen als u een tekort heeft.",
      "Houden slaapproblemen aan, of snurkt u met adempauzes, ga dan naar de huisarts. Voeding lost dat niet op.",
    ],
  },
];

const PHASE_ADVICE = {
  cut: "U zit in een tekort. Honger en iets minder energie tijdens de training zijn normaal. Houd eiwit en slaap strak.",
  slotcut: "De laatste fase richting uw einddoel. Honger en iets minder energie zijn normaal; houd eiwit en slaap strak.",
  minicut: "Kort en stevig. Houd de gewichten op de stang gelijk en verlaag het trainingsvolume met ongeveer een derde.",
  bulk: "U zit in een surplus. Een langzame stijging op de weegschaal is precies de bedoeling.",
  reverse: "De calorieën gaan stap voor stap omhoog. Een halve tot hele kilo erbij is vooral glycogeen en vocht, geen vet.",
  onderhoud: "Stabiel houden. Uw gewicht hoort binnen ongeveer een kilo te blijven schommelen.",
};

const PHASE_GUIDE = (sex) => [
  {
    title: "Minicut",
    col: "var(--fat)",
    items: [
      `Inzetten zodra uw vetpercentage het plafond van uw venster raakt en u nog minstens zes weken opbouwtijd over heeft.`,
      "Tempo 0,7 tot 1,0 procent lichaamsgewicht per week, duur drie tot zes weken. Korter levert te weinig op, langer maakt het een gewone cut met bijbehorend verlies aan trainingskwaliteit.",
      "Eiwit omhoog naar de bovenkant van de bandbreedte, trainingsvolume met ongeveer een derde omlaag, maar de gewichten op de stang gelijk houden. Zo behoudt u de prikkel zonder het herstel te overvragen.",
      "Mik op ongeveer vier procentpunten terug, niet op de bodem van uw venster. Verder terug lukt niet binnen enkele weken.",
      "Sluit altijd af met een tot twee weken onderhoud voordat het surplus terugkomt.",
    ],
  },
  {
    title: "Onderhoudsfase",
    col: "var(--carb)",
    items: [
      "Na twaalf tot zestien weken aaneengesloten surplus, ook als uw vetpercentage nog prima is. Eetlust, spijsvertering en bloeddruk hebben de pauze nodig.",
      "Na elke minicut, als herstelperiode voordat u weer opbouwt.",
      "Tijdens een cut na acht tot twaalf weken tekort, om stofwisseling, hormonen en trainingskwaliteit te laten terugveren.",
      "Bij een drukke periode, vakantie of blessure: onderhoud is de fase waarin u niets verliest en weinig hoeft te bewaken.",
    ],
  },
  {
    title: "Na een cut",
    col: "var(--pro)",
    items: [
      "Ga niet in één stap van tekort naar onderhoud. Bouw de calorieën in twee tot vier weken op, ongeveer honderd tot honderdvijftig kcal per week. De kilo die u dan aankomt is grotendeels glycogeen en vocht, niet vet.",
      "Blijf daarna op onderhoud voor ongeveer de helft van het aantal dieetweken, met een minimum van vier en een maximum van twaalf. Na twintig weken diëten is dat dus tien weken stabiel.",
      "Die periode is geen verloren tijd. Uw trainingsprestaties, hormoonwaarden en eetlust komen dan terug op niveau, en juist daarmee rendeert het surplus dat erna komt.",
      "Meteen na een lange cut in surplus gaan is de klassieke fout: het lichaam slaat dan onevenredig veel van het overschot op als vet.",
    ],
  },
  {
    title: "Echte cut in plaats van minicut",
    col: "var(--danger)",
    items: [
      `Wanneer u boven het plafond van uw venster start. Bulken vanaf een te hoog vetpercentage levert per kilo minder spier op en verlengt de cut die er toch komt.`,
      "Wanneer u meer dan vijf procentpunten te gaan heeft.",
      "Wanneer er een datum is waarop u in conditie wilt zijn. Reken vanaf die datum terug met het gekozen tempo en tel de dieetpauzes mee.",
    ],
  },
  {
    title: "Niet beginnen aan een bulk",
    col: "var(--muted)",
    items: [
      sex === "man"
        ? "Boven ongeveer 20 procent vet. Breng dat eerst omlaag; het venster is anders nul weken breed."
        : "Boven ongeveer 30 procent vet. Breng dat eerst omlaag; het venster is anders nul weken breed.",
      "Tijdens een blessure die uw belangrijkste oefeningen blokkeert. Zonder progressieve overbelasting wordt een surplus vooral vet.",
      "Als uw slaap structureel onder zes uur ligt of uw trainingsfrequentie onder twee keer per week. Dan ontbreekt de prikkel om het surplus zinvol te besteden.",
    ],
  },
];

const DEFAULT_CHOICE = (label, index) => {
  if (index === 0) return { protein: "kwark", carb: "havermout", fat: "pindakaas" };
  if (label === "pre" || label === "post") return { protein: "kip", carb: "rijst", fat: "olijfolie" };
  return { protein: "kip", carb: "aardappel", fat: "olijfolie" };
};

const defaultItems = (label, index) => {
  const c = DEFAULT_CHOICE(label, index);
  return [
    { food: c.protein, grams: null },
    { food: c.carb, grams: null },
    { food: c.fat, grams: null },
  ];
};

/* ============================================================
   DESIGNSYSTEEM
   Richting: sportief-editoriaal. Condensed display-type voor cijfers,
   een enkel elektrisch accent, macrokleuren uitsluitend als data-codering.
   Vormtaal: kaarten 14 px, velden en knoppen 10 px, schakelaars pill.
   Alle tokens zijn CSS-variabelen, zodat licht en donker uit een bron komen.
   ============================================================ */

const C = {
  bg: "var(--bg)",
  paper: "var(--bg)",
  panel: "var(--surface)",
  surface2: "var(--surface-2)",
  ink: "var(--ink)",
  muted: "var(--muted)",
  line: "var(--line)",
  lineSoft: "var(--line-soft)",
  accent: "var(--accent)",
  onAccent: "var(--on-accent)",
  pro: "var(--pro)",
  carb: "var(--carb)",
  fat: "var(--fat)",
  proFill: "var(--pro-fill)",
  carbFill: "var(--carb-fill)",
  fatFill: "var(--fat-fill)",
  train: "var(--danger)",
  onTrain: "var(--on-danger)",
  warn: "var(--warn)",
  warnBg: "var(--warn-bg)",
  dark: "var(--dark)",
  darkInk: "var(--dark-ink)",
  darkMuted: "var(--dark-muted)",
  darkLine: "var(--dark-line)",
  shadow: "var(--shadow)",
};

const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@500;600;700&display=swap');

:root {
  --bg:#EEF0F4; --surface:#FFFFFF; --surface-2:#F6F7F9;
  --ink:#0B0D11; --muted:#5F6673; --line:#DEE1E7; --line-soft:#EBEDF1;
  --accent:#1B3BFF; --accent-soft:#E7EAFF; --on-accent:#FFFFFF;
  --pro:#1B3BFF; --carb:#00795A; --fat:#8A6100;
  --pro-fill:#2B4BFF; --carb-fill:#00C389; --fat-fill:#FFB020;
  --danger:#D8360F; --on-danger:#FFFFFF; --warn:#8A5A00; --warn-bg:#FFF3DF;
  --dark:#0B0D11; --dark-ink:#FFFFFF; --dark-muted:#9BA2B0; --dark-line:#242832;
  --shadow:0 1px 2px rgba(11,13,17,.04), 0 10px 28px -16px rgba(11,13,17,.22);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg:#08090C; --surface:#121419; --surface-2:#191C22;
    --ink:#F1F3F7; --muted:#99A0AD; --line:#252932; --line-soft:#1C1F26;
    --accent:#6B85FF; --accent-soft:#1A2044; --on-accent:#07080B;
    --pro:#93A5FF; --carb:#35D6A0; --fat:#F7C45C;
    --pro-fill:#6B85FF; --carb-fill:#1FC98E; --fat-fill:#F0B03A;
    --danger:#FF6242; --on-danger:#1A0A06; --warn:#F0B75F; --warn-bg:#2A2013;
    --dark:#121419; --dark-ink:#F1F3F7; --dark-muted:#99A0AD; --dark-line:#2A2F39;
    --shadow:0 1px 2px rgba(0,0,0,.5), 0 12px 32px -18px rgba(0,0,0,.9);
  }
}
:root[data-theme="dark"] {
    --bg:#08090C; --surface:#121419; --surface-2:#191C22;
    --ink:#F1F3F7; --muted:#99A0AD; --line:#252932; --line-soft:#1C1F26;
    --accent:#6B85FF; --accent-soft:#1A2044; --on-accent:#07080B;
    --pro:#93A5FF; --carb:#35D6A0; --fat:#F7C45C;
    --pro-fill:#6B85FF; --carb-fill:#1FC98E; --fat-fill:#F0B03A;
    --danger:#FF6242; --on-danger:#1A0A06; --warn:#F0B75F; --warn-bg:#2A2013;
    --dark:#121419; --dark-ink:#F1F3F7; --dark-muted:#99A0AD; --dark-line:#2A2F39;
    --shadow:0 1px 2px rgba(0,0,0,.5), 0 12px 32px -18px rgba(0,0,0,.9);
}

:root { box-sizing: border-box; }
html { scroll-padding-top: env(safe-area-inset-top, 0px); }

/* Zoomen blokkeren. iOS zoomt in op elk invoerveld met tekst kleiner dan
   16 px en zoomt daarna niet terug; dat is de hoofdoorzaak. Daarnaast
   schakelt pan-x pan-y het dubbeltikken en knijpen uit, zonder het
   scrollen te raken. */
html, body { touch-action: pan-x pan-y; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
@media (pointer: coarse) {
  .macroapp input, .macroapp select, .macroapp textarea { font-size: 16px !important; }
}
.macroapp { font-family: Barlow, ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.macroapp h1, .macroapp h2, .disp { font-family: 'Barlow Condensed', 'Barlow', ui-sans-serif, sans-serif; }
.tnum { font-variant-numeric: tabular-nums; }
.disp { letter-spacing: -0.01em; }

.macroapp input, .macroapp select, .macroapp textarea { font-family: inherit; }
.macroapp input:focus-visible, .macroapp select:focus-visible, .macroapp button:focus-visible, .macroapp textarea:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
.tap { transition: transform .12s ease; }
.tap:active { transform: scale(.97); }

/* korrel: vast, niet-interactief, buiten de scrollende laag */
.grain {
  position: fixed; inset: 0; z-index: 40; pointer-events: none; opacity: .045;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
}

@keyframes rise { from { opacity:0; transform: translate3d(0,16px,0); } to { opacity:1; transform:none; } }
@keyframes pop { from { opacity:0; transform: scale(.97); } to { opacity:1; transform:none; } }
@keyframes sweep { from { transform: translate3d(-110%,0,0); } to { transform: translate3d(320%,0,0); } }
@keyframes grow { from { transform: scaleY(.04); } to { transform: scaleY(1); } }

.reveal { opacity: 0; will-change: transform, opacity; }
.reveal.in { animation: rise .5s cubic-bezier(.22,1,.36,1) both; }
.hero-in { animation: pop .5s cubic-bezier(.22,1,.36,1) both; }
.bar-fill { transition: width .55s cubic-bezier(.22,1,.36,1); }
.wk-bar { transform-origin: bottom; animation: grow .5s cubic-bezier(.22,1,.36,1) both; }
.wk-bar > span { transition: height .45s cubic-bezier(.22,1,.36,1), background-color .2s ease; }
.shine { position:absolute; inset:0; overflow:hidden; pointer-events:none; border-radius:inherit; }
.shine::after {
  content:""; position:absolute; top:0; bottom:0; width:38%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,.55), transparent);
  animation: sweep 1.4s cubic-bezier(.4,0,.2,1) .35s both;
}
.rail { position:absolute; left:0; top:0; bottom:0; width:3px; border-radius:3px; }
.macroapp [data-field] { border-radius: 10px; }


/* ---------- afdrukweergave ---------- */
.sheet { background:#fff; color:#0B0D11; }
.sheet .ink { color:#0B0D11; }
.sheet .soft { color:#5A616E; }
@page { size: A4 portrait; margin: 14mm; }
@media print {
  html, body { background:#fff !important; }
  .no-print { display:none !important; }
  .print-root { position:static !important; inset:auto !important; overflow:visible !important; background:#fff !important; padding:0 !important; }
  .sheet { width:auto !important; box-shadow:none !important; border:0 !important; margin:0 !important; padding:0 !important; break-inside:auto; }
  .sheet + .sheet { break-before:page; }
  .grain { display:none !important; }
  * { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
  .meal { break-inside:avoid; }
}

@media (prefers-reduced-motion: reduce) {
  .reveal, .reveal.in, .hero-in, .wk-bar { animation: none !important; opacity: 1 !important; transform: none !important; }
  .shine::after { display: none; }
  .bar-fill, .wk-bar > span, .tap { transition: none !important; }
}
`;

/* ----------------------------- primitieven ----------------------------- */

const STORE_KEY = "macroverdeling:v1";
const APP_VERSION = "24 september, vast vet";
const R = { card: 14, field: 10 };

/* Het heropaneel is in beide modi donker, dus deze drie kleuren staan vast. */
const DK = { pro: "#8FA3FF", carb: "#3BE0A8", fat: "#FFC44D" };

function Reveal({ children, delay = 0 }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return setSeen(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -6% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return (
    <div ref={ref} className={seen ? "reveal in" : "reveal"} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/* Telt naar de nieuwe waarde zonder React-state per frame: schrijft
   rechtstreeks naar de DOM-node en respecteert prefers-reduced-motion. */
function CountUp({ value, digits = 0, duration = 520 }) {
  const ref = useRef(null);
  const prev = useRef(null);
  const fmt = (v) => v.toLocaleString("nl-NL", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = prev.current == null ? value * 0.82 : prev.current;
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || Math.abs(value - start) < 0.5) {
      el.textContent = fmt(value);
      prev.current = value;
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(start + (value - start) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else prev.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, digits, duration]);
  return <span ref={ref}>{fmt(value)}</span>;
}

function Section({ title, sub, children, accent }) {
  return (
    <Reveal>
      <section className="mb-8">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="inline-block w-1.5 h-5 rounded-sm" style={{ background: accent || C.accent }} />
          <h2 className="disp text-2xl font-bold uppercase leading-none" style={{ color: C.ink }}>
            {title}
          </h2>
        </div>
        {sub && (
          <p className="text-sm mb-3 leading-relaxed" style={{ color: C.muted, maxWidth: "62ch" }}>
            {sub}
          </p>
        )}
        <div
          className="overflow-hidden"
          style={{ border: `1px solid ${C.line}`, background: C.panel, borderRadius: R.card, boxShadow: C.shadow }}
        >
          {children}
        </div>
      </section>
    </Reveal>
  );
}

function Row({ label, hint, children, stack }) {
  return (
    <div
      className={`px-4 py-3 ${stack ? "" : "flex items-center justify-between gap-3"}`}
      style={{ borderBottom: `1px solid ${C.lineSoft}` }}
    >
      <div className={stack ? "mb-2" : ""}>
        <div className="text-sm font-medium" style={{ color: C.ink }}>
          {label}
        </div>
        {hint && (
          <div className="text-xs mt-0.5 leading-snug" style={{ color: C.muted }}>
            {hint}
          </div>
        )}
      </div>
      <div className={stack ? "" : "shrink-0"}>{children}</div>
    </div>
  );
}

function Seg({ options, value, onChange }) {
  return (
    <div className="flex p-0.5 rounded-full" style={{ background: C.surface2, border: `1px solid ${C.line}` }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            className="tap px-3 py-1 text-sm rounded-full"
            style={{
              background: on ? C.accent : "transparent",
              color: on ? C.onAccent : C.muted,
              fontWeight: on ? 600 : 500,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Num({ value, onChange, step = 1, min, max, suffix }) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        inputMode="decimal"
        value={value ?? ""}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        className="w-20 px-2 py-1.5 text-sm text-right tnum"
        style={{ border: `1px solid ${C.line}`, borderRadius: R.field, color: C.ink, background: C.surface2 }}
      />
      {suffix && (
        <span className="text-xs w-6" style={{ color: C.muted }}>
          {suffix}
        </span>
      )}
    </div>
  );
}

function Pick({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-2 text-sm"
      style={{ border: `1px solid ${C.line}`, borderRadius: R.field, color: C.ink, background: C.surface2 }}
    >
      {options.map((o) => (
        <option key={o.id ?? o.v} value={o.id ?? o.v}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Slide({ value, onChange, min, max, step, format }) {
  /* Een ontbrekende of ongeldige waarde mag de app nooit laten vallen:
     val is altijd een getal binnen het bereik. */
  const n = Number(value);
  const val = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={val}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
        style={{ accentColor: "var(--accent)" }}
      />
      <span className="disp text-lg font-semibold w-20 text-right tnum" style={{ color: C.ink }}>
        {format(val)}
      </span>
    </div>
  );
}

const STATE_COLOR = { goed: C.carb, oplet: C.warn, risico: C.train };

function Status({ label, value, state, note }) {
  return (
    <div className="px-4 py-3 relative" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
      <span className="rail" style={{ background: STATE_COLOR[state] }} />
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="disp text-xl font-bold tnum shrink-0" style={{ color: STATE_COLOR[state] }}>
          {value}
        </span>
      </div>
      {note && (
        <p className="text-xs mt-1 leading-relaxed" style={{ color: state === "goed" ? C.muted : STATE_COLOR[state] }}>
          {note}
        </p>
      )}
    </div>
  );
}

/* Eigen lijniconen, 24 px raster, 1,8 px lijn. Geen externe bibliotheek. */
const ICON_PATHS = {
  vandaag: ["M4 6.5h16v13H4z", "M4 10.5h16", "M8.5 4v4", "M15.5 4v4", "M8 14h3v3H8z"],
  plan: ["M4 19h16", "M5 15.5l4.5-4.5 3.5 3 6-6.5", "M15 7.5h4v4"],
  eten: ["M7 3.5v17", "M4.5 3.5v5a2.5 2.5 0 0 0 5 0v-5", "M16.5 20.5v-17c-2 1.5-3 4-3 7.5h3"],
  gezondheid: ["M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z", "M7.5 12h2.5l1.5-2.5 2 4.5 1.5-2h1.5"],
  profiel: ["M12 12.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4.5 20.5c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5"],
};

function Icon({ name, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

const TABS = [
  { id: "vandaag", label: "Vandaag", title: "Vandaag" },
  { id: "plan", label: "Plan", title: "Plan en voortgang" },
  { id: "eten", label: "Eten", title: "Eten" },
  { id: "gezondheid", label: "Gezondheid", title: "Gezondheid" },
  { id: "profiel", label: "Profiel", title: "Profiel" },
];

function MacroBar({ p, c, f, height = 8, shine, colors }) {
  const cl = colors || { pro: C.proFill, carb: C.carbFill, fat: C.fatFill };
  const total = p * 4 + c * 4 + f * 9 || 1;
  const seg = [
    { w: (p * 4) / total, color: cl.pro },
    { w: (c * 4) / total, color: cl.carb },
    { w: (f * 9) / total, color: cl.fat },
  ];
  return (
    <div className="flex w-full overflow-hidden relative" style={{ height, borderRadius: height / 2, background: C.lineSoft }}>
      {seg.map((s, i) => (
        <div key={i} className="bar-fill" style={{ width: `${s.w * 100}%`, background: s.color }} />
      ))}
      {shine && <span className="shine" />}
    </div>
  );
}

/* ---------------- gewichtsgrafiek ----------------
   Dagelijkse metingen als punten, het voortschrijdend 7-daags gemiddelde als
   hoofdlijn en, als er een doeltempo is, de geplande lijn gestippeld. Het
   gemiddelde is de lijn om op te sturen: dagwaarden schommelen door vocht,
   zout, koolhydraten en darminhoud gemakkelijk een kilo. */
const dayNum = (iso) => Math.round(Date.parse(iso + "T00:00:00") / DAY_MS);
const fmtDay = (n) => new Date(n * DAY_MS).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
const kg = (v) => v.toFixed(1).replace(".", ",");

function rollingAverage(points) {
  return points.map((p) => {
    const win = points.filter((q) => q.t <= p.t && q.t > p.t - 7);
    return win.reduce((a, q) => a + q.w, 0) / win.length;
  });
}

function isoWeek(n) {
  const d = new Date(n * DAY_MS);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const wd = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - wd);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - y0) / DAY_MS + 1) / 7);
  const monday = n - ((new Date(n * DAY_MS).getDay() || 7) - 1);
  return { key: `${t.getUTCFullYear()}-${week}`, week, monday };
}

function weeklyAverages(log) {
  const groups = {};
  log.forEach((e) => {
    const n = dayNum(e.date);
    const w = isoWeek(n);
    if (!groups[w.key]) groups[w.key] = { ...w, sum: 0, count: 0 };
    groups[w.key].sum += e.weight;
    groups[w.key].count++;
  });
  const list = Object.values(groups)
    .sort((a, b) => a.monday - b.monday)
    .map((g) => ({ ...g, avg: g.sum / g.count }));
  return list.map((g, i) => ({ ...g, delta: i > 0 ? g.avg - list[i - 1].avg : null }));
}

function WeightChart({ log, rangeDays, planKgPerWeek, onDelete }) {
  const [sel, setSel] = useState(null);
  const svgRef = useRef(null);
  const all = log
    .filter((e) => e.weight > 0)
    .map((e) => ({ t: dayNum(e.date), w: e.weight, date: e.date }))
    .sort((a, b) => a.t - b.t);
  if (!all.length) return null;
  const lastT = all[all.length - 1].t;
  const pts = rangeDays ? all.filter((p) => p.t > lastT - rangeDays) : all;
  // gemiddelde over alle metingen berekenen, zodat de eerste dagen van een
  // venster ook de voorgaande week meenemen
  const avgAll = rollingAverage(all);
  const avg = pts.map((p) => avgAll[all.indexOf(p)]);

  const W = 340;
  const H = 190;
  const padL = 36;
  const padR = 10;
  const padT = 14;
  const padB = 26;
  const t0 = pts[0].t;
  const t1 = Math.max(pts[pts.length - 1].t, t0 + 6);
  const plan =
    planKgPerWeek != null && pts.length >= 2 && Math.abs(planKgPerWeek) > 0.005
      ? { y0: avg[0], y1: avg[0] + (planKgPerWeek / 7) * (t1 - t0) }
      : null;
  const vals = [...pts.map((p) => p.w), ...avg, ...(plan ? [plan.y0, plan.y1] : [])];
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const span = Math.max(1.5, hi - lo);
  lo = Math.floor((lo - span * 0.12) * 2) / 2;
  hi = Math.ceil((hi + span * 0.12) * 2) / 2;
  const step = hi - lo > 6 ? 2 : hi - lo > 3 ? 1 : 0.5;
  const x = (t) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  const yTicks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) yTicks.push(Math.round(v * 10) / 10);
  const nX = Math.min(5, Math.max(2, Math.round((t1 - t0) / 7) + 1));
  const xTicks = [...Array(nX)].map((_, i) => Math.round(t0 + ((t1 - t0) * i) / (nX - 1)));

  const avgPath = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(avg[i]).toFixed(1)}`).join(" ");
  const dayPath = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.w).toFixed(1)}`).join(" ");

  const pick = (clientX) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const px = ((clientX - r.left) / r.width) * W;
    let best = 0;
    pts.forEach((p, i) => {
      if (Math.abs(x(p.t) - px) < Math.abs(x(pts[best].t) - px)) best = i;
    });
    setSel(best);
  };
  const s = sel != null && sel < pts.length ? sel : null;

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full block"
        style={{ touchAction: "pan-y", userSelect: "none" }}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerMove={(e) => e.buttons && pick(e.clientX)}
        role="img"
        aria-label={`Gewichtsverloop, laatste 7-daags gemiddelde ${kg(avg[avg.length - 1])} kilo`}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" strokeWidth="1" />
            <text x={padL - 6} y={y(v) + 3.5} fontSize="10" textAnchor="end" fill="var(--muted)">
              {kg(v)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text
            key={i}
            x={x(t)}
            y={H - 8}
            fontSize="10"
            textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
            fill="var(--muted)"
          >
            {fmtDay(t)}
          </text>
        ))}
        {plan && (
          <line
            x1={x(t0)}
            y1={y(plan.y0)}
            x2={x(t1)}
            y2={y(plan.y1)}
            stroke="var(--carb-fill)"
            strokeWidth="2"
            strokeDasharray="5 5"
            opacity="0.9"
          />
        )}
        <path d={dayPath} fill="none" stroke="var(--line)" strokeWidth="1" />
        {pts.map((p, i) => (
          <circle key={p.t} cx={x(p.t)} cy={y(p.w)} r={s === i ? 4.5 : 2.6} fill={s === i ? "var(--ink)" : "var(--muted)"} />
        ))}
        <path d={avgPath} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {s != null && (
          <g>
            <line x1={x(pts[s].t)} x2={x(pts[s].t)} y1={padT} y2={H - padB} stroke="var(--ink)" strokeWidth="1" opacity="0.35" />
            <circle cx={x(pts[s].t)} cy={y(avg[s])} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
          </g>
        )}
      </svg>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs" style={{ color: C.muted }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: "var(--muted)" }} />
          dagelijks
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block rounded-full" style={{ width: 14, height: 3, background: "var(--accent)" }} />
          7-daags gemiddelde
        </span>
        {plan && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block" style={{ width: 14, height: 0, borderTop: "2px dashed var(--carb-fill)" }} />
            gepland tempo
          </span>
        )}
      </div>

      {s != null ? (
        <div
          className="mt-2 px-3 py-2 flex items-center justify-between gap-3 flex-wrap"
          style={{ background: C.surface2, borderRadius: R.field, border: `1px solid ${C.lineSoft}` }}
        >
          <div className="text-xs tnum leading-snug">
            <strong>{fmtDay(pts[s].t)}</strong>
            {" · gemeten "}
            <strong>{kg(pts[s].w)} kg</strong>
            {" · gemiddelde "}
            <strong style={{ color: C.accent }}>{kg(avg[s])} kg</strong>
          </div>
          <button
            onClick={() => {
              onDelete(pts[s].date);
              setSel(null);
            }}
            className="tap text-xs underline"
            style={{ color: C.muted }}
          >
            Deze meting verwijderen
          </button>
        </div>
      ) : (
        <p className="text-xs mt-2" style={{ color: C.muted }}>
          Tik op de grafiek om een dag te bekijken.
        </p>
      )}
    </div>
  );
}

function Sparkline({ data }) {
  const pts = data.map((e) => ({ t: Date.parse(e.date) / 86400000, w: e.weight })).sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;
  const W = 300;
  const H = 70;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const lo = Math.min(...pts.map((p) => p.w));
  const hi = Math.max(...pts.map((p) => p.w));
  const pad = Math.max(0.3, (hi - lo) * 0.15);
  const x = (t) => (t1 === t0 ? W / 2 : ((t - t0) / (t1 - t0)) * (W - 8) + 4);
  const y = (w) => H - 6 - ((w - (lo - pad)) / (hi + pad - (lo - pad))) * (H - 12);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.w).toFixed(1)}`).join(" ");
  const tr = weightTrend(data);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 70 }} role="img" aria-label="Verloop van uw gewicht">
      <path d={line} fill="none" stroke={C.line} strokeWidth="1.5" />
      {pts.map((p, i) => (
        <circle key={i} cx={x(p.t)} cy={y(p.w)} r="2" fill={C.muted} />
      ))}
      {tr.ok && (
        <line
          x1={x(t0)}
          y1={y(tr.intercept + (tr.kgPerWeek / 7) * t0)}
          x2={x(t1)}
          y2={y(tr.intercept + (tr.kgPerWeek / 7) * t1)}
          stroke={C.pro}
          strokeWidth="2"
        />
      )}
      <text x="2" y="10" fontSize="9" fill={C.muted}>
        {hi.toFixed(1)} kg
      </text>
      <text x="2" y={H - 1} fontSize="9" fill={C.muted}>
        {lo.toFixed(1)} kg
      </text>
    </svg>
  );
}

const DAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const DAY_FULL = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag", "Zondag"];

const defaultWeek = () =>
  DAYS.map((_, i) => ({
    session: [0, 1, 3, 4].includes(i) ? { type: "kracht", minutes: 75, start: "18:00" } : null,
    flex: 0,
  }));

const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => new Date(Date.now() + n * 86400000);
const dateNL = (d) => d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });

/* Vangnet: één fout in de weergave mag nooit een leeg scherm opleveren.
   De gebruiker krijgt de melding plus een knop om de opgeslagen instellingen
   te wissen, want een onverwachte fout komt vrijwel altijd uit oude opslag. */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  async reset() {
    try {
      await window.storage.delete(STORE_KEY);
    } catch (e) {
      /* niets: opslag was er mogelijk niet */
    }
    if (typeof location !== "undefined" && location.reload) location.reload();
    else this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen w-full" style={{ background: C.bg, color: C.ink }}>
        <style>{STYLE}</style>
        <div className="macroapp mx-auto max-w-2xl px-5 py-10">
          <h1 className="disp text-4xl font-bold uppercase leading-none mb-2">Er ging iets mis</h1>
          <p className="text-sm leading-relaxed mb-4" style={{ color: C.muted, maxWidth: "50ch" }}>
            De app kon deze weergave niet opbouwen. Meestal komt dat door instellingen die met een oudere versie zijn
            opgeslagen. Uw gegevens wissen lost dat op, maar u begint dan wel opnieuw.
          </p>
          <pre
            className="text-xs p-3 mb-4 overflow-x-auto"
            style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: R.field, color: C.muted }}
          >
            {String(this.state.error && this.state.error.message)}
          </pre>
          <button
            onClick={() => this.reset()}
            className="tap px-4 py-2.5 text-sm"
            style={{ background: C.accent, color: C.onAccent, borderRadius: R.field, fontWeight: 600 }}
          >
            Instellingen wissen en opnieuw beginnen
          </button>
        </div>
      </div>
    );
  }
}

export default function MacroAppRoot() {
  return (
    <ErrorBoundary>
      <MacroApp />
    </ErrorBoundary>
  );
}

function MacroApp() {
  const [f, setF] = useState({
    sex: "man",
    age: 36,
    height: 183,
    weight: 85,
    bodyFat: 18,
    useBodyFat: true,
    activity: "licht",
    goal: "cut",
    rate: -0.5,
    meals: 4,
    wake: "07:00",
    sleep: "23:00",
    cycling: true,
    proteinOverride: null,
    fatPercent: 25,
    experience: "gevorderd",
    bodyFatSex: null,
    caffeineUse: "koffie",
    lightLastMeal: true,
    produceTarget: "kuba",
    hungerMoment: "geen",
    fatMode: "vast",
    fatFixedGrams: null,
  });
  const [week, setWeek] = useState(defaultWeek);
  const [selDay, setSelDay] = useState(new Date().getDay() === 0 ? 6 : new Date().getDay() - 1);
  const [editDay, setEditDay] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [plainText, setPlainText] = useState(null);
  const [showPortions, setShowPortions] = useState(true);
  const [vegGrams, setVegGrams] = useState(100);
  const [showAlts, setShowAlts] = useState(true);
  const [showViewOpts, setShowViewOpts] = useState(false);
  const [mealPlans, setMealPlans] = useState({});
  const [customFoods, setCustomFoods] = useState([]);
  const [savedMeals, setSavedMeals] = useState([]);
  const [savingMeal, setSavingMeal] = useState(null);
  const [newMealName, setNewMealName] = useState("");
  const [confirmMeal, setConfirmMeal] = useState(null);
  const [newFood, setNewFood] = useState({ label: "", cat: "protein", p: "", c: "", f: "", fib: "", unitGrams: "", unitLabel: "" });
  const [foodError, setFoodError] = useState(null);
  const [editingFood, setEditingFood] = useState(null);
  const [labelBusy, setLabelBusy] = useState(false);
  const [labelMsg, setLabelMsg] = useState(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pendingPortion, setPendingPortion] = useState(null);
  const [portionInput, setPortionInput] = useState("");
  const [aiPhoto, setAiPhoto] = useState(null);
  const photoRef = useRef(null);
  const foodFormRef = useRef(null);
  const [confirmFood, setConfirmFood] = useState(null);
  const [autopilot, setAutopilot] = useState(null);
  const [lastSeen, setLastSeen] = useState(null);
  const [planStartInput, setPlanStartInput] = useState(new Date().toISOString().slice(0, 10));
  const [confirmStop, setConfirmStop] = useState(false);
  const [tab, setTabRaw] = useState("vandaag");
  const setTab = (t) => {
    setTabRaw(t);
    try {
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch (e) {
      /* oudere browsers */
    }
  };
  const [printView, setPrintView] = useState(false);
  const [printHint, setPrintHint] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [obTrain, setObTrain] = useState({ type: "kracht", minutes: 75, start: "18:00" });
  const [editMeal, setEditMeal] = useState(null);
  const [log, setLog] = useState([]);
  const [newEntry, setNewEntry] = useState({ date: todayISO(), weight: "" });
  const [chartRange, setChartRange] = useState(28);
  const [kcalAdjust, setKcalAdjust] = useState(0);
  const [phaseCfg, setPhaseCfg] = useState({
    targetWeight: 78,
    blockWeeks: 10,
    maintWeeks: 3,
    horizonWeeks: 26,
    windowKey: "standaard",
    minicut: true,
    minicutRate: 0.75,
    maxMinicutWeeks: 5,
    recoveryWeeks: 2,
    mode: "een",
    bfLow: null,
    bfHigh: null,
    priority: "spier",
    targetBf: 10,
    cutRate: 0.6,
    bulkRate: 0.25,
    cutBlockWeeks: 10,
  });
  const [showPlan, setShowPlan] = useState(false);
  const [showList, setShowList] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [storage, setStorage] = useState("laden");
  const [loaded, setLoaded] = useState(false);
  const [storeMode, setStoreMode] = useState("claude");

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setPhase = (k, v) => setPhaseCfg((s) => ({ ...s, [k]: v }));
  const setDay = (i, patch) => setWeek((w) => w.map((d, k) => (k === i ? { ...d, ...patch } : d)));

  /* Een dag volgt de standaardindeling tenzij hij een eigen waarde heeft. */
  const dayCfg = (i) => ({
    meals: num(week[i].meals ?? f.meals, 4),
    wake: week[i].wake || f.wake || "07:00",
    sleep: week[i].sleep || f.sleep || "23:00",
    own: week[i].meals != null || week[i].wake != null || week[i].sleep != null,
  });

  /* Maaltijdsamenstelling in drie lagen: alle dagen, per dagtype
     (trainingsdag of rustdag) en als uitzondering een losse dag.
     Wie iets wijzigt, wijzigt standaard het profiel van dat dagtype;
     twee ingevulde dagen vullen daarmee de hele week. */
  const dayType = (d) => (week[d].session ? "training" : "rust");
  const TYPE_LABEL = { training: "trainingsdagen", rust: "rustdagen" };

  const itemsFor = (day, i, label) => {
    const t = dayType(day);
    return (
      (mealPlans[day] && mealPlans[day][i]) ||
      (mealPlans[t] && mealPlans[t][i]) ||
      (mealPlans.def && mealPlans.def[i]) ||
      defaultItems(label, i)
    );
  };
  const scopeOf = (day, i) =>
    mealPlans[day] && mealPlans[day][i] ? "dag" : mealPlans[dayType(day)] && mealPlans[dayType(day)][i] ? "type" : "alle";

    /* Safari negeert user-scalable=no sinds iOS 10. Knijpen loopt daar via
     eigen gesture-events en meervingerige touchmoves; die houden we tegen. */
  useEffect(() => {
    const stop = (e) => e.preventDefault();
    const multi = (e) => {
      if (e.touches && e.touches.length > 1) e.preventDefault();
    };
    const opts = { passive: false };
    document.addEventListener("gesturestart", stop, opts);
    document.addEventListener("gesturechange", stop, opts);
    document.addEventListener("touchmove", multi, opts);
    return () => {
      document.removeEventListener("gesturestart", stop, opts);
      document.removeEventListener("gesturechange", stop, opts);
      document.removeEventListener("touchmove", multi, opts);
    };
  }, []);

  /* Kan deze weergave een foto naar Claude sturen? Zo niet, dan verdwijnt de
     fotoknop en blijft alleen het plakveld over. */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (window.claude && typeof window.claude.use === "function") {
          const sample = await window.claude.use("sample");
          if (!sample) {
            if (alive) setAiPhoto({ ok: false, reden: "Claude antwoordt niet in deze weergave" });
            return;
          }
          const lim = await sample.limits().catch((e) => ({ err: (e && e.code) || "limieten onbekend" }));
          if (alive)
            setAiPhoto(
              lim && lim.images
                ? { ok: true, reden: `tot ${lim.images.maxCount} foto per keer` }
                : { ok: false, reden: lim && lim.err ? `Claude meldde: ${lim.err}` : "deze weergave mag geen foto's versturen" }
            );
          return;
        }
      } catch (e) {
        if (alive) setAiPhoto({ ok: false, reden: (e && e.message) || "onbekende fout" });
        return;
      }
      if (alive) setAiPhoto({ ok: true, reden: "via de Claude-weergave" });
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* opslag op dit apparaat, met terugval op alleen deze sessie */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await window.storage.get(STORE_KEY);
        const d = r && r.value ? JSON.parse(r.value) : null;
        if (alive && d) {
          if (d.f) setF((s) => ({ ...s, ...d.f }));
          if (Array.isArray(d.week) && d.week.length === 7)
            setWeek((w) => w.map((day, k) => ({ ...day, ...d.week[k] })));
          if (d.log) setLog(d.log);
          if (typeof d.kcalAdjust === "number") setKcalAdjust(d.kcalAdjust);
          if (d.phaseCfg) setPhaseCfg((s) => ({ ...s, ...d.phaseCfg }));
          if (d.customFoods) setCustomFoods(d.customFoods);
          if (d.savedMeals) setSavedMeals(d.savedMeals);
          if (d.autopilot && Array.isArray(d.autopilot.rows)) setAutopilot(d.autopilot);
          if (d.lastSeen) setLastSeen(d.lastSeen);
          if (d.mealPlans) {
            const v = Object.values(d.mealPlans);
            // ouder formaat: { maaltijdindex: items } zonder dagniveau
            setMealPlans(Array.isArray(v[0]) ? { def: d.mealPlans } : d.mealPlans);
          }
          else if (d.choices) {
            // ouder opslagformaat met een vaste bron per macro
            const conv = {};
            Object.entries(d.choices).forEach(([k, c]) => {
              conv[k] = [
                { food: c.protein, grams: null },
                { food: c.carb, grams: null },
                { food: c.fat, grams: null },
              ];
            });
            setMealPlans(conv);
          }
          if (typeof d.vegGrams === "number") setVegGrams(d.vegGrams);
        }
        if (alive) {
          setStorage("aan");
          if (!d || !d.onboarded) setOnboarding(0);
        }
      } catch (e) {
        if (alive) {
          setStorage(window.storage ? "aan" : "uit");
          setOnboarding(0);
        }
      } finally {
        if (alive) {
          setStoreMode((window.storage && window.storage.mode) || (window.storage ? "claude" : "memory"));
          setLoaded(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded || storage !== "aan") return;
    const t = setTimeout(() => {
      try {
        window.storage.set(
          STORE_KEY,
          JSON.stringify({ f, week, log, kcalAdjust, phaseCfg, mealPlans, vegGrams, customFoods, savedMeals, autopilot, lastSeen, onboarded: true })
        );
      } catch (e) {
        setStorage("uit");
      }
    }, 800);
    return () => clearTimeout(t);
  }, [f, week, log, kcalAdjust, phaseCfg, mealPlans, vegGrams, customFoods, savedMeals, autopilot, lastSeen, loaded, storage]);

  /* ---------------- rekenwerk ---------------- */

  const foodIndex = useMemo(() => buildIndex(customFoods), [customFoods]);

  const planNow = useMemo(() => planPosition(autopilot), [autopilot]);
  const effGoal = planNow.active ? goalFromRate(planNow.row.rate) : f.goal;
  const effRate = planNow.active ? planNow.row.rate : f.goal === "onderhoud" ? 0 : Number(f.rate);

  const core = useMemo(() => {
    const weight = Math.max(20, num(f.weight, 80));
    const input = {
      sex: f.sex,
      age: Math.max(12, num(f.age, 30)),
      height: Math.max(100, num(f.height, 175)),
      weight,
      bodyFat: num(f.bodyFat, 0),
      useBodyFat: f.useBodyFat,
      activityFactor: ACTIVITY.find((a) => a.id === f.activity).factor,
      goal: effGoal,
      rate: effGoal === "onderhoud" ? 0 : effRate,
      cycling: f.cycling,
      kcalAdjust: num(kcalAdjust, 0),
      week,
    };
    return { input, energy: weekEnergy(input), weight };
  }, [f, week, kcalAdjust, effGoal, effRate]);

  const { input, energy, weight } = core;

  const dayPlan = useMemo(() => {
    const proteinPerKg = f.proteinOverride ?? recommendedProtein(input);
    /* Vast vet: afgeleid van het gemiddelde onderhoudsniveau, zodat het niet
       meebeweegt met tekort, surplus of koolhydraatcycling. */
    const fixedFat =
      f.fatMode === "vast"
        ? num(f.fatFixedGrams, 0) > 0
          ? num(f.fatFixedGrams, 0)
          : Math.max(0.6 * weight, ((Math.min(60, Math.max(10, num(f.fatPercent, 25))) / 100) * energy.tdeeAvg) / 9)
        : null;
    const build = (i) => {
      const kcal = energy.kcals[i];
      const macros = calcMacros({ weight, kcal, proteinPerKg, fatPercent: f.fatPercent, fatGrams: fixedFat });
      const s = week[i].session;
      const cfg = {
        meals: num(week[i].meals ?? f.meals, 4),
        wake: week[i].wake || f.wake || "07:00",
        sleep: week[i].sleep || f.sleep || "23:00",
      };
      const plan = planMealTimes({
        wake: cfg.wake,
        sleep: cfg.sleep,
        mealCount: cfg.meals,
        training: s ? { start: s.start, minutes: s.minutes } : null,
      });
      const wakeM = toMin(cfg.wake);
      let sleepM = toMin(cfg.sleep);
      if (sleepM <= wakeM) sleepM += 1440;
      const lastIdx = plan.meals.length - 1;
      const lastBefore = sleepM - plan.meals[lastIdx].time;
      const late =
        f.lightLastMeal !== false && lastBefore < 120 && plan.meals[lastIdx].label === "normaal" ? lastIdx : undefined;
      const hungry = pickHungryMeal(plan.meals, f.hungerMoment);
      const dayTdee = energy.rest + (energy.sess[i] || 0);
      const surplusCarbs = Math.max(0, kcal - dayTdee) / 4;
      const meals = distributeMacros(plan.meals, macros, { late, hungry, surplusCarbs });
      return { kcal, macros, plan, meals, sleepM, wakeM, lastBefore };
    };
    const all = DAYS.map((_, i) => build(i));
    return { all, proteinPerKg, today: all[selDay], fixedFat };
  }, [core, f, week, selDay]);

  const { macros, meals, plan } = dayPlan.today;
  const proteinPerKg = dayPlan.proteinPerKg;

  const warnings = useMemo(() => {
    const w = buildWarnings({
      f: { weight, sessionsPerWeek: week.filter((d) => d.session).length },
      energy: { ...energy, restDayKcal: Math.min(...energy.kcals) },
      macros,
      meals,
    });
    if (Math.abs(energy.unmetFlex) > 50)
      w.push(
        `De extra calorieën van uw flexdag passen niet volledig binnen deze week: het weektotaal ligt ${Math.round(
          energy.unmetFlex
        )} kcal hoger dan gepland, omdat geen enkele dag onder het rustmetabolisme mag zakken. Het werkelijke tempo komt uit op ${energy.realKgPerWeek.toFixed(
          2
        )} kg per week.`
      );
    return w;
  }, [energy, macros, meals, weight, week]);

  const portionPlan = useMemo(() => {
    if (!showPortions) return null;
    return meals.map((m, i) => {
      const items = itemsFor(selDay, i, m.label);
      const built = buildMealPortions({
        target: { p: m.protein, c: m.carbs, f: m.fat },
        items,
        veg: i === 0 ? 0 : vegGrams,
        index: foodIndex,
      });
      return {
        ...built,
        items,
        scope: scopeOf(selDay, i),
        alts: showAlts
          ? built.portions.map((pp) => (pp.food === "groente" ? [] : alternativesFor(pp.food, pp.grams, foodIndex, 2)))
          : null,
      };
    });
  }, [meals, mealPlans, vegGrams, showPortions, foodIndex, selDay, week, showAlts]);

  /* Schrijft naar het niveau waarop deze maaltijd al bestaat; is dat nergens,
     dan naar het profiel van het huidige dagtype. */
  const setItems = (mealIndex, fn) =>
    setMealPlans((s) => {
      const t = dayType(selDay);
      const scope = s[selDay] && s[selDay][mealIndex] ? selDay : t;
      const cur = itemsFor(selDay, mealIndex, meals[mealIndex] ? meals[mealIndex].label : "normaal");
      return { ...s, [scope]: { ...(s[scope] || {}), [mealIndex]: fn(cur) } };
    });

  const setScope = (mealIndex, target) =>
    setMealPlans((s) => {
      const t = dayType(selDay);
      const cur = itemsFor(selDay, mealIndex, meals[mealIndex] ? meals[mealIndex].label : "normaal").map((x) => ({ ...x }));
      const out = { ...s };
      const strip = (key) => {
        if (!out[key]) return;
        const c = { ...out[key] };
        delete c[mealIndex];
        out[key] = c;
      };
      if (target === "dag") {
        out[selDay] = { ...(out[selDay] || {}), [mealIndex]: cur };
      } else if (target === "type") {
        strip(selDay);
        out[t] = { ...(out[t] || {}), [mealIndex]: cur };
      } else {
        strip(selDay);
        strip(t);
        out.def = { ...(out.def || {}), [mealIndex]: cur };
      }
      return out;
    });

  /* Neemt het volledige schema van dit dagtype over naar het andere. */
  /* Zet het dagritme van deze dag op alle dagen van hetzelfde type. */
  const applyRhythmToType = (i) => {
    const t = dayType(i);
    const cfg = { meals: week[i].meals, wake: week[i].wake, sleep: week[i].sleep };
    setWeek((w) => w.map((d, k) => (dayType(k) === t ? { ...d, ...cfg } : d)));
  };

  const copyToOtherType = () => {
    const from = dayType(selDay);
    const to = from === "training" ? "rust" : "training";
    setMealPlans((s) => {
      const src = {};
      meals.forEach((m, i) => {
        src[i] = itemsFor(selDay, i, m.label).map((x) => ({ ...x }));
      });
      return { ...s, [to]: { ...(s[to] || {}), ...src } };
    });
  };

  const shoppingList = useMemo(() => {
    if (!showList) return null;
    const tally = {};
    dayPlan.all.forEach((d, dayIdx) => {
      d.meals.forEach((m, i) => {
        const items = itemsFor(dayIdx, i, m.label);
        const built = buildMealPortions({
          target: { p: m.protein, c: m.carbs, f: m.fat },
          items,
          veg: i === 0 ? 0 : vegGrams,
          index: foodIndex,
        });
        built.portions.forEach((pp) => {
          if (pp.grams <= 0) return;
          if (!tally[pp.food]) tally[pp.food] = { label: pp.label, grams: 0, unitGrams: pp.unitGrams, unitLabel: pp.unitPlural };
          tally[pp.food].grams += pp.grams;
        });
      });
    });
    return Object.values(tally)
      .sort((a, b) => b.grams - a.grams)
      .map((t) => ({
        ...t,
        text: t.unitGrams
          ? `${Math.round(t.grams / t.unitGrams)} ${t.unitLabel} (${(t.grams / 1000).toFixed(2)} kg)`
          : t.grams >= 1000
          ? `${(t.grams / 1000).toFixed(2)} kg`
          : `${Math.round(t.grams)} g`,
      }));
  }, [dayPlan, mealPlans, vegGrams, showList, foodIndex, week]);

  const trend = useMemo(() => weightTrend(log), [log]);
  /* Na een faseovergang zegt de trend van de afgelopen weken niets over de
     huidige fase. Tijdens het opbouwen van de calorieën komt u bovendien
     bewust wat aan. In beide gevallen wacht de correctie. */
  const correctionPaused =
    planNow.active && (planNow.inPhase < 3 || planNow.row.phase === "reverse")
      ? planNow.row.phase === "reverse"
        ? "Tijdens het opbouwen van de calorieën komt u bewust wat aan, vooral glycogeen en vocht. De bijsturing wacht tot die fase voorbij is."
        : `U zit pas ${planNow.inPhase} ${planNow.inPhase === 1 ? "week" : "weken"} in deze fase. De trend van de afgelopen weken zegt daar nog niets over; de bijsturing wacht tot week 3 van de fase.`
      : null;
  const correction = useMemo(
    () =>
      correctionPaused
        ? null
        : calorieCorrection({
            trend,
            targetKgPerWeek: effGoal === "onderhoud" ? 0 : (effRate / 100) * weight,
            goal: effGoal,
          }),
    [trend, effRate, effGoal, weight, correctionPaused]
  );

  /* Het venster waar het plan mee rekent: een voorinstelling, of de grenzen
     die de gebruiker zelf invult, altijd binnen verantwoorde marges en met
     minimaal drie procentpunt ruimte tussen onder- en bovengrens. */
  const bfWindow = useMemo(() => {
    const presets = BF_WINDOW[f.sex] || BF_WINDOW.man;
    if (phaseCfg.windowKey !== "eigen") return presets[phaseCfg.windowKey] || presets.standaard;
    const L = BF_LIMITS[f.sex] || BF_LIMITS.man;
    const lo = Math.min(L.max - 3, Math.max(L.min, num(phaseCfg.bfLow, presets.standaard[0])));
    const hi = Math.min(L.max, Math.max(lo + 3, num(phaseCfg.bfHigh, presets.standaard[1])));
    return [lo, hi];
  }, [f.sex, phaseCfg.windowKey, phaseCfg.bfLow, phaseCfg.bfHigh]);

  const plan52 = useMemo(() => {
    if (!showPlan) return null;
    if (phaseCfg.mode === "doorlopend")
      return chainPlan({
        ...input,
        bfWindow,
        horizonWeeks: Number(phaseCfg.horizonWeeks) || 52,
        bulkRate: Number(phaseCfg.bulkRate) || 0.25,
        cutRate: Number(phaseCfg.cutRate) || 0.6,
        minicut: phaseCfg.minicut,
        minicutRate: Number(phaseCfg.minicutRate) || 0.75,
        maxMinicutWeeks: Number(phaseCfg.maxMinicutWeeks) || 5,
        blockWeeks: Number(phaseCfg.blockWeeks) || 16,
        cutBlockWeeks: Number(phaseCfg.cutBlockWeeks) || 10,
        maintWeeks: Number(phaseCfg.maintWeeks) || 3,
        priority: phaseCfg.priority,
        targetBf: phaseCfg.priority === "vorm" ? Number(phaseCfg.targetBf) : null,
      });
    return phasePlan({
      ...input,
      bfWindow,
      horizonWeeks: Number(phaseCfg.horizonWeeks) || 26,
      minicut: phaseCfg.minicut,
      minicutRate: Number(phaseCfg.minicutRate) || 0.75,
      maxMinicutWeeks: Number(phaseCfg.maxMinicutWeeks) || 5,
      recoveryWeeks: Number(phaseCfg.recoveryWeeks) || 2,
      targetWeight: f.goal === "cut" ? Number(phaseCfg.targetWeight) || null : null,
      blockWeeks: Number(phaseCfg.blockWeeks) || (f.goal === "bulk" ? 16 : 10),
      maintWeeks: Number(phaseCfg.maintWeeks) || 3,
    });
  }, [input, phaseCfg, showPlan, f.sex, f.goal, bfWindow]);

  /* Bouwt beide profielen op voor de afdruk: een trainingsdag en een rustdag,
     compleet met tijden, macro's en porties. */
  const printData = useMemo(() => {
    if (!printView) return null;
    return ["training", "rust"]
      .map((t) => {
        const days = DAYS.map((_, i) => i).filter((i) => dayType(i) === t);
        if (!days.length) return null;
        const d = days[0];
        const dp = dayPlan.all[d];
        const rows = dp.meals.map((m, i) => ({
          kind: "meal",
          index: i,
          time: m.time,
          name:
            m.label === "pre"
              ? "Maaltijd voor de training"
              : m.label === "post"
              ? "Maaltijd na de training"
              : i === 0
              ? "Eerste maaltijd"
              : i === dp.meals.length - 1
              ? "Laatste maaltijd"
              : `Maaltijd ${i + 1}`,
          protein: m.protein,
          carbs: m.carbs,
          fat: m.fat,
          kcal: m.kcal,
          ...(() => {
            const built = buildMealPortions({
              target: { p: m.protein, c: m.carbs, f: m.fat },
              items: itemsFor(d, i, m.label),
              veg: i === 0 ? 0 : vegGrams,
              index: foodIndex,
            });
            return { fib: built.actual.fib, _portions: built.portions };
          })(),
        }));
        rows.forEach((r) => {
          r.portions = r._portions.filter((pp) => pp.grams > 0).map((pp) => ({
            ...pp,
            alt: showAlts && pp.food !== "groente" ? (alternativesFor(pp.food, pp.grams, foodIndex, 1)[0] || null) : null,
          }));
          delete r._portions;
        });
        if (dp.plan.train) rows.push({ kind: "train", time: dp.plan.train.start, end: dp.plan.train.end });
        rows.sort((a, b) => a.time - b.time);
        const fib = rows.reduce((a, r) => a + (r.fib || 0), 0);
        return { type: t, days, kcal: dp.kcal, macros: dp.macros, rows, session: week[d].session, fib };
      })
      .filter(Boolean);
  }, [printView, dayPlan, mealPlans, vegGrams, foodIndex, week, showAlts]);

  const doPrint = () => {
    setPrintHint(null);
    try {
      window.print();
    } catch (e) {
      setPrintHint("Afdrukken is hier geblokkeerd. Gebruik 'Opslaan als bestand' en open dat bestand in uw browser.");
    }
  };

  const downloadSheet = () => {
    try {
      const node = document.getElementById("printSheets");
      if (!node) return;
      const html =
        '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        "<title>Voedingsschema</title><style>" +
        STYLE +
        "body{margin:0;padding:10mm;background:#fff}.sheet{margin:0 auto 10mm;max-width:190mm}</style></head>" +
        '<body class="macroapp">' +
        node.innerHTML +
        "</body></html>";
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "voedingsschema.html";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setPrintHint("Bestand opgeslagen. Open het en kies in uw browser Afdrukken, met als bestemming 'Opslaan als pdf'.");
    } catch (e) {
      setPrintHint("Opslaan lukte niet in deze weergave.");
    }
  };

  /* Groente en fruit in het schema van de gekozen dag. */
  const produceDay = useMemo(() => {
    if (!portionPlan) return null;
    let veg = 0;
    let fruit = 0;
    portionPlan.forEach((m) =>
      m.portions.forEach((pp) => {
        if (pp.grams <= 0) return;
        if (VEG_IDS[pp.food]) veg += pp.grams * VEG_IDS[pp.food];
        if (FRUIT_IDS[pp.food]) fruit += pp.grams * FRUIT_IDS[pp.food];
      })
    );
    const t = PRODUCE_TARGETS[f.produceTarget] || PRODUCE_TARGETS.kuba;
    return { veg, fruit, t };
  }, [portionPlan, f.produceTarget]);

  /* Hoeveel verschillende bronnen staan er deze week op het menu? */
  const weekVariety = useMemo(() => {
    const sets = { protein: new Map(), carb: new Map(), fruit: new Map(), veg: new Map() };
    dayPlan.all.forEach((d, dayIdx) => {
      d.meals.forEach((m, i) => {
        const built = buildMealPortions({
          target: { p: m.protein, c: m.carbs, f: m.fat },
          items: itemsFor(dayIdx, i, m.label),
          veg: i === 0 ? 0 : vegGrams,
          index: foodIndex,
        });
        built.portions.forEach((pp) => {
          if (pp.grams <= 0) return;
          const add = (k) => sets[k].set(pp.food, pp.label);
          if (FRUIT_IDS[pp.food]) add("fruit");
          else if (VEG_IDS[pp.food]) add("veg");
          else if (pp.cat === "protein") add("protein");
          else if (pp.cat === "carb") add("carb");
        });
      });
    });
    const out = {};
    Object.entries(sets).forEach(([k, m]) => (out[k] = [...m.values()]));
    return out;
  }, [dayPlan, mealPlans, vegGrams, foodIndex, week]);

  /* Slaapanalyse per dag: tijd in bed, laatste maaltijd, cafeïnegrens en
     de afstand tussen training en bedtijd. */
  const sleepCheck = useMemo(() => {
    const caf = CAFFEINE[f.caffeineUse] || CAFFEINE.koffie;
    const days = DAYS.map((_, i) => {
      const dp = dayPlan.all[i];
      const hours = (1440 - (dp.sleepM - dp.wakeM)) / 60;
      const s = week[i].session;
      let trainGap = null;
      let preConflict = false;
      const cutoff = caf.hours ? dp.sleepM - caf.hours * 60 : null;
      if (s) {
        let st = toMin(s.start);
        if (st < dp.wakeM) st += 1440;
        trainGap = dp.sleepM - (st + num(s.minutes, 60));
        preConflict = f.caffeineUse === "preworkout" && cutoff != null && st - 30 > cutoff;
      }
      const last = dp.meals[dp.meals.length - 1];
      return {
        i,
        hours,
        wakeM: dp.wakeM,
        sleepM: dp.sleepM,
        trainGap,
        preConflict,
        cutoff,
        lastBefore: dp.lastBefore,
        lastShare: last.kcal / dp.kcal,
        lastLate: !!last.late,
      };
    });
    const wakes = days.map((d) => d.wakeM);
    const hrs = days.map((d) => d.hours);
    return {
      caf,
      days,
      wakeSpread: Math.max(...wakes) - Math.min(...wakes),
      minHours: Math.min(...hrs),
      maxHours: Math.max(...hrs),
      minTrainGap: Math.min(...days.map((d) => (d.trainGap == null ? 9999 : d.trainGap))),
      preDays: days.filter((d) => d.preConflict).map((d) => d.i),
    };
  }, [dayPlan, week, f.caffeineUse]);

  /* Wat de gebruiker nu voorgeschoteld krijgt, samengevat voor vergelijking. */
  const scheduleNow = useMemo(() => {
    const pick = (t) => {
      const d = DAYS.map((_, i) => i).find((i) => dayType(i) === t);
      if (d == null) return null;
      const x = dayPlan.all[d];
      return { kcal: Math.round(x.kcal), p: Math.round(x.macros.protein), c: Math.round(x.macros.carbs), f: Math.round(x.macros.fat) };
    };
    return {
      week: planNow.active ? planNow.week : null,
      phase: planNow.active ? planNow.row.phase : null,
      avg: Math.round(energy.avgTarget),
      training: pick("training"),
      rust: pick("rust"),
    };
  }, [planNow, energy, dayPlan, week]);

  const planUpdate = useMemo(() => {
    if (!planNow.active) return null;
    const ls = lastSeen;
    if (!ls) return { first: true };
    const weekChanged = ls.week !== scheduleNow.week;
    const phaseChanged = ls.phase !== scheduleNow.phase;
    const kcalChanged = Math.abs((ls.avg || 0) - scheduleNow.avg) >= 50;
    if (!weekChanged && !phaseChanged && !kcalChanged) return null;
    return { weekChanged, phaseChanged, kcalChanged, prev: ls };
  }, [planNow, lastSeen, scheduleNow]);

  const acknowledge = () => setLastSeen(scheduleNow);

  const startPlan = () => {
    if (!plan52 || !plan52.rows.length) return;
    setAutopilot({
      start: planStartInput || new Date().toISOString().slice(0, 10),
      rows: snapshotPlan(plan52.rows),
      mode: phaseCfg.mode,
      created: new Date().toISOString().slice(0, 10),
    });
    setLastSeen(null);
    setConfirmStop(false);
  };

  const stopPlan = () => {
    setAutopilot(null);
    setLastSeen(null);
    setConfirmStop(false);
  };

  const hormone = useMemo(() => {
    const bf = f.useBodyFat ? Number(f.bodyFat) : null;
    const ffm = bf ? weight * (1 - bf / 100) : weight * (f.sex === "man" ? 0.85 : 0.75);
    const exercisePerDay = sum(energy.sess) / 7;
    const ea = (energy.avgTarget - exercisePerDay) / ffm;
    const fatPct = ((macros.fat * 9) / dayPlan.today.kcal) * 100;
    const sleepHours = ((toMin(f.wake) - toMin(f.sleep) + 1440) % 1440) / 60;
    const fatRange = f.sex === "man" ? [10, 20] : [18, 28];
    return { ffm, ea, fatPct, sleepHours, bf, fatRange, estimated: !bf };
  }, [f, energy, macros, dayPlan, weight]);

  const events = useMemo(() => {
    const list = meals.map((m, i) => ({ kind: "meal", ...m, index: i }));
    if (plan.train) list.push({ kind: "train", time: plan.train.start, end: plan.train.end });
    return list.sort((a, b) => a.time - b.time);
  }, [meals, plan]);

  const mealName = (label, i, n) =>
    label === "pre"
      ? "Maaltijd voor de training"
      : label === "post"
      ? "Maaltijd na de training"
      : i === 0
      ? "Eerste maaltijd"
      : i === n - 1
      ? "Laatste maaltijd"
      : `Maaltijd ${i + 1}`;

  const session = week[selDay].session;
  /* Richtlijn Gezondheidsraad: 3,4 g vezels per megajoule, ongeveer 14 g per 1000 kcal. */
  const fibre = Math.round((dayPlan.today.kcal / 1000) * 14);
  const fibreDay = portionPlan ? portionPlan.reduce((a, m) => a + (m.actual.fib || 0), 0) : null;
  const water = Math.round(weight * 35 + (session ? (session.minutes / 60) * 600 : 0));

  const makeText = () => {
    const lines = [
      `Macroverdeling - week van ${dateNL(new Date())}`,
      `Weekgemiddelde ${Math.round(energy.avgTarget)} kcal · verwacht ${energy.realKgPerWeek > 0 ? "+" : ""}${energy.realKgPerWeek.toFixed(2)} kg per week`,
      "",
      ...DAYS.map(
        (d, i) =>
          `${DAY_FULL[i]}: ${Math.round(energy.kcals[i])} kcal${week[i].session ? ` (${SESSIONS.find((s) => s.id === week[i].session.type).label}, ${week[i].session.minutes} min vanaf ${week[i].session.start})` : ""}`
      ),
      "",
      `${DAY_FULL[selDay]} in detail`,
      `Eiwit ${Math.round(macros.protein)} g | Koolhydraten ${Math.round(macros.carbs)} g | Vet ${Math.round(macros.fat)} g`,
      "",
      ...meals.flatMap((m, i) => {
        const head = `${toHHMM(m.time)}  ${mealName(m.label, i, meals.length)}: ${m.protein} g eiwit, ${m.carbs} g kh, ${m.fat} g vet (${Math.round(m.kcal)} kcal)`;
        if (!portionPlan) return [head];
        return [head, ...portionPlan[i].portions.map((pp) => `          ${pp.text}`)];
      }),
    ];
    if (plan.train)
      lines.splice(
        lines.indexOf(`${DAY_FULL[selDay]} in detail`) + 3,
        0,
        `${toHHMM(plan.train.start)}  Training tot ${toHHMM(plan.train.end)}`,
        ""
      );
    if (shoppingList) {
      lines.push("", "Boodschappen voor de hele week");
      shoppingList.forEach((x) => lines.push(`  ${x.label}: ${x.text}`));
    }
    const text = lines.join("\n");
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    setPlainText(text);
  };

  const mealTarget = (i) => {
    const m = meals[i];
    const veg = i === 0 ? 0 : vegGrams;
    const vg = foodIndex.groente;
    return {
      p: Math.max(0, m.protein - (vg.p * veg) / 100),
      c: Math.max(0, m.carbs - (vg.c * veg) / 100),
      f: Math.max(0, m.fat - (vg.f * veg) / 100),
    };
  };

  const insertSavedMeal = (mealIndex, savedId) => {
    const sm = savedMeals.find((x) => x.id === savedId);
    if (!sm) return;
    const scaled = scaleItems(sm.items, mealTarget(mealIndex), foodIndex);
    setItems(mealIndex, () => scaled);
  };

  const rescaleMeal = (mealIndex) => {
    const cur = itemsFor(selDay, mealIndex, meals[mealIndex].label);
    const withGrams = portionPlan[mealIndex].portions
      .filter((x) => x.food !== "groente" && x.grams > 0)
      .map((x) => ({ food: x.food, grams: x.grams }));
    if (!withGrams.length) return;
    setItems(mealIndex, () => scaleItems(withGrams, mealTarget(mealIndex), foodIndex));
  };

  const saveMealAs = (mealIndex) => {
    const name = newMealName.trim();
    if (!name) return;
    const items = portionPlan[mealIndex].portions
      .filter((x) => x.food !== "groente" && x.grams > 0)
      .map((x) => ({ food: x.food, grams: x.grams }));
    if (!items.length) return;
    setSavedMeals((l) => [...l, { id: `maaltijd_${Date.now().toString(36)}`, name, items }]);
    setNewMealName("");
    setSavingMeal(null);
  };

  const applyPhase = () => {
    if (!plan52 || !plan52.rows.length) return;
    const ph = plan52.rows[0].phase;
    if (ph === "bulk") setF((s) => ({ ...s, goal: "bulk", rate: Number(phaseCfg.bulkRate) || 0.25 }));
    else if (ph === "minicut") setF((s) => ({ ...s, goal: "cut", rate: -(Number(phaseCfg.minicutRate) || 0.75) }));
    else if (ph === "cut" || ph === "slotcut") setF((s) => ({ ...s, goal: "cut", rate: -(Number(phaseCfg.cutRate) || 0.6) }));
    else setF((s) => ({ ...s, goal: "onderhoud", rate: 0 }));
  };

  /* Zet herkende waarden in het formulier en controleer ze tegen de
     kilocalorieën op het etiket. */
  const applyLabel = (v, naam, bron) => {
    const round = (x) => (x == null ? "" : String(Math.round(x * 10) / 10));
    setNewFood((s) => ({
      ...s,
      label: naam ? naam : s.label,
      p: round(v.eiwit),
      c: round(v.koolhydraten),
      f: round(v.vet),
      fib: v.vezels == null ? s.fib : round(v.vezels),
    }));
    const calc = labelKcal(v);
    const diff = v.kcal ? calc - v.kcal : 0;
    if (v.kcal && Math.abs(diff) > Math.max(20, v.kcal * 0.1)) {
      setLabelMsg({
        tone: "let",
        text: `${bron} Let op: uit de herkende waarden volgt ${Math.round(calc)} kcal per 100 g, terwijl het etiket ${Math.round(
          v.kcal
        )} kcal vermeldt. Controleer de velden voordat u opslaat.`,
      });
    } else {
      setLabelMsg({ tone: "goed", text: `${bron} Controleer de waarden en sla het product op.` });
    }
  };

  const readPhoto = async (file) => {
    setLabelBusy(true);
    setLabelMsg({ tone: "let", text: "Het etiket wordt gelezen. Dit duurt meestal enkele seconden." });
    setPendingPortion(null);
    try {
      const r = await readLabelWithClaude(file);
      const naam = r && typeof r.naam === "string" && r.naam.trim() ? r.naam.trim() : null;
      const note = r && r.opmerking ? ` ${r.opmerking}` : "";
      const laag = r && r.zekerheid === "laag" ? " De foto was deels lastig leesbaar." : "";
      if (r && r.per100 && r.per100.eiwit != null) {
        applyLabel(r.per100, naam, "Waarden per 100 g overgenomen." + laag + note);
      } else if (r && r.perPortie && r.perPortie.eiwit != null && r.portieGram > 0) {
        const k = 100 / r.portieGram;
        const v = {};
        ["kcal", "eiwit", "koolhydraten", "vet", "vezels"].forEach((x) => (v[x] = r.perPortie[x] == null ? null : r.perPortie[x] * k));
        applyLabel(v, naam, `Omgerekend van ${r.portieGram} g per portie naar 100 g.` + laag + note);
      } else if (r && r.perPortie && r.perPortie.eiwit != null) {
        setPendingPortion({ values: r.perPortie, naam });
        setLabelMsg(null);
      } else {
        setLabelMsg({ tone: "fout", text: "Geen voedingswaardetabel herkend." + note + " Probeer een scherpere foto van alleen de tabel, of gebruik Tekst plakken." });
      }
    } catch (e) {
      const code = e && e.code;
      setLabelMsg({
        tone: "fout",
        text:
          code === "not_granted"
            ? "U heeft geen toestemming gegeven om Claude te gebruiken. Vul de waarden zelf in of gebruik Tekst plakken."
            : code === "rate_limited"
            ? "Te veel aanvragen achter elkaar. Probeer het over een minuut opnieuw."
            : code === "images_unavailable"
            ? "Foto's kunnen in deze weergave niet verstuurd worden. Gebruik Tekst plakken."
            : `Analyse mislukt: ${(e && e.message) || "onbekende fout"}. Gebruik Tekst plakken of vul de waarden zelf in.`,
      });
    } finally {
      setLabelBusy(false);
    }
  };

  const convertPortion = () => {
    const g = Number(portionInput);
    if (!g || g <= 0) return;
    const k = 100 / g;
    const src = pendingPortion.values;
    const v = {};
    ["kcal", "eiwit", "koolhydraten", "vet", "vezels"].forEach((x) => (v[x] = src[x] == null ? null : src[x] * k));
    applyLabel(v, pendingPortion.naam, `Omgerekend van ${g} g per portie naar 100 g.`);
    setPendingPortion(null);
    setPortionInput("");
  };

  const readPaste = () => {
    const r = parseLabelText(pasteText);
    if (r.missing.length) {
      setLabelMsg({
        tone: "fout",
        text: `Niet gevonden in de tekst: ${r.missing.join(", ")}. Plak de hele tabel, inclusief de regels met de getallen, of vul die velden zelf in.`,
      });
      if (r.values.eiwit == null && r.values.koolhydraten == null && r.values.vet == null) return;
    }
    if (!r.per100 && r.portie) {
      const k = 100 / r.portie;
      const v = {};
      ["kcal", "eiwit", "koolhydraten", "vet", "vezels"].forEach((x) => (v[x] = r.values[x] == null ? null : r.values[x] * k));
      applyLabel(v, null, `Omgerekend van ${r.portie} g per portie naar 100 g.`);
    } else {
      applyLabel(r.values, null, "Waarden uit de tekst overgenomen.");
    }
    setPasteOpen(false);
  };

  const addFood = () => {
    const label = newFood.label.trim();
    const p = Number(newFood.p) || 0;
    const c = Number(newFood.c) || 0;
    const fa = Number(newFood.f) || 0;
    const unitGrams = Number(newFood.unitGrams) || 0;
    if (!label) return setFoodError("Geef het product een naam.");
    if (p + c + fa <= 0) return setFoodError("Vul minstens een van de drie macro's in.");
    if (p > 100 || c > 100 || fa > 100 || Number(newFood.fib) > 100) return setFoodError("Per 100 g kan geen enkele waarde boven 100 g uitkomen.");
    if (p + c + fa > 100) return setFoodError("Eiwit, koolhydraten en vet samen kunnen niet meer dan 100 g per 100 g zijn.");
    if (unitGrams && !newFood.unitLabel.trim())
      return setFoodError("Vul ook in hoe u een stuk noemt, bijvoorbeeld reep.");
    const unitLabel = newFood.unitLabel.trim();
    const fib = Math.max(0, Number(newFood.fib) || 0);
    const record = {
      label,
      cat: newFood.cat,
      p,
      c,
      f: fa,
      fib,
      ...(unitGrams
        ? { unitGrams, unitLabel, unitPlural: unitLabel.endsWith("s") ? unitLabel : `${unitLabel}s` }
        : { step: 5 }),
    };
    if (editingFood) {
      /* Zelfde id behouden: maaltijden en bewaarde recepten die dit product
         gebruiken, rekenen daardoor meteen met de nieuwe waarden. */
      setCustomFoods((l) => l.map((x) => (x.id === editingFood ? { id: x.id, ...record } : x)));
      setEditingFood(null);
    } else {
      setCustomFoods((l) => [...l, { id: `eigen_${Date.now().toString(36)}`, ...record }]);
    }
    setNewFood({ label: "", cat: newFood.cat, p: "", c: "", f: "", fib: "", unitGrams: "", unitLabel: "" });
    setFoodError(null);
  };

  const startEditFood = (fo) => {
    setNewFood({
      label: fo.label,
      cat: fo.cat || "protein",
      p: String(fo.p),
      c: String(fo.c),
      f: String(fo.f),
      fib: fo.fib ? String(fo.fib) : "",
      unitGrams: fo.unitGrams ? String(fo.unitGrams) : "",
      unitLabel: fo.unitLabel || "",
    });
    setEditingFood(fo.id);
    setConfirmFood(null);
    setFoodError(null);
    try {
      foodFormRef.current && foodFormRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      /* niet elke omgeving kent scrollIntoView */
    }
  };

  const cancelEditFood = () => {
    setEditingFood(null);
    setLabelMsg(null);
    setPendingPortion(null);
    setNewFood({ label: "", cat: "protein", p: "", c: "", f: "", fib: "", unitGrams: "", unitLabel: "" });
    setFoodError(null);
  };

  const removeFood = (id) => {
    if (editingFood === id) cancelEditFood();
    setCustomFoods((l) => l.filter((x) => x.id !== id));
    setMealPlans((s) => {
      const out = {};
      Object.entries(s).forEach(([k, items]) => (out[k] = items.filter((it) => it.food !== id)));
      return out;
    });
    setConfirmFood(null);
  };

  const addEntry = () => {
    const w = Number(newEntry.weight);
    if (!w || w < 30 || w > 300) return;
    setLog((l) => [...l.filter((e) => e.date !== newEntry.date), { date: newEntry.date, weight: w }].sort((a, b) => a.date.localeCompare(b.date)));
    setNewEntry({ date: todayISO(), weight: "" });
  };

  /* ---------------- weergave ---------------- */

  return (
    <div className="min-h-screen w-full" style={{ background: C.bg, color: C.ink }}>
      <style>{STYLE}</style>
      <span className="grain" aria-hidden="true" />

      {/* ---------------- afdrukweergave ---------------- */}
      {printData && (
        <div
          className="print-root macroapp fixed inset-0 z-50 overflow-y-auto"
          style={{ background: "#6B6F76", padding: "16px 12px 80px" }}
          role="dialog"
          aria-label="Afdrukweergave"
        >
          <div className="no-print fixed left-0 right-0 bottom-0 z-10" style={{ background: C.dark, color: C.darkInk }}>
            <div className="mx-auto max-w-2xl px-4 py-3 flex items-center gap-2">
              <button
                onClick={() => setPrintView(false)}
                className="tap px-3 py-2 text-sm"
                style={{ border: `1px solid ${C.darkLine}`, color: C.darkMuted, borderRadius: R.field }}
              >
                Sluiten
              </button>
              <button
                onClick={downloadSheet}
                className="tap px-3 py-2 text-sm"
                style={{ border: `1px solid ${C.darkLine}`, color: C.darkInk, borderRadius: R.field }}
              >
                Opslaan als bestand
              </button>
              <button
                onClick={doPrint}
                className="tap flex-1 py-2.5 disp text-lg font-bold uppercase"
                style={{ background: "var(--accent)", color: "var(--on-accent)", borderRadius: R.field }}
              >
                Afdrukken of pdf
              </button>
            </div>
            {printHint && (
              <div className="mx-auto max-w-2xl px-4 pb-3 text-xs leading-relaxed" style={{ color: C.darkMuted }}>
                {printHint}
              </div>
            )}
          </div>

          <div id="printSheets">
            {printData.map((p) => (
              <div
                key={p.type}
                className="sheet mx-auto mb-4"
                style={{ width: "190mm", maxWidth: "100%", padding: "14mm", boxShadow: "0 8px 30px rgba(0,0,0,.35)" }}
              >
                <div className="flex items-end justify-between gap-4" style={{ borderBottom: "3px solid #0B0D11", paddingBottom: 8 }}>
                  <div>
                    <div className="disp text-3xl font-bold uppercase leading-none ink">
                      {p.type === "training" ? "Trainingsdag" : "Rustdag"}
                    </div>
                    <div className="text-xs mt-1 soft">
                      {p.days.map((d) => DAY_FULL[d]).join(", ")}
                      {p.session ? ` · ${SESSIONS.find((x) => x.id === p.session.type).label}, ${p.session.minutes} min vanaf ${p.session.start}` : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="disp text-4xl font-bold leading-none tnum ink">{Math.round(p.kcal)}</div>
                    <div className="text-xs soft">kcal</div>
                  </div>
                </div>

                <div className="flex gap-4 mt-3">
                  {[
                    { k: "Eiwit", g: p.macros.protein, col: "#2B4BFF" },
                    { k: "Koolhydraten", g: p.macros.carbs, col: "#00A36C" },
                    { k: "Vet", g: p.macros.fat, col: "#D08700" },
                  ].map((m) => (
                    <div key={m.k} className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: m.col }} />
                        <span className="text-xs soft">{m.k}</span>
                      </div>
                      <div className="disp text-2xl font-bold tnum leading-none ink">{Math.round(m.g)} g</div>
                    </div>
                  ))}
                </div>
                <div className="flex w-full mt-2" style={{ height: 8, borderRadius: 4, overflow: "hidden" }}>
                  {[
                    { w: (p.macros.protein * 4) / p.kcal, c: "#2B4BFF" },
                    { w: (p.macros.carbs * 4) / p.kcal, c: "#00A36C" },
                    { w: (p.macros.fat * 9) / p.kcal, c: "#D08700" },
                  ].map((x, k) => (
                    <div key={k} style={{ width: `${x.w * 100}%`, background: x.c }} />
                  ))}
                </div>

                <div className="mt-5">
                  {p.rows.map((r) =>
                    r.kind === "train" ? (
                      <div
                        key={"t" + r.time}
                        className="meal flex items-center gap-3 my-2 px-3 py-1.5"
                        style={{ background: "#0B0D11", color: "#fff", borderRadius: 6 }}
                      >
                        <span className="disp text-base font-bold tnum">{toHHMM(r.time)}</span>
                        <span className="disp text-base font-bold uppercase">Training tot {toHHMM(r.end)}</span>
                      </div>
                    ) : (
                      <div key={r.index} className="meal flex gap-3 py-2" style={{ borderTop: "1px solid #D7DAE0" }}>
                        <span
                          style={{ width: 13, height: 13, border: "1.5px solid #0B0D11", borderRadius: 3, marginTop: 4, flexShrink: 0 }}
                          aria-hidden="true"
                        />
                        <div className="disp text-lg font-bold tnum ink shrink-0" style={{ width: 52 }}>
                          {toHHMM(r.time)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-sm font-semibold ink">{r.name}</span>
                            <span className="text-xs tnum soft shrink-0">
                              {r.protein} e · {r.carbs} k · {r.fat} v · {Math.round(r.fib || 0)} vez · {Math.round(r.kcal)} kcal
                            </span>
                          </div>
                          <ul className="text-sm mt-0.5 ink" style={{ columns: r.portions.length > 4 ? 2 : 1, columnGap: "14px" }}>
                            {r.portions.map((pp, k) => (
                              <li key={k} className="tnum" style={{ breakInside: "avoid" }}>
                                {pp.text}
                                {pp.alt && (
                                  <span className="soft" style={{ fontSize: "0.82em" }}>
                                    {" "}
                                    (of {pp.alt.text})
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )
                  )}
                </div>

                <div
                  className="flex items-end justify-between gap-4 mt-4 pt-2 text-xs soft"
                  style={{ borderTop: "3px solid #0B0D11" }}
                >
                  <div className="leading-relaxed">
                    Vezels {Math.round(p.fib)} g van {Math.round((p.kcal / 1000) * 14)} g · vocht{" "}
                    {((weight * 35 + (p.session ? (p.session.minutes / 60) * 600 : 0)) / 1000).toFixed(1)} liter
                    {sleepCheck.caf.hours && sleepCheck.days[p.days[0]].cutoff != null && (
                      <>
                        {" · "}
                        {sleepCheck.caf.label.toLowerCase()} uiterlijk {toHHMM(sleepCheck.days[p.days[0]].cutoff)}
                      </>
                    )}
                    <br />
                    Gewichten van vlees, vis, rijst en pasta zijn bereid gewicht.
                  </div>
                  <div className="text-right shrink-0">
                    Macroverdeling
                    <br />
                    {dateNL(new Date())}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}


      {/* ---------------- begeleide start ---------------- */}
      {onboarding !== null && (
        <div
          className="no-print fixed inset-0 z-50 overflow-y-auto"
          style={{ background: C.dark, color: C.darkInk, paddingTop: "env(safe-area-inset-top, 0px)" }}
          role="dialog"
          aria-label="Begeleide start"
        >
          <div className="macroapp mx-auto max-w-2xl px-5 py-6 min-h-full flex flex-col">
            <div className="flex gap-1.5 mb-6">
              {ONB.map((_, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-full"
                  style={{
                    height: 3,
                    background: i <= onboarding ? "var(--accent)" : "rgba(255,255,255,.18)",
                    transition: "background-color .3s ease",
                  }}
                />
              ))}
            </div>

            <div className="flex-1" key={onboarding}>
              <div className="hero-in">
                <div className="text-xs mb-1" style={{ color: C.darkMuted }}>
                  Stap {onboarding + 1} van {ONB.length}
                </div>
                <h2 className="disp text-4xl font-bold uppercase leading-none mb-1">{ONB[onboarding].title}</h2>
                <p className="text-sm leading-relaxed mb-5" style={{ color: C.darkMuted, maxWidth: "46ch" }}>
                  {ONB[onboarding].sub}
                </p>
              </div>

              {onboarding === 0 && (
                <div className="grid gap-4">
                  <ObRow label="Ik ben">
                    <ObSeg
                      value={f.sex}
                      onChange={(v) => set("sex", v)}
                      options={[
                        { value: "man", label: "Man" },
                        { value: "vrouw", label: "Vrouw" },
                      ]}
                    />
                  </ObRow>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { k: "age", label: "Leeftijd", u: "jaar", step: 1 },
                      { k: "height", label: "Lengte", u: "cm", step: 1 },
                      { k: "weight", label: "Gewicht", u: "kg", step: 0.5 },
                    ].map((x) => (
                      <div key={x.k}>
                        <div className="text-xs mb-1" style={{ color: C.darkMuted }}>
                          {x.label}
                        </div>
                        <input
                          type="number"
                          inputMode="decimal"
                          step={x.step}
                          value={f[x.k]}
                          onChange={(ev) => set(x.k, ev.target.value === "" ? "" : Number(ev.target.value))}
                          className="w-full px-3 py-2.5 disp text-2xl font-bold tnum" data-field
                          style={{ background: "rgba(255,255,255,.07)", border: `1px solid ${C.darkLine}`, color: C.darkInk }}
                          aria-label={x.label}
                        />
                        <div className="text-xs mt-1" style={{ color: C.darkMuted }}>
                          {x.u}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {onboarding === 1 && (
                <div className="grid gap-2">
                  {BF_STEPS(f.sex).map((b, bi, arr) => {
                    const cur = num(f.bodyFat, arr[2].v);
                    let near = 0;
                    arr.forEach((x, k) => {
                      if (Math.abs(x.v - cur) < Math.abs(arr[near].v - cur)) near = k;
                    });
                    const on = f.useBodyFat && near === bi;
                    return (
                      <button
                        key={b.v}
                        onClick={() => setF((s) => ({ ...s, useBodyFat: true, bodyFat: b.v, bodyFatSex: s.sex }))}
                        className="tap text-left px-4 py-3"
                        style={{
                          background: on ? "var(--accent)" : "rgba(255,255,255,.07)",
                          border: `1px solid ${on ? "var(--accent)" : C.darkLine}`,
                          borderRadius: R.field,
                          color: on ? "var(--on-accent)" : C.darkInk,
                        }}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-semibold">{b.label}</span>
                          <span className="disp text-xl font-bold tnum">{b.v}%</span>
                        </div>
                        <div className="text-xs mt-0.5" style={{ opacity: 0.8 }}>
                          {b.hint}
                        </div>
                      </button>
                    );
                  })}
                  <button
                    onClick={() => set("useBodyFat", false)}
                    className="tap text-left px-4 py-3"
                    style={{
                      background: !f.useBodyFat ? "var(--accent)" : "rgba(255,255,255,.07)",
                      border: `1px solid ${!f.useBodyFat ? "var(--accent)" : C.darkLine}`,
                      borderRadius: R.field,
                      color: !f.useBodyFat ? "var(--on-accent)" : C.darkInk,
                    }}
                  >
                    <span className="text-sm font-semibold">Liever overslaan</span>
                    <div className="text-xs mt-0.5" style={{ opacity: 0.8 }}>
                      De app rekent dan op lichaamsgewicht in plaats van vetvrije massa.
                    </div>
                  </button>
                </div>
              )}

              {onboarding === 2 && (
                <div className="grid gap-2">
                  {ACTIVITY.map((a) => {
                    const on = f.activity === a.id;
                    return (
                      <button
                        key={a.id}
                        onClick={() => set("activity", a.id)}
                        className="tap text-left px-4 py-3 text-sm font-medium"
                        style={{
                          background: on ? "var(--accent)" : "rgba(255,255,255,.07)",
                          border: `1px solid ${on ? "var(--accent)" : C.darkLine}`,
                          borderRadius: R.field,
                          color: on ? "var(--on-accent)" : C.darkInk,
                        }}
                      >
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {onboarding === 3 && (
                <div className="grid gap-4">
                  <div>
                    <div className="text-xs mb-2" style={{ color: C.darkMuted }}>
                      Op welke dagen traint u?
                    </div>
                    <div className="flex gap-1.5">
                      {DAYS.map((d, i) => {
                        const on = !!week[i].session;
                        return (
                          <button
                            key={d}
                            onClick={() =>
                              setDay(i, {
                                session: on ? null : { type: obTrain.type, minutes: obTrain.minutes, start: obTrain.start },
                              })
                            }
                            className="tap flex-1 py-2.5 disp text-base font-bold uppercase"
                            style={{
                              background: on ? "var(--accent)" : "rgba(255,255,255,.07)",
                              border: `1px solid ${on ? "var(--accent)" : C.darkLine}`,
                              borderRadius: R.field,
                              color: on ? "var(--on-accent)" : C.darkMuted,
                            }}
                            aria-pressed={on}
                          >
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <ObRow label="Soort training">
                    <select
                      value={obTrain.type}
                      onChange={(ev) => {
                        const v = ev.target.value;
                        setObTrain((s) => ({ ...s, type: v }));
                        setWeek((w) => w.map((d) => (d.session ? { ...d, session: { ...d.session, type: v } } : d)));
                      }}
                      className="w-full px-3 py-2 text-sm" data-field
                      style={{ background: "rgba(255,255,255,.07)", border: `1px solid ${C.darkLine}`, color: C.darkInk }}
                    >
                      {SESSIONS.map((o) => (
                        <option key={o.id} value={o.id} style={{ color: "#000" }}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </ObRow>
                  <div className="grid grid-cols-2 gap-2">
                    <ObRow label="Duur per sessie">
                      <input
                        type="number"
                        step={5}
                        value={obTrain.minutes}
                        onChange={(ev) => {
                          const v = Number(ev.target.value) || 60;
                          setObTrain((s) => ({ ...s, minutes: v }));
                          setWeek((w) => w.map((d) => (d.session ? { ...d, session: { ...d.session, minutes: v } } : d)));
                        }}
                        className="w-full px-3 py-2 disp text-xl font-bold tnum" data-field
                        style={{ background: "rgba(255,255,255,.07)", border: `1px solid ${C.darkLine}`, color: C.darkInk }}
                        aria-label="Duur per sessie in minuten"
                      />
                    </ObRow>
                    <ObRow label="Rond welk tijdstip">
                      <input
                        type="time"
                        value={obTrain.start}
                        onChange={(ev) => {
                          const v = ev.target.value;
                          setObTrain((s) => ({ ...s, start: v }));
                          setWeek((w) => w.map((d) => (d.session ? { ...d, session: { ...d.session, start: v } } : d)));
                        }}
                        className="w-full px-3 py-2 text-sm tnum" data-field
                        style={{ background: "rgba(255,255,255,.07)", border: `1px solid ${C.darkLine}`, color: C.darkInk }}
                        aria-label="Starttijd van de training"
                      />
                    </ObRow>
                  </div>
                </div>
              )}

              {onboarding === 4 && (
                <div className="grid gap-4">
                  <div>
                    <div className="text-xs mb-2" style={{ color: C.darkMuted }}>
                      Wat wilt u bereiken?
                    </div>
                    <div className="grid gap-2">
                      {[
                        { v: "cut", label: "Vetverlies", hint: "Afvallen met behoud van spiermassa" },
                        { v: "onderhoud", label: "Onderhoud", hint: "Gewicht stabiel, prestaties omhoog" },
                        { v: "bulk", label: "Opbouw", hint: "Spiermassa erbij, vetwinst beperkt houden" },
                      ].map((g) => {
                        const on = f.goal === g.v;
                        return (
                          <button
                            key={g.v}
                            onClick={() =>
                              setF((s) => ({
                                ...s,
                                goal: g.v,
                                rate: g.v === "bulk" ? EXPERIENCE.find((e) => e.id === s.experience).rate : RATES[g.v][g.v === "onderhoud" ? 0 : 1].v,
                              }))
                            }
                            className="tap text-left px-4 py-3"
                            style={{
                              background: on ? "var(--accent)" : "rgba(255,255,255,.07)",
                              border: `1px solid ${on ? "var(--accent)" : C.darkLine}`,
                              borderRadius: R.field,
                              color: on ? "var(--on-accent)" : C.darkInk,
                            }}
                          >
                            <div className="text-sm font-semibold">{g.label}</div>
                            <div className="text-xs mt-0.5" style={{ opacity: 0.8 }}>
                              {g.hint}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <ObRow label="Opstaan">
                      <input
                        type="time"
                        value={f.wake}
                        onChange={(ev) => set("wake", ev.target.value)}
                        className="w-full px-2 py-2 text-sm tnum" data-field
                        style={{ background: "rgba(255,255,255,.07)", border: `1px solid ${C.darkLine}`, color: C.darkInk }}
                      />
                    </ObRow>
                    <ObRow label="Naar bed">
                      <input
                        type="time"
                        value={f.sleep}
                        onChange={(ev) => set("sleep", ev.target.value)}
                        className="w-full px-2 py-2 text-sm tnum" data-field
                        style={{ background: "rgba(255,255,255,.07)", border: `1px solid ${C.darkLine}`, color: C.darkInk }}
                      />
                    </ObRow>
                    <ObRow label="Maaltijden">
                      <input
                        type="number"
                        min={2}
                        max={7}
                        value={f.meals}
                        onChange={(ev) => set("meals", Math.max(2, Math.min(7, Number(ev.target.value) || 4)))}
                        className="w-full px-2 py-2 disp text-xl font-bold tnum" data-field
                        style={{ background: "rgba(255,255,255,.07)", border: `1px solid ${C.darkLine}`, color: C.darkInk }}
                        aria-label="Aantal maaltijden per dag"
                      />
                    </ObRow>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-6">
              {onboarding > 0 && (
                <button
                  onClick={() => setOnboarding(onboarding - 1)}
                  className="tap px-4 py-3 text-sm"
                  style={{ border: `1px solid ${C.darkLine}`, color: C.darkMuted, borderRadius: R.field }}
                >
                  Terug
                </button>
              )}
              <button
                onClick={() => (onboarding < ONB.length - 1 ? setOnboarding(onboarding + 1) : setOnboarding(null))}
                className="tap flex-1 py-3 disp text-xl font-bold uppercase"
                style={{ background: "var(--accent)", color: "var(--on-accent)", borderRadius: R.field }}
              >
                {onboarding < ONB.length - 1 ? "Volgende" : "Schema bouwen"}
              </button>
            </div>
            <button
              onClick={() => setOnboarding(null)}
              className="tap text-xs underline mt-3 mx-auto"
              style={{ color: C.darkMuted }}
            >
              Overslaan en zelf invullen
            </button>
          </div>
        </div>
      )}


      <div className="macroapp no-print mx-auto max-w-2xl px-4 pt-6" style={{ paddingBottom: "calc(96px + env(safe-area-inset-bottom, 0px))" }}>
        <header className="mb-5 flex items-end justify-between gap-3">
          <div>
            <div className="text-xs font-semibold" style={{ color: C.accent, letterSpacing: "0.02em" }}>
              Macroverdeling
            </div>
            <h1 className="disp text-4xl font-bold uppercase leading-none tracking-tight mt-0.5">
              {TABS.find((t) => t.id === tab).title}
            </h1>
          </div>
          {tab === "vandaag" && (
            <div className="text-right text-xs leading-snug" style={{ color: C.muted }}>
              {DAY_FULL[selDay]}
              <br />
              {TYPE_LABEL[dayType(selDay)].replace(/n$/, "")}
            </div>
          )}
        </header>

        {tab === "vandaag" && (
          <>
            {loaded && storeMode === "memory" && (
              <div className="mb-4 px-4 py-3 relative overflow-hidden" style={{ background: C.warnBg, borderRadius: R.card }}>
                <span className="rail" style={{ background: C.train }} />
                <div className="disp text-lg font-bold uppercase leading-none" style={{ color: C.train }}>
                  Uw invoer wordt niet bewaard
                </div>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: C.warn }}>
                  Deze weergave heeft geen toegang tot opslag. Alles wat u invult, verdwijnt zodra de app herlaadt. Open de
                  app via de link in Safari terwijl u bent ingelogd op claude.ai.
                </p>
              </div>
            )}

            {/* ---------------- melding bij een gewijzigd schema ---------------- */}
            {planUpdate && (
              <div
                className="hero-in relative overflow-hidden mb-4 px-4 py-3"
                style={{ background: C.panel, border: `2px solid ${C.accent}`, borderRadius: R.card, boxShadow: C.shadow }}
                role="status"
              >
                <div className="text-xs font-semibold" style={{ color: C.accent }}>
                  {planUpdate.first ? "Plan gestart" : "Uw schema is bijgewerkt"}
                </div>
                <div className="disp text-2xl font-bold uppercase leading-none mt-1">
                  {planUpdate.phaseChanged && !planUpdate.first
                    ? `Nieuwe fase: ${PHASE_LABEL[planNow.row.phase]}`
                    : `Week ${planNow.week + 1} van ${planNow.total} · ${PHASE_LABEL[planNow.row.phase]}`}
                </div>

                <div className="text-sm mt-2 tnum">
                  Gemiddeld <strong>{scheduleNow.avg}</strong> kcal per dag
                  {planUpdate.prev && planUpdate.prev.avg != null && planUpdate.prev.avg !== scheduleNow.avg && (
                    <span style={{ color: C.muted }}>
                      {" "}
                      (was {planUpdate.prev.avg},{" "}
                      <span style={{ color: scheduleNow.avg > planUpdate.prev.avg ? C.carb : C.train, fontWeight: 600 }}>
                        {scheduleNow.avg > planUpdate.prev.avg ? "+" : ""}
                        {scheduleNow.avg - planUpdate.prev.avg}
                      </span>
                      )
                    </span>
                  )}
                </div>

                {["training", "rust"].map((t) => {
                  const cur = scheduleNow[t];
                  if (!cur) return null;
                  const prev = planUpdate.prev && planUpdate.prev[t];
                  const d = (k) => (prev ? cur[k] - prev[k] : 0);
                  const chip = (k, label, col) => (
                    <span style={{ color: col }}>
                      {cur[k]} {label}
                      {prev && Math.abs(d(k)) >= 3 && (
                        <span className="text-xs" style={{ color: C.muted }}>
                          {" "}
                          ({d(k) > 0 ? "+" : ""}
                          {d(k)})
                        </span>
                      )}
                    </span>
                  );
                  return (
                    <div key={t} className="text-xs mt-1 tnum flex flex-wrap gap-x-2">
                      <span className="font-semibold" style={{ width: 84 }}>
                        {t === "training" ? "Trainingsdag" : "Rustdag"}
                      </span>
                      <span>{cur.kcal} kcal</span>
                      {chip("p", "e", C.pro)}
                      {chip("c", "k", C.carb)}
                      {chip("f", "v", C.fat)}
                    </div>
                  );
                })}

                {planNow.row.note && (
                  <p className="text-xs mt-2 leading-relaxed" style={{ color: C.ink }}>
                    {planNow.row.note}
                  </p>
                )}
                <p className="text-xs mt-2 leading-relaxed" style={{ color: C.muted }}>
                  {PHASE_ADVICE[planNow.row.phase]} Uw porties zijn al aangepast.
                </p>
                <button
                  onClick={acknowledge}
                  className="tap w-full mt-3 py-2 text-sm"
                  style={{ background: C.accent, color: C.onAccent, borderRadius: R.field, fontWeight: 600 }}
                >
                  Gezien
                </button>
              </div>
            )}

            {/* ---------------- planstatus ---------------- */}
            {(planNow.active || planNow.pending || planNow.ended) && (
              <button
                onClick={() => setTab("plan")}
                className="tap w-full text-left mb-3 px-3 py-2 flex items-center gap-3"
                style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: R.field }}
              >
                <span
                  className="shrink-0 rounded-full"
                  style={{ width: 10, height: 10, background: planNow.active ? PHASE_COLOR[planNow.row.phase] : C.muted }}
                />
                <span className="text-xs leading-snug flex-1" style={{ color: C.muted }}>
                  {planNow.active ? (
                    <>
                      <strong style={{ color: C.ink }}>
                        Plan · week {planNow.week + 1} van {planNow.total} · {PHASE_LABEL[planNow.row.phase]}
                      </strong>
                      {(() => {
                        let left = 0;
                        for (let k = planNow.week; k < autopilot.rows.length && autopilot.rows[k].phase === planNow.row.phase; k++) left++;
                        const after = autopilot.rows[planNow.week + left];
                        return after
                          ? ` · nog ${left} ${left === 1 ? "week" : "weken"}, daarna ${PHASE_LABEL[after.phase]}`
                          : ` · nog ${left} ${left === 1 ? "week" : "weken"} tot het einde van het plan`;
                      })()}
                    </>
                  ) : planNow.pending ? (
                    <>
                      <strong style={{ color: C.ink }}>Plan start over {planNow.daysToStart} {planNow.daysToStart === 1 ? "dag" : "dagen"}</strong>
                      {" · tot die tijd geldt uw eigen doel"}
                    </>
                  ) : (
                    <>
                      <strong style={{ color: C.ink }}>Plan afgerond</strong>
                      {" · uw eigen doel geldt weer. Maak een nieuw plan op het tabblad Plan."}
                    </>
                  )}
                </span>
                <span className="text-xs shrink-0" style={{ color: C.accent }}>
                  Plan
                </span>
              </button>
            )}

            {/* Kleeft bovenaan tijdens het scrollen met position: sticky.
                Geen scrollmeting nodig, dus het werkt in elke webweergave. */}
            <div
              className="sticky z-30 -mx-4 px-4 pt-2 pb-2 mb-3"
              style={{
                top: "env(safe-area-inset-top, 0px)",
                background: C.bg,
                borderBottom: `1px solid ${C.line}`,
                boxShadow: "0 10px 18px -16px rgba(0,0,0,.45)",
              }}
            >
              <div className="flex gap-1">
                {DAYS.map((d, i) => {
                  const on = selDay === i;
                  return (
                    <button
                      key={d}
                      onClick={() => setSelDay(i)}
                      className="tap flex-1 py-1 rounded-full disp text-sm uppercase"
                      style={{
                        background: on ? C.accent : "transparent",
                        color: on ? C.onAccent : week[i].session ? C.ink : C.muted,
                        fontWeight: on ? 700 : 500,
                        border: `1px solid ${on ? C.accent : C.lineSoft}`,
                      }}
                      aria-label={`${DAY_FULL[i]} kiezen`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-baseline gap-3 mt-1.5 tnum">
                <span className="disp text-2xl font-bold leading-none">{Math.round(dayPlan.today.kcal)}</span>
                <span className="text-xs" style={{ color: C.muted }}>
                  kcal
                </span>
                <span className="flex-1" />
                <span className="text-sm font-semibold" style={{ color: C.pro }}>
                  {Math.round(macros.protein)} e
                </span>
                <span className="text-sm font-semibold" style={{ color: C.carb }}>
                  {Math.round(macros.carbs)} k
                </span>
                <span className="text-sm font-semibold" style={{ color: C.fat }}>
                  {Math.round(macros.fat)} v
                </span>
              </div>
            </div>

        {/* ---------------- hero: de week als grafiek en de dag in cijfers ---------------- */}
        <div
          className="hero-in relative overflow-hidden mb-8"
          style={{ background: C.dark, color: C.darkInk, borderRadius: 18, boxShadow: C.shadow }}
        >
          <div
            className="absolute inset-x-0 top-0 h-px"
            style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent)" }}
            aria-hidden="true"
          />

          <div className="px-3 pt-4">
            <div className="flex items-end gap-1" style={{ height: 86 }}>
              {DAYS.map((d, i) => {
                const on = selDay === i;
                const k = energy.kcals[i];
                const base = Math.min(...energy.kcals) * 0.88;
                const top = Math.max(...energy.kcals);
                const pct = Math.max(16, Math.min(100, ((k - base) / (top - base || 1)) * 100));
                return (
                  <button
                    key={d}
                    onClick={() => setSelDay(i)}
                    className="tap flex-1 flex flex-col justify-end items-center h-full wk-bar"
                    style={{ animationDelay: `${i * 45}ms` }}
                    aria-label={`${DAY_FULL[i]}, ${Math.round(k)} kcal`}
                    aria-pressed={on}
                  >
                    <span
                      className="text-xs tnum mb-1 disp font-semibold"
                      style={{ color: on ? C.darkInk : "transparent", lineHeight: 1 }}
                    >
                      {Math.round(k)}
                    </span>
                    <span
                      className="w-full block"
                      style={{
                        height: `${pct}%`,
                        borderRadius: 6,
                        background: on
                          ? "var(--accent)"
                          : week[i].session
                          ? "rgba(255,255,255,.34)"
                          : "rgba(255,255,255,.14)",
                      }}
                    />
                  </button>
                );
              })}
            </div>
            <div className="flex gap-1 mt-2">
              {DAYS.map((d, i) => (
                <div key={d} className="flex-1 text-center">
                  <div
                    className="disp text-sm uppercase leading-none"
                    style={{ color: selDay === i ? C.darkInk : C.darkMuted, fontWeight: selDay === i ? 700 : 500 }}
                  >
                    {d}
                  </div>
                  <div
                    className="w-1 h-1 rounded-full mx-auto mt-1"
                    style={{ background: week[i].session ? (selDay === i ? "var(--accent)" : C.darkMuted) : "transparent" }}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="px-4 pt-3 pb-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="disp font-bold leading-none tnum" style={{ fontSize: 64 }}>
                  <CountUp value={Math.round(dayPlan.today.kcal)} />
                </div>
                <div className="text-sm mt-1" style={{ color: C.darkMuted }}>
                  kcal op {DAY_FULL[selDay].toLowerCase()}
                  {week[selDay].session ? " · trainingsdag" : ""}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="disp text-2xl font-bold tnum leading-none" style={{ color: "var(--accent)" }}>
                  {dayPlan.today.kcal >= energy.avgTarget ? "+" : ""}
                  {Math.round(dayPlan.today.kcal - energy.avgTarget)}
                </div>
                <div className="text-xs mt-1" style={{ color: C.darkMuted }}>
                  t.o.v. weekgemiddelde
                </div>
              </div>
            </div>

            <div className="mt-3">
              <MacroBar p={macros.protein} c={macros.carbs} f={macros.fat} height={12} shine colors={DK} />
            </div>

            <div className="grid grid-cols-3 gap-2 mt-3">
              {[
                { k: "Eiwit", g: macros.protein, kcal: macros.protein * 4, col: DK.pro },
                { k: "Koolhydraten", g: macros.carbs, kcal: macros.carbs * 4, col: DK.carb },
                { k: "Vet", g: macros.fat, kcal: macros.fat * 9, col: DK.fat },
              ].map((m) => (
                <div key={m.k}>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: m.col }} />
                    <span className="text-xs truncate" style={{ color: C.darkMuted }}>
                      {m.k}
                    </span>
                  </div>
                  <div className="disp text-3xl font-bold tnum leading-none mt-0.5" style={{ color: m.col }}>
                    <CountUp value={Math.round(m.g)} />
                    <span className="text-base font-medium" style={{ color: C.darkMuted }}>
                      g
                    </span>
                  </div>
                  <div className="text-xs tnum mt-0.5" style={{ color: C.darkMuted }}>
                    {(m.g / weight).toFixed(1)} g/kg · {Math.round((m.kcal / dayPlan.today.kcal) * 100)}%
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            className="px-4 py-2.5 text-xs leading-relaxed tnum"
            style={{ borderTop: `1px solid ${C.darkLine}`, color: C.darkMuted }}
          >
            Rust {Math.round(energy.bmr)} · behoefte {Math.round(energy.tdeeAvg)} · doel {Math.round(energy.avgTarget)} kcal
            {kcalAdjust !== 0 && ` (correctie ${kcalAdjust > 0 ? "+" : ""}${kcalAdjust})`}
            {f.goal !== "onderhoud" && (
              <>
                {" · "}
                {energy.realKgPerWeek > 0 ? "+" : ""}
                {energy.realKgPerWeek.toFixed(2)} kg per week
              </>
            )}
          </div>
        </div>

        {/* ---------------- dagindeling ---------------- */}
        <Section
          title={`Dagindeling ${DAY_FULL[selDay].toLowerCase()}`}
          sub="Koolhydraten schuiven naar de maaltijden rond de training, vet schuift daar juist vanaf. Eiwit blijft gelijkmatig verdeeld."
        >
          <div
            className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap"
            style={{ borderBottom: `1px solid ${C.lineSoft}`, background: C.surface2 }}
          >
            <div className="text-xs leading-snug" style={{ color: C.muted }}>
              U bewerkt het profiel voor <strong style={{ color: C.ink }}>{TYPE_LABEL[dayType(selDay)]}</strong>:{" "}
              {DAYS.filter((_, k) => dayType(k) === dayType(selDay)).join(", ")}. Wijzigingen gelden meteen voor al die
              dagen.
            </div>
            <button onClick={copyToOtherType} className="tap text-xs underline shrink-0" style={{ color: C.accent }}>
              Kopieer naar {TYPE_LABEL[dayType(selDay) === "training" ? "rust" : "training"]}
            </button>
          </div>
          <div className="px-3 py-4">
            {events.map((e, i) =>
              e.kind === "train" ? (
                <div key={`t${i}`} className="flex gap-3 py-2 reveal in" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="w-11 disp text-base font-semibold tnum pt-0.5" style={{ color: C.train }}>
                    {toHHMM(e.time)}
                  </div>
                  <div className="flex-1 px-3 py-2" style={{ background: C.train, color: C.onTrain, borderRadius: R.field }}>
                    <div className="disp text-lg font-bold uppercase leading-none">Training tot {toHHMM(e.end)}</div>
                    <div className="text-xs mt-1" style={{ opacity: 0.9 }}>
                      {SESSIONS.find((s) => s.id === session.type).label} · {Math.round(energy.sess[selDay])} kcal extra
                      verbruik
                    </div>
                  </div>
                </div>
              ) : (
                <div key={`m${i}`} className="flex gap-3 py-2 reveal in" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="w-11 disp text-base font-semibold tnum pt-0.5" style={{ color: C.muted }}>
                    {toHHMM(e.time)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold truncate">
                        {mealName(e.label, e.index, meals.length)}
                        {e.hungry && (
                          <span
                            className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full align-middle"
                            style={{ background: C.surface2, color: C.fat, border: `1px solid ${C.lineSoft}`, fontWeight: 600 }}
                          >
                            meeste honger
                          </span>
                        )}
                      </span>
                      <span className="disp text-lg font-bold tnum shrink-0" style={{ color: C.ink }}>
                        {Math.round(e.kcal)}
                        <span className="text-xs font-medium" style={{ color: C.muted }}> kcal</span>
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <MacroBar p={e.protein} c={e.carbs} f={e.fat} />
                    </div>
                    <div className="mt-1.5 flex gap-3 text-xs tnum font-medium">
                      <span style={{ color: C.pro }}>{e.protein} g eiwit</span>
                      <span style={{ color: C.carb }}>{e.carbs} g kh</span>
                      <span style={{ color: C.fat }}>{e.fat} g vet</span>
                      {portionPlan && portionPlan[e.index] && (
                        <span style={{ color: C.muted }}>{Math.round(portionPlan[e.index].actual.fib)} g vezels</span>
                      )}
                    </div>

                    {portionPlan &&
                      (editMeal !== e.index ? (
                        <div className="mt-2">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span
                            className="text-xs px-2 py-0.5 rounded-full"
                            style={{ background: C.surface2, color: C.muted, border: `1px solid ${C.lineSoft}` }}
                          >
                            {portionPlan[e.index].scope === "dag"
                              ? `Alleen ${DAY_FULL[selDay].toLowerCase()}`
                              : portionPlan[e.index].scope === "alle"
                              ? "Alle dagen"
                              : dayType(selDay) === "training"
                              ? "Trainingsdagen"
                              : "Rustdagen"}
                          </span>
                          <button
                            onClick={() => setEditMeal(e.index)}
                            className="tap text-xs px-2.5 py-1 rounded-full"
                            style={{ border: `1px solid ${C.line}`, color: C.accent, fontWeight: 600 }}
                          >
                            Bewerken
                          </button>
                        </div>
                        <ul className="text-sm leading-relaxed">
                          {portionPlan[e.index].portions.map((pp, k) => pp.grams <= 0 ? null : (
                            <li key={k} className="tnum">
                              {pp.text}
                              {portionPlan[e.index].alts && portionPlan[e.index].alts[k] && portionPlan[e.index].alts[k][0] && (
                                <span className="text-xs" style={{ color: C.muted }}>
                                  {" "}
                                  · of {portionPlan[e.index].alts[k][0].text}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                        {(() => {
                          const g = portionPlan[e.index].gap;
                          const off = ["p", "c", "f"].filter((k) => Math.abs(g[k]) >= 5);
                          if (!off.length) return null;
                          const naam = { p: "eiwit", c: "kh", f: "vet" };
                          return (
                            <p className="text-xs mt-1" style={{ color: C.warn }}>
                              Afwijking:{" "}
                              {off.map((k) => `${g[k] > 0 ? "nog " : ""}${Math.abs(Math.round(g[k]))} g ${naam[k]}${g[k] < 0 ? " te veel" : ""}`).join(", ")}
                            </p>
                          );
                        })()}
                      </div>
                      ) : (
                        <div>
                          <div className="mt-2 px-2.5 py-2" style={{ background: C.surface2, border: `1px solid ${C.lineSoft}`, borderRadius: R.field }}>
                        <div className="flex items-center gap-1 pb-1.5 mb-1" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
                          <span className="text-xs shrink-0 mr-1" style={{ color: C.muted }}>
                            Geldt voor
                          </span>
                          {[
                            { id: "type", label: dayType(selDay) === "training" ? "Trainingsdagen" : "Rustdagen" },
                            { id: "alle", label: "Alle dagen" },
                            { id: "dag", label: DAYS[selDay] },
                          ].map((o) => {
                            const on = portionPlan[e.index].scope === o.id;
                            return (
                              <button
                                key={o.id}
                                onClick={() => setScope(e.index, o.id)}
                                className="tap text-xs px-2 py-0.5 rounded-full"
                                style={{
                                  background: on ? C.accent : "transparent",
                                  color: on ? C.onAccent : C.muted,
                                  border: `1px solid ${on ? C.accent : C.line}`,
                                  fontWeight: on ? 600 : 400,
                                }}
                              >
                                {o.label}
                              </button>
                            );
                          })}
                        </div>
                        {portionPlan[e.index].portions.map((pp, k) => (
                          <div key={`${pp.food}-${k}`} className="flex items-center gap-1.5 py-1">
                            <span className="text-xs flex-1 min-w-0 truncate">
                              {pp.label}
                              {pp.unitGrams && pp.grams > 0 ? (
                                <span style={{ color: C.muted }}> · {pp.text.split(" (")[0]}</span>
                              ) : null}
                              {!pp.fixed && pp.grams === 0 ? (
                                <span style={{ color: C.muted }}> · niet nodig</span>
                              ) : null}
                            </span>
                            {pp.food === "groente" ? (
                              <span className="text-xs tnum w-20 text-right" style={{ color: C.muted }}>
                                {Math.round(pp.grams)} g vast
                              </span>
                            ) : (
                              <>
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  value={Math.round(pp.grams)}
                                  onChange={(ev) =>
                                    setItems(e.index, (items) =>
                                      items.map((it, j) =>
                                        j === k ? { ...it, grams: ev.target.value === "" ? null : Math.max(0, Number(ev.target.value)) } : it
                                      )
                                    )
                                  }
                                  className="w-16 px-1.5 py-1 text-xs text-right tnum" data-field
                                  style={{
                                    border: `1px solid ${pp.fixed ? C.accent : C.line}`,
                                    background: C.panel,
                                    color: C.ink,
                                    borderRadius: 8,
                                    fontWeight: pp.fixed ? 700 : 400,
                                  }}
                                  aria-label={`Grammen ${pp.label}`}
                                />
                                <span className="text-xs" style={{ color: C.muted }}>
                                  g
                                </span>
                                <button
                                  onClick={() =>
                                    setItems(e.index, (items) => items.map((it, j) => (j === k ? { ...it, grams: null } : it)))
                                  }
                                  className="text-xs px-1"
                                  style={{ color: pp.fixed ? C.pro : C.line }}
                                  disabled={!pp.fixed}
                                  aria-label="Terug naar automatisch"
                                >
                                  auto
                                </button>
                                <button
                                  onClick={() => setItems(e.index, (items) => items.filter((_, j) => j !== k))}
                                  className="text-xs px-1"
                                  style={{ color: C.muted }}
                                  aria-label={`${pp.label} verwijderen`}
                                >
                                  &times;
                                </button>
                              </>
                            )}
                          </div>
                        ))}
                        {portionPlan[e.index].alts &&
                          portionPlan[e.index].portions.map((pp, k) =>
                            portionPlan[e.index].alts[k] && portionPlan[e.index].alts[k].length ? (
                              <div key={`alt-${k}`} className="text-xs leading-snug pl-0 pb-1" style={{ color: C.muted }}>
                                of{" "}
                                {portionPlan[e.index].alts[k].map((a, ai) => (
                                  <span key={a.food}>
                                    {ai > 0 ? " · " : ""}
                                    <button
                                      onClick={() =>
                                        setItems(e.index, (items) =>
                                          items.map((it, j) =>
                                            j === k ? { food: a.food, grams: it.grams == null ? null : a.grams } : it
                                          )
                                        )
                                      }
                                      className="tap underline"
                                      style={{ color: C.muted }}
                                      title="Vervang deze bron"
                                    >
                                      {a.text}
                                    </button>
                                  </span>
                                ))}
                              </div>
                            ) : null
                          )}

                        {(() => {
                          const g = portionPlan[e.index].gap;
                          const naam = { p: "eiwit", c: "koolhydraten", f: "vet" };
                          const kleur = { p: C.pro, c: C.carb, f: C.fat };
                          const tekort = ["p", "c", "f"].filter((k) => g[k] >= 1);
                          const teveel = ["p", "c", "f"].filter((k) => g[k] <= -1);
                          if (!tekort.length && !teveel.length)
                            return (
                              <p className="text-xs mt-1" style={{ color: C.carb }}>
                                Precies op het doel.
                              </p>
                            );
                          return (
                            <div className="text-xs mt-1 leading-snug">
                              {tekort.length > 0 && (
                                <p>
                                  <span style={{ color: C.muted }}>Nog nodig: </span>
                                  {tekort.map((k, idx) => (
                                    <span key={k} style={{ color: kleur[k] }}>
                                      {idx > 0 ? ", " : ""}
                                      {Math.round(g[k])} g {naam[k]}
                                    </span>
                                  ))}
                                </p>
                              )}
                              {teveel.length > 0 && (
                                <p>
                                  <span style={{ color: C.muted }}>Te veel: </span>
                                  {teveel.map((k, idx) => (
                                    <span key={k} style={{ color: kleur[k] }}>
                                      {idx > 0 ? ", " : ""}
                                      {Math.abs(Math.round(g[k]))} g {naam[k]}
                                    </span>
                                  ))}
                                </p>
                              )}
                            </div>
                          );
                        })()}

                        <select
                          value=""
                          onChange={(ev) => {
                            if (!ev.target.value) return;
                            const v = ev.target.value;
                            setItems(e.index, (items) => [...items, { food: v, grams: null }]);
                          }}
                          className="w-full mt-2 px-2 py-1.5 text-xs" data-field
                          style={{ border: `1px solid ${C.line}`, background: C.surface2, color: C.muted, borderRadius: R.field }}
                          aria-label="Bron toevoegen"
                        >
                          <option value="">Bron toevoegen</option>
                          {customFoods.length > 0 && (
                            <optgroup label="Eigen producten">
                              {customFoods.map((fo) => (
                                <option key={fo.id} value={fo.id}>
                                  {fo.label}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {[
                            ["protein", "Eiwitbronnen"],
                            ["carb", "Koolhydraatbronnen"],
                            ["fat", "Vetbronnen"],
                            ["overig", "Groente, fruit en sauzen"],
                          ].map(([cat, label]) => (
                            <optgroup key={cat} label={label}>
                              {FOODS[cat].map((fo) => (
                                <option key={fo.id} value={fo.id}>
                                  {fo.label}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>

                        {savedMeals.length > 0 && (
                          <select
                            value=""
                            onChange={(ev) => ev.target.value && insertSavedMeal(e.index, ev.target.value)}
                            className="w-full mt-1.5 px-2 py-1.5 text-xs" data-field
                            style={{ border: `1px solid ${C.accent}`, background: C.panel, color: C.accent, borderRadius: R.field }}
                            aria-label="Bewaarde maaltijd invoegen"
                          >
                            <option value="">Bewaarde maaltijd invoegen</option>
                            {savedMeals.map((sm) => (
                              <option key={sm.id} value={sm.id}>
                                {sm.name}
                              </option>
                            ))}
                          </select>
                        )}

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                          <button onClick={() => rescaleMeal(e.index)} className="tap text-xs underline" style={{ color: C.accent }}>
                            Passend schalen
                          </button>
                          <button
                            onClick={() => {
                              setSavingMeal(savingMeal === e.index ? null : e.index);
                              setNewMealName("");
                            }}
                            className="tap text-xs underline"
                            style={{ color: C.muted }}
                          >
                            Bewaren als maaltijd
                          </button>
                          <button
                            onClick={() => setItems(e.index, () => defaultItems(e.label, e.index))}
                            className="tap text-xs underline"
                            style={{ color: C.muted }}
                          >
                            Terugzetten
                          </button>
                        </div>
                        {savingMeal === e.index && (
                          <div className="flex gap-2 mt-2">
                            <input
                              type="text"
                              value={newMealName}
                              onChange={(ev) => setNewMealName(ev.target.value)}
                              placeholder="Naam, bijvoorbeeld overnight oats"
                              className="flex-1 px-2 py-1.5 text-xs" data-field
                              style={{ border: `1px solid ${C.line}`, background: C.panel, color: C.ink, borderRadius: R.field }}
                              aria-label="Naam van de maaltijd"
                            />
                            <button
                              onClick={() => saveMealAs(e.index)}
                              className="tap px-3 py-1.5 text-xs shrink-0"
                              style={{ background: C.accent, color: C.onAccent, borderRadius: R.field, fontWeight: 600 }}
                            >
                              Bewaren
                            </button>
                          </div>
                        )}
                      </div>
                          <button
                            onClick={() => setEditMeal(null)}
                            className="tap w-full mt-2 py-2 text-sm"
                            style={{ background: C.accent, color: C.onAccent, borderRadius: R.field, fontWeight: 600 }}
                          >
                            Klaar
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              )
            )}
          </div>

          {plan.notes.length > 0 && (
            <div className="px-3 py-3" style={{ borderTop: `1px solid ${C.lineSoft}`, background: C.warnBg }}>
              {plan.notes.map((n, i) => (
                <p key={i} className="text-xs leading-relaxed mb-1 last:mb-0" style={{ color: C.warn }}>
                  {n}
                </p>
              ))}
            </div>
          )}

          {/* ---------------- slaap vanavond ---------------- */}
          {(() => {
            const d = sleepCheck.days[selDay];
            const lines = [];
            if (d.cutoff != null) {
              lines.push({
                col: d.preConflict ? C.train : C.muted,
                text: d.preConflict
                  ? `Uw training begint na de grens voor pre-workout (${toHHMM(d.cutoff)}). Kies op deze dag een cafeïnevrije pre-workout, anders kost het u naar verwachting slaap.`
                  : `${sleepCheck.caf.label} uiterlijk ${toHHMM(d.cutoff)}, ${String(sleepCheck.caf.hours).replace(".", ",")} uur voor bedtijd.`,
              });
            }
            if (d.lastLate) {
              lines.push({
                col: C.carb,
                text: `Laatste maaltijd ${Math.round(d.lastBefore)} minuten voor bedtijd: automatisch lichter gemaakt, met de helft minder vet en iets meer eiwit.`,
              });
            } else if (d.lastBefore < 120 && d.lastShare > 0.3) {
              lines.push({
                col: C.warn,
                text: `Uw laatste maaltijd is ${Math.round(d.lastShare * 100)} procent van de dag en valt ${Math.round(d.lastBefore)} minuten voor bedtijd. Zet "Lichte laatste maaltijd" aan op Gezondheid, of eet eerder.`,
              });
            }
            const lastIdx = meals.length - 1;
            const lastPortions = portionPlan && portionPlan[lastIdx] ? portionPlan[lastIdx].portions.filter((pp) => pp.grams > 0) : null;
            const hasSlow = lastPortions ? lastPortions.some((pp) => SLOW_PROTEIN.includes(pp.food)) : true;
            if (!hasSlow) {
              lines.push({
                col: C.warn,
                text: "Geen langzaam eiwit in uw laatste maaltijd. Kwark of hüttenkäse voor het slapen ondersteunt het herstel 's nachts.",
                action: { label: "Kwark toevoegen", run: () => setItems(lastIdx, (items) => [...items, { food: "kwark", grams: null }]) },
              });
            }
            if (d.trainGap != null && d.trainGap < 60) {
              lines.push({
                col: C.warn,
                text: `Uw training eindigt ${Math.max(0, Math.round(d.trainGap))} minuten voor bedtijd. Een zware sessie zo laat kan het inslapen vertragen; houd hem lichter of plan wat ontspanning.`,
              });
            }
            lines.push({
              col: C.muted,
              text: `Drink het grootste deel van uw vocht voor ${toHHMM(d.sleepM - 120)}, twee uur voor bedtijd.`,
            });
            return (
              <div className="px-3 py-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <span className="text-sm font-medium">Slaap vanavond</span>
                  <span className="text-xs tnum" style={{ color: C.muted }}>
                    bedtijd {toHHMM(d.sleepM)} · {d.hours.toFixed(1).replace(".", ",")} uur in bed
                  </span>
                </div>
                {lines.map((l, k) => (
                  <div key={k} className="flex gap-2 mb-1.5 last:mb-0">
                    <span className="shrink-0 rounded-full" style={{ width: 6, height: 6, marginTop: 6, background: l.col }} />
                    <div className="text-xs leading-relaxed flex-1" style={{ color: l.col === C.muted ? C.muted : C.ink }}>
                      {l.text}
                      {l.action && (
                        <button
                          onClick={l.action.run}
                          className="tap ml-2 text-xs px-2 py-0.5 rounded-full"
                          style={{ border: `1px solid ${C.accent}`, color: C.accent, fontWeight: 600 }}
                        >
                          {l.action.label}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* vezels in het schema, afgezet tegen de richtlijn */}
          <div className="px-3 py-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
            {fibreDay == null ? (
              <div className="text-xs" style={{ color: C.muted }}>
                Richtlijn vezels {fibre} g. Zet de porties aan om te zien hoeveel uw schema levert.
              </div>
            ) : (
              (() => {
                const pct = fibreDay / Math.max(1, fibre);
                const col = pct >= 0.9 ? C.carb : pct >= 0.6 ? C.warn : C.train;
                return (
                  <>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium">Vezels</span>
                      <span className="text-sm tnum">
                        <strong style={{ color: col }}>{Math.round(fibreDay)} g</strong>
                        <span style={{ color: C.muted }}> van {fibre} g</span>
                      </span>
                    </div>
                    <div className="mt-1.5 w-full overflow-hidden" style={{ height: 6, borderRadius: 3, background: C.lineSoft }}>
                      <div className="bar-fill" style={{ width: `${Math.min(100, pct * 100)}%`, height: "100%", background: col }} />
                    </div>
                    {pct < 0.9 && (
                      <p className="text-xs mt-1.5 leading-relaxed" style={{ color: C.muted }}>
                        {pct < 0.6 ? "Ruim onder de richtlijn. " : "Iets onder de richtlijn. "}
                        Kies volkoren in plaats van wit, voeg peulvruchten, havermout of chiazaad toe, of verhoog de
                        groente bij de weergave-instellingen. Bouw het rustig op en drink er voldoende bij.
                      </p>
                    )}
                  </>
                );
              })()
            )}
          </div>
          {/* groente en fruit in het schema */}
          {produceDay && (
            <div className="px-3 py-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-sm font-medium">Groente en fruit</span>
                <Seg
                  value={f.produceTarget || "kuba"}
                  onChange={(v) => set("produceTarget", v)}
                  options={[
                    { value: "kuba", label: "500/500" },
                    { value: "schijf", label: "Schijf van 5" },
                  ]}
                />
              </div>
              {[
                { k: "veg", label: "Groente", col: C.carbFill, target: produceDay.t.veg },
                { k: "fruit", label: "Fruit", col: C.fatFill, target: produceDay.t.fruit },
              ].map((x) => {
                const v = produceDay[x.k];
                const pct = v / Math.max(1, x.target);
                return (
                  <div key={x.k} className="mb-2 last:mb-0">
                    <div className="flex items-baseline justify-between gap-3 text-xs tnum">
                      <span>{x.label}</span>
                      <span>
                        <strong style={{ color: pct >= 0.9 ? C.carb : C.warn }}>{Math.round(v)} g</strong>
                        <span style={{ color: C.muted }}> van {x.target} g</span>
                      </span>
                    </div>
                    <div className="mt-1 w-full overflow-hidden" style={{ height: 6, borderRadius: 3, background: C.lineSoft }}>
                      <div className="bar-fill" style={{ width: `${Math.min(100, pct * 100)}%`, height: "100%", background: x.col }} />
                    </div>
                  </div>
                );
              })}
              {(produceDay.veg < produceDay.t.veg * 0.9 || produceDay.fruit < produceDay.t.fruit * 0.9) && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {produceDay.veg < produceDay.t.veg * 0.9 && vegGrams < 400 && (
                    <button
                      onClick={() => setVegGrams((g) => Math.min(400, num(g, 100) + 50))}
                      className="tap text-xs px-2.5 py-1 rounded-full"
                      style={{ border: `1px solid ${C.accent}`, color: C.accent, fontWeight: 600 }}
                    >
                      Groente per maaltijd +50 g
                    </button>
                  )}
                  {produceDay.fruit < produceDay.t.fruit * 0.9 &&
                    (() => {
                      const idx = portionPlan.findIndex((m) => !m.portions.some((pp) => pp.grams > 0 && FRUIT_IDS[pp.food]));
                      if (idx < 0) return null;
                      const pickFruit = idx === 0 ? { food: "bessen", grams: 150, label: "Bessen" } : { food: "appel", grams: 150, label: "Appel" };
                      return (
                        <button
                          onClick={() => setItems(idx, (items) => [...items, { food: pickFruit.food, grams: pickFruit.grams }])}
                          className="tap text-xs px-2.5 py-1 rounded-full"
                          style={{ border: `1px solid ${C.accent}`, color: C.accent, fontWeight: 600 }}
                        >
                          {pickFruit.label} toevoegen aan {mealName(meals[idx].label, idx, meals.length).toLowerCase()}
                        </button>
                      );
                    })()}
                </div>
              )}
              <p className="text-xs mt-2 leading-relaxed" style={{ color: C.muted }}>
                Het fruit gaat van uw koolhydraten af; de overige porties rekenen zich daarop om. Gedroogd fruit telt drie
                keer zijn gewicht.
              </p>
            </div>
          )}

          <button
            onClick={() => setShowViewOpts((v) => !v)}
            className="tap w-full px-3 py-2.5 flex items-center justify-between text-sm"
            style={{ borderTop: `1px solid ${C.lineSoft}`, color: C.muted }}
          >
            <span>Weergave-instellingen</span>
            <span className="text-xs">{showViewOpts ? "Verbergen" : "Tonen"}</span>
          </button>
          {showViewOpts && (
            <>
          <div className="px-3 py-3 flex items-center justify-between gap-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
            <div className="text-sm">Porties tonen</div>
            <Seg
              value={showPortions}
              onChange={setShowPortions}
              options={[
                { value: true, label: "Aan" },
                { value: false, label: "Uit" },
              ]}
            />
          </div>
          {showPortions && (
            <div className="px-3 py-3 flex items-center justify-between gap-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
              <div>
                <div className="text-sm">Gelijkwaardige alternatieven</div>
                <div className="text-xs mt-0.5" style={{ color: C.muted }}>
                  Tik op een alternatief om de bron te vervangen.
                </div>
              </div>
              <Seg
                value={showAlts}
                onChange={setShowAlts}
                options={[
                  { value: true, label: "Aan" },
                  { value: false, label: "Uit" },
                ]}
              />
            </div>
          )}
          {showPortions && (
            <div className="px-3 py-3 flex items-center justify-between gap-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
              <div>
                <div className="text-sm">Groente per maaltijd</div>
                <div className="text-xs mt-0.5" style={{ color: C.muted }}>
                  Wordt meegerekend, behalve bij de eerste maaltijd.
                </div>
              </div>
              <Num value={vegGrams} onChange={setVegGrams} step={50} min={0} max={400} suffix="g" />
            </div>
          )}
            </>
          )}
          <div className="px-3 py-3 flex items-center justify-between gap-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
            <div className="text-xs leading-snug tnum" style={{ color: C.muted }}>
              Vocht {(water / 1000).toFixed(1)} liter
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => { setPrintHint(null); setPrintView(true); }}
                className="tap px-3 py-1.5 text-sm"
                style={{ border: `1px solid ${C.accent}`, color: C.accent, borderRadius: R.field, fontWeight: 600 }}
              >
                Afdrukken
              </button>
              <button onClick={makeText} className="tap px-3 py-1.5 text-sm" style={{ background: C.accent, color: C.onAccent, borderRadius: R.field, fontWeight: 600 }}>
                Kopiëren
              </button>
            </div>
          </div>
          {plainText && (
            <div className="px-3 pb-3">
              <textarea
                readOnly
                value={plainText}
                rows={14}
                className="w-full text-xs p-2 tnum" data-field
                style={{ border: `1px solid ${C.line}`, background: C.surface2, color: C.ink, borderRadius: R.field }}
              />
            </div>
          )}
        </Section>

        {warnings.length > 0 && (
          <div className="px-4 py-3 mb-8 relative overflow-hidden" style={{ background: C.warnBg, borderRadius: R.card }}>
            <span className="rail" style={{ background: C.warn }} />
            <div className="disp text-xl font-bold uppercase mb-1 leading-none" style={{ color: C.warn }}>
              Let op
            </div>
            {warnings.map((w, i) => (
              <p key={i} className="text-xs leading-relaxed mb-1.5 last:mb-0" style={{ color: C.warn }}>
                {w}
              </p>
            ))}
          </div>
        )}

          </>
        )}
        {tab === "eten" && (
          <>
        {/* ---------------- variatie deze week ---------------- */}
        <Section
          title="Variatie deze week"
          accent={C.carb}
          sub="Minstens vier verschillende bronnen per groep. Afwisseling maakt een schema beter vol te houden en spreidt de micronutriënten."
        >
          {[
            { k: "protein", label: "Eiwitbronnen" },
            { k: "carb", label: "Koolhydraatbronnen" },
            { k: "veg", label: "Groente" },
            { k: "fruit", label: "Fruit" },
          ].map((x) => {
            const list = weekVariety[x.k];
            const n = list.length;
            return (
              <Status
                key={x.k}
                label={x.label}
                value={`${n} van 4`}
                state={n >= 4 ? "goed" : n >= 2 ? "oplet" : "risico"}
                note={
                  n
                    ? list.join(", ").toLowerCase() +
                      (n < 4
                        ? x.k === "veg" && list.length === 1 && list[0] === "Groente, gemengd"
                          ? ". Gemengde groente is al gevarieerd; voeg er een losse soort bij."
                          : ". Wissel via een alternatief onder een portie, of kies per dagtype een andere bron."
                        : "")
                    : "Nog geen enkele bron in uw weekschema."
                }
              />
            );
          })}
          <div className="px-4 py-3 text-xs leading-relaxed" style={{ color: C.muted }}>
            Geteld over alle zeven dagen van uw schema. Met trainings- en rustdagprofielen haalt u de vier al snel door
            per profiel andere bronnen te kiezen.
          </div>
        </Section>

        {/* ---------------- boodschappenlijst ---------------- */}
        <Section title="Boodschappen voor de week" sub="De porties van alle zeven dagen bij elkaar opgeteld.">
          <div className="px-3 py-3 flex items-center justify-between gap-3">
            <div className="text-sm">Lijst berekenen</div>
            <Seg
              value={showList}
              onChange={setShowList}
              options={[
                { value: true, label: "Aan" },
                { value: false, label: "Uit" },
              ]}
            />
          </div>
          {shoppingList && (
            <div className="px-3 py-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
              <ul className="text-sm">
                {shoppingList.map((x, i) => (
                  <li key={i} className="flex justify-between gap-3 py-1" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
                    <span>{x.label}</span>
                    <span className="tnum shrink-0" style={{ color: C.muted }}>
                      {x.text}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs mt-2 leading-relaxed" style={{ color: C.muted }}>
                Gewichten van vlees, vis, rijst en pasta zijn bereid gewicht. Reken voor rauwe rijst en pasta
                ongeveer een derde, voor rauw vlees ongeveer een kwart meer dan hier staat.
              </p>
            </div>
          )}
        </Section>

        {/* ---------------- bewaarde maaltijden ---------------- */}
        <Section
          title="Mijn maaltijden"
          accent={C.carb}
          sub="Bewaar een samenstelling die u vaker eet. Bij invoegen schaalt de app het hele recept naar het doel van dat maaltijdmoment, met de onderlinge verhoudingen intact."
        >
          {savedMeals.length === 0 ? (
            <div className="px-4 py-3 text-xs leading-relaxed" style={{ color: C.muted }}>
              Nog geen bewaarde maaltijden. Stel in de dagindeling een maaltijd samen zoals u hem werkelijk eet en tik
              daar op "Bewaren als maaltijd".
            </div>
          ) : (
            savedMeals.map((sm) => {
              const tot = sm.items.reduce(
                (a, it) => {
                  const fo = foodIndex[it.food];
                  if (!fo) return a;
                  return { p: a.p + (fo.p * it.grams) / 100, c: a.c + (fo.c * it.grams) / 100, f: a.f + (fo.f * it.grams) / 100 };
                },
                { p: 0, c: 0, f: 0 }
              );
              return (
                <div key={sm.id} className="px-4 py-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">{sm.name}</div>
                      <div className="text-xs mt-0.5 leading-relaxed" style={{ color: C.muted }}>
                        {sm.items
                          .map((it) => (foodIndex[it.food] ? `${it.grams} g ${foodIndex[it.food].label.toLowerCase()}` : null))
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      <div className="text-xs mt-1 tnum">
                        <span style={{ color: C.pro }}>{Math.round(tot.p)} g eiwit</span>
                        {" · "}
                        <span style={{ color: C.carb }}>{Math.round(tot.c)} g kh</span>
                        {" · "}
                        <span style={{ color: C.fat }}>{Math.round(tot.f)} g vet</span>
                        {" · "}
                        {Math.round(tot.p * 4 + tot.c * 4 + tot.f * 9)} kcal
                      </div>
                    </div>
                    {confirmMeal === sm.id ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => {
                            setSavedMeals((l) => l.filter((x) => x.id !== sm.id));
                            setConfirmMeal(null);
                          }}
                          className="tap px-2 py-1 text-xs"
                          style={{ background: C.train, color: C.onTrain, borderRadius: 8 }}
                        >
                          Verwijderen
                        </button>
                        <button
                          onClick={() => setConfirmMeal(null)}
                          className="tap px-2 py-1 text-xs"
                          style={{ border: `1px solid ${C.line}`, color: C.muted, borderRadius: 8 }}
                        >
                          Terug
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmMeal(sm.id)} className="tap text-xs px-2 shrink-0" style={{ color: C.muted }}>
                        &times;
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </Section>

        {/* ---------------- eigen producten ---------------- */}
        <Section
          title="Eigen producten"
          sub="Neem de waarden per 100 g van het etiket over. Uw producten verschijnen bovenaan in elke keuzelijst en blijven bewaard."
        >
          <div
            ref={foodFormRef}
            className="px-3 py-3"
            style={{
              borderBottom: `1px solid ${C.lineSoft}`,
              background: editingFood ? C.surface2 : "transparent",
              scrollMarginTop: 90,
            }}
          >
            {editingFood && (
              <div className="disp text-lg font-bold uppercase leading-none mb-2" style={{ color: C.accent }}>
                Product bewerken
              </div>
            )}
            <div className="mb-3">
              <div className="flex gap-2">
                {true && (
                  <button
                    onClick={() =>
                      aiPhoto && aiPhoto.ok === false
                        ? setLabelMsg({
                            tone: "fout",
                            text: `Fotoanalyse kan hier niet: ${aiPhoto.reden}. Gebruik Tekst plakken, of vul de waarden zelf in.`,
                          })
                        : photoRef.current && photoRef.current.click()
                    }
                    disabled={labelBusy}
                    className="tap flex-1 py-2 text-sm"
                    style={{
                      background: labelBusy || (aiPhoto && aiPhoto.ok === false) ? C.surface2 : C.accent,
                      color: labelBusy || (aiPhoto && aiPhoto.ok === false) ? C.muted : C.onAccent,
                      border: aiPhoto && aiPhoto.ok === false ? `1px solid ${C.line}` : "none",
                      borderRadius: R.field,
                      fontWeight: 600,
                    }}
                  >
                    {labelBusy ? "Etiket lezen..." : "Etiket fotograferen"}
                  </button>
                )}
                <button
                  onClick={() => setPasteOpen((v) => !v)}
                  className="tap px-3 py-2 text-sm"
                  style={{ border: `1px solid ${C.line}`, color: C.ink, borderRadius: R.field }}
                >
                  Tekst plakken
                </button>
              </div>
              <p className="text-xs mt-1.5" style={{ color: aiPhoto && aiPhoto.ok === false ? C.warn : C.muted }}>
                Fotoanalyse:{" "}
                {aiPhoto == null ? "wordt gecontroleerd" : aiPhoto.ok ? `beschikbaar, ${aiPhoto.reden}` : `niet beschikbaar, ${aiPhoto.reden}`}
              </p>
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(ev) => {
                  const file = ev.target.files && ev.target.files[0];
                  ev.target.value = "";
                  if (file) readPhoto(file);
                }}
                aria-label="Foto van het etiket"
              />

              {pasteOpen && (
                <div className="mt-2">
                  <textarea
                    value={pasteText}
                    onChange={(ev) => setPasteText(ev.target.value)}
                    rows={4}
                    placeholder={"Plak hier de tekst van de voedingswaardetabel.\nOp de iPhone: houd de foto ingedrukt, selecteer de tekst en kopieer."}
                    className="w-full px-2 py-2 text-sm" data-field
                    style={{ border: `1px solid ${C.line}`, background: C.surface2, color: C.ink, borderRadius: R.field }}
                    aria-label="Etikettekst"
                  />
                  <button
                    onClick={readPaste}
                    className="tap px-3 py-1.5 text-sm mt-1"
                    style={{ background: C.accent, color: C.onAccent, borderRadius: R.field, fontWeight: 600 }}
                  >
                    Tekst uitlezen
                  </button>
                </div>
              )}

              {pendingPortion && (
                <div className="mt-2 px-3 py-2" style={{ background: C.warnBg, borderRadius: R.field }}>
                  <p className="text-xs leading-relaxed mb-2" style={{ color: C.warn }}>
                    Dit etiket geeft alleen waarden per portie en vermeldt geen portiegewicht. Vul het gewicht van een
                    portie in, dan rekent de app het om naar 100 g.
                  </p>
                  <div className="flex items-end gap-2">
                    <Num value={portionInput} onChange={setPortionInput} step={1} min={1} max={2000} suffix="g" />
                    <button
                      onClick={convertPortion}
                      className="tap px-3 py-1.5 text-sm"
                      style={{ background: C.accent, color: C.onAccent, borderRadius: R.field, fontWeight: 600 }}
                    >
                      Omrekenen
                    </button>
                    <button
                      onClick={() => setPendingPortion(null)}
                      className="tap px-3 py-1.5 text-sm"
                      style={{ border: `1px solid ${C.line}`, color: C.muted, borderRadius: R.field }}
                    >
                      Annuleren
                    </button>
                  </div>
                </div>
              )}

              {labelMsg && (
                <p
                  className="text-xs mt-2 leading-relaxed"
                  style={{ color: labelMsg.tone === "goed" ? C.carb : labelMsg.tone === "fout" ? C.train : C.warn }}
                >
                  {labelMsg.text}
                </p>
              )}
            </div>
            <div className="text-xs mb-1" style={{ color: C.muted }}>
              Naam
            </div>
            <input
              type="text"
              value={newFood.label}
              onChange={(ev) => setNewFood((s) => ({ ...s, label: ev.target.value }))}
              placeholder="bijvoorbeeld Whey vanille van uw merk"
              className="w-full px-2 py-1.5 text-sm mb-2" data-field
              style={{ border: `1px solid ${C.line}`, background: C.surface2, color: C.ink, borderRadius: R.field }}
            />
            <div className="text-xs mb-1" style={{ color: C.muted }}>
              Soort bron
            </div>
            <Pick
              value={newFood.cat}
              onChange={(v) => setNewFood((s) => ({ ...s, cat: v }))}
              options={[
                { id: "protein", label: "Eiwitbron" },
                { id: "carb", label: "Koolhydraatbron" },
                { id: "fat", label: "Vetbron" },
                { id: "overig", label: "Overig" },
              ]}
            />
            <div className="grid grid-cols-3 gap-2 mt-2">
              {[
                { k: "p", label: "Eiwit", col: C.pro },
                { k: "c", label: "Koolhydraten", col: C.carb },
                { k: "f", label: "Vet", col: C.fat },
              ].map((m) => (
                <div key={m.k}>
                  <div className="text-xs mb-1" style={{ color: m.col }}>
                    {m.label}
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={newFood[m.k]}
                    onChange={(ev) => setNewFood((s) => ({ ...s, [m.k]: ev.target.value }))}
                    placeholder="g"
                    className="w-full px-2 py-1.5 text-sm text-right tnum" data-field
                    style={{ border: `1px solid ${C.line}`, background: C.surface2, color: C.ink, borderRadius: R.field }}
                    aria-label={`${m.label} per 100 gram`}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2" style={{ maxWidth: "33%" }}>
              <div className="text-xs mb-1" style={{ color: C.muted }}>
                Vezels (optioneel)
              </div>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={newFood.fib}
                onChange={(ev) => setNewFood((s) => ({ ...s, fib: ev.target.value }))}
                placeholder="g"
                className="w-full px-2 py-1.5 text-sm text-right tnum" data-field
                style={{ border: `1px solid ${C.line}`, background: C.surface2, color: C.ink, borderRadius: R.field }}
                aria-label="Vezels per 100 gram"
              />
            </div>
            <p className="text-xs mt-1.5 tnum" style={{ color: C.muted }}>
              Per 100 g. Dat komt neer op{" "}
              {Math.round((Number(newFood.p) || 0) * 4 + (Number(newFood.c) || 0) * 4 + (Number(newFood.f) || 0) * 9)} kcal;
              vergelijk dat met het etiket als controle.
            </p>

            <div className="grid grid-cols-2 gap-2 mt-2">
              <div>
                <div className="text-xs mb-1" style={{ color: C.muted }}>
                  Gewicht per stuk (optioneel)
                </div>
                <input
                  type="number"
                  inputMode="numeric"
                  value={newFood.unitGrams}
                  onChange={(ev) => setNewFood((s) => ({ ...s, unitGrams: ev.target.value }))}
                  placeholder="g"
                  className="w-full px-2 py-1.5 text-sm text-right tnum" data-field
                  style={{ border: `1px solid ${C.line}`, background: C.surface2, color: C.ink, borderRadius: R.field }}
                  aria-label="Gewicht per stuk"
                />
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: C.muted }}>
                  Naam van een stuk
                </div>
                <input
                  type="text"
                  value={newFood.unitLabel}
                  onChange={(ev) => setNewFood((s) => ({ ...s, unitLabel: ev.target.value }))}
                  placeholder="reep, bakje"
                  className="w-full px-2 py-1.5 text-sm" data-field
                  style={{ border: `1px solid ${C.line}`, background: C.surface2, color: C.ink, borderRadius: R.field }}
                  aria-label="Naam van een stuk"
                />
              </div>
            </div>

            {foodError && (
              <p className="text-xs mt-2" style={{ color: C.warn }}>
                {foodError}
              </p>
            )}
            <div className="flex gap-2 mt-2">
              <button
                onClick={addFood}
                className="tap px-3 py-1.5 text-sm"
                style={{ background: C.accent, color: C.onAccent, borderRadius: R.field, fontWeight: 600 }}
              >
                {editingFood ? "Wijzigingen opslaan" : "Product opslaan"}
              </button>
              {editingFood && (
                <button
                  onClick={cancelEditFood}
                  className="tap px-3 py-1.5 text-sm"
                  style={{ border: `1px solid ${C.line}`, color: C.muted, borderRadius: R.field }}
                >
                  Annuleren
                </button>
              )}
            </div>
          </div>

          {customFoods.length === 0 ? (
            <div className="px-3 py-3 text-xs leading-relaxed" style={{ color: C.muted }}>
              Nog geen eigen producten. De standaardtabel bevat {Object.values(FOODS).reduce((a, b) => a + b.length, 0)}{" "}
              producten met afgeronde gemiddelden; voeg hier alles toe waarvan u het etiket wilt aanhouden.
            </div>
          ) : (
            customFoods.map((fo) => (
              <div key={fo.id} className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{fo.label}</div>
                  <div className="text-xs tnum" style={{ color: C.muted }}>
                    {fo.p} g eiwit · {fo.c} g kh · {fo.f} g vet{fo.fib ? ` · ${fo.fib} g vezels` : ""} ·{" "}
                    {Math.round(fo.p * 4 + fo.c * 4 + fo.f * 9)} kcal per 100 g
                    {fo.unitGrams ? ` · ${fo.unitGrams} g per ${fo.unitLabel}` : ""}
                  </div>
                </div>
                {confirmFood === fo.id ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => removeFood(fo.id)}
                      className="px-2 py-1 text-xs rounded"
                      style={{ background: C.train, color: C.paper }}
                    >
                      Verwijderen
                    </button>
                    <button
                      onClick={() => setConfirmFood(null)}
                      className="px-2 py-1 text-xs rounded"
                      style={{ border: `1px solid ${C.line}`, color: C.muted }}
                    >
                      Terug
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => startEditFood(fo)}
                      className="tap text-xs px-2.5 py-1 rounded-full"
                      style={{
                        border: `1px solid ${editingFood === fo.id ? C.accent : C.line}`,
                        color: C.accent,
                        fontWeight: 600,
                      }}
                    >
                      {editingFood === fo.id ? "Wordt bewerkt" : "Bewerken"}
                    </button>
                    <button
                      onClick={() => setConfirmFood(fo.id)}
                      className="tap text-base px-2"
                      style={{ color: C.muted }}
                      aria-label={`${fo.label} verwijderen`}
                    >
                      &times;
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </Section>

          </>
        )}
        {tab === "plan" && (
          <>
        {/* ---------------- actief plan ---------------- */}
        {autopilot && (
          <Section
            title="Actief plan"
            accent={planNow.active ? PHASE_COLOR[planNow.row.phase] : C.muted}
            sub="Uw voedingsschema volgt dit plan automatisch. Elke week past de app de calorieën en porties aan; u krijgt een melding op Vandaag zodra er iets verandert."
          >
            <div className="px-4 pt-4 pb-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
              <div className="flex gap-px overflow-hidden relative" style={{ height: 30, borderRadius: 6 }}>
                {autopilot.rows.map((r, k) => {
                  const here = planNow.active && planNow.week === k;
                  const past = planNow.active ? k < planNow.week : planNow.ended;
                  return (
                    <div
                      key={k}
                      className="flex-1 relative"
                      style={{ background: PHASE_COLOR[r.phase], opacity: past ? 0.35 : 1, minWidth: 2 }}
                      title={`Week ${k + 1}: ${PHASE_LABEL[r.phase]}`}
                    >
                      {here && (
                        <span
                          className="absolute inset-0"
                          style={{ boxShadow: `inset 0 0 0 2px ${C.ink}`, borderRadius: 2 }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              {planNow.active && (
                <div className="relative mt-1" style={{ height: 16 }}>
                  <span
                    className="absolute text-xs font-semibold whitespace-nowrap"
                    style={{
                      left: `${((planNow.week + 0.5) / planNow.total) * 100}%`,
                      transform: `translateX(${planNow.week / planNow.total > 0.7 ? "-100%" : planNow.week / planNow.total > 0.3 ? "-50%" : "0"})`,
                      color: C.ink,
                    }}
                  >
                    u bent hier · week {planNow.week + 1}
                  </span>
                </div>
              )}
            </div>

            <div className="px-4 py-3 grid grid-cols-2 gap-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
              <div>
                <div className="text-xs" style={{ color: C.muted }}>
                  Gestart
                </div>
                <div className="text-sm font-semibold">{dateNL(new Date(autopilot.start + "T00:00:00"))}</div>
              </div>
              <div>
                <div className="text-xs" style={{ color: C.muted }}>
                  Einde
                </div>
                <div className="text-sm font-semibold">
                  {dateNL(new Date(new Date(autopilot.start + "T00:00:00").getTime() + autopilot.rows.length * 7 * DAY_MS))}
                </div>
              </div>
              <div className="col-span-2 text-xs leading-relaxed" style={{ color: C.muted }}>
                {planNow.active
                  ? `Deze week: ${PHASE_LABEL[planNow.row.phase]}, ${planNow.row.rate > 0 ? "+" : ""}${planNow.row.rate.toFixed(2)} procent lichaamsgewicht per week.${
                      planNow.next && planNow.next.phase !== planNow.row.phase ? ` Volgende week: ${PHASE_LABEL[planNow.next.phase]}.` : ""
                    }`
                  : planNow.pending
                  ? `Het plan begint over ${planNow.daysToStart} ${planNow.daysToStart === 1 ? "dag" : "dagen"}. Tot dan geldt uw eigen doel.`
                  : "Het plan is afgelopen. Uw eigen doel geldt weer."}
              </div>
            </div>

            {autopilot.rows.some((r) => r.note) && (
              <div className="px-4 py-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
                <div className="text-sm font-semibold mb-2">Komende omslagmomenten</div>
                {autopilot.rows
                  .map((r, k) => ({ ...r, k }))
                  .filter((r) => r.note && (!planNow.active || r.k >= planNow.week))
                  .slice(0, 4)
                  .map((r) => {
                    const date = new Date(new Date(autopilot.start + "T00:00:00").getTime() + (r.k + 1) * 7 * DAY_MS);
                    return (
                      <div key={r.k} className="flex gap-2 mb-2 last:mb-0">
                        <span className="text-xs font-semibold shrink-0 tnum" style={{ width: 64, color: PHASE_COLOR[r.phase] }}>
                          {date.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
                        </span>
                        <span className="text-xs leading-relaxed">{r.note}</span>
                      </div>
                    );
                  })}
              </div>
            )}

            <div className="px-4 py-3">
              {!confirmStop ? (
                <button onClick={() => setConfirmStop(true)} className="tap text-sm underline" style={{ color: C.muted }}>
                  Plan stoppen
                </button>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs" style={{ color: C.warn }}>
                    Plan stoppen? Uw eigen doel geldt dan weer.
                  </span>
                  <button
                    onClick={stopPlan}
                    className="tap px-3 py-1.5 text-sm"
                    style={{ background: C.train, color: C.onTrain, borderRadius: R.field, fontWeight: 600 }}
                  >
                    Stoppen
                  </button>
                  <button
                    onClick={() => setConfirmStop(false)}
                    className="tap px-3 py-1.5 text-sm"
                    style={{ border: `1px solid ${C.line}`, color: C.muted, borderRadius: R.field }}
                  >
                    Annuleren
                  </button>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* ---------------- gewichtslog ---------------- */}
        <Section
          title="Gewicht en bijsturen"
          sub="Elke formule heeft een marge van ongeveer tien procent. Na tien dagen wegen weet de app wat uw werkelijke behoefte is."
        >
          <div className="px-3 py-3 flex items-end gap-2" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
            <div className="flex-1">
              <div className="text-xs mb-1" style={{ color: C.muted }}>
                Datum
              </div>
              <input
                type="date"
                value={newEntry.date}
                onChange={(e) => setNewEntry((s) => ({ ...s, date: e.target.value }))}
                className="w-full px-2 py-1.5 text-sm tnum" data-field
                style={{ border: `1px solid ${C.line}`, background: C.surface2, color: C.ink, borderRadius: R.field }}
              />
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: C.muted }}>
                Gewicht
              </div>
              <Num value={newEntry.weight} onChange={(v) => setNewEntry((s) => ({ ...s, weight: v }))} step={0.1} suffix="kg" />
            </div>
            <button onClick={addEntry} className="tap px-3 py-1.5 text-sm" style={{ background: C.accent, color: C.onAccent, borderRadius: R.field, fontWeight: 600 }}>
              Toevoegen
            </button>
          </div>

          {log.length > 0 && (
            <div className="px-3 py-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
              <div className="flex items-end justify-between gap-3 mb-2">
                <div>
                  <div className="text-xs" style={{ color: C.muted }}>
                    7-daags gemiddelde
                  </div>
                  <div className="disp text-3xl font-bold tnum leading-none">
                    {kg(rollingAverage(log.map((e) => ({ t: dayNum(e.date), w: e.weight })).sort((a, b) => a.t - b.t)).slice(-1)[0])}
                    <span className="text-base font-medium" style={{ color: C.muted }}>
                      {" "}
                      kg
                    </span>
                  </div>
                </div>
                <Seg
                  value={chartRange}
                  onChange={setChartRange}
                  options={[
                    { value: 28, label: "4 wk" },
                    { value: 84, label: "12 wk" },
                    { value: 0, label: "Alles" },
                  ]}
                />
              </div>
              <WeightChart
                log={log}
                rangeDays={chartRange}
                planKgPerWeek={effGoal === "onderhoud" ? 0 : (effRate / 100) * weight}
                onDelete={(date) => setLog((l) => l.filter((e) => e.date !== date))}
              />
              <div className="text-xs mt-2" style={{ color: C.muted }}>
                {log.length} {log.length === 1 ? "meting" : "metingen"}, laatste op{" "}
                {new Date(log[log.length - 1].date + "T00:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}
              </div>
            </div>
          )}

          {log.length > 0 && (
            <div className="px-3 py-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
              <div className="text-sm font-medium mb-1.5">Weekgemiddelden</div>
              <table className="w-full text-xs tnum">
                <thead>
                  <tr style={{ color: C.muted }}>
                    <th className="text-left font-normal py-1">Week</th>
                    <th className="text-right font-normal py-1">Gemiddeld</th>
                    <th className="text-right font-normal py-1">Verschil</th>
                    <th className="text-right font-normal py-1">Metingen</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyAverages(log)
                    .slice(-8)
                    .reverse()
                    .map((g) => {
                      const want = effGoal === "onderhoud" ? 0 : effRate;
                      const good =
                        g.delta == null
                          ? null
                          : want < 0
                          ? g.delta < 0
                          : want > 0
                          ? g.delta > 0 && g.delta < 0.6
                          : Math.abs(g.delta) < 0.4;
                      return (
                        <tr key={g.key} style={{ borderTop: `1px solid ${C.lineSoft}` }}>
                          <td className="py-1.5">
                            <strong>Wk {g.week}</strong>
                            <span style={{ color: C.muted }}> · {fmtDay(g.monday)}</span>
                          </td>
                          <td className="py-1.5 text-right font-semibold">{kg(g.avg)} kg</td>
                          <td
                            className="py-1.5 text-right"
                            style={{ color: good == null ? C.muted : good ? C.carb : C.warn, fontWeight: 600 }}
                          >
                            {g.delta == null ? "-" : `${g.delta > 0 ? "+" : ""}${kg(g.delta)}`}
                          </td>
                          <td className="py-1.5 text-right" style={{ color: g.count < 3 ? C.warn : C.muted }}>
                            {g.count}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              <p className="text-xs mt-1.5 leading-relaxed" style={{ color: C.muted }}>
                Het verschil is groen als het de kant op gaat die uw huidige doel vraagt. Een week met minder dan drie
                metingen is minder betrouwbaar.
              </p>
            </div>
          )}

          <div className="px-3 py-3">
            {!trend.ok ? (
              <p className="text-xs leading-relaxed" style={{ color: C.muted }}>
                Nog geen betrouwbare trend: {trend.reason}. Weeg bij voorkeur elke ochtend na het toilet en voor
                het ontbijt; dagschommelingen van een kilo zijn normaal en worden weggemiddeld.
              </p>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm">Gemeten tempo</span>
                  <span className="text-sm font-semibold tnum" style={{ color: C.ink }}>
                    {trend.kgPerWeek > 0 ? "+" : ""}
                    {trend.kgPerWeek.toFixed(2).replace(".", ",")} kg per week
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 mt-1">
                  <span className="text-sm" style={{ color: C.muted }}>
                    Gepland tempo
                  </span>
                  <span className="text-sm tnum" style={{ color: C.muted }}>
                    {effGoal === "onderhoud" ? "0,00" : ((effRate / 100) * weight > 0 ? "+" : "") + ((effRate / 100) * weight).toFixed(2).replace(".", ",")} kg
                    per week
                  </span>
                </div>
                <p className="text-xs mt-2 leading-relaxed" style={{ color: C.muted }}>
                  Gebaseerd op {trend.n} metingen over {Math.round(trend.span)} dagen, zevendaags gemiddelde{" "}
                  {trend.avg7.toFixed(1).replace(".", ",")} kg.
                </p>
                {correctionPaused ? (
                  <p className="text-xs mt-2 leading-relaxed" style={{ color: C.muted }}>
                    {correctionPaused}
                  </p>
                ) : correction && correction.meaningful ? (
                  <div className="mt-3 rounded px-3 py-2" style={{ background: C.warnBg, border: `1px solid ${C.warn}` }}>
                    <p className="text-xs leading-relaxed" style={{ color: C.warn }}>
                      U zit {correction.rounded < 0 ? "boven" : "onder"} het geplande tempo. Pas de inname aan met{" "}
                      {correction.rounded > 0 ? "+" : ""}
                      {correction.rounded} kcal per dag.
                    </p>
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => setKcalAdjust((k) => k + correction.rounded)}
                        className="tap px-3 py-1.5 text-sm"
                        style={{ background: C.accent, color: C.onAccent, borderRadius: R.field, fontWeight: 600 }}
                      >
                        Toepassen
                      </button>
                      {kcalAdjust !== 0 && (
                        <button
                          onClick={() => setKcalAdjust(0)}
                          className="px-3 py-1.5 text-sm rounded"
                          style={{ border: `1px solid ${C.line}`, color: C.muted }}
                        >
                          Correctie wissen
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs mt-2 leading-relaxed" style={{ color: C.carb }}>
                    U ligt op koers. Een afwijking onder 100 kcal per dag valt binnen de meetruis; laat het schema
                    staan.
                  </p>
                )}
                {kcalAdjust !== 0 && (
                  <p className="text-xs mt-2 tnum" style={{ color: C.muted }}>
                    Actieve correctie: {kcalAdjust > 0 ? "+" : ""}
                    {kcalAdjust} kcal per dag.
                  </p>
                )}
              </>
            )}
          </div>
        </Section>

        {/* ---------------- fasenplan ---------------- */}
        <Section
          title="Meerwekenplan"
          sub={
            f.goal === "bulk"
              ? "Bij opbouwen is niet uw gewicht de grens maar uw vetpercentage. Het plan houdt u binnen een venster en zet een minicut in zodra u het plafond raakt."
              : "Uw behoefte daalt naarmate u lichter wordt. Het plan rekent dat week voor week door en zet dieetpauzes tussen de blokken."
          }
        >
          <Row label="Plan berekenen">
            <Seg
              value={showPlan}
              onChange={setShowPlan}
              options={[
                { value: true, label: "Aan" },
                { value: false, label: "Uit" },
              ]}
            />
          </Row>
          {showPlan && (
            <>
              <Row
                label="Soort plan"
                stack
                hint={
                  phaseCfg.mode === "doorlopend"
                    ? "Eén doorlopende keten: cut, opbouw van de calorieën, onderhoud, opbouwfase en minicuts achter elkaar, met de overgangen erbij."
                    : "Eén richting, volgens het doel dat u hierboven heeft gekozen."
                }
              >
                <Seg
                  value={phaseCfg.mode}
                  onChange={(v) => setPhase("mode", v)}
                  options={[
                    { value: "een", label: "Eén fase" },
                    { value: "doorlopend", label: "Doorlopend" },
                  ]}
                />
              </Row>
              <Row label="Horizon" hint="Hoe ver vooruit u wilt kijken.">
                <Num value={phaseCfg.horizonWeeks} onChange={(v) => setPhase("horizonWeeks", v)} min={4} max={78} suffix="wk" />
              </Row>

              {phaseCfg.mode === "doorlopend" ? (
                <>
                  <Row label="Wat weegt het zwaarst" stack hint="Bepaalt of het plan eindigt met maximale spiermassa of met een slotcut naar een vetpercentage.">
                    <Pick
                      value={phaseCfg.priority}
                      onChange={(v) => setPhase("priority", v)}
                      options={[
                        { id: "spier", label: "Zoveel mogelijk spiermassa binnen de horizon" },
                        { id: "vorm", label: "In vorm zijn op de einddatum" },
                      ]}
                    />
                  </Row>
                  {phaseCfg.priority === "vorm" && (
                    <Row label="Vetpercentage op de einddatum" hint="De slotcut wordt hiervandaan teruggerekend.">
                      <Num value={phaseCfg.targetBf} onChange={(v) => setPhase("targetBf", v)} step={0.5} min={5} max={35} suffix="%" />
                    </Row>
                  )}
                  <Row
                    label="Vetpercentagevenster"
                    stack
                    hint="De bodem is waar een opbouwfase begint, het plafond is waar een minicut start."
                  >
                    <Pick
                      value={phaseCfg.windowKey}
                      onChange={(v) =>
                        setPhaseCfg((s) => {
                          if (v !== "eigen") return { ...s, windowKey: v };
                          // eigen grenzen beginnen bij het venster dat nu actief is
                          const cur = (BF_WINDOW[f.sex] || BF_WINDOW.man)[s.windowKey] || (BF_WINDOW[f.sex] || BF_WINDOW.man).standaard;
                          return { ...s, windowKey: "eigen", bfLow: s.bfLow ?? cur[0], bfHigh: s.bfHigh ?? cur[1] };
                        })
                      }
                      options={[
                        ...Object.keys(BF_WINDOW[f.sex]).map((k) => ({
                          id: k,
                          label: `${k === "behoudend" ? "Behoudend" : k === "standaard" ? "Standaard" : "Ruim"}: ${BF_WINDOW[f.sex][k][0]} tot ${BF_WINDOW[f.sex][k][1]} procent`,
                        })),
                        { id: "eigen", label: "Eigen grenzen invullen" },
                      ]}
                    />
                    {phaseCfg.windowKey === "eigen" && (() => {
                      const L = BF_LIMITS[f.sex] || BF_LIMITS.man;
                      const rawLo = num(phaseCfg.bfLow, bfWindow[0]);
                      const rawHi = num(phaseCfg.bfHigh, bfWindow[1]);
                      const notes = [];
                      if (rawLo !== bfWindow[0] || rawHi !== bfWindow[1])
                        notes.push(`De app rekent met ${bfWindow[0]} tot ${bfWindow[1]} procent: tussen ${L.min} en ${L.max} procent, met minimaal drie procentpunt ruimte.`);
                      if (bfWindow[0] < L.lowWarn)
                        notes.push(`Onder ${L.lowWarn} procent raakt de hormoonproductie verstoord. Houd dat hooguit kort vol.`);
                      if (bfWindow[1] > L.highWarn)
                        notes.push(`Boven ${L.highWarn} procent gaat een steeds groter deel van elk surplus naar vet in plaats van spier.`);
                      return (
                        <div className="mt-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <div className="text-xs mb-1" style={{ color: C.muted }}>
                                Ondergrens
                              </div>
                              <Num value={phaseCfg.bfLow ?? ""} onChange={(v) => setPhase("bfLow", v)} step={0.5} min={L.min} max={L.max} suffix="%" />
                            </div>
                            <div>
                              <div className="text-xs mb-1" style={{ color: C.muted }}>
                                Bovengrens
                              </div>
                              <Num value={phaseCfg.bfHigh ?? ""} onChange={(v) => setPhase("bfHigh", v)} step={0.5} min={L.min} max={L.max} suffix="%" />
                            </div>
                          </div>
                          <p className="text-xs mt-1.5 leading-relaxed" style={{ color: C.muted }}>
                            Een cut gaat terug naar de ondergrens, een opbouwfase loopt tot de bovengrens en een minicut
                            brengt u ongeveer vier procentpunt terug, niet verder dan de ondergrens.
                          </p>
                          {notes.map((n, i) => (
                            <p key={i} className="text-xs mt-1 leading-relaxed" style={{ color: C.warn }}>
                              {n}
                            </p>
                          ))}
                        </div>
                      );
                    })()}
                  </Row>
                  <Row label="Tempo opbouwfase" stack>
                    <Slide value={phaseCfg.bulkRate} onChange={(v) => setPhase("bulkRate", v)} min={0.1} max={0.5} step={0.025} format={(v) => `${v.toFixed(3)} %`} />
                  </Row>
                  <Row label="Tempo cut" stack>
                    <Slide value={phaseCfg.cutRate} onChange={(v) => setPhase("cutRate", v)} min={0.3} max={1.0} step={0.05} format={(v) => `${v.toFixed(2)} %`} />
                  </Row>
                  <Row label="Minicuts gebruiken">
                    <Seg
                      value={phaseCfg.minicut}
                      onChange={(v) => setPhase("minicut", v)}
                      options={[
                        { value: true, label: "Aan" },
                        { value: false, label: "Uit" },
                      ]}
                    />
                  </Row>
                  <Row label="Maximale opbouwfase">
                    <Num value={phaseCfg.blockWeeks} onChange={(v) => setPhase("blockWeeks", v)} min={6} max={24} suffix="wk" />
                  </Row>
                  <Row label="Maximaal dieetblok" hint="Daarna volgt een dieetpauze.">
                    <Num value={phaseCfg.cutBlockWeeks} onChange={(v) => setPhase("cutBlockWeeks", v)} min={4} max={16} suffix="wk" />
                  </Row>
                </>
              ) : f.goal === "bulk" ? (
                <>
                  <Row
                    label="Vetpercentagevenster"
                    stack
                    hint="De bodem is waar u een opbouwfase begint, het plafond is waar een minicut start."
                  >
                    <Pick
                      value={phaseCfg.windowKey}
                      onChange={(v) =>
                        setPhaseCfg((s) => {
                          if (v !== "eigen") return { ...s, windowKey: v };
                          // eigen grenzen beginnen bij het venster dat nu actief is
                          const cur = (BF_WINDOW[f.sex] || BF_WINDOW.man)[s.windowKey] || (BF_WINDOW[f.sex] || BF_WINDOW.man).standaard;
                          return { ...s, windowKey: "eigen", bfLow: s.bfLow ?? cur[0], bfHigh: s.bfHigh ?? cur[1] };
                        })
                      }
                      options={[
                        ...Object.keys(BF_WINDOW[f.sex]).map((k) => ({
                          id: k,
                          label: `${k === "behoudend" ? "Behoudend" : k === "standaard" ? "Standaard" : "Ruim"}: ${BF_WINDOW[f.sex][k][0]} tot ${BF_WINDOW[f.sex][k][1]} procent`,
                        })),
                        { id: "eigen", label: "Eigen grenzen invullen" },
                      ]}
                    />
                    {phaseCfg.windowKey === "eigen" && (() => {
                      const L = BF_LIMITS[f.sex] || BF_LIMITS.man;
                      const rawLo = num(phaseCfg.bfLow, bfWindow[0]);
                      const rawHi = num(phaseCfg.bfHigh, bfWindow[1]);
                      const notes = [];
                      if (rawLo !== bfWindow[0] || rawHi !== bfWindow[1])
                        notes.push(`De app rekent met ${bfWindow[0]} tot ${bfWindow[1]} procent: tussen ${L.min} en ${L.max} procent, met minimaal drie procentpunt ruimte.`);
                      if (bfWindow[0] < L.lowWarn)
                        notes.push(`Onder ${L.lowWarn} procent raakt de hormoonproductie verstoord. Houd dat hooguit kort vol.`);
                      if (bfWindow[1] > L.highWarn)
                        notes.push(`Boven ${L.highWarn} procent gaat een steeds groter deel van elk surplus naar vet in plaats van spier.`);
                      return (
                        <div className="mt-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <div className="text-xs mb-1" style={{ color: C.muted }}>
                                Ondergrens
                              </div>
                              <Num value={phaseCfg.bfLow ?? ""} onChange={(v) => setPhase("bfLow", v)} step={0.5} min={L.min} max={L.max} suffix="%" />
                            </div>
                            <div>
                              <div className="text-xs mb-1" style={{ color: C.muted }}>
                                Bovengrens
                              </div>
                              <Num value={phaseCfg.bfHigh ?? ""} onChange={(v) => setPhase("bfHigh", v)} step={0.5} min={L.min} max={L.max} suffix="%" />
                            </div>
                          </div>
                          <p className="text-xs mt-1.5 leading-relaxed" style={{ color: C.muted }}>
                            Een cut gaat terug naar de ondergrens, een opbouwfase loopt tot de bovengrens en een minicut
                            brengt u ongeveer vier procentpunt terug, niet verder dan de ondergrens.
                          </p>
                          {notes.map((n, i) => (
                            <p key={i} className="text-xs mt-1 leading-relaxed" style={{ color: C.warn }}>
                              {n}
                            </p>
                          ))}
                        </div>
                      );
                    })()}
                  </Row>
                  <Row label="Minicuts gebruiken" hint="Zonder minicut stopt de opbouw zodra u het plafond raakt.">
                    <Seg
                      value={phaseCfg.minicut}
                      onChange={(v) => setPhase("minicut", v)}
                      options={[
                        { value: true, label: "Aan" },
                        { value: false, label: "Uit" },
                      ]}
                    />
                  </Row>
                  {phaseCfg.minicut && (
                    <>
                      <Row label="Tempo van de minicut" stack hint="Kort en stevig. Onder 0,5 procent duurt het te lang, boven 1,0 procent kost het spiermassa.">
                        <Slide
                          value={phaseCfg.minicutRate}
                          onChange={(v) => setPhase("minicutRate", v)}
                          min={0.5}
                          max={1.0}
                          step={0.05}
                          format={(v) => `${v.toFixed(2)} %`}
                        />
                      </Row>
                      <Row label="Maximale duur minicut">
                        <Num value={phaseCfg.maxMinicutWeeks} onChange={(v) => setPhase("maxMinicutWeeks", v)} min={2} max={8} suffix="wk" />
                      </Row>
                    </>
                  )}
                  <Row label="Maximale opbouwfase" hint="Na deze periode volgt hoe dan ook een onderhoudsblok.">
                    <Num value={phaseCfg.blockWeeks} onChange={(v) => setPhase("blockWeeks", v)} min={6} max={24} suffix="wk" />
                  </Row>
                </>
              ) : (
                <>
                  <Row label="Doelgewicht">
                    <Num value={phaseCfg.targetWeight} onChange={(v) => setPhase("targetWeight", v)} step={0.5} suffix="kg" />
                  </Row>
                  <Row label="Lengte dieetblok">
                    <Num value={phaseCfg.blockWeeks} onChange={(v) => setPhase("blockWeeks", v)} min={4} max={16} suffix="wk" />
                  </Row>
                </>
              )}
              <Row label="Lengte onderhoudsfase">
                <Num value={phaseCfg.maintWeeks} onChange={(v) => setPhase("maintWeeks", v)} min={1} max={8} suffix="wk" />
              </Row>

              {plan52 && plan52.rows.length > 0 && (
                <>
                  {/* fasenstreep */}
                  <div className="px-4 pt-4 pb-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
                    <div className="flex gap-px overflow-hidden" style={{ height: 26, borderRadius: 6 }}>
                      {plan52.rows.map((r) => (
                        <div
                          key={r.week}
                          className="flex-1 relative"
                          style={{ background: PHASE_COLOR[r.phase], minWidth: 2 }}
                          title={`Week ${r.week}: ${PHASE_LABEL[r.phase]}`}
                        >
                          {r.note && (
                            <span
                              className="absolute left-0 right-0 bottom-0 h-1"
                              style={{ background: C.ink, opacity: 0.55 }}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                      {[...new Set(plan52.rows.map((r) => r.phase))].map((ph) => (
                        <span key={ph} className="flex items-center gap-1.5 text-xs" style={{ color: C.muted }}>
                          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: PHASE_COLOR[ph] }} />
                          {PHASE_LABEL[ph]} · {plan52.rows.filter((r) => r.phase === ph).length} wk
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* samenvatting */}
                  <div className="px-4 py-3 grid grid-cols-3 gap-2" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
                    {[
                      {
                        k: "Gewicht",
                        v: `${plan52.summary.gain >= 0 ? "+" : ""}${plan52.summary.gain.toFixed(1)}`,
                        u: "kg",
                        col: C.ink,
                      },
                      {
                        k: "Vetvrije massa",
                        v: `${plan52.summary.lean >= 0 ? "+" : ""}${plan52.summary.lean.toFixed(1)}`,
                        u: "kg",
                        col: C.carb,
                      },
                      {
                        k: "Vetmassa",
                        v: `${plan52.summary.fat >= 0 ? "+" : ""}${plan52.summary.fat.toFixed(1)}`,
                        u: "kg",
                        col: plan52.summary.fat > 0 ? C.fat : C.carb,
                      },
                    ].map((x) => (
                      <div key={x.k}>
                        <div className="text-xs truncate" style={{ color: C.muted }}>
                          {x.k}
                        </div>
                        <div className="disp text-2xl font-bold tnum leading-none" style={{ color: x.col }}>
                          {x.v}
                          <span className="text-sm font-medium" style={{ color: C.muted }}>
                            {" "}
                            {x.u}
                          </span>
                        </div>
                      </div>
                    ))}
                    <div className="col-span-3 text-xs leading-relaxed tnum mt-1" style={{ color: C.muted }}>
                      {plan52.summary.weeks} weken, eindigend rond {dateNL(addDays(plan52.summary.weeks * 7))} op{" "}
                      {plan52.summary.endWeight.toFixed(1)} kg en {plan52.summary.endBf.toFixed(1)} procent vet
                      {plan52.summary.minicuts > 0 && `, met ${plan52.summary.minicuts} minicut${plan52.summary.minicuts > 1 ? "s" : ""}`}
                      .{plan52.summary.estimatedBf && " Het vetpercentage is geschat; vul uw eigen waarde in voor een scherper plan."}
                    </div>
                  </div>

                  <div className="px-4 py-3" style={{ borderBottom: `1px solid ${C.lineSoft}`, background: C.surface2 }}>
                    <div className="text-sm font-semibold">{autopilot ? "Dit plan in plaats van het actieve plan starten" : "Dit plan starten"}</div>
                    <p className="text-xs mt-0.5 mb-2 leading-relaxed" style={{ color: C.muted }}>
                      Vanaf de startdatum volgt uw voedingsschema dit plan automatisch, week voor week. De fases liggen
                      vast; de calorieën rekent de app steeds opnieuw uit met uw actuele gewicht.
                    </p>
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <div className="text-xs mb-1" style={{ color: C.muted }}>
                          Startdatum
                        </div>
                        <input
                          type="date"
                          value={planStartInput}
                          onChange={(ev) => setPlanStartInput(ev.target.value)}
                          className="w-full px-2 py-1.5 text-sm tnum" data-field
                          style={{ border: `1px solid ${C.line}`, background: C.panel, color: C.ink, borderRadius: R.field }}
                          aria-label="Startdatum van het plan"
                        />
                      </div>
                      <button
                        onClick={startPlan}
                        className="tap px-4 py-1.5 text-sm"
                        style={{ background: C.accent, color: C.onAccent, borderRadius: R.field, fontWeight: 600 }}
                      >
                        {autopilot ? "Vervangen" : "Starten"}
                      </button>
                    </div>
                  </div>

                  {plan52.summary.advice.map((a, i) => (
                    <div key={i} className="px-4 py-3 relative" style={{ background: C.warnBg, borderBottom: `1px solid ${C.lineSoft}` }}>
                      <span className="rail" style={{ background: C.warn }} />
                      <p className="text-xs leading-relaxed" style={{ color: C.warn }}>
                        {a}
                      </p>
                    </div>
                  ))}

                  {/* omslagmomenten */}
                  {plan52.rows.some((r) => r.note) && (
                    <div className="px-4 py-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
                      <div className="text-sm font-semibold mb-2">Omslagmomenten</div>
                      {plan52.rows
                        .filter((r) => r.note)
                        .map((r) => (
                          <div key={r.week} className="flex gap-2 mb-2 last:mb-0">
                            <span className="disp text-base font-bold tnum shrink-0 w-12" style={{ color: PHASE_COLOR[r.phase] }}>
                              wk {r.week}
                            </span>
                            <span className="text-xs leading-relaxed">{r.note}</span>
                          </div>
                        ))}
                    </div>
                  )}

                  <div className="px-3 py-2 max-h-64 overflow-y-auto">
                    <table className="w-full text-xs tnum">
                      <thead>
                        <tr style={{ color: C.muted }}>
                          <th className="text-left font-normal py-1">Wk</th>
                          <th className="text-left font-normal py-1">Fase</th>
                          <th className="text-right font-normal py-1">Gewicht</th>
                          <th className="text-right font-normal py-1">Vet</th>
                          <th className="text-right font-normal py-1">Kcal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan52.rows.map((r) => (
                          <tr key={r.week} style={{ borderTop: `1px solid ${C.lineSoft}` }}>
                            <td className="py-1">{r.week}</td>
                            <td className="py-1">
                              <span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: PHASE_COLOR[r.phase] }} />
                              {PHASE_LABEL[r.phase]}
                            </td>
                            <td className="py-1 text-right">{r.weight.toFixed(1)}</td>
                            <td className="py-1 text-right">{r.bodyFat.toFixed(1)}%</td>
                            <td className="py-1 text-right">{Math.round(r.kcal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-3 text-xs leading-relaxed" style={{ color: C.muted }}>
                    De prognose rekent met een verhouding tussen spier- en vetaanwas die verslechtert naarmate u vetter
                    wordt en naarmate u sneller aankomt. Bij 0,125 procent per week gaat ongeveer 40 procent van de
                    aanwas naar vet, bij 0,5 procent per week ruim 65 procent. Dat is de reden dat sneller bulken niet
                    sneller spier oplevert.
                  </div>
                </>
              )}
            </>
          )}
        </Section>

        <Section title="Wanneer welke fase" accent={C.carb}>
          {PHASE_GUIDE(f.sex).map((g, i) => (
            <div key={i} className="px-4 py-3 relative" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
              <span className="rail" style={{ background: g.col }} />
              <div className="disp text-lg font-bold uppercase leading-none mb-1.5" style={{ color: g.col }}>
                {g.title}
              </div>
              <ul className="text-xs leading-relaxed">
                {g.items.map((t, k) => (
                  <li key={k} className="mb-1 last:mb-0 flex gap-2">
                    <span style={{ color: C.muted }}>·</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Section>

          </>
        )}
        {tab === "gezondheid" && (
          <>
        {/* ---------------- micronutriënten en hormonen ---------------- */}
        <Section
          title="Hormonale gezondheid"
          sub="Vier factoren met meer invloed op uw hormoonhuishouding dan welk supplement ook. Ze volgen uit de gegevens die u invult."
        >
          <Status
            label="Energiebeschikbaarheid"
            value={`${Math.round(hormone.ea)} kcal/kg VVM`}
            state={hormone.ea < 30 ? "risico" : hormone.ea < 35 ? "oplet" : "goed"}
            note={
              hormone.ea < 30
                ? "Onder 30 kcal per kg vetvrije massa raakt de hormoonproductie verstoord: bij vrouwen cyclusuitval en botverlies, bij mannen een daling van testosteron. Verlaag het tempo of het trainingsvolume."
                : hormone.ea < 35
                ? "Werkbaar tijdens een dieetfase, maar niet houdbaar voor maanden achtereen. Plan onderhoudsweken in."
                : "Ruim voldoende voor een normale hormoonproductie." +
                  (hormone.estimated ? " Vetvrije massa is geschat; vul uw vetpercentage in voor een preciezer getal." : "")
            }
          />
          <Status
            label="Vetinname"
            value={`${Math.round(hormone.fatPct)} % van de calorieën`}
            state={hormone.fatPct < 20 ? "risico" : hormone.fatPct < 23 ? "oplet" : "goed"}
            note={
              hormone.fatPct < 23
                ? "Steroïdhormonen worden uit cholesterol opgebouwd. Onder 20 procent van de calorieën uit vet daalt het totaal testosteron in meta-analyse met ongeveer 10 tot 15 procent. Verhoog het vetaandeel bij de geavanceerde instellingen."
                : null
            }
          />
          <Status
            label="Tijd in bed"
            value={`${hormone.sleepHours.toFixed(1)} uur`}
            state={hormone.sleepHours < 6.5 ? "risico" : hormone.sleepHours < 7.5 ? "oplet" : "goed"}
            note={
              hormone.sleepHours < 7.5
                ? "Reken op ongeveer een half uur minder werkelijke slaap dan tijd in bed. Een week met vijf uur slaap verlaagde testosteron bij jonge mannen met 10 tot 15 procent en verstoort bij vrouwen de cyclus."
                : null
            }
          />
          {hormone.bf !== null && (
            <Status
              label="Vetpercentage"
              value={`${hormone.bf} %`}
              state={
                hormone.bf < hormone.fatRange[0] - 2 || hormone.bf > hormone.fatRange[1] + 5
                  ? "risico"
                  : hormone.bf < hormone.fatRange[0] || hormone.bf > hormone.fatRange[1]
                  ? "oplet"
                  : "goed"
              }
              note={
                hormone.bf > hormone.fatRange[1]
                  ? `Boven ongeveer ${hormone.fatRange[1]} procent neemt de omzetting van testosteron naar oestradiol toe en verslechtert de insulinegevoeligheid.`
                  : hormone.bf < hormone.fatRange[0]
                  ? `Onder ongeveer ${hormone.fatRange[0]} procent zakt de hormoonproductie. Houd dit hooguit kort vol, rond een wedstrijd of fotomoment.`
                  : null
              }
            />
          )}
        </Section>

        <Section
          title={HORMONE_TIPS[f.sex].title}
          sub="Op volgorde van effect. De eerste drie punten wegen zwaarder dan alle overige samen."
        >
          <div className="px-3 py-3">
            <ul className="text-xs leading-relaxed">
              {HORMONE_TIPS[f.sex].works.map((t, i) => (
                <li key={i} className="mb-2 last:mb-0 flex gap-2">
                  <span style={{ color: C.carb }}>+</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="px-3 py-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
            <div className="text-sm font-medium mb-2">Wat niet werkt</div>
            <ul className="text-xs leading-relaxed">
              {HORMONE_TIPS[f.sex].myths.map((t, i) => (
                <li key={i} className="mb-2 last:mb-0 flex gap-2">
                  <span style={{ color: C.train }}>&minus;</span>
                  <span style={{ color: C.muted }}>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </Section>

        {/* ---------------- slaap ---------------- */}
        <Section
          title="Slaap"
          accent={C.pro}
          sub="Kwalitatief goede slaap stuurt herstel, eetlust en hormonen. Deze controles volgen uit uw weekschema; waar voeding meespeelt, past de app uw schema aan."
        >
          <Status
            label="Tijd in bed"
            value={
              sleepCheck.minHours === sleepCheck.maxHours
                ? `${sleepCheck.minHours.toFixed(1).replace(".", ",")} uur`
                : `${sleepCheck.minHours.toFixed(1).replace(".", ",")} tot ${sleepCheck.maxHours.toFixed(1).replace(".", ",")} uur`
            }
            state={sleepCheck.minHours < 6.5 ? "risico" : sleepCheck.minHours < 7.5 ? "oplet" : "goed"}
            note={
              sleepCheck.minHours < 7.5
                ? "Reken op ongeveer een half uur minder werkelijke slaap dan tijd in bed. Mik op minimaal 7 uur slaap; wie hard traint, heeft vaak 8 uur nodig."
                : null
            }
          />
          <Status
            label="Regelmaat"
            value={sleepCheck.wakeSpread === 0 ? "elke dag gelijk" : `${Math.round(sleepCheck.wakeSpread)} min verschil`}
            state={sleepCheck.wakeSpread > 90 ? "risico" : sleepCheck.wakeSpread > 45 ? "oplet" : "goed"}
            note={
              sleepCheck.wakeSpread > 45
                ? "Uw opstaantijd verschilt over de week meer dan drie kwartier. Zo'n verschuiving werkt als een kleine jetlag; houd het verschil binnen een half uur, ook in het weekend."
                : null
            }
          />
          <Status
            label="Cafeïnegrens"
            value={
              sleepCheck.caf.hours
                ? `uiterlijk ${toHHMM(Math.min(...sleepCheck.days.map((d) => d.cutoff)))}`
                : "geen grens nodig"
            }
            state={sleepCheck.preDays.length ? "risico" : "goed"}
            note={
              sleepCheck.preDays.length
                ? `Op ${sleepCheck.preDays.map((i) => DAY_FULL[i].toLowerCase()).join(", ")} valt uw training na de grens voor pre-workout. Kies daar een cafeïnevrije variant.`
                : sleepCheck.caf.hours
                ? "Gebaseerd op uw vroegste bedtijd van de week."
                : null
            }
          />
          <Status
            label="Training en bedtijd"
            value={sleepCheck.minTrainGap >= 9999 ? "geen training" : `${Math.max(0, Math.round(sleepCheck.minTrainGap))} min ertussen`}
            state={sleepCheck.minTrainGap < 60 ? "oplet" : "goed"}
            note={
              sleepCheck.minTrainGap < 60
                ? "Op minstens één dag eindigt uw training korter dan een uur voor bedtijd. Alleen dan vertraagt zware training aantoonbaar het inslapen."
                : null
            }
          />

          <Row label="Cafeïnegebruik" stack hint="Bepaalt de grens die de app per dag berekent.">
            <Pick
              value={f.caffeineUse}
              onChange={(v) => set("caffeineUse", v)}
              options={Object.entries(CAFFEINE).map(([id, c]) => ({ id, label: c.label }))}
            />
          </Row>
          <Row
            label="Lichte laatste maaltijd"
            hint="Valt de laatste maaltijd binnen twee uur voor bedtijd, dan krijgt die de helft minder vet, minder koolhydraten en iets meer eiwit."
          >
            <Seg
              value={f.lightLastMeal !== false}
              onChange={(v) => set("lightLastMeal", v)}
              options={[
                { value: true, label: "Aan" },
                { value: false, label: "Uit" },
              ]}
            />
          </Row>

          {SLEEP_GUIDE.map((g, i) => (
            <div key={i} className="px-4 py-3 relative" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
              <span className="rail" style={{ background: g.col }} />
              <div className="disp text-lg font-bold uppercase leading-none mb-1.5" style={{ color: g.col }}>
                {g.title}
              </div>
              <ul className="text-xs leading-relaxed">
                {g.items.map((t, k) => (
                  <li key={k} className="mb-1 last:mb-0 flex gap-2">
                    <span style={{ color: C.muted }}>·</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Section>

        <Section
          title="Micronutriënten per dag"
          sub="Richtlijnen voor volwassenen. Deze getallen corrigeren tekorten; boven de norm innemen levert geen extra hormonale winst op."
        >
          {MICROS.map((mi) => (
            <div key={mi.id} className="px-3 py-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{mi.name}</span>
                <span className="text-sm tnum shrink-0" style={{ color: C.pro }}>
                  {f.sex === "man" ? mi.m : mi.v}
                </span>
              </div>
              <p className="text-xs mt-1 leading-relaxed">{mi.why[f.sex]}</p>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: C.muted }}>
                Bronnen: {mi.src}
                {mi.note ? ` · ${mi.note}` : ""}
              </p>
            </div>
          ))}
          <div className="px-3 py-3 text-xs leading-relaxed" style={{ color: C.muted }}>
            De app berekent uw werkelijke micronutriënteninname niet, want die hangt af van merk, bereiding en
            bodemgehalte. Wilt u zekerheid, laat dan vitamine D, ferritine en bij klachten de schildklier prikken en
            stuur bij op de uitslag in plaats van op gevoel.
          </div>
        </Section>

          </>
        )}
        {tab === "profiel" && (
          <>
        {/* ---------------- invoer ---------------- */}
        <Section title="Weekschema" sub="Per dag uw training en eventuele uitzonderingen. Tik op een dag om die aan te passen.">
          {week.map((d, i) => (
            <div key={i} style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
              <button onClick={() => setEditDay(editDay === i ? null : i)} className="w-full px-3 py-3 flex items-center justify-between gap-3 text-left">
                <span className="text-sm font-medium w-24 shrink-0">{DAY_FULL[i]}</span>
                <span className="text-xs text-right" style={{ color: d.session ? C.ink : C.muted }}>
                  {d.session
                    ? `${SESSIONS.find((s) => s.id === d.session.type).label}, ${d.session.minutes} min vanaf ${d.session.start}`
                    : "Rustdag"}
                  {d.flex ? ` · flex ${d.flex > 0 ? "+" : ""}${d.flex} kcal` : ""}
                  {dayCfg(i).own ? ` · eigen ritme, ${dayCfg(i).meals} maaltijden` : ""}
                </span>
              </button>
              {editDay === i && (
                <div className="px-3 pb-3 grid gap-2">
                  <Pick
                    value={d.session ? d.session.type : "geen"}
                    onChange={(v) =>
                      setDay(i, {
                        session: v === "geen" ? null : { type: v, minutes: d.session ? d.session.minutes : 75, start: d.session ? d.session.start : "18:00" },
                      })
                    }
                    options={[{ id: "geen", label: "Geen training" }, ...SESSIONS]}
                  />
                  {d.session && (
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <div className="text-xs mb-1" style={{ color: C.muted }}>
                          Duur
                        </div>
                        <Num value={d.session.minutes} onChange={(v) => setDay(i, { session: { ...d.session, minutes: v } })} step={5} min={20} max={240} suffix="min" />
                      </div>
                      <div className="flex-1">
                        <div className="text-xs mb-1" style={{ color: C.muted }}>
                          Starttijd
                        </div>
                        <input
                          type="time"
                          value={d.session.start}
                          onChange={(e) => setDay(i, { session: { ...d.session, start: e.target.value } })}
                          className="px-2 py-1.5 text-sm tnum w-full" data-field
                          style={{ border: `1px solid ${C.line}`, background: C.surface2, color: C.ink, borderRadius: R.field }}
                        />
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="text-xs mb-1" style={{ color: C.muted }}>
                      Extra calorieën deze dag, bijvoorbeeld uit eten. De rest van de week vangt dit op.
                    </div>
                    <Num value={d.flex} onChange={(v) => setDay(i, { flex: v })} step={100} min={-1000} max={2000} suffix="kcal" />
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-xs" style={{ color: C.muted }}>
                      Eigen dagritme, bijvoorbeeld voor het weekend
                    </span>
                    <Seg
                      value={dayCfg(i).own}
                      onChange={(v) =>
                        setDay(i, v ? { meals: Number(f.meals), wake: f.wake, sleep: f.sleep } : { meals: null, wake: null, sleep: null })
                      }
                      options={[
                        { value: false, label: "Standaard" },
                        { value: true, label: "Eigen" },
                      ]}
                    />
                  </div>
                  {dayCfg(i).own && (
                    <div className="grid gap-2">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <div className="text-xs mb-1" style={{ color: C.muted }}>
                            Opstaan
                          </div>
                          <input
                            type="time"
                            value={dayCfg(i).wake}
                            onChange={(ev) => setDay(i, { wake: ev.target.value })}
                            className="px-2 py-1.5 text-sm tnum w-full" data-field
                            style={{ border: `1px solid ${C.line}`, background: C.surface2, color: C.ink, borderRadius: R.field }}
                          />
                        </div>
                        <div className="flex-1">
                          <div className="text-xs mb-1" style={{ color: C.muted }}>
                            Naar bed
                          </div>
                          <input
                            type="time"
                            value={dayCfg(i).sleep}
                            onChange={(ev) => setDay(i, { sleep: ev.target.value })}
                            className="px-2 py-1.5 text-sm tnum w-full" data-field
                            style={{ border: `1px solid ${C.line}`, background: C.surface2, color: C.ink, borderRadius: R.field }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="text-xs mb-1" style={{ color: C.muted }}>
                          Aantal maaltijden
                        </div>
                        <Slide value={dayCfg(i).meals} onChange={(v) => setDay(i, { meals: v })} min={2} max={7} step={1} format={(v) => `${v}`} />
                      </div>
                      <button
                        onClick={() => applyRhythmToType(i)}
                        className="tap text-xs underline text-left"
                        style={{ color: C.accent }}
                      >
                        Dit ritme op alle {TYPE_LABEL[dayType(i)]} toepassen
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div className="px-3 py-3 flex items-center justify-between gap-3">
            <span className="text-xs" style={{ color: C.muted }}>
              {week.filter((d) => d.session).length} sessies per week
            </span>
            {!confirmReset ? (
              <button onClick={() => setConfirmReset(true)} className="text-sm underline shrink-0" style={{ color: C.muted }}>
                Terug naar standaard
              </button>
            ) : (
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs" style={{ color: C.warn }}>
                  Schema wissen?
                </span>
                <button
                  onClick={() => {
                    setWeek(defaultWeek());
                    setEditDay(null);
                    setConfirmReset(false);
                  }}
                  className="px-2.5 py-1 text-sm rounded"
                  style={{ background: C.train, color: C.paper }}
                >
                  Ja, wissen
                </button>
                <button
                  onClick={() => setConfirmReset(false)}
                  className="px-2.5 py-1 text-sm rounded"
                  style={{ border: `1px solid ${C.line}`, color: C.muted }}
                >
                  Annuleren
                </button>
              </div>
            )}
          </div>
        </Section>

        <Section title="Lichaamsgegevens">
          <Row label="Geslacht">
            <Seg
              value={f.sex}
              onChange={(v) => set("sex", v)}
              options={[
                { value: "man", label: "Man" },
                { value: "vrouw", label: "Vrouw" },
              ]}
            />
          </Row>
          <Row label="Leeftijd">
            <Num value={f.age} onChange={(v) => set("age", v)} min={14} max={90} suffix="jr" />
          </Row>
          <Row label="Lengte">
            <Num value={f.height} onChange={(v) => set("height", v)} min={130} max={220} suffix="cm" />
          </Row>
          <Row label="Gewicht">
            <Num value={f.weight} onChange={(v) => set("weight", v)} step={0.5} min={35} max={250} suffix="kg" />
          </Row>
          <Row
            label="Vetpercentage gebruiken"
            hint="Nauwkeuriger bij een hoog of juist laag vetpercentage, omdat eiwit en rustmetabolisme dan op vetvrije massa worden berekend."
          >
            <Seg
              value={f.useBodyFat}
              onChange={(v) => set("useBodyFat", v)}
              options={[
                { value: true, label: "Ja" },
                { value: false, label: "Nee" },
              ]}
            />
          </Row>
          {f.useBodyFat && (
            <Row label="Vetpercentage">
              <Num
                value={f.bodyFat}
                onChange={(v) => setF((s) => ({ ...s, bodyFat: v, bodyFatSex: s.sex }))}
                step={0.5}
                min={4}
                max={60}
                suffix="%"
              />
            </Row>
          )}
          {f.useBodyFat && f.bodyFatSex && f.bodyFatSex !== f.sex && (
            <div className="px-4 py-3 relative" style={{ background: C.warnBg }}>
              <span className="rail" style={{ background: C.warn }} />
              <p className="text-xs leading-relaxed mb-2" style={{ color: C.warn }}>
                Uw vetpercentage van {num(f.bodyFat, 0)} procent is ingevuld voor{" "}
                {f.bodyFatSex === "man" ? "een man" : "een vrouw"}. Doordat vrouwen ongeveer 8 procentpunt meer
                essentieel vetweefsel hebben, betekent hetzelfde getal een heel andere conditie. Vergelijkbaar is nu
                ongeveer {convertBf(num(f.bodyFat, 20), f.bodyFatSex, f.sex)} procent.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    setF((s) => ({ ...s, bodyFat: convertBf(num(s.bodyFat, 20), s.bodyFatSex, s.sex), bodyFatSex: s.sex }))
                  }
                  className="tap px-3 py-1.5 text-sm"
                  style={{ background: C.accent, color: C.onAccent, borderRadius: R.field, fontWeight: 600 }}
                >
                  Omrekenen
                </button>
                <button
                  onClick={() => setF((s) => ({ ...s, bodyFatSex: s.sex }))}
                  className="tap px-3 py-1.5 text-sm"
                  style={{ border: `1px solid ${C.line}`, color: C.muted, borderRadius: R.field }}
                >
                  Laten staan
                </button>
              </div>
            </div>
          )}
        </Section>

        <Section title="Dagelijkse activiteit" sub="Alles buiten uw trainingen om: werk, huishouden, wandelen.">
          <Row label="Leefpatroon" stack>
            <Pick value={f.activity} onChange={(v) => set("activity", v)} options={ACTIVITY} />
          </Row>
          <Row label="Opstaan">
            <input
              type="time"
              value={f.wake}
              onChange={(e) => set("wake", e.target.value)}
              className="px-2 py-1.5 text-sm tnum" data-field
              style={{ border: `1px solid ${C.line}`, background: C.surface2, color: C.ink, borderRadius: R.field }}
            />
          </Row>
          <Row label="Naar bed">
            <input
              type="time"
              value={f.sleep}
              onChange={(e) => set("sleep", e.target.value)}
              className="px-2 py-1.5 text-sm tnum" data-field
              style={{ border: `1px solid ${C.line}`, background: C.surface2, color: C.ink, borderRadius: R.field }}
            />
          </Row>
          <Row label="Aantal maaltijden" stack hint="Drie tot zes maaltijden geeft de gelijkmatigste eiwitinname.">
            <Slide value={f.meals} onChange={(v) => set("meals", v)} min={2} max={7} step={1} format={(v) => `${v}`} />
          </Row>
          <Row
            label="Hongerigste moment"
            stack
            hint="Die maaltijd krijgt structureel meer koolhydraten en wat meer vet. In een surplus gaat bovendien het grootste deel van de extra koolhydraten daarnaartoe, zodat een verhoging voelbaar op één moment landt."
          >
            <Pick
              value={f.hungerMoment || "geen"}
              onChange={(v) => set("hungerMoment", v)}
              options={Object.entries(HUNGER_MOMENTS).map(([id, h]) => ({ id, label: h.label }))}
            />
          </Row>
          <Row
            label="Koolhydraten cycleren"
            hint={
              f.cycling
                ? "Aan: trainingsdagen krijgen hun eigen verbruik terug plus een opslag, rustdagen leveren dat in. Het weekgemiddelde blijft gelijk."
                : "Uit: elke dag exact dezelfde calorieën en macro's, ook op trainingsdagen. Het tekort of surplus valt dan groter uit op de dagen dat u traint."
            }
          >
            <Seg
              value={f.cycling}
              onChange={(v) => set("cycling", v)}
              options={[
                { value: true, label: "Aan" },
                { value: false, label: "Uit" },
              ]}
            />
          </Row>
        </Section>

        <Section title="Doel">
          {planNow.active && (
            <div className="px-4 py-3 relative" style={{ background: C.surface2, borderBottom: `1px solid ${C.lineSoft}` }}>
              <span className="rail" style={{ background: PHASE_COLOR[planNow.row.phase] }} />
              <p className="text-xs leading-relaxed">
                <strong>Uw actieve plan bepaalt nu het doel:</strong> week {planNow.week + 1} van {planNow.total},{" "}
                {PHASE_LABEL[planNow.row.phase]}, {planNow.row.rate > 0 ? "+" : ""}
                {planNow.row.rate.toFixed(2)} procent per week. Wat u hieronder instelt, geldt pas weer als het plan stopt
                of afloopt.
              </p>
            </div>
          )}
          <Row label="Richting" stack>
            <Seg
              value={f.goal}
              onChange={(v) => {
                const r = RATES[v][v === "onderhoud" ? 0 : 1].v;
                setF((s) => ({ ...s, goal: v, rate: r }));
              }}
              options={[
                { value: "cut", label: "Vetverlies" },
                { value: "onderhoud", label: "Onderhoud" },
                { value: "bulk", label: "Opbouw" },
              ]}
            />
          </Row>
          {f.goal === "bulk" && (
            <Row
              label="Trainingservaring"
              stack
              hint={`Bepaalt hoe snel u zinvol kunt aankomen. Advies: ${EXPERIENCE.find((e) => e.id === f.experience).rate} procent per week.`}
            >
              <Pick value={f.experience} onChange={(v) => setF((s) => ({ ...s, experience: v, rate: EXPERIENCE.find((e) => e.id === v).rate }))} options={EXPERIENCE} />
            </Row>
          )}
          {f.goal !== "onderhoud" && (
            <Row label="Tempo" stack hint="Percentage van uw lichaamsgewicht per week.">
              <Pick value={f.rate} onChange={(v) => set("rate", Number(v))} options={RATES[f.goal].map((r) => ({ v: r.v, label: r.label }))} />
            </Row>
          )}
          {f.goal === "bulk" && Number(f.rate) > EXPERIENCE.find((e) => e.id === f.experience).rate && (
            <div className="px-4 py-3 relative" style={{ background: C.warnBg }}>
              <span className="rail" style={{ background: C.warn }} />
              <p className="text-xs leading-relaxed" style={{ color: C.warn }}>
                Dit tempo ligt boven wat bij uw trainingservaring past. Het overschot komt dan grotendeels als vet
                binnen en kost u later dieettijd. Uw spieren groeien niet sneller dan hun eigen tempo, hoeveel u er ook
                bovenop legt.
              </p>
            </div>
          )}
        </Section>

        <div className="mb-8">
          <button onClick={() => setShowAdvanced((v) => !v)} className="text-sm underline" style={{ color: C.muted }}>
            {showAdvanced ? "Geavanceerde instellingen verbergen" : "Geavanceerde instellingen tonen"}
          </button>
          {showAdvanced && (
            <div className="mt-3">
              <Section title="Handmatig bijstellen">
                <Row
                  label="Eiwit"
                  stack
                  hint={`Advies op basis van uw gegevens: ${recommendedProtein(input).toFixed(2)} g per kg lichaamsgewicht.`}
                >
                  <Slide
                    value={Number(proteinPerKg.toFixed(2))}
                    onChange={(v) => set("proteinOverride", v)}
                    min={1.2}
                    max={3.2}
                    step={0.05}
                    format={(v) => `${v.toFixed(2)} g/kg`}
                  />
                </Row>
                <Row
                  label="Vet bij verhogingen"
                  stack
                  hint={
                    f.fatMode === "vast"
                      ? "Vet ligt vast in grammen, gelijk op trainings- en rustdagen. Elke verhoging of verlaging van de calorieën gaat naar koolhydraten, de brandstof voor uw training."
                      : "Vet schaalt mee met uw calorieën als vast percentage."
                  }
                >
                  <Seg
                    value={f.fatMode || "vast"}
                    onChange={(v) => set("fatMode", v)}
                    options={[
                      { value: "vast", label: "Vast in grammen" },
                      { value: "procent", label: "Meeschalen" },
                    ]}
                  />
                  {f.fatMode !== "procent" && (
                    <div className="mt-2">
                      <div className="flex items-end gap-2">
                        <div>
                          <div className="text-xs mb-1" style={{ color: C.muted }}>
                            Eigen hoeveelheid, leeg is automatisch
                          </div>
                          <Num
                            value={f.fatFixedGrams ?? ""}
                            onChange={(v) => set("fatFixedGrams", v === "" ? null : v)}
                            step={5}
                            min={20}
                            max={200}
                            suffix="g"
                          />
                        </div>
                      </div>
                      <p className="text-xs mt-1.5 leading-relaxed tnum" style={{ color: C.muted }}>
                        Nu {Math.round(dayPlan.fixedFat || 0)} g vet per dag
                        {num(f.fatFixedGrams, 0) > 0 ? ", door u ingesteld" : `, ${f.fatPercent} procent van uw onderhoudsniveau`}. Nooit
                        onder {Math.round(0.6 * weight)} g en in een diepe cut nooit boven 35 procent van de dagcalorieën.
                      </p>
                    </div>
                  )}
                </Row>
                <Row label={f.fatMode === "procent" ? "Vet als aandeel van de calorieën" : "Vet als aandeel van uw onderhoudsniveau"} stack hint="Onder 20 procent gaat vaak ten koste van verzadiging en hormoonhuishouding.">
                  <Slide value={f.fatPercent} onChange={(v) => set("fatPercent", v)} min={15} max={45} step={1} format={(v) => `${v} %`} />
                </Row>
                <Row label="Handmatige caloriecorrectie" stack hint="Wordt normaal gevuld door de bijsturing op basis van uw gewichtslog.">
                  <Slide value={kcalAdjust} onChange={setKcalAdjust} min={-600} max={600} step={50} format={(v) => `${v > 0 ? "+" : ""}${v} kcal`} />
                </Row>
                <div className="px-3 py-3">
                  <button
                    onClick={() => setF((s) => ({ ...s, proteinOverride: null, fatPercent: 25 }))}
                    className="text-sm underline"
                    style={{ color: C.muted }}
                  >
                    Terug naar het advies
                  </button>
                </div>
              </Section>
            </div>
          )}
        </div>

        <footer className="text-xs leading-relaxed pt-4" style={{ color: C.muted, borderTop: `1px solid ${C.line}` }}>
          <p className="mb-2 tnum">
            Versie {APP_VERSION} · opslag: {storeMode === "account" ? "account" : storeMode === "device" ? "apparaat" : storeMode === "memory" ? "geen" : "via Claude"} ·
            fotoanalyse: {aiPhoto == null ? "wordt gecontroleerd" : aiPhoto.ok ? "beschikbaar" : "niet beschikbaar"}
          </p>
          <p className="mb-2">
            <button onClick={() => setOnboarding(0)} className="tap underline" style={{ color: C.accent }}>
              Opnieuw instellen met de begeleide start
            </button>
          </p>
          <p className="mb-2">
            {storeMode === "account"
              ? "Uw gegevens worden bewaard in uw Claude-account. Ze overleven herstarts en zijn op al uw apparaten hetzelfde."
              : storeMode === "device"
              ? "Uw gegevens worden op dit apparaat bewaard. Safari kan die opslag na een tijd niet gebruiken wissen."
              : storeMode === "memory"
              ? "Opslag is hier niet beschikbaar: uw invoer verdwijnt bij herladen."
              : storage === "aan"
              ? "Uw gegevens worden op dit apparaat bewaard en zijn alleen voor u zichtbaar."
              : "Opslag is in deze weergave niet beschikbaar; uw invoer geldt alleen voor deze sessie."}
          </p>
          <p className="mb-2">
            Rekenmethode: Mifflin-St Jeor of Katch-McArdle voor het rustmetabolisme, MET-waarden voor het
            trainingsverbruik, eiwitrichtlijnen volgens de ISSN position stand en Helms et al., eiwitspreiding volgens
            Schoenfeld en Aragon, koolhydraattiming volgens Kerksick et al. Voedingswaarden zijn afgeronde
            standaardwaarden uit NEVO en USDA FoodData Central; controleer de verpakking van uw eigen producten.
            De niveaus en beschrijvingen bij het vetpercentage volgen de fotoreeks van BuiltLean (Marc Perry), met de ACE-tabel en Gallagher et al. (AJCN 2000) als achtergrond. Micronutriëntnormen volgen de Gezondheidsraad en EFSA Dietary Reference Values; hormonale adviezen zijn
            gebaseerd op Whittaker en Wu (2021), Leproult en Van Cauter (2011) en de IOC-consensus over REDs (2023).
          </p>
          <p>
            Dit is een rekenhulp, geen medisch advies. De prognoses zijn schattingen; de weegschaal over meerdere weken
            is de enige echte meting.
          </p>
        </footer>
          </>
        )}
      </div>

      {/* ---------------- tabbalk ---------------- */}
      <nav
        className="no-print fixed left-0 right-0 bottom-0 z-40"
        style={{
          background: C.panel,
          borderTop: `1px solid ${C.line}`,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          boxShadow: "0 -8px 24px -18px rgba(0,0,0,.35)",
        }}
        aria-label="Hoofdnavigatie"
      >
        <div className="mx-auto max-w-2xl grid grid-cols-5">
          {TABS.map((t) => {
            const on = tab === t.id;
            const badge = t.id === "vandaag" && (warnings.length > 0 || !!planUpdate) && !on;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="tap relative flex flex-col items-center justify-center gap-0.5 pt-2 pb-1.5"
                style={{ color: on ? C.accent : C.muted }}
                aria-current={on ? "page" : undefined}
                aria-label={t.label}
              >
                <span
                  className="absolute top-0 rounded-full"
                  style={{
                    height: 3,
                    width: on ? 28 : 0,
                    background: C.accent,
                    transition: "width .25s cubic-bezier(.22,1,.36,1)",
                  }}
                />
                <span className="relative">
                  <Icon name={t.id} />
                  {badge && (
                    <span
                      className="absolute rounded-full"
                      style={{ top: -1, right: -3, width: 8, height: 8, background: C.train, border: `2px solid ${C.panel}` }}
                    />
                  )}
                </span>
                <span className="text-xs" style={{ fontWeight: on ? 600 : 500 }}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
