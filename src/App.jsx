import React, { useState, useMemo, useEffect, useRef } from "react";

/* =========================================================================
   Nexa - Your personal performance coach
   Trainingsgerichte macro-, maaltijd- en trainingsplanner
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

/* Serverfunctie die de foto met Claude leest (netlify/functions/etiket.mjs).
   De API-sleutel staat alleen op de server, nooit in de app. */
const LABEL_ENDPOINT = "/.netlify/functions/etiket";

/* Een telefoonfoto is al snel 3 tot 5 MB; verkleind tot 1600 px aan de lange
   kant blijft de tabel scherp leesbaar en past het verzoek ruim binnen de
   limiet van de server. */
async function shrinkImage(file, max = 1600, quality = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("De foto kon niet worden geopend."));
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", quality));
    if (!blob) throw new Error("De foto kon niet worden verkleind.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const labelError = (message, code) => Object.assign(new Error(message), { code });

/* Vraagt Claude om de foto te lezen. Binnen de Claude-weergave via de
   sample-capability, als losse app via de eigen serverfunctie. */
async function readLabelWithClaude(file) {
  if (typeof window !== "undefined" && window.claude && typeof window.claude.use === "function") {
    const sample = await window.claude.use("sample");
    if (!sample) throw Object.assign(new Error("Claude is hier niet beschikbaar."), { code: "not_granted" });
    const lim = await sample.limits().catch(() => null);
    if (!lim || !lim.images) throw Object.assign(new Error("Foto's kunnen hier niet verstuurd worden."), { code: "images_unavailable" });
    return await sample.json(LABEL_PROMPT, { images: [file], modelTier: "default" });
  }
  const blob = await shrinkImage(file).catch(() => file);
  const data = await blobToBase64(blob);
  let r;
  try {
    r = await fetch(LABEL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: data, mediaType: blob.type || "image/jpeg" }),
    });
  } catch (e) {
    throw labelError("Geen verbinding met de server.", "offline");
  }
  const d = await r.json().catch(() => null);
  if (!d) throw labelError(r.status === 404 ? "De serverfunctie is niet gevonden." : `Serverfout (${r.status}).`, r.status === 404 ? "geen_functie" : "server");
  if (!d.ok) throw labelError(d.message || "Analyse mislukt.", d.code);
  return d.result;
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

/* ---------------- lichaamssamenstelling ----------------
   De weegschaal ziet het verschil tussen vet en spier niet, en geen enkele
   praktische meting ziet een week vetverlies van een paar tienden procent.
   Daarom schat de app het vetpercentage: per wekelijkse meting voorspelt hij
   uit het gewichtsverloop hoeveel vet en spier er bij- of afging, en stelt
   die voorspelling bij met de metingen, gewogen naar hun betrouwbaarheid.
   De meetlintschatting (US Navy-formule) is als absoluut getal onzeker maar
   volgt veranderingen goed; de eerste meting ijkt daarom alleen het niveau. */

function navyBodyFat({ sex, height, waist, neck, hip }) {
  const h = num(height, 0);
  const w = num(waist, 0);
  const n = num(neck, 0);
  if (!(h > 0 && w > 0 && n > 0)) return null;
  if (sex === "vrouw") {
    const hp = num(hip, 0);
    if (!(hp > 0) || w + hp - n <= 0) return null;
    return 495 / (1.29579 - 0.35004 * Math.log10(w + hp - n) + 0.221 * Math.log10(h)) - 450;
  }
  if (w - n <= 0) return null;
  return 495 / (1.0324 - 0.19077 * Math.log10(w - n) + 0.15456 * Math.log10(h)) - 450;
}

const BF_METHODS = {
  weegschaal: { label: "Weegschaal met vetmeting", sd: 3.5 },
  huidplooi: { label: "Huidplooimeter", sd: 2.5 },
  dexa: { label: "DEXA-scan", sd: 1.2 },
  bodpod: { label: "Bod Pod", sd: 1.8 },
};

/* Gemiddeld gewicht rond een datum: alle metingen binnen drie dagen, anders
   de dichtstbijzijnde binnen tien dagen. */
function weightNear(pts, t) {
  const near = pts.filter((p) => Math.abs(p.t - t) <= 3);
  if (near.length) return sum(near.map((p) => p.w)) / near.length;
  let best = null;
  pts.forEach((p) => {
    if (Math.abs(p.t - t) <= 10 && (!best || Math.abs(p.t - t) < Math.abs(best.t - t))) best = p;
  });
  return best ? best.w : null;
}

function estimateComposition({ sex, height, log, checkins, anchor, win, today }) {
  if (!anchor || !checkins || !checkins.length) return null;
  const pts = (log || [])
    .filter((e) => e.weight > 0)
    .map((e) => ({ t: dayNum(e.date), w: e.weight }))
    .sort((a, b) => a.t - b.t);
  const cks = [...checkins].sort((a, b) => a.date.localeCompare(b.date));
  let t = Math.min(dayNum(anchor.date), dayNum(cks[0].date));
  let W = weightNear(pts, t) ?? num(anchor.weight, 80);
  /* Twee grootheden: b = werkelijk vetpercentage, o = afwijking van de
     meetlintijking. Het meetlint meet b + o: veranderingen scherp, het niveau
     niet. Een andere meting (weegschaal, DEXA) meet b zelf en stelt daarmee
     ook de ijking bij. P is de onzekerheid (covariantie) van beide. */
  let b = num(anchor.bf, 20);
  let o = 0;
  let P = [num(anchor.sd, 4) ** 2, 0, 0]; // [var b, cov b-o, var o]
  let navy0 = null;
  const out = [];
  const start = { bf: b, weight: W, fat: (W * b) / 100, lean: W * (1 - b / 100) };

  const step = (toT) => {
    const W2 = weightNear(pts, toT) ?? W;
    const weeks = Math.max(0, (toT - t) / 7);
    const dW = W2 - W;
    if (weeks > 0) {
      const rate = ((dW / W) * 100) / weeks;
      const p = dW < 0 ? fatFractionLoss(rate, b, win) : fatFractionGain(rate, b, win);
      const fat = (b / 100) * W + p * dW;
      b = clamp((fat / W2) * 100, 3, 60);
      // onzekerheid groeit met de tijd en met de onzekere verdeling vet/spier
      P = [P[0] + 0.04 * weeks + ((0.2 * Math.abs(dW)) / W2 * 100) ** 2, P[1], P[2]];
    }
    t = toT;
    W = W2;
  };
  // scalaire meting z = h0*b + h1*o met ruis r
  const update = (z, h0, h1, r) => {
    const Ph0 = P[0] * h0 + P[1] * h1;
    const Ph1 = P[1] * h0 + P[2] * h1;
    const S = h0 * Ph0 + h1 * Ph1 + r;
    const k0 = Ph0 / S;
    const k1 = Ph1 / S;
    const res = z - (h0 * b + h1 * o);
    b += k0 * res;
    o += k1 * res;
    P = [P[0] - k0 * Ph0, P[1] - k0 * Ph1, P[2] - k1 * Ph1];
  };

  cks.forEach((c) => {
    const n = dayNum(c.date);
    if (n > t) step(n);
    const navy = navyBodyFat({ sex, height, waist: c.waist, neck: c.neck, hip: c.hip });
    let navyAdj = null;
    if (navy != null) {
      if (navy0 == null) {
        // ijken: het meetlint gaat uit van de huidige schatting; de ijkfout
        // is precies de (onbekende) fout in die schatting
        navy0 = b - navy;
        o = 0;
        P = [P[0], -P[0], P[0]];
      } else {
        navyAdj = navy + navy0;
        update(navyAdj, 1, 1, 0.7 ** 2);
      }
    }
    const dev = num(c.bf, 0);
    if (dev > 0 && BF_METHODS[c.method]) update(dev, 1, 0, BF_METHODS[c.method].sd ** 2);
    out.push({ date: c.date, t: n, bf: b, sd: Math.sqrt(P[0]), weight: W, navy: navyAdj, device: dev > 0 ? dev : null });
  });
  const tn = dayNum(today);
  if (tn > t) step(tn);
  // de verandering sinds de start is veel zekerder dan het niveau: met het
  // meetlint is alleen de onzekerheid van b + o daarop van invloed
  const sd0 = num(anchor.sd, 4);
  const changeSd = navy0 != null ? Math.sqrt(Math.max(0.01, P[0] + 2 * P[1] + P[2])) : Math.sqrt(Math.max(0.01, P[0] - sd0 * sd0));
  return {
    bf: b,
    sd: Math.sqrt(P[0]),
    changeSd,
    weight: W,
    fat: (W * b) / 100,
    lean: W * (1 - b / 100),
    start,
    points: out,
    calibrated: navy0 != null,
  };
}

/* Verandering per week van een meting (taille, nek) via lineaire regressie
   over de laatste vijf weken; minstens drie metingen over twee weken. */
function measureTrend(checkins, key, today, days = 35) {
  const tn = dayNum(today);
  const pts = (checkins || [])
    .filter((c) => num(c[key], 0) > 0)
    .map((c) => ({ t: dayNum(c.date), v: num(c[key], 0) }))
    .filter((p) => tn - p.t <= days)
    .sort((a, b) => a.t - b.t);
  if (pts.length < 3 || pts[pts.length - 1].t - pts[0].t < 14) return { ok: false, n: pts.length };
  const mt = sum(pts.map((p) => p.t)) / pts.length;
  const mv = sum(pts.map((p) => p.v)) / pts.length;
  const slope = sum(pts.map((p) => (p.t - mt) * (p.v - mv))) / sum(pts.map((p) => (p.t - mt) ** 2));
  return { ok: true, n: pts.length, perWeek: slope * 7 };
}

/* Krachtverloop uit de trainingsmodule: per oefening de verandering van de
   geschatte 1RM over vier weken, de mediaan over minstens drie oefeningen. */
function strengthTrend(sessions, today, days = 28) {
  const t0 = dayNum(today) - days;
  const by = {};
  (sessions || []).forEach((s) => {
    if (!s.end || s.deload || dayNum(s.date) < t0) return;
    s.exercises.forEach((e) => {
      const v = bestE1rm(e);
      if (v > 0) (by[e.exId] = by[e.exId] || []).push({ t: s.start, v });
    });
  });
  const changes = Object.values(by)
    .filter((a) => a.length >= 2)
    .map((a) => {
      a.sort((x, y) => x.t - y.t);
      return (a[a.length - 1].v - a[0].v) / a[0].v;
    })
    .sort((a, b) => a - b);
  if (changes.length < 3) return { ok: false, n: changes.length };
  return { ok: true, n: changes.length, pct: changes[Math.floor(changes.length / 2)] * 100 };
}

const cmTxt = (v) => `${v > 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")} cm`;
const pctTxt = (v) => `${v > 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")}%`;

/* Leest gewicht, taille en kracht samen. Geeft alleen iets terug als de
   combinatie iets anders zegt dan de weegschaal alleen. */
function compositionAdvice({ goal, correction, waist, strength }) {
  if (!correction || !correction.meaningful) return null;
  const lower = correction.rounded < 0; // minder eten
  const waistDown = waist.ok && waist.perWeek <= -0.2;
  const waistUp = waist.ok && waist.perWeek >= 0.2;
  const strengthKept = strength.ok ? strength.pct >= -2 : null;
  const strengthDown = strength.ok && strength.pct <= -3;
  const kracht = strength.ok ? `uw kracht ${strength.pct >= 0 ? "blijft op peil" : "daalt licht"} (${pctTxt(strength.pct)} in vier weken)` : null;
  if (goal === "cut" && lower && waistDown && strengthKept !== false) {
    return {
      kind: "recomp",
      suppress: true,
      title: "Niet bijsturen: u verliest wel vet",
      text: `Uw gewicht daalt trager dan gepland, maar uw taille daalt ${cmTxt(-waist.perWeek).replace("+", "")} per week${kracht ? ` en ${kracht}` : ""}. Dat wijst op vetverlies terwijl u spier behoudt of opbouwt, of op tijdelijk vastgehouden vocht. Houd de calorieën gelijk en kijk over twee weken opnieuw.`,
    };
  }
  if (goal === "cut" && !lower && strengthDown) {
    return {
      kind: "spier",
      suppress: false,
      title: "Te snel: risico op spierverlies",
      text: `U valt sneller af dan gepland en uw kracht daalt (${pctTxt(strength.pct)} in vier weken). Verhoog de calorieën zoals voorgesteld om spiermassa te beschermen.`,
    };
  }
  if (goal === "bulk" && lower && waistUp) {
    return {
      kind: "vet",
      suppress: false,
      title: "Er komt te veel vet bij",
      text: `U komt sneller aan dan gepland en uw taille groeit ${cmTxt(waist.perWeek).replace("+", "")} per week. Verlaag het surplus zoals voorgesteld.`,
    };
  }
  if (goal === "bulk" && !lower && waistDown && strength.ok && strength.pct > 0) {
    return {
      kind: "recomp",
      suppress: true,
      title: "Niet bijsturen: kwalitatieve opbouw",
      text: `U komt trager aan dan gepland, maar uw taille daalt en ${kracht}. U bouwt spier op terwijl u vet verliest; laat het schema staan.`,
    };
  }
  return null;
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
      "Houd vet op minimaal 20 procent van uw calorieën. Vetarme voeding gaat samen met een circa 10 tot 15 procent lager totaal testosteron.",
      "Slaap minimaal 7 uur. Een week met 5 uur slaap per nacht kan testosteron bij jonge mannen met 10 tot 15 procent verlagen.",
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
      "Energiebeschikbaarheid is de belangrijkste knop. Onder 30 kcal per kg vetvrije massa verstoort de LH-pulsatiliteit, met cyclusuitval en botverlies tot gevolg.",
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
const APP_VERSION = "25 september, Nexa";
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

/* Tijdens het typen blijft de tekst staan zoals ingetypt; alleen een
   waarde binnen het bereik gaat meteen door. Pas bij het verlaten van het
   veld wordt begrensd. Anders wordt de 2 van "20" direct het minimum. */
function Num({ value, onChange, step = 1, min, max, suffix }) {
  const [draft, setDraft] = useState(null);
  const inRange = (n) => Number.isFinite(n) && (min == null || n >= min) && (max == null || n <= max);
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        inputMode="decimal"
        value={draft ?? value ?? ""}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const t = e.target.value;
          setDraft(t);
          if (t !== "" && inRange(Number(t))) onChange(Number(t));
        }}
        onBlur={() => {
          if (draft == null) return;
          const t = draft;
          setDraft(null);
          if (t === "") return onChange("");
          const n = Number(t);
          if (!Number.isFinite(n)) return;
          const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
          if (c !== num(value, NaN)) onChange(c);
        }}
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
  training: ["M7 7v10", "M4 9.5v5", "M17 7v10", "M20 9.5v5", "M7 12h10"],
  eten: ["M7 3.5v17", "M4.5 3.5v5a2.5 2.5 0 0 0 5 0v-5", "M16.5 20.5v-17c-2 1.5-3 4-3 7.5h3"],
  gezondheid: ["M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z", "M7.5 12h2.5l1.5-2.5 2 4.5 1.5-2h1.5"],
  profiel: ["M12 12.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4.5 20.5c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5"],
};

