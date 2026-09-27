/* Maakt de schermafbeeldingen voor de landingspagina uit de echte app.
   Gebruik: npm run build, dan `cd dist && python3 -m http.server 8765`
   in een tweede terminal, dan:
     NODE_PATH=$(npm root -g) node design/maak-schermen.cjs
   Schrijft landing/img/<scherm>-<licht|donker>.jpg. De klok staat op een
   donderdagochtend (trainingsdag) met zes weken voorbeeldhistorie. */
const { chromium } = require("playwright");
const path = require("path");
const OUT = path.join(__dirname, "..", "landing", "img");
const BASE = "http://localhost:8765";
const NOW = new Date("2026-09-24T08:40:00");
const DAY = 864e5;
const iso = (d) => new Date(NOW.getTime() - d * DAY).toISOString().slice(0, 10);

function nutrition() {
  const log = [];
  for (let d = 41; d >= 0; d--) {
    const trend = 86.6 - (41 - d) * 0.052;
    const noise = [0.3, -0.2, 0.1, 0.4, -0.3, 0, 0.2][d % 7];
    log.push({ date: iso(d), weight: +(trend + noise).toFixed(1) });
  }
  const checkins = [42, 35, 28, 21, 14, 7, 0].map((d, i) => ({ date: iso(d), waist: +(91.5 - i * 0.45).toFixed(1), neck: 39.5, hip: null, method: null, bf: null }));
  return {
    f: { sex: "man", age: 31, height: 182, weight: 84.4, bodyFat: 18, useBodyFat: true, goal: "cut", rate: -0.5, meals: 4, wake: "07:00", sleep: "23:15" },
    log,
    checkins,
    compAnchor: { date: iso(42), bf: 19, sd: 3, weight: 86.6 },
    onboarded: true,
  };
}

async function seedTraining(page) {
  // schema aanmaken via de app zelf, daarna zes weken voorbeeldtrainingen toevoegen
  await page.getByRole("button", { name: "Training", exact: true }).last().click();
  await page.waitForTimeout(300);
  await page.getByText("Schema aanmaken").click();
  await page.waitForTimeout(1200);
  await page.evaluate(({ now, day }) => {
    const K = "macroverdeling:training:v1";
    const T = JSON.parse(localStorage.getItem(K));
    const p = T.programs[0];
    const lib = { compound: [62, 2.5], isolation: [16, 1] };
    const sessions = [];
    const bases = {};
    const today = new Date(now);
    const mon = new Date(today.getTime() - ((today.getDay() + 6) % 7) * day);
    for (let w = 6; w >= 0; w--) {
      p.weekMap.forEach((dayId, wd) => {
        const d = p.days.find((x) => x.id === dayId);
        if (!d) return;
        const date = new Date(mon.getTime() - w * 7 * day + wd * day + 18 * 3600e3);
        if (date.getTime() >= today.getTime() - 12 * 3600e3) return; // alleen trainingen vóór vandaag
        const k = 6 - w;
        sessions.push({
          id: "s" + w + wd,
          date: date.toISOString().slice(0, 10),
          start: date.getTime(),
          end: date.getTime() + 68 * 60e3,
          programId: p.id,
          dayId: d.id,
          name: d.name,
          rotPos: null,
          deload: false,
          blockPhase: "opbouw",
          blockNumber: 1,
          blockWeek: k + 1,
          nutritionPhase: "cut",
          readiness: null,
          note: "",
          exercises: d.slots.map((s, i) => {
            // één startgewicht per oefening, ook als die op meer dagen voorkomt
            if (!bases[s.exId]) {
              const heavy = i < 2;
              bases[s.exId] = { base: (heavy ? lib.compound[0] : lib.isolation[0]) * (1 - i * 0.06), inc: heavy ? lib.compound[1] : lib.isolation[1] };
            }
            const { base, inc } = bases[s.exId];
            // gelijkmatige progressie: elke week iets meer gewicht, reps binnen de range
            const weight = Math.round((base + k * inc) / inc) * inc;
            const top = s.repMin + 2;
            return {
              id: "e" + w + wd + i,
              slotId: s.id,
              exId: s.exId,
              repMin: s.repMin,
              repMax: s.repMax,
              rest: s.rest,
              rir: 2,
              note: "",
              bwLoad: 0,
              sets: Array.from({ length: s.sets }, (_, j) => ({ type: "work", weight, reps: Math.max(s.repMin, top - j), rir: j ? 1 : 2, done: true })),
            };
          }),
        });
      });
    }
    T.sessions = sessions.sort((a, b) => a.start - b.start);
    // blok 2, derde opbouwweek (geen deload op de schermafbeeldingen)
    T.block = { ...T.block, start: new Date(mon.getTime() - 2 * 7 * day).toISOString().slice(0, 10), number: 2, deloadFrom: null };
    localStorage.setItem(K, JSON.stringify(T));
  }, { now: NOW.getTime(), day: DAY });
}

async function shoot(scheme) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme === "donker" ? "dark" : "light" });
  await ctx.addInitScript((seed) => {
    if (!localStorage.getItem("macroverdeling:v1")) {
      localStorage.setItem("macroverdeling:v1", seed);
      localStorage.setItem("nexa:account-hint", "1");
    }
    localStorage.setItem("nexa:checkin-later", String(Date.now()));
  }, JSON.stringify(nutrition()));
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  await page.route(/supabase\.co|\.netlify\/functions/, (r) => r.abort());
  await page.goto(BASE + "/app/");
  await page.waitForTimeout(1300);
  await seedTraining(page);
  await page.reload();
  await page.waitForTimeout(1300);
  const snap = async (name) => {
    await page.mouse.move(1, 1); // geen hoverpijltjes in invoervelden
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(OUT, `${name}-${scheme}.jpg`), type: "jpeg", quality: 82 });
  };
  const tab = async (n) => {
    await page.getByRole("button", { name: n, exact: true }).last().click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
  };
  await tab("Vandaag");
  await snap("vandaag");
  const toTop = async (loc, offset) => {
    await loc.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.evaluate((o) => window.scrollBy(0, -o), offset);
  };
  await toTop(page.getByText(/^Dagindeling /).first(), 24);
  await snap("maaltijden");
  await tab("Plan");
  await toTop(page.getByText("Lichaamssamenstelling", { exact: true }), 24);
  await snap("samenstelling");
  await tab("Training");
  await page.getByRole("tab", { name: "Inzichten" }).click();
  await page.waitForTimeout(400);
  await snap("inzichten");
  await tab("Vandaag");
  await page.getByRole("button", { name: "Start", exact: true }).first().click();
  await page.waitForTimeout(500);
  const skip = page.getByRole("button", { name: "Overslaan", exact: true });
  if (await skip.count()) await skip.first().click();
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  await snap("training");
  await b.close();
}

(async () => {
  for (const s of ["licht", "donker"]) await shoot(s);
  console.log("klaar");
})();