/* Beeldmerk van Nexa: drie staven in blauw, groen en oranje. */
function NexaMark({ size = 14 }) {
  const bars = [
    { x: 0, h: 10, c: ["#4D86FF", "#1E48F5"] },
    { x: 7, h: 14, c: ["#46F2BC", "#0FBF86"] },
    { x: 14, h: 8.5, c: ["#FFD24D", "#FFA114"] },
  ];
  return (
    <svg width={(size * 20) / 14} height={size} viewBox="0 0 20 14" aria-hidden="true" style={{ display: "inline-block", verticalAlign: "-2px" }}>
      <defs>
        {bars.map((b, i) => (
          <linearGradient key={i} id={`nexa-mark-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={b.c[0]} />
            <stop offset="1" stopColor={b.c[1]} />
          </linearGradient>
        ))}
      </defs>
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={14 - b.h} width="6" height={b.h} rx="1.6" fill={`url(#nexa-mark-${i})`} />
      ))}
    </svg>
  );
}

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
  { id: "training", label: "Training", title: "Training" },
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

/* =========================================================================
   TRAINING - schema's, live logging, progressie en periodisering
   Methodiek naar de principes van Kuba Cielen (IFBB Pro, MK Coaching):
   twee werksets per oefening tot RIR 0-1 na een opbouwende warming-up,
   voorkeur voor lengthened-bias en unilaterale oefeningen, ongeveer 40/60
   compound/isolatie, reps-first progressie (gewicht omhoog na twee sessies
   op de bovenkant van de range) en blokken van opbouw en intensivering met
   een deload. Volumerichtwaarden per spiergroep (MEV/MAV/MRV) volgen
   Israetel, Hoffmann en Smith, Scientific Principles of Hypertrophy
   Training (Renaissance Periodization). e1RM volgens Epley (1985), met de
   reps in reserve opgeteld bij de gehaalde reps.
   ========================================================================= */

const TRAIN_KEY = "macroverdeling:training:v1";

const localISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const isoOfNum = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
// 1 januari 1970 was een donderdag; maandag = 0
const wdOfNum = (n) => (((n + 3) % 7) + 7) % 7;
const mondayOf = (iso) => {
  const n = dayNum(iso);
  return isoOfNum(n - wdOfNum(n));
};
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-5);
const roundTo = (v, step) => (step > 0 ? Math.round(v / step) * step : v);
const kgTxt = (v) =>
  v == null || v === "" || !Number.isFinite(Number(v))
    ? "–"
    : (Math.round(Number(v) * 100) / 100).toLocaleString("nl-NL", { maximumFractionDigits: 2 });
const expand = (arr, n, fallback = null) =>
  Array.from({ length: Math.max(0, n) }, (_, i) => (arr && arr.length ? arr[Math.min(i, arr.length - 1)] : fallback));

const e1rm = (load, reps, rir) => (load > 0 && reps > 0 ? load * (1 + (reps + Math.max(0, num(rir, 0))) / 30) : 0);

const MUSCLES = {
  borst: { label: "Borst", mev: 8, mav: [12, 20], mrv: 22 },
  rug: { label: "Rug", mev: 10, mav: [14, 22], mrv: 25 },
  schouder_voor: { label: "Schouder voor", mev: 0, mav: [6, 8], mrv: 12 },
  schouder_zij: { label: "Schouder zij", mev: 8, mav: [16, 22], mrv: 26 },
  schouder_achter: { label: "Schouder achter", mev: 6, mav: [12, 18], mrv: 22 },
  trapezius: { label: "Trapezius", mev: 0, mav: [12, 20], mrv: 26 },
  biceps: { label: "Biceps", mev: 8, mav: [14, 20], mrv: 26 },
  triceps: { label: "Triceps", mev: 6, mav: [10, 14], mrv: 18 },
  onderarmen: { label: "Onderarmen", mev: 2, mav: [6, 12], mrv: 20 },
  quadriceps: { label: "Quadriceps", mev: 8, mav: [12, 18], mrv: 20 },
  hamstrings: { label: "Hamstrings", mev: 6, mav: [10, 16], mrv: 20 },
  bilspieren: { label: "Bilspieren", mev: 0, mav: [4, 12], mrv: 16 },
  kuiten: { label: "Kuiten", mev: 8, mav: [12, 16], mrv: 20 },
  buik: { label: "Buik", mev: 0, mav: [16, 20], mrv: 25 },
};
const MUSCLE_IDS = Object.keys(MUSCLES);

const EQUIP = {
  stang: { label: "Stang", inc: 2.5 },
  dumbbell: { label: "Dumbbells", inc: 2 },
  machine: { label: "Machine", inc: 5 },
  kabel: { label: "Kabel", inc: 2.5 },
  smith: { label: "Smith machine", inc: 2.5 },
  lichaam: { label: "Lichaamsgewicht", inc: 2.5 },
};

/* id, naam, materiaal, c(ompound)/i(solatie), primaire en secundaire
   spieren, vlaggen (L = lengthened-bias, U = unilateraal), repsrange en bij
   lichaamsgewicht het deel van het lichaamsgewicht dat u verplaatst. */
const EX = (id, name, equip, kind, pri, sec, flags, lo, hi, bw) => ({
  id,
  name,
  equip,
  kind: kind === "c" ? "compound" : "isolation",
  pri,
  sec,
  lengthened: flags.includes("L"),
  unilateral: flags.includes("U"),
  repMin: lo,
  repMax: hi,
  bw: bw ?? 1,
});

const EXERCISES = [
  EX("bankdrukken", "Bankdrukken", "stang", "c", ["borst"], ["triceps", "schouder_voor"], "", 6, 10),
  EX("schuin_bankdrukken", "Schuin bankdrukken", "stang", "c", ["borst"], ["schouder_voor", "triceps"], "", 6, 10),
  EX("db_bankdrukken", "Dumbbell bankdrukken", "dumbbell", "c", ["borst"], ["triceps", "schouder_voor"], "L", 8, 12),
  EX("schuin_db", "Schuine dumbbell press", "dumbbell", "c", ["borst"], ["schouder_voor", "triceps"], "L", 8, 12),
  EX("smith_schuin", "Schuin drukken in de Smith", "smith", "c", ["borst"], ["schouder_voor", "triceps"], "", 6, 10),
  EX("chest_press", "Chest press machine", "machine", "c", ["borst"], ["triceps", "schouder_voor"], "", 8, 12),
  EX("dips", "Dips", "lichaam", "c", ["borst", "triceps"], ["schouder_voor"], "L", 6, 12, 0.95),
  EX("push_ups", "Push-ups", "lichaam", "c", ["borst"], ["triceps", "schouder_voor"], "", 8, 20, 0.65),
  EX("cable_fly", "Cable fly", "kabel", "i", ["borst"], [], "L", 10, 15),
  EX("pec_deck", "Pec deck", "machine", "i", ["borst"], [], "L", 10, 15),
  EX("db_flyes", "Dumbbell flyes", "dumbbell", "i", ["borst"], [], "L", 10, 15),

  EX("optrekken", "Optrekken (pull-up)", "lichaam", "c", ["rug"], ["biceps"], "L", 6, 10, 0.95),
  EX("lat_pulldown", "Lat pulldown", "kabel", "c", ["rug"], ["biceps"], "L", 8, 12),
  EX("pulldown_1arm", "Eenarmige lat pulldown", "kabel", "c", ["rug"], ["biceps"], "LU", 10, 15),
  EX("barbell_row", "Barbell row", "stang", "c", ["rug"], ["biceps", "schouder_achter"], "", 6, 10),
  EX("db_row", "Eenarmige dumbbell row", "dumbbell", "c", ["rug"], ["biceps", "schouder_achter"], "LU", 8, 12),
  EX("chest_supported_row", "Chest-supported row", "machine", "c", ["rug"], ["biceps", "schouder_achter"], "", 8, 12),
  EX("cable_row", "Seated cable row", "kabel", "c", ["rug"], ["biceps", "schouder_achter"], "L", 8, 12),
  EX("tbar_row", "T-bar row", "stang", "c", ["rug"], ["biceps", "schouder_achter"], "", 6, 10),
  EX("pullover", "Cable pullover", "kabel", "i", ["rug"], [], "L", 10, 15),
  EX("deadlift", "Deadlift", "stang", "c", ["hamstrings", "bilspieren", "rug"], ["trapezius", "onderarmen"], "", 4, 8),
  EX("shrugs", "Shrugs", "dumbbell", "i", ["trapezius"], ["onderarmen"], "", 10, 15),
  EX("hyperextension", "Hyperextension", "lichaam", "c", ["bilspieren", "hamstrings"], [], "", 10, 15, 0.5),

  EX("overhead_press", "Overhead press", "stang", "c", ["schouder_voor"], ["triceps", "schouder_zij"], "", 6, 10),
  EX("db_shoulder_press", "Dumbbell shoulder press", "dumbbell", "c", ["schouder_voor"], ["triceps", "schouder_zij"], "", 8, 12),
  EX("machine_shoulder_press", "Shoulder press machine", "machine", "c", ["schouder_voor"], ["triceps", "schouder_zij"], "", 8, 12),
  EX("lateral_raise", "Lateral raise", "dumbbell", "i", ["schouder_zij"], [], "", 12, 20),
  EX("cable_lateral", "Cable lateral raise, eenarmig", "kabel", "i", ["schouder_zij"], [], "LU", 12, 20),
  EX("machine_lateral", "Lateral raise machine", "machine", "i", ["schouder_zij"], [], "", 12, 20),
  EX("reverse_pec_deck", "Reverse pec deck", "machine", "i", ["schouder_achter"], ["trapezius"], "", 12, 20),
  EX("face_pull", "Face pull", "kabel", "i", ["schouder_achter"], ["trapezius"], "", 12, 20),

  EX("barbell_curl", "Barbell curl", "stang", "i", ["biceps"], ["onderarmen"], "", 8, 12),
  EX("db_curl", "Dumbbell curl", "dumbbell", "i", ["biceps"], ["onderarmen"], "", 8, 12),
  EX("incline_curl", "Incline dumbbell curl", "dumbbell", "i", ["biceps"], [], "L", 8, 12),
  EX("preacher_curl", "Preacher curl", "machine", "i", ["biceps"], [], "L", 8, 12),
  EX("bayesian_curl", "Bayesian cable curl", "kabel", "i", ["biceps"], [], "LU", 10, 15),
  EX("hammer_curl", "Hammer curl", "dumbbell", "i", ["biceps", "onderarmen"], [], "", 8, 12),
  EX("cable_curl", "Cable curl", "kabel", "i", ["biceps"], [], "", 10, 15),

  EX("pushdown", "Triceps pushdown", "kabel", "i", ["triceps"], [], "", 10, 15),
  EX("overhead_ext", "Overhead triceps extension, kabel", "kabel", "i", ["triceps"], [], "L", 10, 15),
  EX("skullcrusher", "Skullcrusher", "stang", "i", ["triceps"], [], "L", 8, 12),
  EX("db_overhead_ext", "Dumbbell overhead extension", "dumbbell", "i", ["triceps"], [], "L", 10, 15),
  EX("close_grip_bench", "Close-grip bankdrukken", "stang", "c", ["triceps"], ["borst", "schouder_voor"], "", 6, 10),

  EX("squat", "Squat", "stang", "c", ["quadriceps", "bilspieren"], ["hamstrings"], "L", 5, 8),
  EX("front_squat", "Front squat", "stang", "c", ["quadriceps"], ["bilspieren"], "L", 5, 8),
  EX("hack_squat", "Hack squat", "machine", "c", ["quadriceps"], ["bilspieren"], "L", 6, 10),
  EX("leg_press", "Leg press", "machine", "c", ["quadriceps"], ["bilspieren"], "", 8, 12),
  EX("bulgarian_split_squat", "Bulgaarse split squat", "dumbbell", "c", ["quadriceps", "bilspieren"], [], "LU", 8, 12),
  EX("walking_lunge", "Walking lunges", "dumbbell", "c", ["quadriceps", "bilspieren"], [], "LU", 8, 12),
  EX("leg_extension", "Leg extension", "machine", "i", ["quadriceps"], [], "", 10, 15),
  EX("rdl", "Roemeense deadlift", "stang", "c", ["hamstrings", "bilspieren"], ["rug"], "L", 6, 10),
  EX("seated_leg_curl", "Zittende leg curl", "machine", "i", ["hamstrings"], [], "L", 10, 15),
  EX("lying_leg_curl", "Liggende leg curl", "machine", "i", ["hamstrings"], [], "", 10, 15),
  EX("hip_thrust", "Hip thrust", "stang", "c", ["bilspieren"], ["hamstrings"], "", 8, 12),
  EX("cable_kickback", "Cable kickback", "kabel", "i", ["bilspieren"], [], "U", 12, 15),
  EX("abductor", "Abductor machine", "machine", "i", ["bilspieren"], [], "", 12, 20),
  EX("standing_calf", "Staande kuitraise", "machine", "i", ["kuiten"], [], "L", 10, 15),
  EX("seated_calf", "Zittende kuitraise", "machine", "i", ["kuiten"], [], "", 12, 20),
  EX("leg_press_calf", "Kuitraise in de leg press", "machine", "i", ["kuiten"], [], "L", 10, 15),

  EX("cable_crunch", "Cable crunch", "kabel", "i", ["buik"], [], "", 10, 15),
  EX("hanging_leg_raise", "Hanging leg raise", "lichaam", "i", ["buik"], [], "", 10, 15, 0.3),
  EX("ab_wheel", "Ab wheel", "lichaam", "i", ["buik"], [], "L", 8, 15, 0.5),
  EX("crunch_machine", "Crunch machine", "machine", "i", ["buik"], [], "", 10, 15),
  EX("wrist_curl", "Wrist curl", "dumbbell", "i", ["onderarmen"], [], "", 12, 20),
];

function buildExIndex(customEx = [], exEdits = {}) {
  const idx = {};
  [...EXERCISES, ...(customEx || [])].forEach((e) => {
    idx[e.id] = { ...e, ...((exEdits && exEdits[e.id]) || {}) };
  });
  return idx;
}
const exOf = (idx, id) =>
  idx[id] || { id, name: "Verwijderde oefening", equip: "machine", kind: "isolation", pri: [], sec: [], repMin: 8, repMax: 12, bw: 1, missing: true };

/* Sjablonen volgen de Kuba-principes: per dag ongeveer 40/60
   compound/isolatie, veel lengthened-bias en unilaterale keuzes. */
const TEMPLATES = [
  {
    id: "ul",
    name: "Upper / Lower",
    sub: "4 dagen, elke spiergroep twee keer per week. Past op het standaardschema ma, di, do, vr.",
    days: [
      ["Upper A", ["bankdrukken", "db_row", "db_shoulder_press", "cable_fly", "lateral_raise", "bayesian_curl", "overhead_ext"]],
      ["Lower A", ["squat", "rdl", "leg_extension", "seated_leg_curl", "standing_calf"]],
      ["Upper B", ["schuin_db", "lat_pulldown", "chest_supported_row", "pec_deck", "cable_lateral", "incline_curl", "pushdown"]],
      ["Lower B", ["hack_squat", "bulgarian_split_squat", "lying_leg_curl", "leg_extension", "seated_calf", "hanging_leg_raise"]],
    ],
    week: [0, 1, null, 2, 3, null, null],
    rotation: [0, 1, "rust", 2, 3, "rust"],
  },
  {
    id: "ppl",
    name: "Push / Pull / Legs",
    sub: "Zes dagen per week, of als rotatie van drie trainingen en een rustdag.",
    days: [
      ["Push", ["schuin_db", "machine_shoulder_press", "cable_fly", "cable_lateral", "overhead_ext", "pushdown"]],
      ["Pull", ["pulldown_1arm", "chest_supported_row", "pullover", "reverse_pec_deck", "incline_curl", "hammer_curl"]],
      ["Legs", ["hack_squat", "rdl", "seated_leg_curl", "leg_extension", "standing_calf", "cable_crunch"]],
    ],
    week: [0, 1, 2, null, 0, 1, 2],
    rotation: [0, 1, 2, "rust"],
  },
  {
    id: "fb",
    name: "Full body",
    sub: "3 dagen, drie verschillende trainingen. Veel frequentie met weinig tijd.",
    days: [
      ["Full body A", ["squat", "bankdrukken", "lat_pulldown", "seated_leg_curl", "lateral_raise", "incline_curl"]],
      ["Full body B", ["rdl", "schuin_db", "cable_row", "leg_extension", "cable_fly", "overhead_ext", "standing_calf"]],
      ["Full body C", ["hack_squat", "machine_shoulder_press", "pulldown_1arm", "lying_leg_curl", "reverse_pec_deck", "pushdown", "cable_crunch"]],
    ],
    week: [0, null, 1, null, 2, null, null],
    rotation: [0, "rust", 1, "rust", 2, "rust"],
  },
];

function makeSlot(ex, opts = {}) {
  const c = ex.kind === "compound";
  return {
    id: uid(),
    exId: ex.id,
    sets: opts.sets ?? 2,
    warmups: opts.warmups ?? (c ? 2 : 1),
    repMin: ex.repMin,
    repMax: ex.repMax,
    rest: c ? 180 : 120,
    rir: null,
    note: "",
  };
}

function programFromTemplate(tpl, { mode = "week", sets = 2, exIndex }) {
  const days = tpl.days.map(([name, ids]) => {
    const seen = new Set();
    const slots = ids
      .map((id) => exIndex[id])
      .filter(Boolean)
      .map((ex) => {
        const first = !ex.pri.some((m) => seen.has(m));
        ex.pri.forEach((m) => seen.add(m));
        const warm = ex.kind === "compound" ? (first ? 2 : 1) : first ? 1 : 0;
        return makeSlot(ex, { sets, warmups: warm });
      });
    return { id: uid(), name, slots };
  });
  return {
    id: uid(),
    name: tpl.name,
    mode,
    days,
    weekMap: tpl.week.map((k) => (k == null ? null : days[k].id)),
    rotation: tpl.rotation.map((k) => (k === "rust" ? "rust" : days[k].id)),
    created: localISO(),
  };
}

function emptyProgram(name = "Eigen schema") {
  const day = { id: uid(), name: "Training A", slots: [] };
  return { id: uid(), name, mode: "week", days: [day], weekMap: [day.id, null, null, null, null, null, null], rotation: [day.id, "rust"], created: localISO() };
}

/* ---------------- periodisering ---------------- */

const INTENSITY = {
  kuba: { label: "Standaard: RIR 2 naar 0", acc: [2, 1], int: [1, 0] },
  gematigd: { label: "Gematigd: RIR 3 naar 1", acc: [3, 2], int: [2, 1] },
};
const BLOCK_LABEL = { opbouw: "Opbouw", intensivering: "Intensivering", deload: "Deload" };
const BLOCK_COLOR = { opbouw: "var(--accent)", intensivering: "var(--danger)", deload: "var(--carb-fill)" };

function rirFor(profile, phase, i, n) {
  if (phase === "deload") return 4;
  const p = INTENSITY[profile] || INTENSITY.kuba;
  if (phase === "opbouw") return i < Math.ceil(n / 2) ? p.acc[0] : p.acc[1];
  return i < n - 1 ? p.int[0] : p.int[1];
}

function blockPosition(block, today, profile) {
  const acc = clamp(Math.round(num(block.acc, 4)), 1, 8);
  const int = clamp(Math.round(num(block.int, 2)), 0, 4);
  const dl = block.deload === false ? 0 : 1;
  const len = acc + int + dl;
  const t = dayNum(today);
  const base = { acc, int, dl, len };
  if (block.deloadFrom) {
    const d0 = dayNum(block.deloadFrom);
    if (t >= d0 && t < d0 + 7) {
      const before = blockPosition({ ...block, deloadFrom: null }, isoOfNum(d0), profile);
      return { ...base, phase: "deload", week: -1, number: before.number, rir: 4, forced: true, cycleStart: d0, daysLeft: d0 + 7 - t };
    }
  }
  const s = dayNum(block.start || today);
  const wAll = Math.max(0, Math.floor((t - s) / 7));
  const w = wAll % len;
  const number = (block.number || 1) + Math.floor(wAll / len);
  const phase = w < acc ? "opbouw" : w < acc + int ? "intensivering" : "deload";
  const i = phase === "opbouw" ? w : phase === "intensivering" ? w - acc : 0;
  const n = phase === "opbouw" ? acc : int;
  return {
    ...base,
    phase,
    week: w,
    number,
    rir: rirFor(profile, phase, i, n),
    forced: false,
    cycleStart: s + (wAll - w) * 7,
    daysLeft: 7 - (Math.max(0, t - s) % 7),
  };
}

/* Voedingsfase naar trainingsinstelling. De minicut volgt het advies dat
   de app al gaf: gewichten gelijk houden, volume ongeveer een derde omlaag. */
const TRAIN_PHASE = {
  bulk: {
    label: "Opbouw",
    vf: 1,
    load: true,
    tol: 0.03,
    note: "Surplus: de beste fase om te progressen. Gewicht en reps gaan hier het snelst omhoog.",
  },
  onderhoud: { label: "Onderhoud", vf: 1, load: true, tol: 0.03, note: "Onderhoud: normaal progressen, met iets tragere vooruitgang dan in een surplus." },
  reverse: { label: "Opbouw calorieën", vf: 1, load: true, tol: 0.03, note: "Calorieën lopen op: normaal progressen." },
  cut: {
    label: "Cut",
    vf: 1,
    load: true,
    tol: 0.05,
    note: "Tekort: kracht behouden is het doel. Stilstand is normaal; alleen een duidelijke terugval over meerdere oefeningen telt als vermoeidheid.",
  },
  slotcut: { label: "Slotcut", vf: 1, load: true, tol: 0.05, note: "Slotcut: kracht vasthouden, stilstand is normaal." },
  minicut: {
    label: "Minicut",
    vf: 2 / 3,
    load: false,
    tol: 0.06,
    note: "Minicut: gewichten op de stang gelijk houden en het volume met ongeveer een derde verlagen. Zo behoudt u de prikkel zonder het herstel te overvragen.",
  },
};

/* ---------------- sets, e1RM en historie ---------------- */

const workSets = (e) => ((e && e.sets) || []).filter((s) => s.type === "work" && s.done && num(s.reps, 0) > 0);
const setLoad = (e, s) => num(s.weight, 0) + ((e && e.bwLoad) || 0);
const bestE1rm = (e) => Math.max(0, ...workSets(e).map((s) => e1rm(setLoad(e, s), num(s.reps, 0), s.rir)));
const readinessScore = (r) => (r && !r.skipped ? num(r.sleep, 2) + num(r.energy, 2) + num(r.soreness, 2) : null);
const lowReadiness = (r) => {
  const v = readinessScore(r);
  return v != null && v <= 5;
};

/* ---------------- technieken ----------------
   Supersets koppelen een oefening aan de volgende (slot.ss); twee of meer
   gekoppelde oefeningen wisselen elkaar per ronde af, met een korte wissel
   (slot.ssRest) en de volledige rust na de laatste. Dropsets, rest-pause,
   myo-reps en halve reps hangen als extra rijen (subsets) na een werkset.
   Progressie, e1RM en records kijken alleen naar gewone werksets; voor het
   volume telt elke subset als een halve set, hoogstens één extra per werkset. */

const TECH = {
  drop: { label: "Dropset", sub: "drop", n: [1, 3, 2], rest: 0, row: "↓", reps: "max", hint: "Direct na de werkset, zonder rust, met minder gewicht door tot (bijna) falen." },
  rp: { label: "Rest-pause", sub: "rp", n: [1, 3, 2], rest: 15, row: "P", reps: "max", hint: "Zelfde gewicht, korte pauze, dan zoveel mogelijk reps. Herhaal." },
  myo: { label: "Myo-reps", sub: "myo", n: [2, 5, 4], rest: 15, row: "M", reps: "3–5", hint: "Activatieset van 12–20 reps, dan mini-sets van 3–5 reps met 3 tot 5 ademhalingen rust. Stop zodra u het doel niet meer haalt." },
  partial: { label: "Halve reps (gerekt)", sub: "partial", n: [1, 1, 1], rest: 0, row: "½", reps: "5–10", hint: "Na de laatste volledige rep doorgaan met halve reps in de gerekte positie, tot falen." },
};
const SUB_TYPES = new Set(Object.keys(TECH));
const techShort = (t) =>
  !t
    ? ""
    : t.type === "drop"
    ? `dropset ${t.n}× −${t.pct}%${t.all ? " (elke set)" : ""}`
    : t.type === "rp"
    ? `rest-pause ${t.n}× ${t.pause} s${t.all ? " (elke set)" : ""}`
    : t.type === "myo"
    ? `myo-reps tot ${t.n} mini-sets`
    : `halve reps${t.all ? " (elke set)" : ""}`;
const isSub = (s) => !!s && SUB_TYPES.has(s.type);
const MYO_MIN = 3;

function normTech(t) {
  if (!t || !TECH[t.type]) return null;
  const d = TECH[t.type];
  return {
    type: t.type,
    n: clamp(Math.round(num(t.n, d.n[2])), d.n[0], d.n[1]),
    pct: clamp(num(t.pct, 20), 10, 40),
    pause: clamp(num(t.pause, d.rest || 15), 5, 60),
    all: !!t.all,
  };
}

/* Techniek vervalt in een deload en in een minicut: dan gaat het om
   herstel en behoud, niet om extra prikkel. */
const techOff = (D) => (D.pos.phase === "deload" ? "deload" : D.phase === "minicut" && D.phaseOn ? "minicut" : null);

function subWeight(type, w, k, pct, inc) {
  if (!(num(w, 0) > 0)) return null;
  if (type === "drop") return Math.max(0, roundTo(num(w, 0) * Math.pow(1 - pct / 100, k), inc || 2.5));
  return num(w, 0);
}

function techSubs(tech, w, inc) {
  const t = normTech(tech);
  if (!t) return [];
  return Array.from({ length: t.n }, (_, k) => ({ type: t.type, k: k + 1, weight: subWeight(t.type, w, k + 1, t.pct, inc), reps: null, rir: null, done: false }));
}

/* Plakt de subsets achter de laatste werkset, of achter elke werkset. */
function applyTech(sets, tech, inc) {
  const t = normTech(tech);
  if (!t) return sets;
  const work = sets.map((x, k) => (x.type === "work" ? k : -1)).filter((k) => k >= 0);
  if (!work.length) return sets;
  const at = new Set(t.all ? work : [work[work.length - 1]]);
  const out = [];
  sets.forEach((x, k) => {
    out.push(x);
    if (at.has(k)) out.push(...techSubs(t, x.weight, inc));
  });
  return out;
}

/* Houdt de gewichten van nog niet gedane subsets gelijk met hun werkset,
   tot de gebruiker er zelf een wijzigt. */
function syncSubs(sets, tech, inc) {
  const t = normTech(tech);
  let w = null;
  return sets.map((x) => {
    if (x.type === "work") w = x.weight;
    if (!isSub(x) || x.done || x.manual) return x;
    const nw = subWeight(x.type, w, x.k || 1, t ? t.pct : 20, inc);
    return nw === x.weight ? x : { ...x, weight: nw };
  });
}

/* Werksets met hun subsets als blokken; warming-ups apart. */
function setBlocks(sets) {
  const warm = [];
  const blocks = [];
  sets.forEach((x, j) => {
    if (x.type === "warmup") warm.push(j);
    else if (x.type === "work" || !blocks.length) blocks.push([j]);
    else blocks[blocks.length - 1].push(j);
  });
  return { warm, blocks };
}

function addWorkSet(sets, tech, inc) {
  const t = normTech(tech);
  const lastWork = [...sets].reverse().find((x) => x.type === "work");
  const ns = { type: "work", weight: lastWork ? lastWork.weight : null, reps: lastWork ? lastWork.reps : null, rir: null, done: false };
  if (!t) return [...sets, ns];
  if (t.all) return [...sets, ns, ...techSubs(t, ns.weight, inc)];
  // de techniek blijft op de laatste werkset: nieuwe set vóór die laatste
  const { blocks } = setBlocks(sets);
  const lastB = blocks[blocks.length - 1];
  if (!lastB || sets[lastB[0]].done) return [...sets, ns];
  const at = lastB[0];
  return [...sets.slice(0, at), ns, ...sets.slice(at)];
}

/* Haalt een werkset weg (standaard de laatste nog open). Staat de techniek
   alleen op de laatste set, dan schuift die door naar de vorige. */
function removeWorkSet(sets, tech, inc) {
  const t = normTech(tech);
  const work = setBlocks(sets).blocks.filter((b) => sets[b[0]].type === "work");
  const open = work.filter((b) => !b.some((j) => sets[j].done));
  const b = open[open.length - 1];
  if (!b) {
    const k = sets.length - 1;
    return k >= 0 && !sets[k].done ? sets.slice(0, k) : sets;
  }
  const keepSubs = t && !t.all && b.length > 1 && work.length > 1;
  const drop = new Set(keepSubs ? [b[0]] : b);
  return syncSubs(
    sets.filter((_, j) => !drop.has(j)),
    tech,
    inc
  );
}

/* Supersets: groepen van opeenvolgende oefeningen die met ss aan elkaar
   hangen. label A1, A2, B1 ... alleen bij groepen van twee of meer. */
function ssGroups(list) {
  const info = list.map(() => ({ g: null, pos: 0, size: 1, label: null }));
  let gi = 0;
  let k = 0;
  while (k < list.length) {
    let end = k;
    while (end < list.length - 1 && list[end].ss) end++;
    if (end > k) {
      const letter = String.fromCharCode(65 + (gi % 26));
      for (let m = k; m <= end; m++) info[m] = { g: gi, pos: m - k, size: end - k + 1, label: `${letter}${m - k + 1}`, start: k, end };
      gi++;
    }
    k = end + 1;
  }
  return info;
}

/* Volgorde van alle sets in een training: binnen een superset eerst alle
   warming-ups, dan per ronde van elke oefening één werkset met zijn subsets. */
function sessionOrder(exercises) {
  const info = ssGroups(exercises);
  const out = [];
  let i = 0;
  while (i < exercises.length) {
    const g = info[i];
    if (g.g == null) {
      exercises[i].sets.forEach((_, j) => out.push({ i, j, round: null }));
      i++;
      continue;
    }
    const members = [];
    for (let m = g.start; m <= g.end; m++) members.push(m);
    const parts = members.map((m) => setBlocks(exercises[m].sets));
    members.forEach((m, q) => parts[q].warm.forEach((j) => out.push({ i: m, j, round: null })));
    const rounds = Math.max(0, ...parts.map((p) => p.blocks.length));
    for (let r = 0; r < rounds; r++) members.forEach((m, q) => (parts[q].blocks[r] || []).forEach((j) => out.push({ i: m, j, round: r })));
    i = g.end + 1;
  }
  return out;
}

/* Wat komt er na set (i, j), en hoe lang is de rust ertussen. */
function nextStep(exercises, i, j, doneNow = true) {
  const order = sessionOrder(exercises);
  const isDone = (o) => exercises[o.i].sets[o.j].done || (doneNow && o.i === i && o.j === j);
  const pos = order.findIndex((o) => o.i === i && o.j === j);
  const next = order.slice(pos + 1).find((o) => !isDone(o)) || order.find((o) => !isDone(o)) || null;
  const e = exercises[i];
  const s = e.sets[j];
  if (!next) return { next: null, rest: 0, kind: "klaar" };
  const ns = exercises[next.i].sets[next.j];
  const t = normTech(e.tech);
  if (next.i === i && isSub(ns) && next.j === j + 1) {
    return { next, rest: ns.type === "rp" || ns.type === "myo" ? (t ? t.pause : TECH[ns.type].rest) : 0, kind: "sub" };
  }
  if (s.type === "warmup") return { next, rest: 60, kind: "warmup" };
  const cur = order[pos];
  if (cur && cur.round != null && next.i !== i && next.round === cur.round && ssGroups(exercises)[next.i].g === ssGroups(exercises)[i].g) {
    return { next, rest: clamp(num(e.ssRest, 15), 0, 120), kind: "wissel" };
  }
  return { next, rest: num(e.rest, 120), kind: "rust" };
}

/* Voor het volume: werksets plus een halve set per subset, hoogstens één
   extra per werkset. */
function effSets(e) {
  const sets = (e && e.sets) || [];
  let n = 0;
  let extra = 0;
  let open = false;
  const flush = () => {
    n += Math.min(1, extra * 0.5);
    extra = 0;
  };
  sets.forEach((x) => {
    if (x.type === "work") {
      flush();
      open = x.done && num(x.reps, 0) > 0;
      if (open) n++;
    } else if (isSub(x) && open && x.done && num(x.reps, 0) > 0) extra++;
  });
  flush();
  return n;
}

function techExtraSets(slot) {
  const t = normTech(slot.tech);
  if (!t) return 0;
  return Math.min(1, t.n * 0.5) * (t.all ? Math.max(1, num(slot.sets, 2)) : 1);
}

const UPPER = new Set(["borst", "rug", "schouder_voor", "schouder_zij", "schouder_achter", "trapezius", "biceps", "triceps", "onderarmen"]);
const LOWER = new Set(["quadriceps", "hamstrings", "bilspieren", "kuiten"]);
const ANTAG = [
  ["borst", "rug"],
  ["biceps", "triceps"],
  ["quadriceps", "hamstrings"],
  ["schouder_voor", "schouder_achter"],
];
function ssKind(a, b) {
  if (!a || !b) return null;
  if (a.pri.some((m) => b.pri.includes(m))) return "zelfde";
  if (ANTAG.some(([x, y]) => (a.pri.includes(x) && b.pri.includes(y)) || (a.pri.includes(y) && b.pri.includes(x)))) return "tegengesteld";
  if (a.pri.some((m) => b.sec.includes(m)) || b.pri.some((m) => a.sec.includes(m))) return "overlap";
  const up = (e) => e.pri.every((m) => UPPER.has(m));
  const low = (e) => e.pri.every((m) => LOWER.has(m));
  if ((up(a) && low(b)) || (low(a) && up(b))) return "boven-onder";
  return "los";
}
const SS_KIND = {
  tegengesteld: { label: "tegengestelde spieren", note: "Aanbevolen: bespaart tijd zonder prestatieverlies.", ok: true },
  "boven-onder": { label: "boven- en onderlichaam", note: "Prima: de spieren storen elkaar niet.", ok: true },
  los: { label: "verschillende spieren", note: "Prima: de spieren storen elkaar nauwelijks.", ok: true },
  overlap: { label: "deels dezelfde spieren", note: "De tweede oefening gebruikt spieren die de eerste al vermoeid heeft; reken op iets minder reps.", ok: false },
  zelfde: { label: "dezelfde spiergroep", note: "Zwaar: de tweede oefening haalt duidelijk minder reps en de progressie wordt lastiger te volgen. Liever tegengestelde spieren combineren.", ok: false },
};

/* Zware oefeningen met een losse stang (squat, deadlift, bankdrukken):
   tot falen met snel gewicht wisselen is daar riskant. */
const heavyFree = (ex) => !!ex && ex.equip === "stang" && ex.kind === "compound";

/* Stelt supersets van tegengestelde spieren voor binnen een trainingsdag.
   De volgorde blijft zoveel mogelijk staan: de partner schuift naar voren. */
function suggestSupersets(day, exIndex) {
  const slots = day.slots;
  const grouped = new Set();
  ssGroups(slots).forEach((g, k) => g.g != null && grouped.add(k));
  const used = new Set(grouped);
  const pairs = [];
  slots.forEach((s, i) => {
    if (used.has(i)) return;
    const a = exIndex[s.exId];
    if (!a || (heavyFree(a) && a.pri.some((m) => LOWER.has(m)))) return;
    for (let j = i + 1; j < slots.length; j++) {
      if (used.has(j)) continue;
      const b = exIndex[slots[j].exId];
      if (!b || (heavyFree(b) && b.pri.some((m) => LOWER.has(m)))) continue;
      if (ssKind(a, b) === "tegengesteld") {
        used.add(i);
        used.add(j);
        pairs.push([i, j]);
        break;
      }
    }
  });
  if (!pairs.length) return null;
  const partner = new Map(pairs.map(([i, j]) => [i, j]));
  const moved = new Set(pairs.map(([, j]) => j));
  const out = [];
  slots.forEach((s, i) => {
    if (moved.has(i)) return;
    if (partner.has(i)) {
      const r = rest2(s, slots[partner.get(i)]);
      out.push({ ...s, ss: true, ssRest: s.ssRest ?? 15 });
      out.push({ ...slots[partner.get(i)], ss: false, rest: r });
    } else out.push(s);
  });
  return { pairs: pairs.map(([i, j]) => [slots[i], slots[j]]), slots: out };
}
const rest2 = (a, b) => Math.max(num(a.rest, 120), num(b.rest, 120));

function historyFor(sessions, slot) {
  const pick = (pred) => {
    const out = [];
    sessions.forEach((s) => {
      if (s.deload || !s.end) return;
      const e = s.exercises.find(pred);
      if (e && workSets(e).length) out.push({ s, e });
    });
    return out;
  };
  const bySlot = pick((e) => e.slotId === slot.id);
  return bySlot.length ? bySlot : pick((e) => e.exId === slot.exId);
}

function incFor(ex, settings, weight = 0) {
  const own = ex && ex.inc != null && ex.inc !== "" ? num(ex.inc, 0) : 0;
  const base = own > 0 ? own : num(settings && settings.inc && settings.inc[ex.equip], (EQUIP[ex.equip] || {}).inc || 2.5) || 2.5;
  if ((ex.equip === "stang" || ex.equip === "smith") && weight * 0.025 > base * 1.5) return roundTo(weight * 0.025, base);
  return base;
}

/* Reps-first progressie. Binnen de range komt er per set een rep bij op
   hetzelfde gewicht. Twee sessies op rij op de bovenkant: gewicht omhoog.
   Bovenkant met ruim reps over: te licht, direct omhoog. Twee keer onder
   de onderkant: gewicht omlaag. */
function progressFor({ slot, ex, hist, targetRir, load, settings }) {
  const lo = Math.max(1, num(slot.repMin, 8));
  const hi = Math.max(lo, num(slot.repMax, 12));
  if (!hist.length) {
    const sw = slot.startWeight != null && slot.startWeight !== "" ? num(slot.startWeight, null) : null;
    return {
      change: "nieuw",
      weight: sw,
      reps: [hi],
      last: null,
      why: `Eerste keer: kies een gewicht waarmee u ${lo} tot ${hi} reps haalt met nog ${targetRir} ${targetRir === 1 ? "rep" : "reps"} in reserve.`,
    };
  }
  const lastE = hist[hist.length - 1].e;
  const ws = workSets(lastE);
  const w = num(ws[0].weight, 0);
  const bw = lastE.bwLoad || 0;
  const inc = incFor(ex, settings, w);
  const repsL = ws.map((s) => num(s.reps, 0));
  const rirs = ws.map((s) => (s.rir == null || s.rir === "" ? targetRir : num(s.rir, targetRir)));
  const minRir = Math.min(...rirs);
  const sameW = ws.every((s) => num(s.weight, 0) === w);
  const top = sameW && repsL.every((r) => r >= hi);
  const miss = repsL[0] < lo;
  const prevE = hist.length > 1 ? hist[hist.length - 2].e : null;
  const prevWs = prevE ? workSets(prevE) : [];
  const prevTop = prevWs.length > 0 && prevWs.every((s) => num(s.weight, 0) === w && num(s.reps, 0) >= hi);
  const prevMiss = prevWs.length > 0 && num(prevWs[0].weight, 0) === w && num(prevWs[0].reps, 0) < lo;
  const e1 = bestE1rm(lastE);
  const repsAt = (nw) => (e1 > 0 && nw + bw > 0 ? clamp(Math.floor(30 * (e1 / (nw + bw) - 1) - targetRir), lo, hi) : lo);
  const base = { last: { weight: w, reps: repsL, rir: rirs }, inc, lo, hi };
  const r2 = (v) => Math.round(v * 100) / 100;

  if (!load) {
    return { ...base, change: "behoud", weight: w, reps: repsL, why: "Minicut: gewicht en reps vasthouden. Behoud is in deze fase de winst." };
  }
  if (top && minRir >= targetRir + 2) {
    const nw = r2(w + (minRir >= targetRir + 4 ? inc * 2 : inc));
    return {
      ...base,
      change: "omhoog",
      weight: nw,
      reps: repsL.map(() => repsAt(nw)),
      why: `Bovenkant (${hi}) gehaald met nog ${minRir} reps over: te licht. Gewicht direct omhoog naar ${kgTxt(nw)} kg.`,
    };
  }
  if (top && prevTop) {
    const nw = r2(w + inc);
    return {
      ...base,
      change: "omhoog",
      weight: nw,
      reps: repsL.map(() => repsAt(nw)),
      why: `Twee sessies op rij ${hi} reps gehaald: gewicht omhoog met ${kgTxt(inc)} kg naar ${kgTxt(nw)} kg. De reps zakken daardoor terug in de range.`,
    };
  }
  if (top) {
    return { ...base, change: "bevestigen", weight: w, reps: repsL.map(() => hi), why: `Bovenkant van de range gehaald. Nog één keer ${hi} reps op ${kgTxt(w)} kg, dan gaat het gewicht omhoog.` };
  }
  if (miss && prevMiss) {
    const nw = r2(Math.max(0, w - Math.max(inc, roundTo(w * 0.05, inc))));
    if (nw < w) {
      return { ...base, change: "omlaag", weight: nw, reps: repsL.map(() => repsAt(nw)), why: `Twee keer onder de ${lo} reps: gewicht omlaag naar ${kgTxt(nw)} kg om weer binnen de range te werken.` };
    }
    return { ...base, change: "vasthouden", weight: w, reps: repsL.map(() => lo), why: `Twee keer onder de ${lo} reps zonder extra gewicht. Kies een lichtere variant of gebruik ondersteuning.` };
  }
  if (miss) {
    return { ...base, change: "vasthouden", weight: w, reps: repsL.map(() => lo), why: `Onder de ${lo} reps gebleven. Zelfde gewicht; lukt het de volgende keer weer niet, dan gaat het omlaag.` };
  }
  return { ...base, change: "reps", weight: w, reps: repsL.map((r) => Math.min(hi, r + 1)), why: "Binnen de range: zelfde gewicht, een rep meer per set. Eerst reps, dan gewicht." };
}

const CHANGE_LABEL = {
  nieuw: "nieuw",
  omhoog: "gewicht omhoog",
  bevestigen: "bevestigen",
  reps: "+1 rep",
  vasthouden: "vasthouden",
  omlaag: "gewicht omlaag",
  behoud: "behoud",
  deload: "deload",
  handmatig: "handmatig",
  vorige: "als vorige keer",
};
const CHANGE_COLOR = {
  omhoog: "var(--carb)",
  reps: "var(--accent)",
  bevestigen: "var(--accent)",
  omlaag: "var(--danger)",
  vasthouden: "var(--warn)",
  behoud: "var(--fat)",
  deload: "var(--carb)",
  nieuw: "var(--muted)",
  handmatig: "var(--muted)",
  vorige: "var(--muted)",
};

function targetFor(slot, D, T) {
  const ex = exOf(D.exIndex, slot.exId);
  const hist = historyFor(D.sessions, slot);
  const rir = D.pos.phase === "deload" ? 4 : slot.rir != null && slot.rir !== "" ? num(slot.rir, D.pos.rir) : D.pos.rir;
  const load = D.phaseOn ? D.tp.load : true;
  const prop = progressFor({ slot, ex, hist, targetRir: rir, load, settings: T.settings });
  const lastId = hist.length ? hist[hist.length - 1].s.id : null;
  const ov = T.overrides && T.overrides[slot.id];
  let use;
  let source;
  if (D.pos.phase === "deload" && prop.last) {
    use = { weight: prop.last.weight, reps: prop.last.reps.map(() => prop.lo) };
    source = "deload";
  } else if (ov && ov.basis === lastId) {
    use = ov;
    source = "handmatig";
  } else if (T.settings.autoProgress || !prop.last) {
    use = prop;
    source = "auto";
  } else {
    use = { weight: prop.last.weight, reps: prop.last.reps };
    source = "vorige";
  }
  const differs = prop.last && (prop.weight !== use.weight || (prop.reps || []).join() !== (use.reps || []).join());
  const pending = source === "vorige" && differs;
  return { ex, hist, prop, use, source, rir, pending, lastId, change: source === "auto" ? prop.change : source };
}

/* Werksets per oefening voor een geplande sessie: deload halveert, een
   minicut haalt ongeveer een derde weg, eerst bij de laatste oefeningen
   (meestal isolatie), en elke oefening houdt minstens één werkset. */
function plannedSetsFor(day, D, light = false) {
  let out = day.slots.map((s) => Math.max(1, Math.round(num(s.sets, 2))));
  if (D.pos.phase === "deload") out = out.map((c) => Math.max(1, Math.ceil(c / 2)));
  else if (D.phaseOn && D.tp.vf < 1) {
    const total = sum(out);
    const goal = Math.max(out.length, Math.round(total * D.tp.vf));
    let cur = total;
    let guard = 50;
    while (cur > goal && out.some((c) => c > 1) && guard-- > 0) {
      for (let k = out.length - 1; k >= 0 && cur > goal; k--) {
        if (out[k] > 1) {
          out[k]--;
          cur--;
        }
      }
    }
  }
  if (light) out = out.map((c) => Math.max(1, c - 1));
  return out;
}

const WARM = { 1: [[0.6, 6]], 2: [[0.5, 8], [0.75, 4]], 3: [[0.4, 10], [0.6, 6], [0.8, 3]] };
function warmupSets(n, work, inc) {
  const k = clamp(Math.round(num(n, 0)), 0, 3);
  if (!k) return [];
  return WARM[k].map(([p, r]) => ({
    type: "warmup",
    weight: work > 0 ? Math.max(0, roundTo(work * p, inc || 2.5)) : null,
    reps: r,
    rir: null,
    done: false,
    pct: p,
  }));
}

function entryFromSlot(slot, count, D, T, bw) {
  const tg = targetFor(slot, D, T);
  const ex = tg.ex;
  const w = tg.use.weight != null && tg.use.weight !== "" ? num(tg.use.weight, null) : null;
  const inc = incFor(ex, T.settings, w || 0);
  const lo = num(slot.repMin, ex.repMin);
  const hi = num(slot.repMax, ex.repMax);
  const off = techOff(D);
  const tech = off ? null : normTech(slot.tech);
  const reps = tg.prop.last || tg.source === "handmatig" ? expand(tg.use.reps, count) : expand([], count, null);
  return {
    id: uid(),
    slotId: slot.id,
    exId: slot.exId,
    repMin: lo,
    repMax: hi,
    rest: num(slot.rest, 120),
    rir: tg.rir,
    note: "",
    slotNote: slot.note || "",
    bwLoad: ex.equip === "lichaam" ? Math.round(num(bw, 0) * num(ex.bw, 1) * 10) / 10 : 0,
    target: {
      weight: w,
      reps,
      change: tg.change,
      why:
        tg.source === "deload"
          ? "Deload: zelfde gewicht, minder sets en reps, ver van falen."
          : tg.source === "vorige"
          ? tg.pending
            ? "Zelfde als de vorige keer. Het voorstel hieronder kunt u overnemen."
            : tg.prop.why
          : tg.source === "handmatig"
          ? "Door u overgenomen voorstel."
          : tg.prop.why,
    },
    proposal: tg.pending ? { weight: tg.prop.weight, reps: expand(tg.prop.reps, count), why: tg.prop.why, change: tg.prop.change } : null,
    ss: !!slot.ss,
    ssRest: slot.ssRest ?? 15,
    tech: tech,
    techOff: slot.tech && !tech ? off : null,
    sets: applyTech(
      [
        ...warmupSets(slot.warmups, w || 0, inc),
        ...Array.from({ length: count }, (_, i) => ({ type: "work", weight: w, reps: reps[i] ?? null, rir: null, done: false })),
      ],
      tech,
      inc
    ),
  };
}

function buildSession({ program, day, D, T, rotPos = null, bw }) {
  const counts = day ? plannedSetsFor(day, D) : [];
  return {
    id: uid(),
    date: localISO(),
    start: Date.now(),
    end: null,
    programId: program ? program.id : null,
    dayId: day ? day.id : null,
    name: day ? day.name : "Vrije training",
    rotPos,
    deload: D.pos.phase === "deload",
    blockPhase: D.pos.phase,
    blockNumber: D.pos.number,
    blockWeek: D.pos.week,
    nutritionPhase: D.phase,
    volumeCut: D.pos.phase !== "deload" && D.phaseOn && D.tp.vf < 1,
    readiness: null,
    light: false,
    note: "",
    exercises: day ? day.slots.map((slot, k) => entryFromSlot(slot, counts[k], D, T, bw)) : [],
    rest: null,
  };
}

function finishSession(a) {
  const exercises = a.exercises
    .map((e) => {
      const { proposal, ...rest } = e;
      return { ...rest, sets: e.sets.filter((s) => s.done) };
    })
    .filter((e) => e.sets.length);
  const { rest, ...clean } = a;
  return { ...clean, end: Date.now(), exercises };
}

function sessionStats(s) {
  let ton = 0;
  let sets = 0;
  let reps = 0;
  s.exercises.forEach((e) => {
    workSets(e).forEach((x) => {
      ton += setLoad(e, x) * num(x.reps, 0);
      sets++;
      reps += num(x.reps, 0);
    });
    e.sets.forEach((x) => {
      if (!isSub(x) || !x.done) return;
      ton += setLoad(e, x) * num(x.reps, 0);
      reps += num(x.reps, 0);
    });
  });
  return { ton, sets, reps, min: s.end ? Math.max(1, Math.round((s.end - s.start) / 60000)) : null };
}

function bestBefore(sessions, exId, beforeStart) {
  let best = 0;
  sessions.forEach((p) => {
    if (p.start >= beforeStart) return;
    p.exercises.forEach((x) => {
      if (x.exId === exId) best = Math.max(best, bestE1rm(x));
    });
  });
  return best;
}

function sessionPRs(s, sessions) {
  const out = [];
  s.exercises.forEach((e) => {
    const cur = bestE1rm(e);
    if (!cur) return;
    const prev = bestBefore(sessions, e.exId, s.start);
    if (prev > 0 && cur > prev + 0.05) out.push({ exId: e.exId, e1: cur, prev });
  });
  return out;
}

/* ---------------- volume per spiergroep ---------------- */

function muscleSets(sessions, exIndex, fromNum, toNum) {
  const m = Object.fromEntries(MUSCLE_IDS.map((k) => [k, 0]));
  sessions.forEach((s) => {
    const n = dayNum(s.date);
    if (n < fromNum || n > toNum || !s.end) return;
    s.exercises.forEach((e) => {
      const ex = exIndex[e.exId];
      if (!ex) return;
      const k = effSets(e);
      ex.pri.forEach((p) => {
        if (m[p] != null) m[p] += k;
      });
      ex.sec.forEach((p) => {
        if (m[p] != null) m[p] += k / 2;
      });
    });
  });
  return m;
}

function daysPerWeek(program) {
  if (!program) return [];
  const known = (id) => program.days.find((d) => d.id === id);
  if (program.mode === "week") return program.weekMap.map(known).filter(Boolean).map((d) => ({ day: d, weight: 1 }));
  const rot = program.rotation || [];
  if (!rot.length) return [];
  return rot.map(known).filter(Boolean).map((d) => ({ day: d, weight: 7 / rot.length }));
}

function plannedMuscleSets(program, exIndex) {
  const m = Object.fromEntries(MUSCLE_IDS.map((k) => [k, 0]));
  daysPerWeek(program).forEach(({ day, weight }) =>
    day.slots.forEach((s) => {
      const ex = exIndex[s.exId];
      if (!ex) return;
      const k = (num(s.sets, 2) + techExtraSets(s)) * weight;
      ex.pri.forEach((p) => {
        if (m[p] != null) m[p] += k;
      });
      ex.sec.forEach((p) => {
        if (m[p] != null) m[p] += k / 2;
      });
    })
  );
  return m;
}

const sessionsPerWeek = (program) => sum(daysPerWeek(program).map((d) => d.weight));

function estMinutes(day) {
  if (!day) return 0;
  /* in een superset vervangt de korte wissel de rust, behalve na de laatste */
  const sec = sum(
    day.slots.map((s) => {
      const t = normTech(s.tech);
      const sub = t ? t.n * (t.type === "rp" || t.type === "myo" ? t.pause + 15 : 20) * (t.all ? num(s.sets, 2) : 1) : 0;
      return num(s.warmups, 0) * 100 + num(s.sets, 2) * (45 + (s.ss ? num(s.ssRest, 15) : num(s.rest, 120))) + sub;
    })
  );
  return Math.max(15, Math.round(sec / 60 / 5) * 5);
}

function programCheck(program, exIndex) {
  const slots = program.days.flatMap((d) => d.slots);
  const exs = slots.map((s) => exIndex[s.exId]).filter(Boolean);
  if (!exs.length) return [];
  const comp = exs.filter((e) => e.kind === "compound").length / exs.length;
  const len = exs.filter((e) => e.lengthened).length / exs.length;
  const uni = exs.filter((e) => e.unilateral).length;
  const avgSets = sum(slots.map((s) => num(s.sets, 2))) / slots.length;
  const planned = plannedMuscleSets(program, exIndex);
  const under = MUSCLE_IDS.filter((k) => MUSCLES[k].mev > 0 && planned[k] < MUSCLES[k].mev);
  const over = MUSCLE_IDS.filter((k) => planned[k] > MUSCLES[k].mrv);
  const pc = Math.round(comp * 100);
  return [
    {
      label: "Compound / isolatie",
      value: `${pc} / ${100 - pc}`,
      state: comp >= 0.3 && comp <= 0.5 ? "goed" : "oplet",
      note:
        comp > 0.5
          ? "Veel compound. Streef naar ongeveer 40/60: isolatie laat u dichter bij falen trainen met minder vermoeidheid per set."
          : comp < 0.3
          ? "Weinig compound. Een paar zware basisoefeningen per week houden de totale belasting en kracht op peil."
          : "Rond de aanbevolen 40/60.",
    },
    {
      label: "Lengthened-bias",
      value: `${Math.round(len * 100)}%`,
      state: len >= 0.4 ? "goed" : len >= 0.25 ? "oplet" : "risico",
      note: "Oefeningen die de spier in de gerekte positie het zwaarst belasten, zoals incline curls, overhead extensions en zittende leg curls, geven per set meer groeiprikkel.",
    },
    {
      label: "Unilateraal werk",
      value: uni ? `${uni} ${uni === 1 ? "oefening" : "oefeningen"}` : "geen",
      state: uni ? "goed" : "oplet",
      note: "Eenzijdige oefeningen corrigeren disbalans en laten u per kant dichter bij falen komen.",
    },
    {
      label: "Werksets per oefening",
      value: avgSets.toFixed(1).replace(".", ","),
      state: avgSets <= 3 ? "goed" : "oplet",
      note: "Twee kwaliteitssets tot RIR 0-1 is het uitgangspunt. Meer sets per oefening kan, maar dan daalt de kwaliteit per set vaak.",
    },
    {
      label: "Onder het minimum (MEV)",
      value: under.length ? `${under.length} ${under.length === 1 ? "groep" : "groepen"}` : "geen",
      state: under.length ? "oplet" : "goed",
      note: under.length
        ? `Weinig sets voor ${under.map((k) => MUSCLES[k].label.toLowerCase()).join(", ")}. Bij sets tot (bijna) falen ligt het echte minimum vaak lager dan deze richtwaarde; kijk vooral naar uw voortgang.`
        : "Elke spiergroep krijgt minstens het minimale effectieve volume.",
    },
    ...(over.length
      ? [
          {
            label: "Boven het maximum (MRV)",
            value: `${over.length}`,
            state: "risico",
            note: `Meer sets dan u waarschijnlijk kunt herstellen voor ${over.map((k) => MUSCLES[k].label.toLowerCase()).join(", ")}.`,
          },
        ]
      : []),
  ];
}

/* ---------------- dagplanning ---------------- */

function todayPlan(program, sessions, today) {
  if (!program || !program.days.length) return null;
  const t = dayNum(today);
  if (program.mode === "week") {
    const dayId = program.weekMap[wdOfNum(t)];
    const day = program.days.find((d) => d.id === dayId) || null;
    const doneToday = sessions.some((s) => s.date === today && s.programId === program.id && s.dayId === dayId && s.end);
    return { day, rest: !day, doneToday, rotPos: null };
  }
  const rot = program.rotation || [];
  if (!rot.length) return null;
  const last = [...sessions].reverse().find((s) => s.programId === program.id && s.rotPos != null && s.end);
  let p = last ? (last.rotPos + 1) % rot.length : 0;
  let rests = 0;
  while (rot[p] === "rust" && rests < rot.length) {
    rests++;
    p = (p + 1) % rot.length;
  }
  const day = program.days.find((d) => d.id === rot[p]) || null;
  if (!day) return { day: null, rest: true, rotPos: null };
  if (last && last.date === today) return { day: null, rest: true, doneToday: true, next: day, rotPos: p };
  const since = last ? t - dayNum(last.date) : Infinity;
  if (since <= rests) return { day: null, rest: true, next: day, rotPos: p };
  return { day, rest: false, rotPos: p };
}

function rotPosFor(program, dayId, from = 0) {
  const rot = program.rotation || [];
  for (let k = 0; k < rot.length; k++) {
    const p = (from + k) % rot.length;
    if (rot[p] === dayId) return p;
  }
  return null;
}

/* ---------------- vermoeidheid en deload ----------------
   Een deload wordt voorgesteld als de prestaties over de laatste twee weken
   bij minstens 30 procent van de vergelijkbare oefeningen dalen (e1RM,
   gecorrigeerd voor reps in reserve), of als de herstelscore voor de
   training drie keer laag was en er ook prestaties dalen. */
function fatigueCheck({ sessions, pos, today, tp, block }) {
  if (pos.phase === "deload") return null;
  const t = dayNum(today);
  if (t - pos.cycleStart < 7) return null;
  if (block.dismissedAt && t - dayNum(block.dismissedAt) < 7) return null;
  const done = sessions.filter((s) => !s.deload && s.end);
  const recent = done.filter((s) => dayNum(s.date) >= Math.max(pos.cycleStart, t - 14) && dayNum(s.date) <= t);
  if (recent.length < 3) return null;
  const tol = tp.tol ?? 0.03;
  let comps = 0;
  let drops = 0;
  const dropped = [];
  recent.forEach((s) =>
    s.exercises.forEach((e) => {
      const cur = bestE1rm(e);
      if (!cur) return;
      let prev = 0;
      for (let k = done.length - 1; k >= 0; k--) {
        const p = done[k];
        if (p.start >= s.start) continue;
        const x = p.exercises.find((y) => y.exId === e.exId && bestE1rm(y) > 0);
        if (x) {
          prev = bestE1rm(x);
          break;
        }
      }
      if (!prev) return;
      comps++;
      if (cur < prev * (1 - tol)) {
        drops++;
        dropped.push(e.exId);
      }
    })
  );
  const lowReady = recent.filter((s) => lowReadiness(s.readiness)).length;
  const ratio = comps ? drops / comps : 0;
  const perf = comps >= 4 && ratio >= 0.3;
  const ready = lowReady >= 3 && drops >= 1;
  if (!perf && !ready) return null;
  const reasons = [];
  if (drops) reasons.push(`Prestatie gedaald bij ${drops} van ${comps} vergelijkingen met de vorige keer (laatste twee weken).`);
  if (lowReady >= 3) reasons.push(`${lowReady} keer een lage herstelscore voor de training (slaap, energie, spierpijn).`);
  return { reasons, drops, comps, dropped: [...new Set(dropped)] };
}

/* ---------------- opslag ---------------- */

const TRAIN_DEFAULT = () => ({
  v: 1,
  settings: {
    effort: "rir",
    autoProgress: false,
    intensity: "kuba",
    sound: true,
    vibrate: true,
    notify: false,
    wakeLock: true,
    readiness: true,
    inc: Object.fromEntries(Object.entries(EQUIP).map(([k, v]) => [k, v.inc])),
  },
  customEx: [],
  exEdits: {},
  programs: [],
  activeProgramId: null,
  sessions: [],
  active: null,
  overrides: {},
  phaseAccept: null,
  block: { start: mondayOf(localISO()), acc: 4, int: 2, deload: true, number: 1, deloadFrom: null, dismissedAt: null, auto: null },
});

function normalizeTraining(d) {
  const def = TRAIN_DEFAULT();
  if (!d || typeof d !== "object") return def;
  return {
    ...def,
    ...d,
    settings: { ...def.settings, ...(d.settings || {}), inc: { ...def.settings.inc, ...((d.settings && d.settings.inc) || {}) } },
    block: { ...def.block, ...(d.block || {}) },
    customEx: Array.isArray(d.customEx) ? d.customEx : [],
    exEdits: d.exEdits && typeof d.exEdits === "object" ? d.exEdits : {},
    programs: Array.isArray(d.programs) ? d.programs : [],
    sessions: Array.isArray(d.sessions) ? [...d.sessions].sort((a, b) => a.start - b.start) : [],
    overrides: d.overrides && typeof d.overrides === "object" ? d.overrides : {},
    active: d.active && Array.isArray(d.active.exercises) ? d.active : null,
  };
}

function useTrainingStore() {
  const [T, setT] = useState(TRAIN_DEFAULT);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!window.storage) return;
        const r = await window.storage.get(TRAIN_KEY);
        const d = r && r.value ? JSON.parse(r.value) : null;
        if (alive && d) setT(normalizeTraining(d));
      } catch (e) {
        /* nog niets opgeslagen */
      } finally {
        if (alive) setOk(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!ok || !window.storage) return;
    const t = setTimeout(() => {
      try {
        const p = window.storage.set(TRAIN_KEY, JSON.stringify(T));
        if (p && p.catch) p.catch(() => {});
      } catch (e) {
        /* opslag vol of niet beschikbaar */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [T, ok]);
  return [T, setT, ok];
}

function trainDerive(T, ctx, today) {
  const exIndex = buildExIndex(T.customEx, T.exEdits);
  const program = T.programs.find((p) => p.id === T.activeProgramId) || null;
  const pos = blockPosition(T.block, today, T.settings.intensity);
  const phase = TRAIN_PHASE[ctx.phase] ? ctx.phase : "onderhoud";
  const tp = TRAIN_PHASE[phase];
  const phaseOn = tp.vf === 1 && tp.load ? true : T.settings.autoProgress || T.phaseAccept === phase;
  const sessions = T.sessions;
  const plan = todayPlan(program, sessions, today);
  const fatigue = fatigueCheck({ sessions, pos, today, tp, block: T.block });
  return { exIndex, program, pos, phase, tp, phaseOn, sessions, plan, fatigue, today };
}

/* ---------------- geluid, trilling en melding bij einde rust ---------------- */

let audioCtx = null;
function primeAudio() {
  try {
    const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (e) {
    /* geen geluid beschikbaar */
  }
}
function beep() {
  try {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    [0, 0.22, 0.44].forEach((d, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.value = i === 2 ? 1320 : 880;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.18);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.2);
    });
  } catch (e) {
    /* geen geluid beschikbaar */
  }
}
function restAlert(settings, next) {
  if (settings.sound) beep();
  try {
    if (settings.vibrate && navigator.vibrate) navigator.vibrate([220, 120, 220]);
  } catch (e) {
    /* trillen niet ondersteund */
  }
  try {
    if (settings.notify && document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
      const body = next ? `Volgende: ${next}` : "Tijd voor de volgende set.";
      const plain = () => new Notification("Rust voorbij", { body, tag: "rust" });
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        navigator.serviceWorker
          .getRegistration()
          .then((r) => (r ? r.showNotification("Rust voorbij", { body, tag: "rust", renotify: true }) : plain()))
          .catch(() => {});
      } else plain();
    }
  } catch (e) {
    /* meldingen niet ondersteund */
  }
}

function useNow(ms = 1000, on = true) {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setN(Date.now());
    const id = setInterval(() => setN(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, on]);
  return n;
}
const mmss = (sec) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};
function Elapsed({ start }) {
  const now = useNow(1000);
  return <span className="tnum">{mmss((now - start) / 1000)}</span>;
}

/* ---------------- kleine bouwstenen ---------------- */

function TBtn({ children, onClick, kind = "primary", small, full, disabled, className = "", label }) {
  const st =
    kind === "primary"
      ? { background: C.accent, color: C.onAccent, border: `1px solid ${C.accent}` }
      : kind === "danger"
      ? { background: C.train, color: C.onTrain, border: `1px solid ${C.train}` }
      : kind === "ghost"
      ? { background: "transparent", color: C.ink, border: `1px solid ${C.line}` }
      : { background: C.surface2, color: C.ink, border: `1px solid ${C.line}` };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`tap ${small ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2.5 text-sm"} ${full ? "w-full" : ""} ${className}`}
      style={{ ...st, borderRadius: R.field, fontWeight: 600, opacity: disabled ? 0.45 : 1 }}
    >
      {children}
    </button>
  );
}

function Chip({ children, color, title }) {
  return (
    <span
      title={title}
      className="inline-flex items-center px-1.5 text-xs font-semibold whitespace-nowrap"
      style={{ color: color || C.muted, background: C.surface2, borderRadius: 6, border: `1px solid ${C.lineSoft}`, lineHeight: "18px" }}
    >
      {children}
    </span>
  );
}

function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 flex items-end justify-center"
      style={{ background: "rgba(8,9,12,.55)", zIndex: 60 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="macroapp w-full max-w-2xl hero-in flex flex-col"
        style={{
          background: C.panel,
          color: C.ink,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          maxHeight: "88vh",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
          <h3 className="disp text-xl font-bold uppercase leading-none">{title}</h3>
          <button onClick={onClose} className="tap text-sm px-2 py-1" style={{ color: C.muted }}>
            Sluiten
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-3" style={{ WebkitOverflowScrolling: "touch" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

const inputStyle = { border: `1px solid ${C.line}`, borderRadius: R.field, color: C.ink, background: C.surface2 };

const RPE_OPTS = [10, 9.5, 9, 8.5, 8, 7, 6];
const effortLabel = (rir, scale) =>
  rir == null || rir === "" ? "–" : scale === "rpe" ? `RPE ${String(10 - num(rir, 0)).replace(".", ",")}` : `RIR ${rir}`;

function EffortSelect({ value, onChange, scale }) {
  return (
    <select
      value={value == null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="w-full px-1 py-2 text-sm tnum"
      style={inputStyle}
      aria-label={scale === "rpe" ? "RPE van deze set" : "Reps in reserve van deze set"}
    >
      <option value="">{scale === "rpe" ? "RPE" : "RIR"}</option>
      {scale === "rpe"
        ? RPE_OPTS.map((r) => (
            <option key={r} value={10 - r}>
              {String(r).replace(".", ",")}
            </option>
          ))
        : [0, 1, 2, 3, 4, 5].map((r) => (
            <option key={r} value={r}>
              {r === 0 ? "0 falen" : r === 5 ? "5+" : r}
            </option>
          ))}
    </select>
  );
}

function exMeta(ex) {
  return [EQUIP[ex.equip] ? EQUIP[ex.equip].label : ex.equip, ex.kind === "compound" ? "compound" : "isolatie", ex.pri.map((m) => (MUSCLES[m] ? MUSCLES[m].label : m)).join(", ")]
    .filter(Boolean)
    .join(" · ");
}

function ExBadges({ ex }) {
  return (
    <span className="inline-flex gap-1 align-middle">
      {ex.lengthened && (
        <Chip color={C.carb} title="Lengthened-bias: zwaarst belast in de gerekte positie">
          rek
        </Chip>
      )}
      {ex.unilateral && (
        <Chip color={C.pro} title="Unilateraal: per kant">
          1 kant
        </Chip>
      )}
      {ex.custom && <Chip>eigen</Chip>}
    </span>
  );
}

/* Past een eigen oefening aan. Schema's die nog de oude standaard-repsrange
   van die oefening gebruikten, krijgen de nieuwe range; een range die u per
   training zelf had gewijzigd blijft staan. */
function updateCustomEx(t, ex) {
  const old = t.customEx.find((x) => x.id === ex.id);
  if (!old) return t;
  return {
    ...t,
    customEx: t.customEx.map((x) => (x.id === ex.id ? ex : x)),
    programs: t.programs.map((p) => ({
      ...p,
      days: p.days.map((d) => ({
        ...d,
        slots: d.slots.map((sl) =>
          sl.exId === ex.id && num(sl.repMin, 0) === num(old.repMin, 0) && num(sl.repMax, 0) === num(old.repMax, 0)
            ? { ...sl, repMin: ex.repMin, repMax: ex.repMax }
            : sl
        ),
      })),
    })),
  };
}

const exUsage = (programs, id) => sum(programs.map((p) => sum(p.days.map((d) => d.slots.filter((sl) => sl.exId === id).length))));

function CustomExForm({ initialName = "", initial = null, onSave, onCancel }) {
  const [x, setX] = useState(() =>
    initial
      ? {
          name: initial.name,
          equip: initial.equip,
          kind: initial.kind,
          pri: (initial.pri && initial.pri[0]) || "borst",
          sec: (initial.sec && initial.sec[0]) || "",
          repMin: initial.repMin,
          repMax: initial.repMax,
          lengthened: !!initial.lengthened,
          unilateral: !!initial.unilateral,
          bwPct: Math.round(num(initial.bw, 1) * 100),
        }
      : { name: initialName, equip: "machine", kind: "isolation", pri: "borst", sec: "", repMin: 10, repMax: 15, lengthened: false, unilateral: false, bwPct: 100 }
  );
  const s = (k, v) => setX((o) => ({ ...o, [k]: v }));
  const ok = x.name.trim().length >= 2 && num(x.repMin, 0) > 0 && num(x.repMax, 0) >= num(x.repMin, 0);
  const muscleOpts = MUSCLE_IDS.map((k) => ({ id: k, label: MUSCLES[k].label }));
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs" style={{ color: C.muted }}>
          Naam
        </span>
        <input value={x.name} onChange={(e) => s("name", e.target.value)} className="w-full px-3 py-2 text-sm mt-1" style={inputStyle} placeholder="Bijvoorbeeld: Pendulum squat" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs" style={{ color: C.muted }}>
            Materiaal
          </span>
          <Pick value={x.equip} onChange={(v) => s("equip", v)} options={Object.entries(EQUIP).map(([id, v]) => ({ id, label: v.label }))} />
        </label>
        <label className="block">
          <span className="text-xs" style={{ color: C.muted }}>
            Soort
          </span>
          <Pick
            value={x.kind}
            onChange={(v) => s("kind", v)}
            options={[
              { id: "compound", label: "Compound" },
              { id: "isolation", label: "Isolatie" },
            ]}
          />
        </label>
        <label className="block">
          <span className="text-xs" style={{ color: C.muted }}>
            Hoofdspier
          </span>
          <Pick value={x.pri} onChange={(v) => s("pri", v)} options={muscleOpts} />
        </label>
        <label className="block">
          <span className="text-xs" style={{ color: C.muted }}>
            Hulpspier
          </span>
          <Pick value={x.sec} onChange={(v) => s("sec", v)} options={[{ id: "", label: "Geen" }, ...muscleOpts.filter((m) => m.id !== x.pri)]} />
        </label>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm">Repsrange</span>
        <Num value={x.repMin} onChange={(v) => s("repMin", v)} min={1} max={50} />
        <span style={{ color: C.muted }}>tot</span>
        <Num value={x.repMax} onChange={(v) => s("repMax", v)} min={1} max={50} />
      </div>
      {x.equip === "lichaam" && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm">Lichaamsgewicht telt mee voor</span>
          <Num value={x.bwPct} onChange={(v) => s("bwPct", v)} min={0} max={100} suffix="%" />
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={x.lengthened} onChange={(e) => s("lengthened", e.target.checked)} style={{ accentColor: "var(--accent)" }} />
        Zwaarst in de gerekte positie (lengthened-bias)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={x.unilateral} onChange={(e) => s("unilateral", e.target.checked)} style={{ accentColor: "var(--accent)" }} />
        Per kant (unilateraal)
      </label>
      <div className="flex gap-2 pt-1">
        <TBtn
          disabled={!ok}
          onClick={() =>
            ok &&
            onSave({
              id: initial ? initial.id : "eigen_" + uid(),
              name: x.name.trim(),
              equip: x.equip,
              kind: x.kind,
              pri: [x.pri],
              sec: x.sec ? [x.sec] : [],
              lengthened: x.lengthened,
              unilateral: x.unilateral,
              repMin: num(x.repMin, 8),
              repMax: Math.max(num(x.repMin, 8), num(x.repMax, 12)),
              bw: x.equip === "lichaam" ? clamp(num(x.bwPct, 100), 0, 100) / 100 : 1,
              custom: true,
            })
          }
        >
          {initial ? "Wijzigingen opslaan" : "Oefening opslaan"}
        </TBtn>
        <TBtn kind="ghost" onClick={onCancel}>
          Annuleren
        </TBtn>
      </div>
    </div>
  );
}

function ExercisePicker({ exIndex, onPick, onClose, onCreate, onUpdate, title = "Oefening kiezen", muscle = null }) {
  const [q, setQ] = useState("");
  const [mus, setMus] = useState(muscle);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const ql = q.trim().toLowerCase();
  const list = Object.values(exIndex)
    .filter((e) => !e.missing && !e.hidden && (!mus || e.pri.includes(mus) || e.sec.includes(mus)) && (!ql || e.name.toLowerCase().includes(ql)))
    .sort((a, b) => (mus ? Number(b.pri.includes(mus)) - Number(a.pri.includes(mus)) : 0) || a.name.localeCompare(b.name, "nl"));
  return (
    <Sheet title={editing ? "Oefening bewerken" : creating ? "Eigen oefening" : title} onClose={onClose}>
      {editing ? (
        <CustomExForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={(ex) => {
            onUpdate(ex);
            setEditing(null);
          }}
        />
      ) : creating ? (
        <CustomExForm
          initialName={q}
          onCancel={() => setCreating(false)}
          onSave={(ex) => {
            onCreate(ex);
            onPick(ex);
          }}
        />
      ) : (
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Zoeken"
            className="w-full px-3 py-2 text-sm mb-2"
            style={inputStyle}
            aria-label="Oefening zoeken"
          />
          <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
            {[{ id: null, label: "Alles" }, ...MUSCLE_IDS.map((k) => ({ id: k, label: MUSCLES[k].label }))].map((m) => {
              const on = mus === m.id;
              return (
                <button
                  key={String(m.id)}
                  onClick={() => setMus(m.id)}
                  className="tap shrink-0 px-2.5 py-1 text-xs rounded-full"
                  style={{ background: on ? C.accent : C.surface2, color: on ? C.onAccent : C.ink, border: `1px solid ${on ? C.accent : C.line}`, fontWeight: 600 }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          <div>
            {list.map((e) => (
              <div key={e.id} className="flex items-center gap-2" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
                <button onClick={() => onPick(e)} className="tap flex-1 min-w-0 text-left py-2.5 flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="text-sm font-semibold block">{e.name}</span>
                    <span className="text-xs block" style={{ color: C.muted }}>
                      {exMeta(e)}
                    </span>
                  </span>
                  <ExBadges ex={e} />
                </button>
                {e.custom && onUpdate && (
                  <button onClick={() => setEditing(e)} className="tap text-xs shrink-0 px-2 py-2" style={{ color: C.accent }} aria-label={`${e.name} bewerken`}>
                    Wijzig
                  </button>
                )}
              </div>
            ))}
            {!list.length && (
              <p className="text-sm py-4" style={{ color: C.muted }}>
                Niets gevonden. Voeg de oefening zelf toe.
              </p>
            )}
          </div>
          <div className="pt-3">
            <TBtn kind="secondary" full onClick={() => setCreating(true)}>
              + Eigen oefening toevoegen
            </TBtn>
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ---------------- grafieken ---------------- */

function LineMini({ pts, fmt = kgTxt, unit = "kg", color = "var(--accent)" }) {
  if (!pts || pts.length < 2) return null;
  const W = 340;
  const H = 160;
  const padL = 40;
  const padR = 10;
  const padT = 12;
  const padB = 22;
  const t0 = pts[0].t;
  const t1 = Math.max(pts[pts.length - 1].t, t0 + 1);
  let lo = Math.min(...pts.map((p) => p.v));
  let hi = Math.max(...pts.map((p) => p.v));
  const span = Math.max(1, hi - lo);
  lo = Math.max(0, lo - span * 0.15);
  hi = hi + span * 0.15;
  const x = (t) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const ticks = [lo, (lo + hi) / 2, hi];
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" role="img" aria-label={`Verloop, laatste waarde ${fmt(pts[pts.length - 1].v)} ${unit}`}>
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" />
          <text x={padL - 6} y={y(v) + 3.5} fontSize="10" textAnchor="end" fill="var(--muted)">
            {fmt(Math.round(v))}
          </text>
        </g>
      ))}
      <text x={padL} y={H - 6} fontSize="10" fill="var(--muted)">
        {fmtDay(t0)}
      </text>
      <text x={W - padR} y={H - 6} fontSize="10" textAnchor="end" fill="var(--muted)">
        {fmtDay(t1)}
      </text>
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={x(p.t)} cy={y(p.v)} r={p.pr ? 4.5 : 2.8} fill={p.pr ? "var(--carb-fill)" : color} stroke="var(--surface)" strokeWidth="1.5" />
      ))}
    </svg>
  );
}

function BarsMini({ bars, fmt = (v) => Math.round(v).toLocaleString("nl-NL"), color = "var(--accent)", target }) {
  if (!bars.length) return null;
  const max = Math.max(1, ...bars.map((b) => b.v), target || 0);
  return (
    <div>
      <div className="flex items-end gap-1.5 relative" style={{ height: 110 }}>
        {target != null && (
          <span
            className="absolute left-0 right-0"
            style={{ bottom: `${(target / max) * 100}%`, borderTop: "2px dashed var(--carb-fill)", opacity: 0.8 }}
            aria-hidden="true"
          />
        )}
        {bars.map((b, i) => (
          <div key={i} className="flex-1 flex flex-col justify-end items-center h-full">
            <span className="text-xs tnum mb-0.5" style={{ color: C.muted, fontSize: 10 }}>
              {b.v ? fmt(b.v) : ""}
            </span>
            <span
              className="w-full block wk-bar"
              style={{ height: `${Math.max(2, (b.v / max) * 100)}%`, background: b.hi ? color : "var(--line)", borderRadius: 5, animationDelay: `${i * 35}ms` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1">
        {bars.map((b, i) => (
          <span key={i} className="flex-1 text-center tnum" style={{ color: C.muted, fontSize: 10 }}>
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function VolumeRow({ m, done, planned }) {
  const L = MUSCLES[m];
  const max = Math.max(L.mrv + 4, done, planned);
  const pct = (v) => `${Math.min(100, (v / max) * 100)}%`;
  const state = done >= L.mrv ? C.train : done >= L.mav[0] ? C.carb : done >= L.mev ? C.accent : C.muted;
  return (
    <div className="px-4 py-2.5" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{L.label}</span>
        <span className="text-sm tnum shrink-0">
          <strong style={{ color: state }}>{String(Math.round(done * 2) / 2).replace(".", ",")}</strong>
          <span style={{ color: C.muted }}>{planned > 0 ? ` / ${String(Math.round(planned * 2) / 2).replace(".", ",")} gepland` : " sets"}</span>
        </span>
      </div>
      <div className="text-xs tnum mb-1.5" style={{ color: C.muted }}>
        MEV {L.mev} · MAV {L.mav[0]}–{L.mav[1]} · MRV {L.mrv}
      </div>
      <div className="relative" style={{ height: 10, background: C.lineSoft, borderRadius: 5 }}>
        <span className="absolute top-0 bottom-0" style={{ left: pct(L.mav[0]), width: `calc(${pct(L.mav[1])} - ${pct(L.mav[0])})`, background: "rgba(0,195,137,.18)" }} />
        <span className="absolute top-0 bottom-0 bar-fill" style={{ left: 0, width: pct(done), background: state, borderRadius: 5, opacity: 0.9 }} />
        <span className="absolute" style={{ left: pct(L.mev), top: -2, bottom: -2, width: 2, background: "var(--muted)" }} title="MEV" />
        <span className="absolute" style={{ left: pct(L.mrv), top: -2, bottom: -2, width: 2, background: "var(--danger)" }} title="MRV" />
        {planned > 0 && <span className="absolute" style={{ left: pct(planned), top: -4, bottom: -4, width: 3, background: C.ink, borderRadius: 2 }} title="Gepland" />}
      </div>
    </div>
  );
}

/* ---------------- dock: lopende training en rusttimer ---------------- */

function WorkoutDock({ T, setT, showOpen, onOpen }) {
  const a = T.active;
  const rest = a && a.rest;
  const now = useNow(250, !!rest);
  const left = rest ? (rest.endsAt - now) / 1000 : 0;
  const fired = useRef(null);
  useEffect(() => {
    if (!rest) return;
    if (left <= 0 && fired.current !== rest.endsAt) {
      fired.current = rest.endsAt;
      // een rust die al lang voorbij was (bijv. na herladen) niet alsnog laten piepen
      if (left > -10) restAlert(T.settings, rest.next);
    }
  }, [left <= 0, rest && rest.endsAt]);
  if (!a || (!rest && !showOpen)) return null;
  const adj = (d) =>
    setT((t) =>
      t.active && t.active.rest
        ? { ...t, active: { ...t.active, rest: { ...t.active.rest, endsAt: Math.max(Date.now() + 1000, t.active.rest.endsAt + d * 1000), total: Math.max(5, t.active.rest.total + d) } } }
        : t
    );
  const stop = () => setT((t) => (t.active ? { ...t, active: { ...t.active, rest: null } } : t));
  const over = rest && left <= 0;
  const pct = rest ? Math.max(0, Math.min(100, (left / Math.max(1, rest.total)) * 100)) : 0;
  return (
    <div className="no-print fixed left-0 right-0 px-3" style={{ bottom: "calc(62px + env(safe-area-inset-bottom, 0px))", zIndex: 45 }}>
      <div
        className="macroapp mx-auto max-w-2xl hero-in overflow-hidden"
        style={{ background: C.dark, color: C.darkInk, borderRadius: 14, boxShadow: "0 12px 30px -12px rgba(0,0,0,.6)", border: `1px solid ${C.darkLine}` }}
        role="status"
        aria-live="polite"
      >
        {showOpen && (
          <button onClick={onOpen} className="tap w-full text-left px-3 py-2 flex items-center gap-2" style={{ borderBottom: rest ? `1px solid ${C.darkLine}` : "none" }}>
            <span className="rounded-full shrink-0" style={{ width: 8, height: 8, background: "var(--carb-fill)" }} />
            <span className="text-xs flex-1 truncate">
              <strong>Training bezig</strong> · {a.name} · <Elapsed start={a.start} />
            </span>
            <span className="text-xs font-semibold" style={{ color: "var(--accent)" }}>
              Verder
            </span>
          </button>
        )}
        {rest && (
          <div className="px-3 py-2">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs truncate" style={{ color: over ? "var(--carb-fill)" : C.darkMuted }}>
                  {over ? (rest.kind === "wissel" ? "Wisselen" : rest.kind === "sub" ? "Door" : "Rust voorbij") : rest.kind === "wissel" ? "Wissel" : rest.kind === "sub" ? "Pauze" : "Rust"}
                  {rest.next ? ` · ${rest.next}` : ""}
                </div>
                <div className="disp text-3xl font-bold tnum leading-none" style={{ color: over ? "var(--carb-fill)" : C.darkInk }}>
                  {over ? "Go" : mmss(left)}
                </div>
              </div>
              {!over && (
                <>
                  <button onClick={() => adj(-15)} className="tap px-2.5 py-2 text-xs font-semibold" style={{ border: `1px solid ${C.darkLine}`, borderRadius: R.field }} aria-label="15 seconden korter">
                    −15
                  </button>
                  <button onClick={() => adj(15)} className="tap px-2.5 py-2 text-xs font-semibold" style={{ border: `1px solid ${C.darkLine}`, borderRadius: R.field }} aria-label="15 seconden langer">
                    +15
                  </button>
                </>
              )}
              <button onClick={stop} className="tap px-3 py-2 text-xs font-semibold" style={{ background: "var(--accent)", color: "var(--on-accent)", borderRadius: R.field }}>
                {over ? "Sluiten" : "Overslaan"}
              </button>
            </div>
            <div className="mt-2" style={{ height: 4, background: "rgba(255,255,255,.12)", borderRadius: 2 }}>
              <div style={{ height: 4, width: `${pct}%`, background: over ? "var(--carb-fill)" : "var(--accent)", borderRadius: 2, transition: "width .25s linear" }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- live training ---------------- */

function ReadinessCard({ onSave, onSkip }) {
  const [r, setR] = useState({ sleep: null, energy: null, soreness: null });
  const rows = [
    ["sleep", "Slaap afgelopen nacht", ["Slecht", "Matig", "Goed"]],
    ["energy", "Energie", ["Laag", "Normaal", "Hoog"]],
    ["soreness", "Spierpijn", ["Veel", "Wat", "Geen"]],
  ];
  const ok = r.sleep && r.energy && r.soreness;
  return (
    <div className="mb-4 px-4 py-3" style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: R.card, boxShadow: C.shadow }}>
      <div className="disp text-lg font-bold uppercase leading-none mb-1">Hoe staat u ervoor?</div>
      <p className="text-xs mb-3" style={{ color: C.muted }}>
        Tien seconden. De app gebruikt dit om vermoeidheid te herkennen en stelt zo nodig een lichtere dag of een deload voor.
      </p>
      {rows.map(([k, label, opts]) => (
        <div key={k} className="mb-2.5">
          <div className="text-xs mb-1 font-medium">{label}</div>
          <div className="flex gap-1.5">
            {opts.map((o, i) => {
              const on = r[k] === i + 1;
              return (
                <button
                  key={o}
                  onClick={() => setR((x) => ({ ...x, [k]: i + 1 }))}
                  className="tap flex-1 py-2 text-sm"
                  style={{ background: on ? C.accent : C.surface2, color: on ? C.onAccent : C.ink, border: `1px solid ${on ? C.accent : C.line}`, borderRadius: R.field, fontWeight: 600 }}
                >
                  {o}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex gap-2 mt-3">
        <TBtn disabled={!ok} onClick={() => ok && onSave(r)}>
          Opslaan
        </TBtn>
        <TBtn kind="ghost" onClick={onSkip}>
          Overslaan
        </TBtn>
      </div>
    </div>
  );
}

function lastSummary(D, e) {
  const slot = { id: e.slotId, exId: e.exId };
  const h = historyFor(D.sessions, slot);
  if (!h.length) return null;
  const { s, e: x } = h[h.length - 1];
  const ws = workSets(x);
  const w = ws.length ? ws[0].weight : null;
  return {
    date: s.date,
    text: `${kgTxt(w)} kg × ${ws.map((y) => y.reps).join(", ")}`,
    rir: ws.map((y) => y.rir).filter((v) => v != null),
  };
}

function LiveWorkout({ T, setT, D, bw, onFinish }) {
  const a = T.active;
  const scale = T.settings.effort;
  const [picker, setPicker] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [open, setOpen] = useState(() => {
    const k = a.exercises.findIndex((e) => e.sets.some((s) => !s.done));
    return k < 0 ? 0 : k;
  });
  const [toast, setToast] = useState(null);
  const [noteOpen, setNoteOpen] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.long ? 4200 : 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const upd = (fn) => setT((t) => (t.active ? { ...t, active: fn(t.active) } : t));
  const updEx = (i, fn) => upd((x) => ({ ...x, exercises: x.exercises.map((e, k) => (k === i ? fn(e) : e)) }));
  const setField = (i, j, key, val) =>
    updEx(i, (e) => {
      const cur = e.sets[j];
      const firstWork = e.sets.findIndex((s) => s.type === "work");
      const inc = incFor(exOf(D.exIndex, e.exId), T.settings, num(val, 0));
      const sets = e.sets.map((s, k) => {
          if (k === j) return { ...s, [key]: val, ...(key === "weight" && s.type === "warmup" ? { pct: null } : {}), ...(key === "weight" && isSub(s) ? { manual: true } : {}) };
          // warming-ups rekenen mee met het eerste werkgewicht, tot u ze zelf aanpast
          if (key === "weight" && j === firstWork && s.type === "warmup" && !s.done && s.pct && num(val, 0) > 0)
            return { ...s, weight: Math.max(0, roundTo(num(val, 0) * s.pct, inc)) };
          // een nieuw gewicht op een werkset geldt ook voor de volgende werksets
          if (key === "weight" && k > j && !s.done && s.type === "work" && cur.type === "work" && s.weight === cur.weight) return { ...s, weight: val };
          return s;
        });
      return { ...e, sets: key === "weight" && e.tech ? syncSubs(sets, e.tech, inc) : sets };
    });

  const toggleDone = (i, j) => {
    primeAudio();
    const e = a.exercises[i];
    const s = e.sets[j];
    if (s.done) {
      updEx(i, (x) => ({ ...x, sets: x.sets.map((y, k) => (k === j ? { ...y, done: false } : y)) }));
      return;
    }
    const reps = num(s.reps, NaN);
    if (!(reps > 0)) {
      setToast({ text: "Vul eerst het aantal reps in." });
      return;
    }
    const name = exOf(D.exIndex, e.exId).name;
    if (s.type === "work") {
      const cur = e1rm(num(s.weight, 0) + (e.bwLoad || 0), reps, s.rir);
      const prev = Math.max(bestBefore(D.sessions, e.exId, Infinity), ...a.exercises.filter((x) => x.exId === e.exId).map((x) => bestE1rm(x)));
      if (prev > 0 && cur > prev + 0.05) setToast({ text: `Nieuw record: ${name}, e1RM ${kgTxt(Math.round(cur * 10) / 10)} kg`, pr: true, long: true });
    }
    /* myo-reps: haalt een mini-set het doel niet meer, dan vervallen de
       overige mini-sets van dat blok */
    let sets = e.sets.map((z, m) => (m === j ? { ...z, done: true, t: Date.now() } : z));
    let myoStop = false;
    if (s.type === "myo" && reps < MYO_MIN) {
      const rest = [];
      for (let m = j + 1; m < sets.length && sets[m].type === "myo"; m++) if (!sets[m].done) rest.push(m);
      if (rest.length) {
        sets = sets.filter((_, m) => !rest.includes(m));
        myoStop = true;
      }
    }
    const exs = a.exercises.map((y, k) => (k === i ? { ...y, sets } : y));
    const st = nextStep(exs, i, j);
    const nx = st.next ? exs[st.next.i] : null;
    const ns = nx ? nx.sets[st.next.j] : null;
    const gi = ssGroups(exs);
    const nm = (k) => `${exOf(D.exIndex, exs[k].exId).name}${gi[k].label ? ` (${gi[k].label})` : ""}`;
    const next = !ns
      ? null
      : isSub(ns)
      ? `${TECH[ns.type].label}, ${ns.type === "drop" ? `${kgTxt(ns.weight)} kg` : `mini-set ${ns.k}`}`
      : st.next.i === i
      ? `${name}, ${ns.type === "warmup" ? "warming-up" : "werkset"}`
      : `${nm(st.next.i)}${ns.type === "warmup" ? ", warming-up" : ""}`;
    upd((x) => ({
      ...x,
      exercises: x.exercises.map((y, k) => (k === i ? { ...y, sets } : y)),
      rest: !st.next || st.rest <= 0 ? null : { endsAt: Date.now() + st.rest * 1000, total: st.rest, next, kind: st.kind },
    }));
    if (st.next && st.next.i !== i) setOpen(st.next.i);
    if (!st.next) setToast({ text: "Alle sets gedaan. Rond de training af om hem op te slaan." });
    else if (myoStop) setToast({ text: `Myo-reps klaar: minder dan ${MYO_MIN} reps, de overige mini-sets vervallen.` });
    else if (st.rest <= 0 && next) setToast({ text: `Direct door: ${next}` });
  };

  const incOf = (e) => {
    const w = e.sets.find((s) => s.type === "work");
    return incFor(exOf(D.exIndex, e.exId), T.settings, w ? num(w.weight, 0) : 0);
  };
  const addSet = (i) => updEx(i, (e) => ({ ...e, sets: addWorkSet(e.sets, e.tech, incOf(e)) }));
  const removeSet = (i) => updEx(i, (e) => ({ ...e, sets: removeWorkSet(e.sets, e.tech, incOf(e)) }));
  const freeSlot = (ex, sets, warmups, rest) => ({
    id: "vrij_" + uid(),
    exId: ex.id,
    sets,
    warmups,
    repMin: ex.repMin,
    repMax: ex.repMax,
    rest: rest ?? (ex.kind === "compound" ? 180 : 120),
    rir: null,
  });
  const addEx = (ex) => {
    const n = D.pos.phase === "deload" ? 1 : 2;
    const entry = { ...entryFromSlot(freeSlot(ex, n, ex.kind === "compound" ? 2 : 1), n, D, T, bw), slotId: null };
    upd((x) => ({ ...x, exercises: [...x.exercises, entry] }));
    setOpen(a.exercises.length);
  };
  const swapEx = (i, ex) => {
    const e = a.exercises[i];
    const n = Math.max(1, e.sets.filter((s) => s.type === "work").length);
    const w = e.sets.filter((s) => s.type === "warmup").length;
    const entry = { ...entryFromSlot(freeSlot(ex, n, w, e.rest), n, D, T, bw), slotId: null, swappedFrom: e.exId, ss: e.ss, ssRest: e.ssRest };
    updEx(i, () => entry);
  };
  const moveEx = (i, d) =>
    upd((x) => {
      const j = i + d;
      if (j < 0 || j >= x.exercises.length) return x;
      const list = [...x.exercises];
      [list[i], list[j]] = [list[j], list[i]];
      return { ...x, exercises: list };
    });
  const acceptProposal = (i) =>
    updEx(i, (e) => {
      if (!e.proposal) return e;
      let k = -1;
      return {
        ...e,
        target: { ...e.target, weight: e.proposal.weight, reps: e.proposal.reps, change: e.proposal.change, why: e.proposal.why },
        proposal: null,
        sets: syncSubs(
          e.sets.map((s) => {
            if (s.type !== "work")
              return s.done || !(num(e.target.weight, 0) > 0) || !(num(s.weight, 0) > 0)
                ? s
                : { ...s, weight: roundTo(e.proposal.weight * (s.weight / e.target.weight), 0.5) };
            k++;
            return s.done ? s : { ...s, weight: e.proposal.weight, reps: e.proposal.reps[Math.min(k, e.proposal.reps.length - 1)] };
          }),
          e.tech,
          incOf(e)
        ),
      };
    });
  const lightDay = () =>
    upd((x) => ({
      ...x,
      light: true,
      lightAsked: true,
      exercises: x.exercises.map((e) => {
        const work = e.sets.filter((s) => s.type === "work");
        if (work.length <= 1) return e;
        if (!work.some((s) => !s.done)) return e;
        return { ...e, sets: removeWorkSet(e.sets, e.tech, incOf(e)) };
      }),
    }));

  const finish = () => {
    if (!a.exercises.some((e) => e.sets.some((s) => s.done))) {
      setConfirm("leeg");
      return;
    }
    const s = finishSession(a);
    setT((t) => ({ ...t, active: null, sessions: [...t.sessions, s].sort((x, y) => x.start - y.start) }));
    onFinish(s);
  };
  const discard = () => setT((t) => ({ ...t, active: null }));

  const liveGroups = ssGroups(a.exercises);
  const totalWork = sum(a.exercises.map((e) => e.sets.filter((s) => s.type === "work").length));
  const doneWork = sum(a.exercises.map((e) => e.sets.filter((s) => s.type === "work" && s.done).length));
  const anyDone = a.exercises.some((e) => e.sets.some((s) => s.done));
  const cols = { gridTemplateColumns: "30px minmax(0,1fr) minmax(0,.8fr) minmax(0,.95fr) 42px" };

  return (
    <div>
      {toast && (
        <div className="fixed left-0 right-0 flex justify-center px-4" style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)", zIndex: 70 }} role="status">
          <div
            className="hero-in px-4 py-2.5 text-sm font-semibold"
            style={{ background: toast.pr ? "var(--carb-fill)" : C.dark, color: toast.pr ? "#04140E" : C.darkInk, borderRadius: 12, boxShadow: C.shadow, maxWidth: 420 }}
          >
            {toast.text}
          </div>
        </div>
      )}

      <div className="hero-in relative overflow-hidden mb-4 px-4 pt-4 pb-4" style={{ background: C.dark, color: C.darkInk, borderRadius: 18, boxShadow: C.shadow }}>
        <div className="text-xs font-semibold" style={{ color: C.darkMuted }}>
          Training bezig · blok {a.blockNumber} · {BLOCK_LABEL[a.blockPhase] || "vrij"} · doel {effortLabel(a.deload ? 4 : D.pos.rir, scale)}
        </div>
        <div className="flex items-end justify-between gap-3 mt-1">
          <h2 className="disp text-3xl font-bold uppercase leading-none">{a.name}</h2>
          <div className="text-right shrink-0">
            <div className="disp text-2xl font-bold leading-none">
              <Elapsed start={a.start} />
            </div>
            <div className="text-xs tnum" style={{ color: C.darkMuted }}>
              {doneWork}/{totalWork} werksets
            </div>
          </div>
        </div>
        <div className="mt-3" style={{ height: 5, background: "rgba(255,255,255,.12)", borderRadius: 3 }}>
          <div className="bar-fill" style={{ height: 5, width: `${totalWork ? (doneWork / totalWork) * 100 : 0}%`, background: "var(--accent)", borderRadius: 3 }} />
        </div>
        {a.deload && (
          <p className="text-xs mt-2 leading-relaxed" style={{ color: C.darkMuted }}>
            Deload: de helft van de werksets, hetzelfde gewicht en ver van falen (RIR 4). Herstel is vandaag het doel.
          </p>
        )}
        {a.volumeCut && (
          <p className="text-xs mt-2 leading-relaxed" style={{ color: C.darkMuted }}>
            {TRAIN_PHASE.minicut.note}
          </p>
        )}
        {a.light && (
          <p className="text-xs mt-2 leading-relaxed" style={{ color: C.darkMuted }}>
            Lichtere dag: een werkset minder per oefening vanwege de lage herstelscore.
          </p>
        )}
      </div>

      {T.settings.readiness && !a.readiness && !anyDone && (
        <ReadinessCard onSave={(r) => upd((x) => ({ ...x, readiness: r }))} onSkip={() => upd((x) => ({ ...x, readiness: { skipped: true } }))} />
      )}
      {lowReadiness(a.readiness) && !a.lightAsked && (
        <div className="mb-4 px-4 py-3 relative overflow-hidden" style={{ background: C.warnBg, borderRadius: R.card }}>
          <span className="rail" style={{ background: C.warn }} />
          <div className="disp text-lg font-bold uppercase leading-none" style={{ color: C.warn }}>
            Lage herstelscore
          </div>
          <p className="text-xs mt-1 mb-2 leading-relaxed" style={{ color: C.warn }}>
            Train vandaag met een werkset minder per oefening. De gewichten blijven gelijk, zodat de prikkel blijft zonder extra vermoeidheid.
          </p>
          <div className="flex gap-2">
            <TBtn small onClick={lightDay}>
              Lichter trainen
            </TBtn>
            <TBtn small kind="ghost" onClick={() => upd((x) => ({ ...x, lightAsked: true }))}>
              Gewoon doorgaan
            </TBtn>
          </div>
        </div>
      )}

      {a.exercises.map((e, i) => {
        const ex = exOf(D.exIndex, e.exId);
        const isOpen = open === i;
        const g = liveGroups[i];
        const inGroup = g.g != null;
        const tech = normTech(e.tech);
        const work = e.sets.filter((s) => s.type === "work");
        const done = work.filter((s) => s.done).length;
        const complete = e.sets.length > 0 && e.sets.every((s) => s.done);
        const last = isOpen ? lastSummary(D, e) : null;
        let wn = 0;
        let un = 0;
        return (
          <React.Fragment key={e.id}>
          {inGroup && g.pos === 0 && (
            <div className="flex items-baseline justify-between gap-2 px-1 mb-1.5 text-xs">
              <span className="font-semibold" style={{ color: C.accent }}>
                {g.size === 2 ? "Superset" : "Giant set"} {g.label[0]}
              </span>
              <span className="tnum" style={{ color: C.muted }}>
                wissel {num(e.ssRest, 15)} s · rust {mmss(a.exercises[g.end].rest)} per ronde
              </span>
            </div>
          )}
          <div
            className={`${inGroup && g.pos < g.size - 1 ? "mb-1.5" : "mb-3"} overflow-hidden`}
            style={{ background: C.panel, border: `1px solid ${isOpen ? C.accent : C.line}`, borderLeft: inGroup ? `4px solid ${C.accent}` : undefined, borderRadius: R.card, boxShadow: C.shadow }}
          >
            <button onClick={() => setOpen(isOpen ? -1 : i)} className="tap w-full text-left px-4 py-3 flex items-center gap-3" aria-expanded={isOpen}>
              <span
                className="shrink-0 flex items-center justify-center disp font-bold text-sm"
                style={{ width: 28, height: 28, borderRadius: 14, background: complete ? "var(--carb-fill)" : C.surface2, color: complete ? "#04140E" : C.muted, border: `1px solid ${complete ? "var(--carb-fill)" : C.line}` }}
              >
                {complete ? "✓" : inGroup ? g.label : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-sm font-semibold block truncate">{ex.name}</span>
                <span className="text-xs block" style={{ color: C.muted }}>
                  {work.length} × {e.repMin}–{e.repMax} · {inGroup && g.pos < g.size - 1 ? `wissel ${num(e.ssRest, 15)} s` : `rust ${mmss(e.rest)}`}
                  {tech && <span style={{ color: C.accent, fontWeight: 600 }}> · {techShort(tech)}</span>}
                  {e.target && e.target.change && e.target.change !== "vorige" ? " · " : ""}
                  {e.target && e.target.change && e.target.change !== "vorige" && (
                    <span style={{ color: CHANGE_COLOR[e.target.change], fontWeight: 600 }}>{CHANGE_LABEL[e.target.change]}</span>
                  )}
                </span>
              </span>
              <span className="text-xs tnum shrink-0" style={{ color: complete ? C.carb : C.muted }}>
                {done}/{work.length}
              </span>
            </button>

            {isOpen && (
              <div className="px-4 pb-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
                <div className="pt-2 text-xs leading-relaxed" style={{ color: C.muted }}>
                  <span style={{ color: C.ink, fontWeight: 600 }}>
                    Doel: {e.target && e.target.weight != null ? `${kgTxt(e.target.weight)} kg${e.bwLoad ? " extra" : ""}` : "gewicht kiezen"} ·{" "}
                    {e.target && e.target.reps && e.target.reps.some((r) => r != null) ? `${e.target.reps.join(", ")} reps` : `${e.repMin}–${e.repMax} reps`} · {effortLabel(e.rir, scale)}
                  </span>
                  {e.target && e.target.why && <span className="block">{e.target.why}</span>}
                  {last && (
                    <span className="block mt-0.5">
                      Vorige keer ({fmtDay(dayNum(last.date))}): {last.text}
                      {last.rir.length ? ` · ${last.rir.map((r) => effortLabel(r, scale)).join(", ")}` : ""}
                    </span>
                  )}
                  {e.slotNote && <span className="block mt-0.5 italic">{e.slotNote}</span>}
                  {tech && <span className="block mt-0.5">{TECH[tech.type].hint}</span>}
                  {e.techOff && (
                    <span className="block mt-0.5">
                      Uw techniek vervalt vandaag: {e.techOff === "deload" ? "in een deload gaat het om herstel" : "in een minicut gaat het om behoud"}.
                    </span>
                  )}
                  {e.bwLoad > 0 && <span className="block mt-0.5">Lichaamsgewicht telt mee als {kgTxt(e.bwLoad)} kg; vul alleen extra gewicht in.</span>}
                </div>

                {e.proposal && (
                  <div className="mt-2 px-3 py-2 flex items-center gap-3" style={{ background: C.surface2, borderRadius: R.field, border: `1px solid ${C.lineSoft}` }}>
                    <div className="text-xs flex-1 leading-snug">
                      <strong style={{ color: CHANGE_COLOR[e.proposal.change] }}>
                        Voorstel: {kgTxt(e.proposal.weight)} kg × {e.proposal.reps.join(", ")}
                      </strong>
                      <span className="block" style={{ color: C.muted }}>
                        {e.proposal.why}
                      </span>
                    </div>
                    <TBtn small onClick={() => acceptProposal(i)}>
                      Overnemen
                    </TBtn>
                  </div>
                )}

                <div className="grid gap-1.5 mt-3 text-xs" style={{ ...cols, color: C.muted }}>
                  <span>Set</span>
                  <span className="text-center">{e.bwLoad ? "+kg" : "kg"}</span>
                  <span className="text-center">Reps</span>
                  <span className="text-center">{scale === "rpe" ? "RPE" : "RIR"}</span>
                  <span />
                </div>
                {e.sets.map((s, j) => {
                  const warm = s.type === "warmup";
                  const sub = isSub(s);
                  const label = warm ? `W${++un}` : sub ? (s.type === "partial" ? "½" : `${TECH[s.type].row}${s.k || 1}`) : `${++wn}`;
                  return (
                    <div
                      key={j}
                      className="grid items-center gap-1.5 py-1"
                      style={{ ...cols, background: s.done ? "rgba(0,195,137,.08)" : "transparent", borderRadius: 8 }}
                    >
                      <span className="disp text-sm font-bold text-center" style={{ color: warm ? C.muted : sub ? C.accent : C.ink }}>
                        {label}
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.5"
                        min="0"
                        value={s.weight ?? ""}
                        placeholder={warm ? "opw." : "kg"}
                        onChange={(ev) => setField(i, j, "weight", ev.target.value === "" ? null : Number(ev.target.value))}
                        className="w-full px-1 py-2 text-sm text-center tnum"
                        style={inputStyle}
                        aria-label={`Gewicht set ${label}`}
                      />
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        value={s.reps ?? ""}
                        placeholder={sub ? TECH[s.type].reps : `${e.repMin}-${e.repMax}`}
                        onChange={(ev) => setField(i, j, "reps", ev.target.value === "" ? null : Number(ev.target.value))}
                        className="w-full px-1 py-2 text-sm text-center tnum"
                        style={inputStyle}
                        aria-label={`Reps set ${label}`}
                      />
                      {warm ? (
                        <span className="text-xs text-center" style={{ color: C.muted }}>
                          opwarmen
                        </span>
                      ) : sub ? (
                        <span className="text-xs text-center leading-tight" style={{ color: C.muted }}>
                          {s.type === "drop" ? "direct" : s.type === "partial" ? "gerekt" : `na ${tech ? tech.pause : TECH[s.type].rest} s`}
                        </span>
                      ) : (
                        <EffortSelect value={s.rir} onChange={(v) => setField(i, j, "rir", v)} scale={scale} />
                      )}
                      <button
                        onClick={() => toggleDone(i, j)}
                        className="tap flex items-center justify-center"
                        style={{
                          height: 38,
                          borderRadius: R.field,
                          background: s.done ? "var(--carb-fill)" : C.surface2,
                          color: s.done ? "#04140E" : C.muted,
                          border: `1px solid ${s.done ? "var(--carb-fill)" : C.line}`,
                          fontWeight: 700,
                        }}
                        aria-label={s.done ? `Set ${label} ongedaan maken` : `Set ${label} afronden`}
                        aria-pressed={s.done}
                      >
                        ✓
                      </button>
                    </div>
                  );
                })}

                <div className="flex flex-wrap gap-1.5 mt-3">
                  <TBtn small kind="secondary" onClick={() => addSet(i)}>
                    + Set
                  </TBtn>
                  <TBtn small kind="secondary" onClick={() => removeSet(i)} disabled={!e.sets.length || e.sets[e.sets.length - 1].done}>
                    − Set
                  </TBtn>
                  <TBtn small kind="secondary" onClick={() => setPicker({ mode: "swap", i, muscle: ex.pri[0] || null })}>
                    Wisselen
                  </TBtn>
                  <TBtn small kind="secondary" onClick={() => setNoteOpen(noteOpen === i ? null : i)}>
                    Notitie
                  </TBtn>
                  <TBtn small kind="ghost" onClick={() => moveEx(i, -1)} disabled={i === 0} label="Omhoog">
                    ↑
                  </TBtn>
                  <TBtn small kind="ghost" onClick={() => moveEx(i, 1)} disabled={i === a.exercises.length - 1} label="Omlaag">
                    ↓
                  </TBtn>
                  <TBtn small kind="ghost" onClick={() => upd((x) => ({ ...x, exercises: x.exercises.filter((_, k) => k !== i) }))}>
                    Verwijderen
                  </TBtn>
                </div>
                {(noteOpen === i || e.note) && (
                  <textarea
                    value={e.note || ""}
                    onChange={(ev) => updEx(i, (x) => ({ ...x, note: ev.target.value }))}
                    placeholder="Notitie bij deze oefening, bijvoorbeeld stoelstand of techniekpunt"
                    rows={2}
                    className="w-full mt-2 px-3 py-2 text-sm"
                    style={inputStyle}
                  />
                )}
              </div>
            )}
          </div>
          </React.Fragment>
        );
      })}

      <div className="mb-4">
        <TBtn kind="secondary" full onClick={() => setPicker({ mode: "add" })}>
          + Oefening toevoegen
        </TBtn>
      </div>

      <textarea
        value={a.note || ""}
        onChange={(ev) => upd((x) => ({ ...x, note: ev.target.value }))}
        placeholder="Notitie bij deze training (optioneel)"
        rows={2}
        className="w-full mb-4 px-3 py-2 text-sm"
        style={inputStyle}
      />

      {confirm === "leeg" ? (
        <div className="mb-4 px-4 py-3" style={{ background: C.warnBg, borderRadius: R.card }}>
          <p className="text-sm mb-2" style={{ color: C.warn }}>
            Er is nog geen set afgerond. Training weggooien?
          </p>
          <div className="flex gap-2">
            <TBtn kind="danger" small onClick={discard}>
              Weggooien
            </TBtn>
            <TBtn kind="ghost" small onClick={() => setConfirm(null)}>
              Doorgaan met trainen
            </TBtn>
          </div>
        </div>
      ) : confirm === "stop" ? (
        <div className="mb-4 px-4 py-3" style={{ background: C.warnBg, borderRadius: R.card }}>
          <p className="text-sm mb-2" style={{ color: C.warn }}>
            Deze training stoppen zonder op te slaan? Alle ingevoerde sets gaan verloren.
          </p>
          <div className="flex gap-2">
            <TBtn kind="danger" small onClick={discard}>
              Stoppen zonder opslaan
            </TBtn>
            <TBtn kind="ghost" small onClick={() => setConfirm(null)}>
              Annuleren
            </TBtn>
          </div>
        </div>
      ) : null}

      <TBtn full onClick={finish} className="disp text-xl uppercase">
        Training afronden
      </TBtn>
      <div className="text-center mt-3 mb-2">
        <button onClick={() => setConfirm("stop")} className="tap text-xs underline" style={{ color: C.muted }}>
          Stoppen zonder opslaan
        </button>
      </div>

      {picker && (
        <ExercisePicker
          exIndex={D.exIndex}
          title={picker.mode === "swap" ? "Oefening wisselen" : "Oefening toevoegen"}
          muscle={picker.muscle || null}
          onClose={() => setPicker(null)}
          onCreate={(ex) => setT((t) => ({ ...t, customEx: [...t.customEx, ex] }))}
          onUpdate={(ex) => setT((t) => updateCustomEx(t, ex))}
          onPick={(ex) => {
            if (picker.mode === "swap") swapEx(picker.i, ex);
            else addEx(ex);
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}

/* ---------------- overzicht, schema, inzichten, logboek ---------------- */

function syncNutritionWeek(week, program) {
  return week.map((d, i) => {
    const day = program.days.find((x) => x.id === program.weekMap[i]);
    if (!day) return { ...d, session: null };
    return {
      ...d,
      session: { type: (d.session && d.session.type) || "volume", start: (d.session && d.session.start) || "18:00", minutes: estMinutes(day) },
    };
  });
}
const weekMismatch = (week, program) =>
  program && program.mode === "week"
    ? week.reduce((n, d, i) => n + (Boolean(d.session) !== Boolean(program.days.find((x) => x.id === program.weekMap[i])) ? 1 : 0), 0)
    : 0;

function downloadJSON(name, data) {
  try {
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = name;
    document.body.appendChild(el);
    el.click();
    el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch (e) {
    return false;
  }
}

const dayInitials = (name) => {
  const w = String(name).trim().split(/[\s/]+/).filter(Boolean);
  return (w.length > 1 ? w.slice(0, 2).map((x) => x[0]).join("") : String(name).slice(0, 2)).toUpperCase();
};
const fmtKgTotal = (v) => `${Math.round(v).toLocaleString("nl-NL")} kg`;
const weekdayNL = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });

function Stat({ label, value, sub }) {
  return (
    <div className="px-3 py-2.5" style={{ background: C.surface2, borderRadius: R.field, border: `1px solid ${C.lineSoft}` }}>
      <div className="text-xs" style={{ color: C.muted }}>
        {label}
      </div>
      <div className="disp text-2xl font-bold tnum leading-tight">{value}</div>
      {sub && (
        <div className="text-xs" style={{ color: C.muted }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function TargetRow({ slot, tg, T, onAccept, accepted }) {
  const show = tg.source === "auto" || tg.source === "handmatig" ? tg.use : tg.prop;
  const reps = (show.reps || []).filter((r) => r != null);
  return (
    <div className="px-4 py-2.5" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{tg.ex.name}</span>
        <span className="text-xs font-semibold shrink-0" style={{ color: CHANGE_COLOR[tg.prop.change] }}>
          {CHANGE_LABEL[tg.prop.change]}
        </span>
      </div>
      <div className="text-xs tnum mt-0.5" style={{ color: C.ink }}>
        {show.weight != null ? `${kgTxt(show.weight)} kg` : "gewicht kiezen"}
        {reps.length ? ` × ${reps.join(", ")}` : ` × ${slot.repMin}–${slot.repMax}`}
        {tg.prop.last ? (
          <span style={{ color: C.muted }}>
            {" "}
            · vorige keer {kgTxt(tg.prop.last.weight)} × {tg.prop.last.reps.join(", ")}
          </span>
        ) : null}
      </div>
      <p className="text-xs mt-0.5 leading-snug" style={{ color: C.muted }}>
        {tg.prop.why}
      </p>
      {onAccept && tg.pending && (
        <div className="mt-1.5">
          <TBtn small onClick={onAccept}>
            Overnemen
          </TBtn>
        </div>
      )}
      {accepted && (
        <p className="text-xs mt-1 font-semibold" style={{ color: C.carb }}>
          Overgenomen voor de volgende keer
        </p>
      )}
    </div>
  );
}

function SessionSummary({ s, D, T, setT, onClose }) {
  const st = sessionStats(s);
  const prs = sessionPRs(s, D.sessions);
  const day = D.program && D.program.days.find((d) => d.id === s.dayId);
  const nexts = day ? day.slots.map((slot) => ({ slot, tg: targetFor(slot, D, T) })).filter((x) => x.tg.prop.last) : [];
  const accept = (slot, tg) =>
    setT((t) => ({ ...t, overrides: { ...t.overrides, [slot.id]: { weight: tg.prop.weight, reps: tg.prop.reps, basis: tg.lastId } } }));
  return (
    <Sheet title="Training opgeslagen" onClose={onClose}>
      <div className="disp text-2xl font-bold uppercase leading-none mb-3">{s.name}</div>
      <div className="grid grid-cols-2 gap-2 mb-4">
        <Stat label="Duur" value={`${st.min} min`} />
        <Stat label="Werksets" value={st.sets} />
        <Stat label="Volume" value={fmtKgTotal(st.ton)} sub="gewicht × reps, zonder warming-ups" />
        <Stat label="Reps" value={st.reps} />
      </div>
      {prs.length > 0 && (
        <div className="mb-4 px-3 py-2.5" style={{ background: "rgba(0,195,137,.12)", borderRadius: R.field }}>
          <div className="text-sm font-semibold mb-1" style={{ color: C.carb }}>
            {prs.length === 1 ? "Nieuw record" : `${prs.length} nieuwe records`}
          </div>
          {prs.map((p) => (
            <div key={p.exId} className="text-xs tnum">
              {exOf(D.exIndex, p.exId).name}: e1RM {kgTxt(Math.round(p.e1 * 10) / 10)} kg (was {kgTxt(Math.round(p.prev * 10) / 10)})
            </div>
          ))}
        </div>
      )}
      {nexts.length > 0 && (
        <>
          <div className="text-sm font-semibold mb-1">Volgende keer</div>
          <p className="text-xs mb-2" style={{ color: C.muted }}>
            {T.settings.autoProgress
              ? "Automatische progressie staat aan: deze doelen staan klaar bij de volgende training."
              : "Voorstelmodus: neem over wat u wilt. Wat u niet overneemt, blijft gelijk aan vandaag."}
          </p>
          <div className="-mx-4 mb-4" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
            {nexts.map(({ slot, tg }) => (
              <TargetRow
                key={slot.id}
                slot={slot}
                tg={tg}
                T={T}
                onAccept={T.settings.autoProgress ? null : () => accept(slot, tg)}
                accepted={tg.source === "handmatig"}
              />
            ))}
          </div>
        </>
      )}
      <TBtn full onClick={onClose}>
        Klaar
      </TBtn>
    </Sheet>
  );
}

function TemplateStarter({ T, setT, D, week, setWeek, onDone }) {
  const [tpl, setTpl] = useState("ul");
  const [mode, setMode] = useState("week");
  const [sets, setSets] = useState(2);
  const [sync, setSync] = useState(true);
  const create = () => {
    const t = TEMPLATES.find((x) => x.id === tpl);
    const p = programFromTemplate(t, { mode, sets, exIndex: D.exIndex });
    setT((s) => ({ ...s, programs: [...s.programs, p], activeProgramId: p.id }));
    if (mode === "week" && sync) setWeek(syncNutritionWeek(week, p));
    onDone && onDone(p);
  };
  return (
    <Section title="Kies een startschema" sub="Alle sjablonen volgen dezelfde uitgangspunten: twee werksets tot RIR 0-1, veel oefeningen die de spier onder rek belasten, en ongeveer 40/60 compound/isolatie. Alles is daarna aan te passen.">
      <div className="px-4 py-3 space-y-2" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
        {TEMPLATES.map((t) => {
          const on = tpl === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTpl(t.id)}
              className="tap w-full text-left px-3 py-2.5"
              style={{ border: `1.5px solid ${on ? C.accent : C.line}`, borderRadius: R.field, background: on ? "var(--accent-soft)" : C.surface2 }}
              aria-pressed={on}
            >
              <div className="text-sm font-semibold">{t.name}</div>
              <div className="text-xs mt-0.5" style={{ color: C.muted }}>
                {t.sub}
              </div>
              <div className="text-xs mt-1" style={{ color: C.muted }}>
                {t.days.map(([n]) => n).join(" · ")}
              </div>
            </button>
          );
        })}
      </div>
      <Row label="Indeling" hint={mode === "week" ? "Elke weekdag een vaste training." : "Trainingen schuiven door; een gemiste dag schuift gewoon op."}>
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            { value: "week", label: "Weekdagen" },
            { value: "rotation", label: "Rotatie" },
          ]}
        />
      </Row>
      <Row label="Werksets per oefening" hint="Twee sets van topkwaliteit is het uitgangspunt. Drie geeft meer volume.">
        <Seg
          value={sets}
          onChange={setSets}
          options={[
            { value: 2, label: "2" },
            { value: 3, label: "3" },
          ]}
        />
      </Row>
      {mode === "week" && (
        <Row label="Voeding afstemmen" hint="Zet de trainingsdagen in uw voedingsweek op dezelfde dagen, met de geschatte duur.">
          <Seg
            value={sync}
            onChange={setSync}
            options={[
              { value: true, label: "Ja" },
              { value: false, label: "Nee" },
            ]}
          />
        </Row>
      )}
      <div className="px-4 py-3 flex flex-wrap gap-2 items-center">
        <TBtn onClick={create}>Schema aanmaken</TBtn>
        <button
          onClick={() => {
            const p = emptyProgram();
            setT((s) => ({ ...s, programs: [...s.programs, p], activeProgramId: p.id }));
            onDone && onDone(p, true);
          }}
          className="tap text-sm underline"
          style={{ color: C.muted }}
        >
          of begin met een leeg schema
        </button>
      </div>
    </Section>
  );
}

function BlockBar({ pos }) {
  const segs = [...Array(pos.acc).fill("opbouw"), ...Array(pos.int).fill("intensivering"), ...Array(pos.dl).fill("deload")];
  return (
    <div className="flex gap-1" style={{ height: 8 }}>
      {segs.map((p, k) => {
        const here = !pos.forced && k === pos.week;
        const past = !pos.forced && k < pos.week;
        return (
          <span
            key={k}
            className="flex-1"
            style={{ background: BLOCK_COLOR[p], opacity: here ? 1 : past ? 0.35 : 0.6, borderRadius: 4, boxShadow: here ? "0 0 0 2px rgba(255,255,255,.85)" : "none" }}
            title={`Week ${k + 1}: ${BLOCK_LABEL[p]}`}
          />
        );
      })}
    </div>
  );
}

function TrainOverview({ T, setT, D, week, setWeek, onStart, go }) {
  const [other, setOther] = useState("");
  const scale = T.settings.effort;
  const program = D.program;
  const plan = D.plan;
  if (!program) return <TemplateStarter T={T} setT={setT} D={D} week={week} setWeek={setWeek} onDone={(p, empty) => empty && go("schema")} />;

  const pos = D.pos;
  const nextDay = plan ? plan.day || plan.next : null;
  const targets = nextDay ? nextDay.slots.map((slot) => ({ slot, tg: targetFor(slot, D, T) })) : [];
  const pending = targets.filter((x) => x.tg.pending);
  const acceptAll = () =>
    setT((t) => {
      const ov = { ...t.overrides };
      pending.forEach(({ slot, tg }) => {
        ov[slot.id] = { weight: tg.prop.weight, reps: tg.prop.reps, basis: tg.lastId };
      });
      return { ...t, overrides: ov };
    });
  const acceptOne = (slot, tg) => setT((t) => ({ ...t, overrides: { ...t.overrides, [slot.id]: { weight: tg.prop.weight, reps: tg.prop.reps, basis: tg.lastId } } }));

  const today = dayNum(D.today);
  const mon = today - wdOfNum(today);
  const weekDays = [...Array(7)].map((_, k) => {
    const n = mon + k;
    const iso = isoOfNum(n);
    const done = D.sessions.filter((s) => s.date === iso && s.end);
    const plannedDay = program.mode === "week" ? program.days.find((d) => d.id === program.weekMap[k]) : null;
    return { n, iso, done, plannedDay };
  });
  const doneWeek = weekDays.reduce((a, d) => a + d.done.length, 0);
  const plannedWeek = Math.round(sessionsPerWeek(program));
  const weekSessions = weekDays.flatMap((d) => d.done);
  const weekStats = weekSessions.reduce((acc, s) => {
    const st = sessionStats(s);
    return { sets: acc.sets + st.sets, ton: acc.ton + st.ton };
  }, { sets: 0, ton: 0 });
  const recentPRs = D.sessions
    .filter((s) => s.end && dayNum(s.date) >= today - 30)
    .flatMap((s) => sessionPRs(s, D.sessions).map((p) => ({ ...p, date: s.date })))
    .reverse()
    .slice(0, 5);

  const startDay = (day) => onStart(day, program.mode === "rotation" ? rotPosFor(program, day.id, plan && plan.rotPos != null ? plan.rotPos : 0) : null);

  return (
    <>
      <div className="hero-in relative overflow-hidden mb-6 px-4 pt-4 pb-4" style={{ background: C.dark, color: C.darkInk, borderRadius: 18, boxShadow: C.shadow }}>
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <span className="text-xs font-semibold" style={{ color: C.darkMuted }}>
            {pos.forced ? `Ingelaste deload · nog ${pos.daysLeft} ${pos.daysLeft === 1 ? "dag" : "dagen"}` : `Blok ${pos.number} · week ${pos.week + 1} van ${pos.len}`}
          </span>
          <span className="text-xs" style={{ color: C.darkMuted }}>
            {program.name}
          </span>
        </div>
        <BlockBar pos={pos} />
        <div className="flex items-baseline justify-between gap-3 mt-3">
          <span className="disp text-3xl font-bold uppercase leading-none">{BLOCK_LABEL[pos.phase]}</span>
          <span className="disp text-xl font-bold uppercase leading-none shrink-0" style={{ color: C.darkMuted }}>
            doel {effortLabel(pos.rir, scale)}
          </span>
        </div>
        <p className="text-xs mt-1.5 leading-relaxed" style={{ color: C.darkMuted }}>
          {pos.phase === "opbouw"
            ? "Opbouw: werksets met een of twee reps in reserve, elke sessie een rep of wat gewicht erbij."
            : pos.phase === "intensivering"
            ? "Intensivering: werksets tot RIR 1, de laatste week tot falen. Hier worden de records gezet."
            : "Deload: halve werksets, zelfde gewicht, ver van falen. Vermoeidheid zakt weg zodat het volgende blok hoger begint."}
        </p>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: C.darkMuted }}>
          Voeding: <strong style={{ color: C.darkInk }}>{D.tp.label}</strong>
          {D.tp.vf < 1 ? (D.phaseOn ? " · volume een derde omlaag, gewichten vasthouden" : " · aanpassing wacht op uw akkoord") : ""}
        </p>

        <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${C.darkLine}` }}>
          {plan && plan.day && !plan.doneToday ? (
            <>
              <div className="text-xs" style={{ color: C.darkMuted }}>
                Vandaag
              </div>
              <div className="disp text-2xl font-bold uppercase leading-none">{plan.day.name}</div>
              <div className="text-xs mt-1 tnum" style={{ color: C.darkMuted }}>
                {plan.day.slots.length} oefeningen · {sum(plannedSetsFor(plan.day, D))} werksets · ± {estMinutes(plan.day)} min
              </div>
              <button
                onClick={() => onStart(plan.day, plan.rotPos)}
                className="tap w-full mt-3 py-3 disp text-xl font-bold uppercase"
                style={{ background: "var(--accent)", color: "var(--on-accent)", borderRadius: R.field }}
              >
                Start training
              </button>
            </>
          ) : (
            <>
              <div className="text-xs" style={{ color: C.darkMuted }}>
                Vandaag
              </div>
              <div className="disp text-2xl font-bold uppercase leading-none">{plan && plan.doneToday ? "Training gedaan" : "Rustdag"}</div>
              <div className="text-xs mt-1" style={{ color: C.darkMuted }}>
                {plan && plan.next ? `Volgende: ${plan.next.name}` : "Herstel is waar de groei gebeurt."}
              </div>
              {plan && plan.next && (
                <button
                  onClick={() => onStart(plan.next, plan.rotPos)}
                  className="tap mt-3 px-3 py-2 text-sm font-semibold"
                  style={{ border: `1px solid ${C.darkLine}`, borderRadius: R.field, color: C.darkInk }}
                >
                  Toch trainen: {plan.next.name}
                </button>
              )}
            </>
          )}
          <div className="mt-3 flex items-center gap-2">
            <select
              value={other}
              onChange={(e) => {
                const v = e.target.value;
                setOther("");
                if (v === "__vrij") onStart(null, null);
                else {
                  const d = program.days.find((x) => x.id === v);
                  if (d) startDay(d);
                }
              }}
              className="flex-1 px-2 py-2 text-sm"
              style={{ background: "rgba(255,255,255,.07)", border: `1px solid ${C.darkLine}`, borderRadius: R.field, color: C.darkInk }}
              aria-label="Andere training starten"
            >
              <option value="">Andere training starten…</option>
              {program.days.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
              <option value="__vrij">Lege training</option>
            </select>
          </div>
        </div>
      </div>

      {D.fatigue && !T.block.deloadFrom && !T.settings.autoProgress && (
        <div className="mb-6 px-4 py-3 relative overflow-hidden" style={{ background: C.warnBg, borderRadius: R.card }}>
          <span className="rail" style={{ background: C.train }} />
          <div className="disp text-xl font-bold uppercase leading-none" style={{ color: C.train }}>
            Tijd voor een deload?
          </div>
          {D.fatigue.reasons.map((r, k) => (
            <p key={k} className="text-xs mt-1 leading-relaxed" style={{ color: C.warn }}>
              {r}
            </p>
          ))}
          <p className="text-xs mt-1 leading-relaxed" style={{ color: C.warn }}>
            Een week met halve werksets en ver van falen laat de vermoeidheid zakken. Daarna begint een nieuw blok.
          </p>
          <div className="flex gap-2 mt-2">
            <TBtn small kind="danger" onClick={() => setT((t) => ({ ...t, block: { ...t.block, deloadFrom: D.today, auto: null } }))}>
              Deload starten
            </TBtn>
            <TBtn small kind="ghost" onClick={() => setT((t) => ({ ...t, block: { ...t.block, dismissedAt: D.today } }))}>
              Nog niet
            </TBtn>
          </div>
        </div>
      )}
      {T.block.auto && pos.forced && (
        <div className="mb-6 px-4 py-3 relative overflow-hidden" style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: R.card }}>
          <span className="rail" style={{ background: BLOCK_COLOR.deload }} />
          <div className="disp text-lg font-bold uppercase leading-none">Deload automatisch ingelast</div>
          {(T.block.auto.reasons || []).map((r, k) => (
            <p key={k} className="text-xs mt-1 leading-relaxed" style={{ color: C.muted }}>
              {r}
            </p>
          ))}
          <div className="mt-2">
            <TBtn small kind="ghost" onClick={() => setT((t) => ({ ...t, block: { ...t.block, deloadFrom: null, auto: null, dismissedAt: D.today } }))}>
              Ongedaan maken
            </TBtn>
          </div>
        </div>
      )}
      {D.tp.vf < 1 && !D.phaseOn && (
        <div className="mb-6 px-4 py-3 relative overflow-hidden" style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: R.card }}>
          <span className="rail" style={{ background: "var(--fat-fill)" }} />
          <div className="disp text-lg font-bold uppercase leading-none">{D.tp.label} actief in uw voeding</div>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: C.muted }}>
            {D.tp.note}
          </p>
          <div className="mt-2">
            <TBtn small onClick={() => setT((t) => ({ ...t, phaseAccept: D.phase }))}>
              Toepassen op mijn training
            </TBtn>
          </div>
        </div>
      )}
      {D.tp.vf < 1 && D.phaseOn && !T.settings.autoProgress && T.phaseAccept === D.phase && (
        <p className="text-xs mb-6 -mt-3" style={{ color: C.muted }}>
          {D.tp.label}-aanpassing staat aan.{" "}
          <button className="underline" onClick={() => setT((t) => ({ ...t, phaseAccept: null }))}>
            Terugdraaien
          </button>
        </p>
      )}

      {nextDay && targets.some((x) => x.tg.prop.last) && (
        <Section
          title={`Doelen: ${nextDay.name}`}
          sub={
            T.settings.autoProgress
              ? "Automatische progressie: deze doelen staan klaar voor de volgende keer."
              : "Voorstelmodus: de app stelt voor, u beslist. Zonder akkoord blijft het doel gelijk aan de vorige keer."
          }
        >
          {!T.settings.autoProgress && pending.length > 1 && (
            <div className="px-4 py-2.5 flex items-center justify-between gap-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
              <span className="text-xs" style={{ color: C.muted }}>
                {pending.length} voorstellen open
              </span>
              <TBtn small onClick={acceptAll}>
                Alles overnemen
              </TBtn>
            </div>
          )}
          {targets
            .filter((x) => x.tg.prop.last)
            .map(({ slot, tg }) => (
              <TargetRow key={slot.id} slot={slot} tg={tg} T={T} onAccept={T.settings.autoProgress ? null : () => acceptOne(slot, tg)} accepted={tg.source === "handmatig"} />
            ))}
        </Section>
      )}

      <Section title="Deze week" sub={`${doneWeek} van ${plannedWeek} ${plannedWeek === 1 ? "training" : "trainingen"} gedaan · ${weekStats.sets} werksets · ${fmtKgTotal(weekStats.ton)} volume`}>
        <div className="px-3 py-3 grid grid-cols-7 gap-1">
          {weekDays.map((d, k) => {
            const isToday = d.n === today;
            const done = d.done.length > 0;
            return (
              <div key={k} className="flex flex-col items-center gap-1">
                <span className="text-xs uppercase disp" style={{ color: isToday ? C.accent : C.muted, fontWeight: isToday ? 700 : 500 }}>
                  {DAYS[k]}
                </span>
                <span
                  className="flex items-center justify-center text-xs font-bold"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    background: done ? "var(--carb-fill)" : d.plannedDay ? C.surface2 : "transparent",
                    color: done ? "#04140E" : C.muted,
                    border: `1.5px ${d.plannedDay && !done ? "solid" : "dashed"} ${isToday ? C.accent : done ? "var(--carb-fill)" : C.line}`,
                  }}
                  title={done ? d.done.map((s) => s.name).join(", ") : d.plannedDay ? d.plannedDay.name : "Rust"}
                >
                  {done ? "✓" : d.plannedDay ? dayInitials(d.plannedDay.name) : ""}
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      {recentPRs.length > 0 && (
        <Section title="Recente records" accent={C.carb} sub="Hoogste geschatte 1RM per oefening, gecorrigeerd voor reps in reserve.">
          {recentPRs.map((p, k) => (
            <div key={k} className="px-4 py-2.5 flex items-baseline justify-between gap-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
              <span className="text-sm">{exOf(D.exIndex, p.exId).name}</span>
              <span className="text-xs tnum shrink-0" style={{ color: C.muted }}>
                <strong style={{ color: C.carb }}>{kgTxt(Math.round(p.e1 * 10) / 10)} kg</strong> · {fmtDay(dayNum(p.date))}
              </span>
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

/* Verplaatsen of verwijderen haalt een oefening uit haar superset, zodat
   er nooit ongemerkt een andere oefening aan vast komt te hangen. */
function unlinkAt(slots, idx) {
  return slots.map((x, k) => (k === idx || (k === idx - 1 && x.ss) ? { ...x, ss: false } : x));
}

function SlotEditor({ slot, ex, nextEx, group, day, idx, n, T, D, setT, updSlot, updDay, onSwap, onEditEx }) {
  const [open, setOpen] = useState(false);
  const hasHist = historyFor(D.sessions, slot).length > 0;
  const edit = (T.exEdits && T.exEdits[ex.id]) || {};
  const tech = normTech(slot.tech);
  const kind = slot.ss && nextEx ? ssKind(ex, nextEx) : null;
  const setTech = (patch) =>
    updSlot(day.id, slot.id, {
      tech: !patch ? null : patch.type ? (tech && tech.type === patch.type ? tech : normTech({ type: patch.type })) : normTech({ ...tech, ...patch }),
    });
  const move = (d) =>
    updDay(day.id, (x) => {
      const j = idx + d;
      if (j < 0 || j >= x.slots.length) return x;
      const s = unlinkAt(x.slots, idx);
      [s[idx], s[j]] = [s[j], s[idx]];
      return { ...x, slots: s };
    });
  const inGroup = group && group.g != null;
  return (
    <div style={{ borderBottom: `1px solid ${C.lineSoft}`, borderLeft: inGroup ? `4px solid ${C.accent}` : undefined }}>
      <button onClick={() => setOpen(!open)} className="tap w-full text-left px-4 py-2.5 flex items-center gap-3" aria-expanded={open}>
        <span className="disp text-sm font-bold shrink-0 text-center" style={{ width: 18, color: inGroup ? C.accent : C.muted }}>
          {inGroup ? group.label : idx + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-sm font-semibold block">
            {ex.name} <ExBadges ex={ex} />
          </span>
          <span className="text-xs block tnum" style={{ color: C.muted }}>
            {slot.sets} × {slot.repMin}–{slot.repMax} · {slot.warmups} opw. · {slot.ss && idx < n - 1 ? `wissel ${num(slot.ssRest, 15)} s` : `rust ${mmss(slot.rest)}`} ·{" "}
            {slot.rir != null && slot.rir !== "" ? effortLabel(slot.rir, T.settings.effort) : "RIR volgens blok"}
            {tech && <span style={{ color: C.accent, fontWeight: 600 }}> · {techShort(tech)}</span>}
          </span>
        </span>
        <span className="text-xs shrink-0" style={{ color: C.accent }}>
          {open ? "Klaar" : "Wijzig"}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-2.5">
          <div className="grid grid-cols-3 gap-x-3 gap-y-2">
            <label className="block">
              <span className="text-xs block mb-1" style={{ color: C.muted }}>
                Werksets
              </span>
              <Num value={slot.sets} onChange={(v) => updSlot(day.id, slot.id, { sets: clamp(num(v, 2), 1, 8) })} min={1} max={8} />
            </label>
            <label className="block">
              <span className="text-xs block mb-1" style={{ color: C.muted }}>
                Warming-ups
              </span>
              <Num value={slot.warmups} onChange={(v) => updSlot(day.id, slot.id, { warmups: clamp(num(v, 0), 0, 3) })} min={0} max={3} />
            </label>
            <label className="block">
              <span className="text-xs block mb-1" style={{ color: C.muted }}>
                Reps vanaf
              </span>
              <Num value={slot.repMin} onChange={(v) => updSlot(day.id, slot.id, { repMin: clamp(num(v, 1), 1, 50) })} min={1} max={50} />
            </label>
            <label className="block">
              <span className="text-xs block mb-1" style={{ color: C.muted }}>
                Reps tot
              </span>
              <Num value={slot.repMax} onChange={(v) => updSlot(day.id, slot.id, { repMax: clamp(num(v, 1), 1, 60) })} min={1} max={60} />
            </label>
            <label className="block">
              <span className="text-xs block mb-1" style={{ color: C.muted }}>
                Rust (sec)
              </span>
              <Num value={slot.rest} step={15} onChange={(v) => updSlot(day.id, slot.id, { rest: clamp(num(v, 120), 15, 600) })} min={15} max={600} />
            </label>
            <label className="block">
              <span className="text-xs block mb-1" style={{ color: C.muted }}>
                Stap (kg)
              </span>
              <Num
                value={edit.inc ?? ""}
                step={0.5}
                onChange={(v) =>
                  setT((t) => ({ ...t, exEdits: { ...t.exEdits, [ex.id]: { ...((t.exEdits || {})[ex.id] || {}), inc: v === "" ? null : Math.max(0.25, num(v, 2.5)) } } }))
                }
                min={0.25}
                max={20}
              />
            </label>
          </div>
          <p className="text-xs" style={{ color: C.muted }}>
            Stap leeg = standaard voor {EQUIP[ex.equip] ? EQUIP[ex.equip].label.toLowerCase() : "dit materiaal"} ({kgTxt(incFor({ ...ex, inc: null }, T.settings, 0))} kg).
          </p>
          <label className="block text-sm">
            <span className="text-xs" style={{ color: C.muted }}>
              Inspanning op werksets
            </span>
            <Pick
              value={slot.rir == null ? "" : String(slot.rir)}
              onChange={(v) => updSlot(day.id, slot.id, { rir: v === "" ? null : Number(v) })}
              options={[{ id: "", label: "Volgens blok (aanbevolen)" }, ...[0, 1, 2, 3, 4].map((r) => ({ id: String(r), label: effortLabel(r, T.settings.effort) + (r === 0 ? ", tot falen" : "") }))]}
            />
          </label>
          {!hasHist && (
            <label className="flex items-center justify-between gap-2 text-sm">
              Startgewicht (kg)
              <Num value={slot.startWeight ?? ""} step={0.5} onChange={(v) => updSlot(day.id, slot.id, { startWeight: v === "" ? null : v })} min={0} />
            </label>
          )}
          <div className="pt-1" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
            <span className="text-xs block mb-1 mt-1.5" style={{ color: C.muted }}>
              Techniek
            </span>
            <Pick
              value={tech ? tech.type : ""}
              onChange={(v) => setTech(v ? { type: v } : null)}
              options={[{ id: "", label: "Normaal" }, ...Object.entries(TECH).map(([id, t]) => ({ id, label: t.label }))]}
            />
            {tech && (
              <div className="mt-2 space-y-2">
                <p className="text-xs leading-relaxed" style={{ color: C.muted }}>
                  {TECH[tech.type].hint}
                </p>
                <div className="grid grid-cols-3 gap-x-3 gap-y-2">
                  {TECH[tech.type].n[1] > 1 && (
                    <label className="block">
                      <span className="text-xs block mb-1" style={{ color: C.muted }}>
                        {tech.type === "drop" ? "Drops" : tech.type === "rp" ? "Pauzes" : "Max. mini-sets"}
                      </span>
                      <Num value={tech.n} onChange={(v) => setTech({ n: v })} min={TECH[tech.type].n[0]} max={TECH[tech.type].n[1]} />
                    </label>
                  )}
                  {tech.type === "drop" && (
                    <label className="block">
                      <span className="text-xs block mb-1" style={{ color: C.muted }}>
                        Minder per drop
                      </span>
                      <Pick value={String(tech.pct)} onChange={(v) => setTech({ pct: Number(v) })} options={[15, 20, 25, 30].map((x) => ({ id: String(x), label: `${x}%` }))} />
                    </label>
                  )}
                  {(tech.type === "rp" || tech.type === "myo") && (
                    <label className="block">
                      <span className="text-xs block mb-1" style={{ color: C.muted }}>
                        Pauze (sec)
                      </span>
                      <Num value={tech.pause} step={5} onChange={(v) => setTech({ pause: v })} min={5} max={60} />
                    </label>
                  )}
                </div>
                {tech.type !== "myo" && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={tech.all} onChange={(e) => setTech({ all: e.target.checked })} />
                    Op elke werkset (standaard alleen de laatste)
                  </label>
                )}
                {heavyFree(ex) && (
                  <p className="text-xs leading-relaxed" style={{ color: C.warn }}>
                    Let op: tot falen met snel gewicht wisselen is bij een zware oefening met de stang riskant. Kies deze techniek liever bij een machine, kabel of
                    isolatieoefening.
                  </p>
                )}
                {tech.type === "myo" && num(slot.repMin, 0) < 12 && (
                  <p className="text-xs leading-relaxed" style={{ color: C.warn }}>
                    Kies voor myo-reps een range van ongeveer 12 tot 20 reps voor de activatieset.
                  </p>
                )}
                <p className="text-xs" style={{ color: C.muted }}>
                  Vervalt automatisch in een deload en een minicut. Telt per extra drop of mini-set als een halve set, hoogstens één extra per werkset.
                </p>
              </div>
            )}
          </div>
          {idx < n - 1 && (
            <div className="pt-1" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
              <label className="flex items-center gap-2 text-sm mt-1.5">
                <input type="checkbox" checked={!!slot.ss} onChange={(e) => updSlot(day.id, slot.id, { ss: e.target.checked, ssRest: slot.ssRest ?? 15 })} />
                Superset met {nextEx ? nextEx.name : "de volgende oefening"}
              </label>
              {slot.ss && (
                <div className="mt-2 space-y-2">
                  <label className="flex items-center justify-between gap-2 text-sm">
                    Wissel naar de volgende (sec)
                    <Num value={slot.ssRest ?? 15} step={5} onChange={(v) => updSlot(day.id, slot.id, { ssRest: clamp(num(v, 15), 0, 120) })} min={0} max={120} />
                  </label>
                  {kind && (
                    <p className="text-xs leading-relaxed" style={{ color: SS_KIND[kind].ok ? C.muted : C.warn }}>
                      <strong>{SS_KIND[kind].label[0].toUpperCase() + SS_KIND[kind].label.slice(1)}.</strong> {SS_KIND[kind].note} De volle rust (
                      {mmss(group && group.end != null ? num(day.slots[group.end].rest, 120) : num(slot.rest, 120))}) komt na de laatste oefening van de superset.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <input
            value={slot.note || ""}
            onChange={(e) => updSlot(day.id, slot.id, { note: e.target.value })}
            placeholder="Notitie, bijvoorbeeld stoelstand of tempo 3-1-1"
            className="w-full px-3 py-2 text-sm"
            style={inputStyle}
          />
          <div className="flex flex-wrap gap-1.5">
            <TBtn small kind="secondary" onClick={onSwap}>
              Andere oefening
            </TBtn>
            {ex.custom && (
              <TBtn small kind="secondary" onClick={onEditEx}>
                Oefening bewerken
              </TBtn>
            )}
            <TBtn small kind="ghost" onClick={() => move(-1)} disabled={idx === 0} label="Omhoog">
              ↑
            </TBtn>
            <TBtn small kind="ghost" onClick={() => move(1)} disabled={idx === n - 1} label="Omlaag">
              ↓
            </TBtn>
            <TBtn small kind="ghost" onClick={() => updDay(day.id, (x) => ({ ...x, slots: unlinkAt(x.slots, idx).filter((s) => s.id !== slot.id) }))}>
              Verwijderen
            </TBtn>
          </div>
        </div>
      )}
    </div>
  );
}

function TrainSchema({ T, setT, D, week, setWeek }) {
  const [picker, setPicker] = useState(null);
  const [editEx, setEditEx] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [newTpl, setNewTpl] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState(null);
  const [ssProp, setSsProp] = useState(null);
  const program = D.program;
  const s = T.settings;
  const setS = (k, v) => setT((t) => ({ ...t, settings: { ...t.settings, [k]: v } }));
  const setB = (k, v) => setT((t) => ({ ...t, block: { ...t.block, [k]: v } }));
  const updProg = (fn) => setT((t) => ({ ...t, programs: t.programs.map((p) => (p.id === t.activeProgramId ? fn(p) : p)) }));
  const updDay = (dayId, fn) => updProg((p) => ({ ...p, days: p.days.map((d) => (d.id === dayId ? fn(d) : d)) }));
  const updSlot = (dayId, slotId, patch) => updDay(dayId, (d) => ({ ...d, slots: d.slots.map((x) => (x.id === slotId ? { ...x, ...patch } : x)) }));

  const askNotify = async () => {
    if (s.notify) return setS("notify", false);
    try {
      if (typeof Notification === "undefined") {
        setNotifyMsg("Deze browser ondersteunt geen meldingen. Geluid en trillen werken wel.");
        return;
      }
      const p = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (p === "granted") {
        setS("notify", true);
        setNotifyMsg(null);
      } else setNotifyMsg("Meldingen zijn geweigerd. U kunt ze toestaan in de instellingen van de browser.");
    } catch (e) {
      setNotifyMsg("Meldingen konden niet worden aangezet in deze weergave.");
    }
  };

  const mismatch = program ? weekMismatch(week, program) : 0;
  const nutriDays = week.filter((d) => d.session).length;
  const perWeek = program ? sessionsPerWeek(program) : 0;
  const check = program ? programCheck(program, D.exIndex) : [];

  return (
    <>
      {newTpl || !program ? (
        <TemplateStarter T={T} setT={setT} D={D} week={week} setWeek={setWeek} onDone={() => setNewTpl(false)} />
      ) : null}

      {program && (
        <>
          <Section title="Schema" sub="Uw trainingen, de volgorde en welke dagen u traint.">
            {T.programs.length > 1 && (
              <Row label="Actief schema" stack>
                <Pick value={program.id} onChange={(v) => setT((t) => ({ ...t, activeProgramId: v }))} options={T.programs.map((p) => ({ id: p.id, label: p.name }))} />
              </Row>
            )}
            <Row label="Naam" stack>
              <input value={program.name} onChange={(e) => updProg((p) => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2 text-sm" style={inputStyle} />
            </Row>
            <Row label="Indeling" hint={program.mode === "week" ? "Vaste training per weekdag." : "Trainingen schuiven door, ongeacht de weekdag."}>
              <Seg
                value={program.mode}
                onChange={(v) => updProg((p) => ({ ...p, mode: v }))}
                options={[
                  { value: "week", label: "Weekdagen" },
                  { value: "rotation", label: "Rotatie" },
                ]}
              />
            </Row>
            {program.mode === "week" ? (
              DAY_FULL.map((dn, i) => (
                <Row key={i} label={dn}>
                  <div style={{ width: 170 }}>
                    <Pick
                      value={program.weekMap[i] || ""}
                      onChange={(v) => updProg((p) => ({ ...p, weekMap: p.weekMap.map((x, k) => (k === i ? v || null : x)) }))}
                      options={[{ id: "", label: "Rust" }, ...program.days.map((d) => ({ id: d.id, label: d.name }))]}
                    />
                  </div>
                </Row>
              ))
            ) : (
              <div className="px-4 py-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
                <p className="text-xs mb-2" style={{ color: C.muted }}>
                  De app kiest steeds de volgende in deze reeks. Een gemiste dag schuift gewoon op; een rustdag wordt overgeslagen zodra u al lang genoeg rust had.
                </p>
                {program.rotation.map((r, k) => (
                  <div key={k} className="flex items-center gap-1.5 mb-1.5">
                    <span className="disp text-sm font-bold text-center shrink-0" style={{ width: 20, color: C.muted }}>
                      {k + 1}
                    </span>
                    <div className="flex-1">
                      <Pick
                        value={r}
                        onChange={(v) => updProg((p) => ({ ...p, rotation: p.rotation.map((x, j) => (j === k ? v : x)) }))}
                        options={[{ id: "rust", label: "Rustdag" }, ...program.days.map((d) => ({ id: d.id, label: d.name }))]}
                      />
                    </div>
                    <TBtn
                      small
                      kind="ghost"
                      label="Omhoog"
                      disabled={k === 0}
                      onClick={() =>
                        updProg((p) => {
                          const rr = [...p.rotation];
                          [rr[k - 1], rr[k]] = [rr[k], rr[k - 1]];
                          return { ...p, rotation: rr };
                        })
                      }
                    >
                      ↑
                    </TBtn>
                    <TBtn small kind="ghost" label="Verwijderen" disabled={program.rotation.length <= 1} onClick={() => updProg((p) => ({ ...p, rotation: p.rotation.filter((_, j) => j !== k) }))}>
                      ✕
                    </TBtn>
                  </div>
                ))}
                <div className="flex gap-2 mt-2">
                  <TBtn small kind="secondary" onClick={() => updProg((p) => ({ ...p, rotation: [...p.rotation, p.days[0].id] }))}>
                    + Training
                  </TBtn>
                  <TBtn small kind="secondary" onClick={() => updProg((p) => ({ ...p, rotation: [...p.rotation, "rust"] }))}>
                    + Rustdag
                  </TBtn>
                </div>
              </div>
            )}
            {program.mode === "week" ? (
              mismatch ? (
                <div className="px-4 py-3 relative" style={{ background: C.warnBg }}>
                  <span className="rail" style={{ background: C.warn }} />
                  <p className="text-xs leading-relaxed" style={{ color: C.warn }}>
                    Uw voeding rekent op {mismatch === 1 ? "één dag" : `${mismatch} dagen`} anders dan dit schema. Trainingsdagen krijgen extra calorieën en koolhydraten rond de training; laat ze gelijklopen.
                  </p>
                  <div className="mt-2">
                    <TBtn small onClick={() => setWeek(syncNutritionWeek(week, program))}>
                      Voeding gelijktrekken
                    </TBtn>
                  </div>
                </div>
              ) : (
                <div className="px-4 py-2.5 text-xs" style={{ color: C.carb }}>
                  Voeding en training lopen gelijk: dezelfde {nutriDays} trainingsdagen.
                </div>
              )
            ) : (
              <div className="px-4 py-2.5 text-xs leading-relaxed" style={{ color: C.muted }}>
                Gemiddeld {perWeek.toFixed(1).replace(".", ",")} trainingen per week. De voeding rekent met een vast weekpatroon van {nutriDays} trainingsdagen
                {Math.abs(perWeek - nutriDays) >= 1 ? "; stem dat aantal af op het tabblad Profiel." : "; dat klopt."}
              </div>
            )}
            <div className="px-4 py-3 flex flex-wrap gap-2">
              <TBtn small kind="secondary" onClick={() => setNewTpl(true)}>
                Nieuw uit sjabloon
              </TBtn>
              <TBtn
                small
                kind="secondary"
                onClick={() => {
                  const map = {};
                  const days = program.days.map((d) => {
                    const id = uid();
                    map[d.id] = id;
                    return { ...d, id, slots: d.slots.map((x) => ({ ...x, id: uid() })) };
                  });
                  const copy = {
                    ...program,
                    id: uid(),
                    name: `${program.name} (kopie)`,
                    days,
                    weekMap: program.weekMap.map((x) => (x ? map[x] : null)),
                    rotation: program.rotation.map((x) => (x === "rust" ? x : map[x])),
                  };
                  setT((t) => ({ ...t, programs: [...t.programs, copy], activeProgramId: copy.id }));
                }}
              >
                Dupliceren
              </TBtn>
              {confirm === "prog" ? (
                <>
                  <TBtn
                    small
                    kind="danger"
                    onClick={() => {
                      setT((t) => {
                        const rest = t.programs.filter((p) => p.id !== program.id);
                        return { ...t, programs: rest, activeProgramId: rest.length ? rest[0].id : null };
                      });
                      setConfirm(null);
                    }}
                  >
                    Ja, schema verwijderen
                  </TBtn>
                  <TBtn small kind="ghost" onClick={() => setConfirm(null)}>
                    Annuleren
                  </TBtn>
                </>
              ) : (
                <TBtn small kind="ghost" onClick={() => setConfirm("prog")}>
                  Verwijderen
                </TBtn>
              )}
            </div>
          </Section>

          {program.days.map((day) => {
            const n = sum(day.slots.map((x) => num(x.sets, 2)));
            return (
              <Section key={day.id} title={day.name} sub={`${day.slots.length} oefeningen · ${n} werksets · ± ${estMinutes(day)} min`}>
                <div className="px-4 py-2.5" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
                  <input
                    value={day.name}
                    onChange={(e) => updDay(day.id, (d) => ({ ...d, name: e.target.value }))}
                    className="w-full px-3 py-2 text-sm"
                    style={inputStyle}
                    aria-label="Naam van de training"
                  />
                </div>
                {day.slots.map((slot, idx, all) => (
                  <SlotEditor
                    key={slot.id}
                    slot={slot}
                    ex={exOf(D.exIndex, slot.exId)}
                    nextEx={idx < all.length - 1 ? exOf(D.exIndex, all[idx + 1].exId) : null}
                    group={ssGroups(all)[idx]}
                    day={day}
                    idx={idx}
                    n={day.slots.length}
                    T={T}
                    D={D}
                    setT={setT}
                    updSlot={updSlot}
                    updDay={updDay}
                    onSwap={() => setPicker({ mode: "swap", dayId: day.id, slotId: slot.id, muscle: exOf(D.exIndex, slot.exId).pri[0] || null })}
                    onEditEx={() => setEditEx(exOf(D.exIndex, slot.exId))}
                  />
                ))}
                {ssProp && ssProp.dayId === day.id && (
                  <div className="mx-4 mt-3 px-3 py-2.5" style={{ background: C.surface2, border: `1px solid ${C.lineSoft}`, borderRadius: R.field }}>
                    {ssProp.sg ? (
                      <>
                        <div className="text-sm font-semibold">Voorstel: {ssProp.sg.pairs.length === 1 ? "één superset" : `${ssProp.sg.pairs.length} supersets`}</div>
                        <ul className="text-xs mt-1 space-y-0.5" style={{ color: C.muted }}>
                          {ssProp.sg.pairs.map(([x, y]) => (
                            <li key={x.id}>
                              {exOf(D.exIndex, x.exId).name} + {exOf(D.exIndex, y.exId).name}
                            </li>
                          ))}
                        </ul>
                        <p className="text-xs mt-1.5 leading-relaxed" style={{ color: C.muted }}>
                          Tegengestelde spieren herstellen terwijl de andere werkt. Geschatte duur {estMinutes(day)} → {estMinutes({ ...day, slots: ssProp.sg.slots })} min; de
                          partner schuift daarvoor naar voren.
                        </p>
                        <div className="flex gap-2 mt-2">
                          <TBtn
                            small
                            onClick={() => {
                              updDay(day.id, (d) => ({ ...d, slots: ssProp.sg.slots }));
                              setSsProp(null);
                            }}
                          >
                            Toepassen
                          </TBtn>
                          <TBtn small kind="ghost" onClick={() => setSsProp(null)}>
                            Annuleren
                          </TBtn>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs leading-relaxed" style={{ color: C.muted }}>
                        Geen geschikte combinatie gevonden. Een superset werkt het best met tegengestelde spieren (borst en rug, biceps en triceps,
                        quadriceps en hamstrings); zware squats en deadlifts met de stang blijven bewust los.{" "}
                        <button onClick={() => setSsProp(null)} className="tap underline">
                          Sluiten
                        </button>
                      </p>
                    )}
                  </div>
                )}
                <div className="px-4 py-3 flex flex-wrap gap-2 items-center">
                  <TBtn small onClick={() => setPicker({ mode: "add", dayId: day.id })}>
                    + Oefening
                  </TBtn>
                  {day.slots.length >= 2 && (
                    <TBtn small kind="secondary" onClick={() => setSsProp({ dayId: day.id, sg: suggestSupersets(day, D.exIndex) })}>
                      Tijd besparen
                    </TBtn>
                  )}
                  {program.days.length > 1 &&
                    (confirm === day.id ? (
                      <>
                        <TBtn
                          small
                          kind="danger"
                          onClick={() => {
                            updProg((p) => {
                              const rot = p.rotation.filter((x) => x !== day.id);
                              return {
                                ...p,
                                days: p.days.filter((d) => d.id !== day.id),
                                weekMap: p.weekMap.map((x) => (x === day.id ? null : x)),
                                rotation: rot.length ? rot : ["rust"],
                              };
                            });
                            setConfirm(null);
                          }}
                        >
                          Ja, dag verwijderen
                        </TBtn>
                        <TBtn small kind="ghost" onClick={() => setConfirm(null)}>
                          Annuleren
                        </TBtn>
                      </>
                    ) : (
                      <TBtn small kind="ghost" onClick={() => setConfirm(day.id)}>
                        Dag verwijderen
                      </TBtn>
                    ))}
                </div>
              </Section>
            );
          })}
          <div className="mb-8 -mt-4">
            <TBtn
              kind="secondary"
              full
              onClick={() => updProg((p) => ({ ...p, days: [...p.days, { id: uid(), name: `Training ${String.fromCharCode(65 + p.days.length)}`, slots: [] }] }))}
            >
              + Trainingsdag toevoegen
            </TBtn>
          </div>

          {check.length > 0 && (
            <Section title="Programmacheck" accent={C.carb} sub="Uw schema getoetst op oefenkeuze, verhouding compound/isolatie en volume per spiergroep.">
              {check.map((c) => (
                <Status key={c.label} label={c.label} value={c.value} state={c.state} note={c.note} />
              ))}
            </Section>
          )}
        </>
      )}

      <Section title="Periodisering" accent={BLOCK_COLOR[D.pos.phase]} sub="Blokken van opbouw en intensivering, afgesloten met een deload. De RIR-doelen schuiven per week mee.">
        <Row label="Start van dit blok">
          <input
            type="date"
            value={T.block.start}
            onChange={(e) => e.target.value && setB("start", e.target.value)}
            className="px-2 py-1.5 text-sm tnum"
            style={inputStyle}
          />
        </Row>
        <Row label="Opbouwweken">
          <Num value={T.block.acc} onChange={(v) => setB("acc", clamp(num(v, 4), 1, 8))} min={1} max={8} />
        </Row>
        <Row label="Intensiveringsweken">
          <Num value={T.block.int} onChange={(v) => setB("int", clamp(num(v, 2), 0, 4))} min={0} max={4} />
        </Row>
        <Row label="Deloadweek aan het eind">
          <Seg
            value={T.block.deload !== false}
            onChange={(v) => setB("deload", v)}
            options={[
              { value: true, label: "Ja" },
              { value: false, label: "Nee" },
            ]}
          />
        </Row>
        <Row label="Intensiteit" stack hint="Standaard: werksets tot RIR 0-1. Gematigd houdt overal een rep meer over.">
          <Pick value={s.intensity} onChange={(v) => setS("intensity", v)} options={Object.entries(INTENSITY).map(([id, v]) => ({ id, label: v.label }))} />
        </Row>
        <div className="px-4 py-3 flex flex-wrap gap-2">
          <TBtn small kind="secondary" onClick={() => setT((t) => ({ ...t, block: { ...t.block, start: mondayOf(D.today), number: D.pos.number + 1, deloadFrom: null, auto: null } }))}>
            Nieuw blok starten
          </TBtn>
          {D.pos.phase !== "deload" && (
            <TBtn small kind="secondary" onClick={() => setT((t) => ({ ...t, block: { ...t.block, deloadFrom: D.today, auto: null } }))}>
              Nu een deloadweek
            </TBtn>
          )}
          {D.pos.forced && (
            <TBtn small kind="ghost" onClick={() => setT((t) => ({ ...t, block: { ...t.block, deloadFrom: null, auto: null, dismissedAt: D.today } }))}>
              Deload stoppen
            </TBtn>
          )}
        </div>
      </Section>

      <Section title="Instellingen training">
        <Row label="Inspanning loggen als" hint="RPE 10 = RIR 0, RPE 9 = RIR 1. De app rekent intern met RIR.">
          <Seg
            value={s.effort}
            onChange={(v) => setS("effort", v)}
            options={[
              { value: "rir", label: "RIR" },
              { value: "rpe", label: "RPE" },
            ]}
          />
        </Row>
        <Row
          label="Progressie"
          hint={
            s.autoProgress
              ? "Automatisch: gewicht, reps, fase-aanpassingen en een deload bij vermoeidheid worden direct toegepast. U kunt alles terugdraaien."
              : "Voorstel: de app rekent alles uit en u keurt goed. Zo kan een verkeerd ingevoerde set nooit ongemerkt uw schema sturen."
          }
        >
          <Seg
            value={s.autoProgress}
            onChange={(v) => setS("autoProgress", v)}
            options={[
              { value: false, label: "Voorstel" },
              { value: true, label: "Auto" },
            ]}
          />
        </Row>
        <Row label="Herstelcheck voor de training" hint="Slaap, energie en spierpijn. Voedt de deload-detectie.">
          <Seg
            value={s.readiness}
            onChange={(v) => setS("readiness", v)}
            options={[
              { value: true, label: "Aan" },
              { value: false, label: "Uit" },
            ]}
          />
        </Row>
        <Row label="Geluid bij einde rust">
          <Seg
            value={s.sound}
            onChange={(v) => setS("sound", v)}
            options={[
              { value: true, label: "Aan" },
              { value: false, label: "Uit" },
            ]}
          />
        </Row>
        <Row label="Trillen bij einde rust" hint="Werkt op Android; iPhone ondersteunt trillen vanuit een webapp niet.">
          <Seg
            value={s.vibrate}
            onChange={(v) => setS("vibrate", v)}
            options={[
              { value: true, label: "Aan" },
              { value: false, label: "Uit" },
            ]}
          />
        </Row>
        <Row
          label="Melding als de app op de achtergrond staat"
          hint="Werkt het best met de app geïnstalleerd op het beginscherm. Op een iPhone pauzeert de telefoon webapps op de achtergrond; de melding komt dan pas als u de app weer opent. Houd de app open voor een betrouwbare timer."
        >
          <Seg
            value={s.notify}
            onChange={askNotify}
            options={[
              { value: true, label: "Aan" },
              { value: false, label: "Uit" },
            ]}
          />
        </Row>
        {notifyMsg && (
          <p className="px-4 py-2 text-xs" style={{ color: C.warn }}>
            {notifyMsg}
          </p>
        )}
        <Row label="Scherm aan houden tijdens training">
          <Seg
            value={s.wakeLock}
            onChange={(v) => setS("wakeLock", v)}
            options={[
              { value: true, label: "Aan" },
              { value: false, label: "Uit" },
            ]}
          />
        </Row>
        <div className="px-4 pt-3 pb-1 text-sm font-medium">Gewichtsstappen per materiaal</div>
        <p className="px-4 text-xs" style={{ color: C.muted }}>
          Hiermee verhoogt de app het gewicht. Per oefening kunt u dit overschrijven.
        </p>
        <div className="px-4 py-3 grid grid-cols-3 gap-x-3 gap-y-2">
          {Object.entries(EQUIP).map(([k, v]) => (
            <label key={k} className="block">
              <span className="text-xs block mb-1 truncate" style={{ color: C.muted }}>
                {v.label}
              </span>
              <Num value={s.inc[k]} step={0.5} onChange={(val) => setT((t) => ({ ...t, settings: { ...t.settings, inc: { ...t.settings.inc, [k]: Math.max(0.25, num(val, v.inc)) } } }))} min={0.25} max={20} />
            </label>
          ))}
        </div>
      </Section>

      {editEx && (
        <Sheet title="Oefening bewerken" onClose={() => setEditEx(null)}>
          <CustomExForm
            initial={editEx}
            onCancel={() => setEditEx(null)}
            onSave={(ex) => {
              setT((t) => updateCustomEx(t, ex));
              setEditEx(null);
            }}
          />
        </Sheet>
      )}

      <Section title="Eigen oefeningen" sub="Oefeningen die u zelf heeft toegevoegd. Tik op Wijzigen om naam, spieren, materiaal of repsrange aan te passen.">
        {T.customEx.some((e) => !e.hidden) ? (
          T.customEx.filter((e) => !e.hidden).map((e) => {
            const used = exUsage(T.programs, e.id);
            return (
              <div key={e.id} className="px-4 py-2.5" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="text-sm font-semibold block">
                      {e.name} <ExBadges ex={{ ...e, custom: false }} />
                    </span>
                    <span className="text-xs block" style={{ color: C.muted }}>
                      {exMeta(e)} · {e.repMin}–{e.repMax} reps
                      {used ? ` · in ${used} ${used === 1 ? "training" : "trainingen"}` : ""}
                    </span>
                  </span>
                  <div className="flex gap-1.5 shrink-0">
                    <TBtn small kind="secondary" onClick={() => setEditEx(e)}>
                      Wijzigen
                    </TBtn>
                    {confirm !== e.id && (
                      <TBtn small kind="ghost" onClick={() => setConfirm(e.id)}>
                        Verwijderen
                      </TBtn>
                    )}
                  </div>
                </div>
                {confirm === e.id && (
                  <div className="mt-2 px-3 py-2" style={{ background: C.warnBg, borderRadius: R.field }}>
                    <p className="text-xs mb-2" style={{ color: C.warn }}>
                      {used
                        ? `Deze oefening staat in ${used} ${used === 1 ? "training" : "trainingen"} van uw schema's en wordt daar ook verwijderd. Uw logboek blijft bewaard.`
                        : "Oefening verwijderen? Uw logboek blijft bewaard."}
                    </p>
                    <div className="flex gap-2">
                      <TBtn
                        small
                        kind="danger"
                        onClick={() => {
                          setT((t) => ({
                            ...t,
                            customEx: t.customEx.map((x) => (x.id === e.id ? { ...x, hidden: true } : x)),
                            programs: t.programs.map((p) => ({ ...p, days: p.days.map((d) => ({ ...d, slots: d.slots.filter((sl) => sl.exId !== e.id) })) })),
                          }));
                          setConfirm(null);
                        }}
                      >
                        Ja, verwijderen
                      </TBtn>
                      <TBtn small kind="ghost" onClick={() => setConfirm(null)}>
                        Annuleren
                      </TBtn>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <p className="px-4 py-3 text-xs" style={{ color: C.muted }}>
            Nog geen eigen oefeningen. Voeg ze toe via "+ Oefening" bij een training.
          </p>
        )}
      </Section>

      {picker && (
        <ExercisePicker
          exIndex={D.exIndex}
          title={picker.mode === "swap" ? "Andere oefening" : "Oefening toevoegen"}
          muscle={picker.muscle || null}
          onClose={() => setPicker(null)}
          onCreate={(ex) => setT((t) => ({ ...t, customEx: [...t.customEx, ex] }))}
          onUpdate={(ex) => setT((t) => updateCustomEx(t, ex))}
          onPick={(ex) => {
            if (picker.mode === "swap") updSlot(picker.dayId, picker.slotId, { exId: ex.id, repMin: ex.repMin, repMax: ex.repMax, startWeight: null });
            else {
              const day = program.days.find((d) => d.id === picker.dayId);
              const first = day && !day.slots.some((x) => ex.pri.some((m) => exOf(D.exIndex, x.exId).pri.includes(m)));
              updDay(picker.dayId, (d) => ({
                ...d,
                slots: [...d.slots, makeSlot(ex, { sets: 2, warmups: ex.kind === "compound" ? (first ? 2 : 1) : first ? 1 : 0 })],
              }));
            }
            setPicker(null);
          }}
        />
      )}
    </>
  );
}

function TrainInsights({ T, D }) {
  const [which, setWhich] = useState("deze");
  const today = dayNum(D.today);
  const mon = today - wdOfNum(today);
  const from = which === "deze" ? mon : mon - 7;
  const vol = muscleSets(D.sessions, D.exIndex, from, from + 6);
  const planned = D.program ? plannedMuscleSets(D.program, D.exIndex) : Object.fromEntries(MUSCLE_IDS.map((k) => [k, 0]));
  const shown = MUSCLE_IDS.filter((k) => vol[k] > 0 || planned[k] > 0);

  const weeks = [...Array(8)].map((_, k) => {
    const m = mon - (7 - k) * 7;
    const ss = D.sessions.filter((s) => s.end && dayNum(s.date) >= m && dayNum(s.date) <= m + 6);
    return { m, n: ss.length, ton: sum(ss.map((s) => sessionStats(s).ton)) };
  });
  const perWeek = D.program ? sessionsPerWeek(D.program) : null;
  const last4 = weeks.slice(4);
  const done4 = sum(last4.map((w) => w.n));
  const plan4 = perWeek ? Math.round(perWeek * 4) : null;

  const exCounts = {};
  D.sessions.forEach((s) =>
    s.exercises.forEach((e) => {
      if (bestE1rm(e) > 0) exCounts[e.exId] = (exCounts[e.exId] || 0) + 1;
    })
  );
  const exList = Object.keys(exCounts).sort((a, b) => exCounts[b] - exCounts[a]);
  const [exSel, setExSel] = useState(null);
  const cur = exSel && exCounts[exSel] ? exSel : exList[0];
  const pts = [];
  let best = 0;
  let heaviest = null;
  D.sessions.forEach((s) => {
    const e = s.exercises.find((x) => x.exId === cur);
    if (!e) return;
    const v = bestE1rm(e);
    if (!v) return;
    const pr = best > 0 && v > best + 0.05;
    best = Math.max(best, v);
    pts.push({ t: dayNum(s.date), v, pr, date: s.date });
    workSets(e).forEach((x) => {
      if (!heaviest || num(x.weight, 0) > num(heaviest.weight, 0)) heaviest = { ...x, date: s.date };
    });
  });
  const change = pts.length >= 2 ? ((pts[pts.length - 1].v - pts[0].v) / pts[0].v) * 100 : null;

  const records = exList
    .map((id) => {
      let b = 0;
      let d = null;
      D.sessions.forEach((s) =>
        s.exercises.forEach((e) => {
          if (e.exId !== id) return;
          const v = bestE1rm(e);
          if (v > b) {
            b = v;
            d = s.date;
          }
        })
      );
      return { id, b, d };
    })
    .sort((a, b) => (b.d || "").localeCompare(a.d || ""))
    .slice(0, 10);

  if (!D.sessions.length) {
    return (
      <Section title="Inzichten" sub="Na uw eerste trainingen verschijnen hier volume per spiergroep, krachtverloop, records en therapietrouw.">
        <p className="px-4 py-3 text-sm" style={{ color: C.muted }}>
          Nog geen trainingen gelogd.
        </p>
      </Section>
    );
  }

  return (
    <>
      <Section
        title="Volume per spiergroep"
        sub="Werksets per week. Hoofdspier telt 1, hulpspier ½. Groene band: MAV, grijs streepje: MEV, rood: MRV, zwart: gepland volgens uw schema. Bij sets tot (bijna) falen ligt het effectieve minimum vaak lager."
      >
        <div className="px-4 py-2.5 flex justify-end" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
          <Seg
            value={which}
            onChange={setWhich}
            options={[
              { value: "deze", label: "Deze week" },
              { value: "vorige", label: "Vorige week" },
            ]}
          />
        </div>
        {shown.map((k) => (
          <VolumeRow key={k} m={k} done={vol[k]} planned={planned[k]} />
        ))}
      </Section>

      <Section title="Volume per week" sub="Gewicht × reps van alle werksets, laatste acht weken.">
        <div className="px-4 py-3">
          <BarsMini bars={weeks.map((w, k) => ({ label: fmtDay(w.m), v: w.ton, hi: k === 7 }))} fmt={(v) => `${Math.round(v / 100) / 10}t`} />
        </div>
      </Section>

      {cur && (
        <Section title="Krachtverloop" sub="Geschatte 1RM per training, gecorrigeerd voor reps in reserve. Groene punten zijn records.">
          <div className="px-4 py-2.5" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
            <Pick value={cur} onChange={setExSel} options={exList.map((id) => ({ id, label: `${exOf(D.exIndex, id).name} (${exCounts[id]}×)` }))} />
          </div>
          <div className="px-4 py-3">
            {pts.length >= 2 ? (
              <LineMini pts={pts} />
            ) : (
              <p className="text-xs" style={{ color: C.muted }}>
                Na twee trainingen met deze oefening verschijnt hier de lijn.
              </p>
            )}
          </div>
          <div className="px-4 pb-3 grid grid-cols-2 gap-2">
            <Stat label="Beste e1RM" value={`${kgTxt(Math.round(best * 10) / 10)} kg`} />
            <Stat label="Zwaarste set" value={heaviest ? `${kgTxt(heaviest.weight)} × ${heaviest.reps}` : "–"} sub={heaviest ? fmtDay(dayNum(heaviest.date)) : null} />
            <Stat label="Sinds de eerste keer" value={change == null ? "–" : `${change >= 0 ? "+" : ""}${change.toFixed(1).replace(".", ",")}%`} />
            <Stat label="Trainingen" value={pts.length} />
          </div>
        </Section>
      )}

      <Section title="Therapietrouw" sub={perWeek ? `Trainingen per week tegen uw schema (${perWeek.toFixed(1).replace(".", ",")} per week).` : "Trainingen per week."}>
        <div className="px-4 py-3">
          <BarsMini bars={weeks.map((w, k) => ({ label: fmtDay(w.m), v: w.n, hi: perWeek ? w.n >= Math.round(perWeek) : k === 7 }))} fmt={(v) => v} color="var(--carb-fill)" target={perWeek} />
          {plan4 != null && (
            <p className="text-xs mt-2" style={{ color: C.muted }}>
              Laatste vier weken: <strong style={{ color: C.ink }}>{done4}</strong> van {plan4} geplande trainingen ({plan4 ? Math.round((done4 / plan4) * 100) : 0}%).
            </p>
          )}
        </div>
      </Section>

      {records.length > 0 && (
        <Section title="Records" accent={C.carb} sub="Hoogste geschatte 1RM per oefening.">
          {records.map((r) => (
            <div key={r.id} className="px-4 py-2.5 flex items-baseline justify-between gap-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
              <span className="text-sm">{exOf(D.exIndex, r.id).name}</span>
              <span className="text-xs tnum shrink-0" style={{ color: C.muted }}>
                <strong style={{ color: C.ink }}>{kgTxt(Math.round(r.b * 10) / 10)} kg</strong> · {r.d ? fmtDay(dayNum(r.d)) : ""}
              </span>
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

function TrainLog({ T, setT, D }) {
  const [open, setOpen] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);
  const scale = T.settings.effort;
  const list = [...D.sessions].filter((s) => s.end).reverse();
  const [limit, setLimit] = useState(20);

  const onImport = async (file) => {
    try {
      const text = await file.text();
      const d = JSON.parse(text);
      if (!d || !Array.isArray(d.sessions) || !Array.isArray(d.programs)) throw new Error("geen trainingsbestand");
      setConfirm({ kind: "import", data: normalizeTraining(d) });
    } catch (e) {
      setMsg("Dit bestand kon niet worden gelezen als trainingsdata.");
    }
  };

  return (
    <>
      <Section title="Logboek" sub={`${list.length} ${list.length === 1 ? "training" : "trainingen"} opgeslagen.`}>
        {!list.length && (
          <p className="px-4 py-3 text-sm" style={{ color: C.muted }}>
            Nog geen trainingen. Start er een op Overzicht.
          </p>
        )}
        {list.slice(0, limit).map((s) => {
          const st = sessionStats(s);
          const isOpen = open === s.id;
          return (
            <div key={s.id} style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
              <button onClick={() => setOpen(isOpen ? null : s.id)} className="tap w-full text-left px-4 py-2.5 flex items-center gap-3" aria-expanded={isOpen}>
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-semibold block">
                    {s.name}{" "}
                    {s.deload && <Chip color={C.carb}>deload</Chip>} {s.light && <Chip color={C.warn}>lichter</Chip>}
                  </span>
                  <span className="text-xs block tnum" style={{ color: C.muted }}>
                    {weekdayNL(s.date)} · {st.min} min · {st.sets} werksets · {fmtKgTotal(st.ton)}
                  </span>
                </span>
                <span className="text-xs shrink-0" style={{ color: C.accent }}>
                  {isOpen ? "Sluiten" : "Details"}
                </span>
              </button>
              {isOpen && (
                <div className="px-4 pb-3">
                  {s.readiness && !s.readiness.skipped && (
                    <p className="text-xs mb-2" style={{ color: C.muted }}>
                      Herstelscore {readinessScore(s.readiness)} van 9
                    </p>
                  )}
                  {s.exercises.map((e, k, all) => (
                    <div key={e.id} className="mb-2">
                      <div className="text-sm font-medium">
                        {ssGroups(all)[k].label && <span style={{ color: C.accent }}>{ssGroups(all)[k].label} </span>}
                        {exOf(D.exIndex, e.exId).name}
                        {e.tech && <span className="text-xs font-normal" style={{ color: C.muted }}> · {techShort(normTech(e.tech))}</span>}
                      </div>
                      <div className="text-xs tnum leading-relaxed" style={{ color: C.muted }}>
                        {e.sets
                          .map((x) =>
                            isSub(x)
                              ? `${x.type === "drop" ? "↓ " : x.type === "partial" ? "½ " : "+ "}${x.type === "drop" ? `${kgTxt(x.weight)} × ` : ""}${x.reps}`
                              : `${x.type === "warmup" ? "opw. " : ""}${kgTxt(x.weight)} × ${x.reps}${x.type === "work" && x.rir != null ? ` ${effortLabel(x.rir, scale)}` : ""}`
                          )
                          .join(" · ")}
                      </div>
                      {e.note && (
                        <div className="text-xs italic" style={{ color: C.muted }}>
                          {e.note}
                        </div>
                      )}
                    </div>
                  ))}
                  {s.note && (
                    <p className="text-xs italic mb-2" style={{ color: C.muted }}>
                      {s.note}
                    </p>
                  )}
                  {confirm && confirm.kind === "del" && confirm.id === s.id ? (
                    <div className="flex gap-2">
                      <TBtn
                        small
                        kind="danger"
                        onClick={() => {
                          setT((t) => ({ ...t, sessions: t.sessions.filter((x) => x.id !== s.id) }));
                          setConfirm(null);
                        }}
                      >
                        Ja, verwijderen
                      </TBtn>
                      <TBtn small kind="ghost" onClick={() => setConfirm(null)}>
                        Annuleren
                      </TBtn>
                    </div>
                  ) : (
                    <TBtn small kind="ghost" onClick={() => setConfirm({ kind: "del", id: s.id })}>
                      Training verwijderen
                    </TBtn>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {list.length > limit && (
          <div className="px-4 py-3">
            <TBtn small kind="secondary" onClick={() => setLimit(limit + 20)}>
              Meer tonen
            </TBtn>
          </div>
        )}
      </Section>

      <Section title="Back-up" sub="Uw trainingsdata staan in deze app. Maak af en toe een back-up, of zet ze over naar een ander apparaat.">
        <div className="px-4 py-3 flex flex-wrap gap-2">
          <TBtn
            small
            kind="secondary"
            onClick={() => {
              const { active, ...rest } = T;
              const ok = downloadJSON(`training-${D.today}.json`, rest);
              setMsg(ok ? "Back-up gedownload." : "Downloaden lukt niet in deze weergave.");
            }}
          >
            Back-up downloaden
          </TBtn>
          <TBtn small kind="secondary" onClick={() => fileRef.current && fileRef.current.click()}>
            Back-up terugzetten
          </TBtn>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              if (f) onImport(f);
              e.target.value = "";
            }}
          />
          {confirm && confirm.kind === "wipe" ? (
            <>
              <TBtn
                small
                kind="danger"
                onClick={() => {
                  setT(TRAIN_DEFAULT());
                  setConfirm(null);
                  setMsg("Alle trainingsdata gewist.");
                }}
              >
                Ja, alles wissen
              </TBtn>
              <TBtn small kind="ghost" onClick={() => setConfirm(null)}>
                Annuleren
              </TBtn>
            </>
          ) : (
            <TBtn small kind="ghost" onClick={() => setConfirm({ kind: "wipe" })}>
              Alle trainingsdata wissen
            </TBtn>
          )}
        </div>
        {confirm && confirm.kind === "import" && (
          <div className="px-4 pb-3">
            <p className="text-xs mb-2" style={{ color: C.warn }}>
              Terugzetten vervangt uw huidige trainingsdata door {confirm.data.sessions.length} trainingen en {confirm.data.programs.length} schema's uit het bestand.
            </p>
            <div className="flex gap-2">
              <TBtn
                small
                kind="danger"
                onClick={() => {
                  setT({ ...confirm.data, active: null });
                  setConfirm(null);
                  setMsg("Back-up teruggezet.");
                }}
              >
                Vervangen
              </TBtn>
              <TBtn small kind="ghost" onClick={() => setConfirm(null)}>
                Annuleren
              </TBtn>
            </div>
          </div>
        )}
        {msg && (
          <p className="px-4 pb-3 text-xs" style={{ color: C.muted }}>
            {msg}
          </p>
        )}
      </Section>
    </>
  );
}

const TRAIN_VIEWS = [
  { id: "overzicht", label: "Overzicht" },
  { id: "schema", label: "Schema" },
  { id: "inzichten", label: "Inzichten" },
  { id: "logboek", label: "Logboek" },
];

function TrainingTab({ T, setT, D, bw, week, setWeek, onStart, summary, setSummary }) {
  const [view, setView] = useState("overzicht");
  const go = (v) => {
    setView(v);
    try {
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch (e) {
      /* oudere browsers */
    }
  };
  if (T.active) return <LiveWorkout T={T} setT={setT} D={D} bw={bw} onFinish={(s) => setSummary(s)} />;
  return (
    <>
      <div className="flex gap-1 p-1 mb-5" style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999 }} role="tablist">
        {TRAIN_VIEWS.map((v) => {
          const on = view === v.id;
          return (
            <button
              key={v.id}
              role="tab"
              aria-selected={on}
              onClick={() => go(v.id)}
              className="tap flex-1 py-1.5 text-sm rounded-full"
              style={{ background: on ? C.accent : "transparent", color: on ? C.onAccent : C.muted, fontWeight: on ? 600 : 500 }}
            >
              {v.label}
            </button>
          );
        })}
      </div>
      {view === "overzicht" && <TrainOverview T={T} setT={setT} D={D} week={week} setWeek={setWeek} onStart={onStart} go={go} />}
      {view === "schema" && <TrainSchema T={T} setT={setT} D={D} week={week} setWeek={setWeek} />}
      {view === "inzichten" && <TrainInsights T={T} D={D} />}
      {view === "logboek" && <TrainLog T={T} setT={setT} D={D} />}
      {summary && <SessionSummary s={summary} D={D} T={T} setT={setT} onClose={() => setSummary(null)} />}
    </>
  );
}

function TodayTrainingCard({ T, D, onOpen, onStart }) {
  if (T.active) return null;
  const plan = D.plan;
  if (!D.program) {
    return (
      <button
        onClick={onOpen}
        className="tap w-full text-left mb-3 px-3 py-2 flex items-center gap-3"
        style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: R.field }}
      >
        <span className="shrink-0 rounded-full" style={{ width: 10, height: 10, background: C.muted }} />
        <span className="text-xs flex-1" style={{ color: C.muted }}>
          <strong style={{ color: C.ink }}>Nog geen trainingsschema</strong> · kies een startschema en log uw trainingen
        </span>
        <span className="text-xs shrink-0" style={{ color: C.accent }}>
          Training
        </span>
      </button>
    );
  }
  const day = plan && plan.day && !plan.doneToday ? plan.day : null;
  return (
    <div className="mb-3 px-3 py-2 flex items-center gap-3" style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: R.field }}>
      <span className="shrink-0 rounded-full" style={{ width: 10, height: 10, background: BLOCK_COLOR[D.pos.phase] }} />
      <button onClick={onOpen} className="tap text-left text-xs flex-1 leading-snug" style={{ color: C.muted }}>
        <strong style={{ color: C.ink }}>
          {day ? `Training: ${day.name}` : plan && plan.doneToday ? "Training gedaan" : "Rustdag"}
        </strong>
        {" · "}
        {BLOCK_LABEL[D.pos.phase].toLowerCase()} · doel {effortLabel(D.pos.rir, T.settings.effort)}
        {D.fatigue && !T.block.deloadFrom ? " · deload aanbevolen" : ""}
      </button>
      {day ? (
        <TBtn small onClick={() => onStart(day, plan.rotPos)}>
          Start
        </TBtn>
      ) : (
        <button onClick={onOpen} className="tap text-xs shrink-0" style={{ color: C.accent }}>
          Training
        </button>
      )}
    </div>
  );
}

class TrainingBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.quiet) return null;
    return (
      <div className="mb-6 px-4 py-3 relative overflow-hidden" style={{ background: C.warnBg, borderRadius: R.card }}>
        <span className="rail" style={{ background: C.train }} />
        <div className="disp text-lg font-bold uppercase leading-none" style={{ color: C.train }}>
          Training kon niet laden
        </div>
        <p className="text-xs mt-1 mb-2" style={{ color: C.warn }}>
          {String(this.state.error && this.state.error.message)}. Uw voeding werkt gewoon door. Meestal lost het verwijderen van de lopende training dit op; uw logboek blijft bewaard.
        </p>
        <div className="flex gap-2 flex-wrap">
          <TBtn
            small
            kind="danger"
            onClick={() => {
              this.props.onClearActive && this.props.onClearActive();
              this.setState({ error: null });
            }}
          >
            Lopende training verwijderen
          </TBtn>
          <TBtn small kind="ghost" onClick={() => this.setState({ error: null })}>
            Opnieuw proberen
          </TBtn>
        </div>
      </div>
    );
  }
}

/* ---------------- Nexa-account ----------------
   Alleen in de losse app (Netlify) bestaat window.nexaSync; binnen de
   Claude-weergave bewaart Claude de gegevens al en blijft dit weg. */

function useNexaSync() {
  const [s, setS] = useState(() => (typeof window !== "undefined" && window.nexaSync ? window.nexaSync.state : null));
  useEffect(() => (typeof window !== "undefined" && window.nexaSync ? window.nexaSync.subscribe(setS) : undefined), []);
  return s;
}

const syncTime = (ms) =>
  ms ? new Date(ms).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "nog niet";

function FormMsg({ msg }) {
  if (!msg) return null;
  const col = msg.tone === "fout" ? C.train : msg.tone === "goed" ? C.carb : C.muted;
  return (
    <p className="text-sm leading-relaxed" style={{ color: col }} role={msg.tone === "fout" ? "alert" : "status"}>
      {msg.text}
    </p>
  );
}

function AccountForm({ initial = "login", onDone }) {
  const [mode, setMode] = useState(initial);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const sync = typeof window !== "undefined" ? window.nexaSync : null;
  if (!sync) return null;
  const submit = async (ev) => {
    if (ev) ev.preventDefault();
    const mail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(mail)) return setMsg({ tone: "fout", text: "Vul een geldig e-mailadres in." });
    if (mode !== "reset" && pw.length < 8) return setMsg({ tone: "fout", text: "Het wachtwoord moet minstens 8 tekens hebben." });
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "login") {
        await sync.signIn(mail, pw);
        setMsg({ tone: "goed", text: "Ingelogd. Uw gegevens zijn bijgewerkt." });
        if (onDone) onDone();
      } else if (mode === "signup") {
        const r = await sync.signUp(mail, pw);
        if (r.confirmed) {
          setMsg({ tone: "goed", text: "Account aangemaakt. Uw gegevens worden nu online bewaard." });
          if (onDone) onDone();
        } else {
          setMode("login");
          setMsg({
            tone: "goed",
            text: "Account aangemaakt. Open de bevestigingsmail en tik op de link. Kom daarna terug in deze app en log hier in met uw e-mailadres en wachtwoord.",
          });
        }
      } else {
        await sync.resetPassword(mail);
        setMsg({ tone: "goed", text: "Als er een account bij dit adres hoort, heeft u nu een mail met een link om een nieuw wachtwoord in te stellen." });
      }
    } catch (err) {
      setMsg({ tone: "fout", text: (err && err.message) || "Er ging iets mis." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {mode !== "reset" && (
        <Seg
          value={mode}
          onChange={(v) => {
            setMode(v);
            setMsg(null);
          }}
          options={[
            { value: "login", label: "Inloggen" },
            { value: "signup", label: "Account maken" },
          ]}
        />
      )}
      <label className="block">
        <span className="text-xs" style={{ color: C.muted }}>
          E-mailadres
        </span>
        <input
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2.5 text-sm mt-1"
          style={inputStyle}
        />
      </label>
      {mode !== "reset" && (
        <label className="block">
          <span className="text-xs" style={{ color: C.muted }}>
            Wachtwoord{mode === "signup" ? " (minstens 8 tekens)" : ""}
          </span>
          <input
            type="password"
            name="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="w-full px-3 py-2.5 text-sm mt-1"
            style={inputStyle}
          />
        </label>
      )}
      <FormMsg msg={msg} />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="tap px-4 py-2.5 text-sm"
          style={{ background: C.accent, color: C.onAccent, borderRadius: R.field, fontWeight: 600, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Even geduld…" : mode === "login" ? "Inloggen" : mode === "signup" ? "Account maken" : "Herstelmail versturen"}
        </button>
        {mode === "login" && (
          <button
            type="button"
            onClick={() => {
              setMode("reset");
              setMsg(null);
            }}
            className="tap text-sm underline"
            style={{ color: C.muted }}
          >
            Wachtwoord vergeten?
          </button>
        )}
        {mode === "reset" && (
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setMsg(null);
            }}
            className="tap text-sm underline"
            style={{ color: C.muted }}
          >
            Terug naar inloggen
          </button>
        )}
      </div>
      {mode === "login" && (
        <p className="text-xs leading-relaxed" style={{ color: C.muted }}>
          Bij inloggen zet de app de gegevens uit uw account op dit apparaat.
        </p>
      )}
    </form>
  );
}

function AccountSection({ s }) {
  const [confirmOut, setConfirmOut] = useState(false);
  if (!s) return null;
  const sync = window.nexaSync;
  if (!s.user) {
    return (
      <Section
        title="Account"
        sub="Met een gratis Nexa-account bewaart de app uw gegevens ook online. Verwijdert u de app of krijgt u een nieuwe telefoon, dan logt u in en staat alles er weer."
      >
        <div className="px-4 py-4">
          <AccountForm />
        </div>
      </Section>
    );
  }
  const status =
    s.status === "bezig"
      ? { state: "oplet", value: "bezig", note: "Uw gegevens worden gesynchroniseerd." }
      : s.status === "offline"
      ? { state: "oplet", value: "offline", note: "Geen verbinding. Wijzigingen worden verstuurd zodra u weer online bent." }
      : s.status === "fout"
      ? { state: "risico", value: "mislukt", note: `Synchroniseren mislukt: ${s.error}` }
      : { state: "goed", value: "bijgewerkt", note: `Laatst gesynchroniseerd: ${syncTime(s.lastSync)}. Wijzigingen gaan automatisch mee.` };
  return (
    <Section title="Account" sub="Uw gegevens staan op dit apparaat en in uw Nexa-account. Ze blijven bewaard als u de app verwijdert of van telefoon wisselt.">
      <Row label="Ingelogd als" hint={s.user.email}>
        <span />
      </Row>
      <Status label="Synchronisatie" value={status.value} state={status.state} note={status.note} />
      <div className="px-4 py-3 flex flex-wrap gap-2 items-center">
        <TBtn small kind="secondary" disabled={s.status === "bezig"} onClick={() => sync.syncNow()}>
          Nu synchroniseren
        </TBtn>
        {confirmOut ? (
          <>
            <TBtn
              small
              kind="danger"
              onClick={() => {
                sync.signOut();
                setConfirmOut(false);
              }}
            >
              Ja, uitloggen
            </TBtn>
            <TBtn small kind="ghost" onClick={() => setConfirmOut(false)}>
              Annuleren
            </TBtn>
          </>
        ) : (
          <TBtn small kind="ghost" onClick={() => setConfirmOut(true)}>
            Uitloggen
          </TBtn>
        )}
      </div>
      {confirmOut && (
        <p className="px-4 pb-3 text-xs" style={{ color: C.muted }}>
          Uw gegevens blijven op dit apparaat en in uw account staan; ze worden alleen niet meer gesynchroniseerd.
        </p>
      )}
    </Section>
  );
}

/* Meldingen die bij een link uit een mail horen. Die link opent vaak in de
   browser in plaats van in de app op het beginscherm. */
function SyncNotices({ s }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  if (!s) return null;
  const sync = window.nexaSync;
  if (s.recovery) {
    const save = async (ev) => {
      ev.preventDefault();
      if (pw.length < 8) return setMsg({ tone: "fout", text: "Het wachtwoord moet minstens 8 tekens hebben." });
      setBusy(true);
      try {
        await sync.updatePassword(pw);
      } catch (err) {
        setMsg({ tone: "fout", text: err.message });
      } finally {
        setBusy(false);
      }
    };
    return (
      <Sheet title="Nieuw wachtwoord" onClose={() => {}}>
        <form onSubmit={save} className="space-y-3">
          <p className="text-sm" style={{ color: C.muted }}>
            Kies een nieuw wachtwoord voor uw Nexa-account.
          </p>
          <input
            type="password"
            autoComplete="new-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="Minstens 8 tekens"
            className="w-full px-3 py-2.5 text-sm"
            style={inputStyle}
            aria-label="Nieuw wachtwoord"
          />
          <FormMsg msg={msg} />
          <button type="submit" disabled={busy} className="tap px-4 py-2.5 text-sm" style={{ background: C.accent, color: C.onAccent, borderRadius: R.field, fontWeight: 600 }}>
            {busy ? "Even geduld…" : "Wachtwoord opslaan"}
          </button>
        </form>
      </Sheet>
    );
  }
  if (!s.notice) return null;
  const text =
    s.notice === "bevestigd"
      ? "Uw e-mailadres is bevestigd. Open Nexa vanaf uw beginscherm en log in met uw e-mailadres en wachtwoord."
      : "Uw wachtwoord is gewijzigd. Open Nexa vanaf uw beginscherm en log in met het nieuwe wachtwoord.";
  return (
    <div className="mb-4 px-4 py-3 relative overflow-hidden" style={{ background: C.panel, border: `2px solid ${C.carb}`, borderRadius: R.card }} role="status">
      <p className="text-sm leading-relaxed">{text}</p>
      <button onClick={() => sync.dismissNotice()} className="tap text-xs underline mt-1" style={{ color: C.muted }}>
        Sluiten
      </button>
    </div>
  );
}

/* ---------------- wekelijkse meting en lichaamssamenstelling ---------------- */

const nlNum = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (v, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${nlNum(Math.abs(v), d)}`;

function CheckinSheet({ sex, last, onSave, onClose }) {
  const [x, setX] = useState(() => ({
    date: localISO(),
    waist: "",
    neck: last && last.neck ? last.neck : "",
    hip: last && last.hip ? last.hip : "",
    method: "",
    bf: "",
  }));
  const [err, setErr] = useState(null);
  const s = (k, v) => setX((o) => ({ ...o, [k]: v }));
  const field = (key, label, hint, min, max) => (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {hint && (
        <span className="text-xs block leading-snug" style={{ color: C.muted }}>
          {hint}
        </span>
      )}
      <div className="flex items-center gap-2 mt-1">
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          min={min}
          max={max}
          value={x[key]}
          onChange={(e) => s(key, e.target.value)}
          className="w-28 px-3 py-2 text-sm tnum"
          style={inputStyle}
          aria-label={label}
        />
        <span className="text-sm" style={{ color: C.muted }}>
          cm
        </span>
      </div>
    </label>
  );
  const save = () => {
    const waist = num(x.waist, 0);
    const neck = num(x.neck, 0);
    const hip = num(x.hip, 0);
    const bf = num(x.bf, 0);
    if (!(waist >= 40 && waist <= 200)) return setErr("Vul uw taille in, in centimeters.");
    if (neck && !(neck >= 20 && neck <= 70)) return setErr("De nekomtrek lijkt niet te kloppen; vul centimeters in.");
    if (hip && !(hip >= 50 && hip <= 200)) return setErr("De heupomtrek lijkt niet te kloppen; vul centimeters in.");
    if (x.method && !(bf >= 3 && bf <= 60)) return setErr("Vul het gemeten vetpercentage in, of kies geen andere meting.");
    if (!x.date) return setErr("Kies een datum.");
    onSave({
      date: x.date,
      waist,
      neck: neck || null,
      hip: sex === "vrouw" && hip ? hip : null,
      method: x.method || null,
      bf: x.method ? bf : null,
    });
  };
  return (
    <Sheet title="Wekelijkse meting" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs leading-relaxed" style={{ color: C.muted }}>
          Meet het liefst op dezelfde dag en tijd, 's ochtends voor het ontbijt. Lint horizontaal, strak maar zonder in te drukken, na een
          normale uitademing.
        </p>
        <label className="block">
          <span className="text-sm font-medium">Datum</span>
          <input type="date" value={x.date} onChange={(e) => s("date", e.target.value)} className="block mt-1 px-3 py-2 text-sm tnum" style={inputStyle} />
        </label>
        {field("waist", "Taille", "Ter hoogte van de navel.", 40, 200)}
        {field("neck", "Nek", "Direct onder het strottenhoofd. Eén keer meten is genoeg; de app onthoudt het.", 20, 70)}
        {sex === "vrouw" && field("hip", "Heupen", "Op het breedste punt van de billen.", 50, 200)}
        <div>
          <span className="text-sm font-medium">Andere vetmeting (optioneel)</span>
          <span className="text-xs block leading-snug" style={{ color: C.muted }}>
            Heeft u deze week ook uw vetpercentage laten meten? De app weegt elke methode naar haar betrouwbaarheid.
          </span>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1">
              <Pick value={x.method} onChange={(v) => s("method", v)} options={[{ id: "", label: "Geen" }, ...Object.entries(BF_METHODS).map(([id, m]) => ({ id, label: m.label }))]} />
            </div>
            {x.method && (
              <>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={x.bf}
                  onChange={(e) => s("bf", e.target.value)}
                  className="w-20 px-2 py-2 text-sm tnum"
                  style={inputStyle}
                  aria-label="Gemeten vetpercentage"
                />
                <span className="text-sm" style={{ color: C.muted }}>
                  %
                </span>
              </>
            )}
          </div>
        </div>
        {err && (
          <p className="text-sm" style={{ color: C.train }} role="alert">
            {err}
          </p>
        )}
        <TBtn full onClick={save}>
          Meting opslaan
        </TBtn>
      </div>
    </Sheet>
  );
}

function BfChart({ comp }) {
  const pts = [...comp.points.map((p) => ({ t: p.t, v: p.bf, navy: p.navy, dev: p.device })), { t: dayNum(localISO()), v: comp.bf, now: true }]
    .filter((p, i, a) => i === 0 || p.t > a[i - 1].t || !p.now);
  if (pts.length < 2) return null;
  const W = 340;
  const H = 150;
  const padL = 34;
  const padR = 10;
  const padT = 12;
  const padB = 22;
  const vals = pts.flatMap((p) => [p.v, p.navy, p.dev].filter((v) => v != null));
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const span = Math.max(1.5, hi - lo);
  lo = Math.floor((lo - span * 0.2) * 2) / 2;
  hi = Math.ceil((hi + span * 0.2) * 2) / 2;
  const t0 = pts[0].t;
  const t1 = Math.max(pts[pts.length - 1].t, t0 + 7);
  const x = (t) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" role="img" aria-label={`Geschat vetpercentage, nu ${nlNum(comp.bf)} procent`}>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" />
            <text x={padL - 5} y={y(v) + 3.5} fontSize="10" textAnchor="end" fill="var(--muted)">
              {nlNum(v)}
            </text>
          </g>
        ))}
        <text x={padL} y={H - 6} fontSize="10" fill="var(--muted)">
          {fmtDay(t0)}
        </text>
        <text x={W - padR} y={H - 6} fontSize="10" textAnchor="end" fill="var(--muted)">
          {fmtDay(t1)}
        </text>
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) =>
          p.navy != null ? <circle key={"n" + i} cx={x(p.t)} cy={y(p.navy)} r="3" fill="none" stroke="var(--muted)" strokeWidth="1.5" /> : null
        )}
        {pts.map((p, i) => (p.dev != null ? <rect key={"d" + i} x={x(p.t) - 3.5} y={y(p.dev) - 3.5} width="7" height="7" fill="var(--carb-fill)" /> : null))}
        {pts.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.v)} r={p.now ? 4 : 2.8} fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs" style={{ color: C.muted }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block rounded-full" style={{ width: 14, height: 3, background: "var(--accent)" }} />
          schatting
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block rounded-full" style={{ width: 7, height: 7, border: "1.5px solid var(--muted)" }} />
          meetlint
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block" style={{ width: 7, height: 7, background: "var(--carb-fill)" }} />
          andere meting
        </span>
      </div>
    </div>
  );
}

function CompositionSection({ comp, checkins, sex, waistTrend, strength, bodyFat, useBodyFat, onNew, onDelete, onApply }) {
  const [showAll, setShowAll] = useState(false);
  if (!comp) {
    return (
      <Section
        title="Lichaamssamenstelling"
        sub="De weegschaal ziet het verschil tussen vet en spier niet. Meet daarom elke week uw taille; met uw nek erbij schat de app ook uw vetpercentage."
      >
        <div className="px-4 py-4">
          <p className="text-sm leading-relaxed mb-3" style={{ color: C.muted }}>
            Een meetlint is genoeg. Blijft uw gewicht gelijk terwijl uw taille daalt, dan verliest u vet en ziet de app dat een
            stilstaande weegschaal geen reden is om minder te eten.
          </p>
          <TBtn onClick={onNew}>Eerste meting</TBtn>
        </div>
      </Section>
    );
  }
  const last = checkins[checkins.length - 1];
  const dBf = comp.bf - comp.start.bf;
  const dFat = comp.fat - comp.start.fat;
  const dLean = comp.lean - comp.start.lean;
  const list = [...checkins].reverse();
  const canApply = !useBodyFat || Math.abs(num(bodyFat, 0) - comp.bf) >= 0.5;
  return (
    <Section
      title="Lichaamssamenstelling"
      sub="Geschat uit uw gewichtsverloop, de wekelijkse meting met het meetlint en eventuele andere vetmetingen."
    >
      <div className="px-4 pt-4 pb-3 grid grid-cols-2 gap-2">
        <Stat label="Geschat vetpercentage" value={`${nlNum(comp.bf)}%`} sub={`marge ±${nlNum(comp.sd)}`} />
        <Stat label="Sinds de eerste meting" value={signed(dBf)} sub={`procentpunt, marge ±${nlNum(comp.changeSd)}`} />
        <Stat label="Vetmassa" value={`${nlNum(comp.fat)} kg`} sub={`${signed(dFat)} kg`} />
        <Stat label="Vetvrije massa" value={`${nlNum(comp.lean)} kg`} sub={`${signed(dLean)} kg`} />
      </div>
      <p className="px-4 pb-3 text-xs leading-relaxed" style={{ color: C.muted }}>
        {comp.calibrated
          ? "De verandering is nauwkeurig; het niveau blijft zo onzeker als uw startschatting tot u een andere meting invoert, zoals een DEXA-scan."
          : sex === "vrouw"
          ? "Vul bij de volgende meting ook uw nek en heupen in; dan volgt de app uw vetpercentage ook met het meetlint."
          : "Vul bij de volgende meting ook uw nek in; dan volgt de app uw vetpercentage ook met het meetlint."}
      </p>
      <div className="px-4 pb-3">
        <BfChart comp={comp} />
      </div>
      <Row
        label="Taille"
        hint={waistTrend.ok ? `${cmTxt(waistTrend.perWeek)} per week over de laatste weken` : "Na drie metingen over twee weken ziet u hier de trend."}
      >
        <span className="text-sm font-semibold tnum">{nlNum(last.waist)} cm</span>
      </Row>
      <Row
        label="Kracht"
        hint={
          strength.ok
            ? `Mediaan van ${strength.n} oefeningen, laatste vier weken. Gelijk of stijgend betekent: spiermassa behouden.`
            : "Uit uw trainingslogboek: minstens drie oefeningen twee keer getraind in vier weken."
        }
      >
        <span className="text-sm font-semibold tnum" style={{ color: strength.ok ? (strength.pct <= -3 ? C.train : C.carb) : C.muted }}>
          {strength.ok ? pctTxt(strength.pct) : "–"}
        </span>
      </Row>
      <div className="px-4 py-3 flex flex-wrap gap-2" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
        <TBtn small onClick={onNew}>
          Nieuwe meting
        </TBtn>
        {canApply && (
          <TBtn small kind="secondary" onClick={onApply}>
            Plan bijwerken naar {nlNum(comp.bf)}%
          </TBtn>
        )}
      </div>
      {canApply && (
        <p className="px-4 pt-2 text-xs leading-relaxed" style={{ color: C.muted }}>
          Uw plan rekent nu met {useBodyFat ? `${nlNum(num(bodyFat, 0))}%` : "een geschat vetpercentage"}. Bijwerken zet de schatting en uw
          huidige gewicht in uw gegevens; het meerwekenplan en uw eiwitbehoefte rekenen daarmee verder.
        </p>
      )}
      <div className="px-4 py-3">
        <div className="text-sm font-medium mb-1.5">Metingen</div>
        {(showAll ? list : list.slice(0, 5)).map((c) => (
          <div key={c.date} className="flex items-center justify-between gap-3 py-1.5 text-xs tnum" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
            <span>
              <strong>{fmtDay(dayNum(c.date))}</strong>
              <span style={{ color: C.muted }}>
                {" "}
                · taille {nlNum(c.waist)}
                {c.neck ? ` · nek ${nlNum(c.neck)}` : ""}
                {c.hip ? ` · heup ${nlNum(c.hip)}` : ""}
                {c.method && c.bf ? ` · ${BF_METHODS[c.method] ? BF_METHODS[c.method].label.toLowerCase() : c.method} ${nlNum(c.bf)}%` : ""}
              </span>
            </span>
            <button onClick={() => onDelete(c.date)} className="tap underline shrink-0" style={{ color: C.muted }} aria-label={`Meting van ${c.date} verwijderen`}>
              Verwijderen
            </button>
          </div>
        ))}
        {list.length > 5 && (
          <button onClick={() => setShowAll(!showAll)} className="tap text-xs underline mt-1" style={{ color: C.muted }}>
            {showAll ? "Minder tonen" : `Alle ${list.length} metingen`}
          </button>
        )}
      </div>
    </Section>
  );
}

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
  const [checkins, setCheckins] = useState([]);
  const [compAnchor, setCompAnchor] = useState(null);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [overrideAdvice, setOverrideAdvice] = useState(false);
  const [checkinLater, setCheckinLater] = useState(() => {
    try {
      return Number(window.localStorage.getItem("nexa:checkin-later")) || 0;
    } catch (e) {
      return 0;
    }
  });
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
  const [T, setT, tLoaded] = useTrainingStore();
  const nx = useNexaSync();
  const [accountOpen, setAccountOpen] = useState(null);
  const [accountHint, setAccountHint] = useState(() => {
    try {
      return !window.localStorage.getItem("nexa:account-hint");
    } catch (e) {
      return true;
    }
  });
  const hideAccountHint = () => {
    setAccountHint(false);
    try {
      window.localStorage.setItem("nexa:account-hint", String(Date.now()));
    } catch (e) {
      /* alleen voor deze sessie verbergen */
    }
  };
  const [trainSummary, setTrainSummary] = useState(null);

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
      /* Losse app: controleren of de serverfunctie klaarstaat. Zonder
         verbinding proberen we het gewoon bij gebruik. */
      try {
        if (location.protocol === "file:") {
          if (alive) setAiPhoto({ ok: false, reden: "alleen als de app online draait" });
          return;
        }
        const r = await fetch(LABEL_ENDPOINT, { method: "GET", cache: "no-store" });
        const d = await r.json().catch(() => null);
        if (!alive) return;
        if (d && d.ok) setAiPhoto({ ok: true, reden: "via de server" });
        else if (d && d.code === "geen_sleutel") setAiPhoto({ ok: false, reden: "er is nog geen API-sleutel ingesteld op de server" });
        else setAiPhoto({ ok: false, reden: "de serverfunctie is niet gevonden op deze site" });
      } catch (e) {
        if (alive) setAiPhoto({ ok: true, reden: "wordt bij gebruik gecontroleerd" });
      }
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
          if (Array.isArray(d.checkins)) setCheckins(d.checkins);
          if (d.compAnchor) setCompAnchor(d.compAnchor);
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
          JSON.stringify({ f, week, log, kcalAdjust, phaseCfg, mealPlans, vegGrams, customFoods, savedMeals, autopilot, lastSeen, checkins, compAnchor, onboarded: true })
        );
      } catch (e) {
        setStorage("uit");
      }
    }, 800);
    return () => clearTimeout(t);
  }, [f, week, log, kcalAdjust, phaseCfg, mealPlans, vegGrams, customFoods, savedMeals, autopilot, lastSeen, checkins, compAnchor, loaded, storage]);

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

  /* ---------------- training ---------------- */
  const trainToday = localISO();
  const trainPhase = planNow.active ? planNow.row.phase : effGoal;
  const D = useMemo(() => trainDerive(T, { phase: trainPhase }, trainToday), [T, trainPhase, trainToday]);

  const startTraining = (day, rotPos = null) => {
    primeAudio();
    setT((t) => (t.active ? t : { ...t, active: buildSession({ program: D.program, day, D, T: t, rotPos, bw: weight }) }));
    setTab("training");
  };

  /* Een ingelaste deload loopt zeven dagen; daarna begint een nieuw blok.
     In de automatische stand wordt een deload bij vermoeidheid direct ingelast. */
  useEffect(() => {
    if (!tLoaded) return;
    const b = T.block;
    if (b.deloadFrom && dayNum(trainToday) >= dayNum(b.deloadFrom) + 7) {
      const before = blockPosition({ ...b, deloadFrom: null }, b.deloadFrom, T.settings.intensity);
      setT((t) => ({ ...t, block: { ...t.block, start: isoOfNum(dayNum(b.deloadFrom) + 7), number: before.number + 1, deloadFrom: null, auto: null } }));
      return;
    }
    if (T.settings.autoProgress && D.fatigue && !b.deloadFrom && !T.active) {
      setT((t) => ({ ...t, block: { ...t.block, deloadFrom: trainToday, auto: { at: trainToday, reasons: D.fatigue.reasons } } }));
    }
  }, [tLoaded, T.block, T.settings.autoProgress, T.settings.intensity, D.fatigue, trainToday, !!T.active]);

  /* Scherm aan houden tijdens een training (Screen Wake Lock API). */
  const trainingActive = !!T.active;
  useEffect(() => {
    if (!trainingActive || !T.settings.wakeLock || typeof navigator === "undefined" || !navigator.wakeLock) return;
    let lock = null;
    let alive = true;
    const req = async () => {
      try {
        if (alive && document.visibilityState === "visible") lock = await navigator.wakeLock.request("screen");
      } catch (e) {
        /* geweigerd of niet ondersteund */
      }
    };
    req();
    const onVis = () => document.visibilityState === "visible" && req();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVis);
      try {
        if (lock) lock.release();
      } catch (e) {
        /* al vrijgegeven */
      }
    };
  }, [trainingActive, T.settings.wakeLock]);

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

  /* Lichaamssamenstelling: schatting uit gewicht plus wekelijkse meting, en
     het oordeel of een afwijking van het tempo echt bijsturen vraagt. */
  const todayLocal = localISO();
  const comp = useMemo(
    () => estimateComposition({ sex: f.sex, height: num(f.height, 180), log, checkins, anchor: compAnchor, win: bfWindow, today: todayLocal }),
    [f.sex, f.height, log, checkins, compAnchor, bfWindow, todayLocal]
  );
  const waistTrend = useMemo(() => measureTrend(checkins, "waist", todayLocal), [checkins, todayLocal]);
  const strength = useMemo(() => strengthTrend(T.sessions || [], todayLocal), [T.sessions, todayLocal]);
  const advice = useMemo(
    () => compositionAdvice({ goal: effGoal, correction, waist: waistTrend, strength }),
    [effGoal, correction, waistTrend, strength]
  );
  const saveCheckin = (c) => {
    setCheckins((list) => [...list.filter((x) => x.date !== c.date), c].sort((a, b) => a.date.localeCompare(b.date)));
    setCompAnchor((a) => {
      if (a) return c.date < a.date ? { ...a, date: c.date } : a;
      return {
        date: c.date,
        bf: f.useBodyFat ? num(f.bodyFat, 18) : f.sex === "vrouw" ? 27 : 18,
        sd: f.useBodyFat ? 3 : 5,
        weight: trend.ok ? trend.avg7 : num(f.weight, 80),
      };
    });
    setCheckinOpen(false);
  };
  const deleteCheckin = (date) => {
    const rest = checkins.filter((x) => x.date !== date);
    setCheckins(rest);
    if (!rest.length) setCompAnchor(null);
  };
  const applyComposition = () => {
    if (!comp) return;
    setF((s) => ({ ...s, bodyFat: Math.round(comp.bf * 10) / 10, useBodyFat: true, weight: Math.round(comp.weight * 10) / 10 }));
  };
  const lastCheckin = checkins[checkins.length - 1];
  const checkinDue =
    loaded &&
    onboarding === null &&
    (!lastCheckin || dayNum(todayLocal) - dayNum(lastCheckin.date) >= 7) &&
    Date.now() - checkinLater > 3 * DAY_MS;
  const snoozeCheckin = () => {
    const now = Date.now();
    setCheckinLater(now);
    try {
      window.localStorage.setItem("nexa:checkin-later", String(now));
    } catch (e) {
      /* alleen voor deze sessie */
    }
  };

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
      `Nexa - week van ${dateNL(new Date())}`,
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
            : code === "offline"
            ? "Geen internetverbinding. Probeer het opnieuw zodra u online bent, of gebruik Tekst plakken."
            : code === "geen_sleutel" || code === "sleutel_ongeldig"
            ? "De fotoanalyse is op de server nog niet ingesteld (API-sleutel ontbreekt of klopt niet). Gebruik tot die tijd Tekst plakken."
            : code === "geen_functie"
            ? "De fotoanalyse is op deze site nog niet geïnstalleerd. Gebruik tot die tijd Tekst plakken."
            : code === "te_groot"
            ? "De foto is te groot. Maak een foto van alleen de voedingswaardetabel."
            : code === "geweigerd"
            ? "Deze foto kon niet worden verwerkt. Probeer een andere foto of gebruik Tekst plakken."
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
                    Nexa
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
            {nx && !nx.user && (
              <button
                onClick={() => {
                  setOnboarding(null);
                  setAccountOpen("login");
                }}
                className="tap text-sm font-semibold mt-4 mx-auto"
                style={{ color: "var(--accent)" }}
              >
                Al een account? Inloggen
              </button>
            )}
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


      <div
        className="macroapp no-print mx-auto max-w-2xl px-4 pt-6"
        style={{ paddingBottom: trainingActive ? "calc(210px + env(safe-area-inset-bottom, 0px))" : "calc(96px + env(safe-area-inset-bottom, 0px))" }}
      >
        <header className="mb-5">
          <div className="text-xs leading-snug whitespace-nowrap overflow-hidden" style={{ textOverflow: "ellipsis" }}>
            <NexaMark size={13} />{" "}
            <span className="font-bold" style={{ color: C.ink, letterSpacing: "0.01em" }}>
              Nexa
            </span>
            <span style={{ color: C.muted }}> · Your personal performance coach</span>
          </div>
          <div className="flex items-end justify-between gap-3 mt-0.5">
          <h1 className="disp text-4xl font-bold uppercase leading-none tracking-tight">
            {TABS.find((t) => t.id === tab).title}
          </h1>
          {tab === "vandaag" && (
            <div className="text-right text-xs leading-snug" style={{ color: C.muted }}>
              {DAY_FULL[selDay]}
              <br />
              {dayType(selDay) === "training" ? "Trainingsdag" : "Rustdag"}
            </div>
          )}
          </div>
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

            <SyncNotices s={nx} />
            {nx && !nx.user && !nx.notice && !nx.recovery && loaded && accountHint && (
              <div className="mb-3 px-3 py-2.5 flex items-center gap-3" style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: R.field }}>
                <span className="text-xs flex-1 leading-snug" style={{ color: C.muted }}>
                  <strong style={{ color: C.ink }}>Bewaar uw gegevens veilig.</strong> Met een gratis account raakt u niets kwijt als u de app verwijdert of van telefoon wisselt.
                </span>
                <div className="flex flex-col gap-1 shrink-0 items-end">
                  <TBtn small onClick={() => setAccountOpen("signup")}>
                    Account
                  </TBtn>
                  <button onClick={hideAccountHint} className="tap text-xs underline" style={{ color: C.muted }}>
                    Later
                  </button>
                </div>
              </div>
            )}
            {checkinDue && (
              <div className="mb-3 px-3 py-2.5 flex items-center gap-3" style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: R.field }}>
                <span className="text-xs flex-1 leading-snug" style={{ color: C.muted }}>
                  <strong style={{ color: C.ink }}>{lastCheckin ? "Tijd voor uw wekelijkse meting." : "Meet ook uw taille."}</strong>{" "}
                  {lastCheckin
                    ? "Taille en nek met het meetlint, 's ochtends voor het ontbijt. Zo ziet de app of u vet verliest als de weegschaal stilstaat."
                    : "De weegschaal ziet het verschil tussen vet en spier niet. Eén meting per week met het meetlint is genoeg."}
                </span>
                <div className="flex flex-col gap-1 shrink-0 items-end">
                  <TBtn small onClick={() => setCheckinOpen(true)}>
                    Meten
                  </TBtn>
                  <button onClick={snoozeCheckin} className="tap text-xs underline" style={{ color: C.muted }}>
                    Later
                  </button>
                </div>
              </div>
            )}
            <TrainingBoundary quiet>
              <TodayTrainingCard T={T} D={D} onOpen={() => setTab("training")} onStart={startTraining} />
            </TrainingBoundary>

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
        {tab === "training" && (
          <TrainingBoundary onClearActive={() => setT((t) => ({ ...t, active: null }))}>
            <TrainingTab
              T={T}
              setT={setT}
              D={D}
              bw={weight}
              week={week}
              setWeek={setWeek}
              onStart={startTraining}
              summary={trainSummary}
              setSummary={setTrainSummary}
            />
          </TrainingBoundary>
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
                ) : correction && correction.meaningful && advice && advice.suppress && !overrideAdvice ? (
                  <div className="mt-3 rounded px-3 py-2" style={{ background: C.surface2, border: `1px solid ${C.carb}` }}>
                    <p className="text-xs font-semibold" style={{ color: C.carb }}>
                      {advice.title}
                    </p>
                    <p className="text-xs leading-relaxed mt-1" style={{ color: C.ink }}>
                      {advice.text}
                    </p>
                    <button onClick={() => setOverrideAdvice(true)} className="tap text-xs underline mt-2" style={{ color: C.muted }}>
                      Toch bijsturen ({correction.rounded > 0 ? "+" : ""}
                      {correction.rounded} kcal)
                    </button>
                  </div>
                ) : correction && correction.meaningful ? (
                  <div className="mt-3 rounded px-3 py-2" style={{ background: C.warnBg, border: `1px solid ${C.warn}` }}>
                    {advice && !advice.suppress && (
                      <p className="text-xs leading-relaxed mb-1.5" style={{ color: C.warn }}>
                        <strong>{advice.title}.</strong> {advice.text}
                      </p>
                    )}
                    <p className="text-xs leading-relaxed" style={{ color: C.warn }}>
                      U zit {correction.rounded < 0 ? "boven" : "onder"} het geplande tempo. Pas de inname aan met{" "}
                      {correction.rounded > 0 ? "+" : ""}
                      {correction.rounded} kcal per dag.
                    </p>
                    {!waistTrend.ok && (effGoal === "cut" ? correction.rounded < 0 : correction.rounded > 0) && (
                      <p className="text-xs leading-relaxed mt-1.5" style={{ color: C.warn }}>
                        Train u zwaar en eet u genoeg eiwit, dan kan een trage weegschaal ook betekenen dat u spier opbouwt terwijl u vet
                        verliest. Meet een paar weken uw taille; daalt die, dan hoeft u niet bij te sturen.
                      </p>
                    )}
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

        <CompositionSection
          comp={comp}
          checkins={checkins}
          sex={f.sex}
          waistTrend={waistTrend}
          strength={strength}
          bodyFat={f.bodyFat}
          useBodyFat={f.useBodyFat}
          onNew={() => setCheckinOpen(true)}
          onDelete={deleteCheckin}
          onApply={applyComposition}
        />

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
                ? "Steroïdhormonen worden uit cholesterol opgebouwd. Onder 20 procent van de calorieën uit vet daalt het totaal testosteron gemiddeld met ongeveer 10 tot 15 procent. Verhoog het vetaandeel bij de geavanceerde instellingen."
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
        <AccountSection s={nx} />
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
            Versie {APP_VERSION} · opslag: {nx && nx.user ? "apparaat en Nexa-account" : storeMode === "account" ? "account" : storeMode === "device" || storeMode === "nexa" ? "apparaat" : storeMode === "memory" ? "geen" : "via Claude"} ·
            fotoanalyse: {aiPhoto == null ? "wordt gecontroleerd" : aiPhoto.ok ? "beschikbaar" : "niet beschikbaar"}
          </p>
          <p className="mb-2">
            <button onClick={() => setOnboarding(0)} className="tap underline" style={{ color: C.accent }}>
              Opnieuw instellen met de begeleide start
            </button>
          </p>
          <p className="mb-2">
            {nx && nx.user
              ? "Uw gegevens staan op dit apparaat en in uw Nexa-account. Ze blijven bewaard als u de app verwijdert of van telefoon wisselt."
              : nx && (storeMode === "device" || storeMode === "nexa")
              ? "Uw gegevens staan alleen op dit apparaat. Verwijdert u de app, dan zijn ze weg. Maak een gratis account op dit tabblad om ze online te bewaren."
              : storeMode === "account"
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
            Rekenmethode: gangbare formules voor het rustmetabolisme, MET-waarden voor het trainingsverbruik en
            sportvoedingsrichtlijnen voor eiwit, eiwitspreiding en koolhydraattiming. Voedingswaarden zijn afgeronde
            standaardwaarden; controleer de verpakking van uw eigen producten.
          </p>
          <p>
            Dit is een rekenhulp, geen medisch advies. De prognoses zijn schattingen; de weegschaal over meerdere weken
            is de enige echte meting.
          </p>
        </footer>
          </>
        )}
      </div>

      {accountOpen && nx && !nx.user && (
        <Sheet title={accountOpen === "signup" ? "Account maken" : "Inloggen"} onClose={() => setAccountOpen(null)}>
          <p className="text-sm mb-3 leading-relaxed" style={{ color: C.muted }}>
            {accountOpen === "signup"
              ? "Met een account bewaart Nexa uw gegevens online. Verwijdert u de app of krijgt u een nieuwe telefoon, dan logt u in en staat alles er weer."
              : "Log in om de gegevens uit uw account op dit apparaat te zetten."}
          </p>
          <AccountForm initial={accountOpen} onDone={() => setAccountOpen(null)} />
        </Sheet>
      )}

      {checkinOpen && <CheckinSheet sex={f.sex} last={lastCheckin} onSave={saveCheckin} onClose={() => setCheckinOpen(false)} />}

      <TrainingBoundary quiet>
        <WorkoutDock T={T} setT={setT} showOpen={tab !== "training"} onOpen={() => setTab("training")} />
      </TrainingBoundary>

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
        <div className="mx-auto max-w-2xl grid grid-cols-6">
          {TABS.map((t) => {
            const on = tab === t.id;
            const badge =
              !on &&
              ((t.id === "vandaag" && (warnings.length > 0 || !!planUpdate)) ||
                (t.id === "training" && (trainingActive || (!!D.fatigue && !T.block.deloadFrom))));
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
