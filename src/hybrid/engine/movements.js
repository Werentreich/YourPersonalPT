/* Bewegingenbibliotheek voor hybride training.

   Anders dan in een krachtschema wordt niet alles in sets × herhalingen × kg
   gemeten: roeien in meters, tijd of calorieën, een sled push in meters met
   gewicht, een plank in seconden, box jumps in herhalingen met hoogte.
   `metrics` geeft per beweging de mogelijke maten, de eerste is de standaard.

   - cat:   cardio (monostructureel), last (sled en dragen), lichaam
            (gymnastiek en lichaamsgewicht), gewicht (halter, kettlebell,
            dumbbell, medicine ball), houding (tijd vasthouden)
   - sport: duursport waar de meters bij optellen (roeimeters in een WOD
            tellen mee bij roeien)
   - legs/upper: aandeel benen en bovenlichaam (de rest is centraal)
   - perHand: gewicht per hand (dumbbells, kettlebells bij dragen)
   - work: geschatte werktijd per eenheid in seconden, voor de duur en de
            verdeling van de belasting (per herhaling, per meter of per cal) */

export const METRICS = {
  reps: { label: "Herhalingen", short: "herh.", unit: "" },
  distance: { label: "Meters", short: "m", unit: "m" },
  time: { label: "Tijd", short: "tijd", unit: "" },
  cal: { label: "Calorieën", short: "cal", unit: "cal" },
  kg: { label: "Gewicht", short: "kg", unit: "kg" },
  height: { label: "Hoogte", short: "cm", unit: "cm" },
};

export const CATS = {
  cardio: { label: "Cardio", legs: 0.55, upper: 0.2 },
  last: { label: "Sled en dragen", legs: 0.55, upper: 0.3 },
  lichaam: { label: "Lichaamsgewicht", legs: 0.3, upper: 0.5 },
  gewicht: { label: "Gewicht", legs: 0.45, upper: 0.4 },
  houding: { label: "Core en houding", legs: 0.15, upper: 0.3 },
};

const M = (id, name, cat, metrics, extra = {}) => ({ id, name, cat, metrics, ...extra });

export const MOVEMENTS = [
  // cardio
  M("run", "Hardlopen", "cardio", ["distance", "time"], { sport: "hardlopen", legs: 0.75, upper: 0.05, work: { distance: 0.3, time: 1 } }),
  M("row", "Roeien (ergometer)", "cardio", ["distance", "time", "cal"], { sport: "roeien", legs: 0.4, upper: 0.35, work: { distance: 0.22, time: 1, cal: 4 } }),
  M("ski", "SkiErg", "cardio", ["distance", "time", "cal"], { sport: "skierg", legs: 0.2, upper: 0.55, work: { distance: 0.24, time: 1, cal: 4.5 } }),
  M("bike_erg", "BikeErg", "cardio", ["distance", "time", "cal"], { sport: "fietsen", legs: 0.65, upper: 0.05, work: { distance: 0.1, time: 1, cal: 3.5 } }),
  M("air_bike", "Air bike (assault/echo)", "cardio", ["cal", "time", "distance"], { legs: 0.45, upper: 0.3, work: { cal: 3, time: 1, distance: 0.12 } }),
  M("swim", "Zwemmen", "cardio", ["distance", "time"], { sport: "zwemmen", legs: 0.15, upper: 0.55, work: { distance: 1, time: 1 } }),
  M("shuttle", "Shuttle runs", "cardio", ["distance", "reps"], { legs: 0.75, upper: 0.05, work: { distance: 0.35, reps: 8 } }),
  M("jump_rope", "Touwtjespringen", "cardio", ["reps", "time"], { legs: 0.6, upper: 0.15, work: { reps: 0.5, time: 1 } }),
  M("double_unders", "Double unders", "cardio", ["reps"], { legs: 0.6, upper: 0.2, work: { reps: 0.7 } }),

  // sled en dragen
  M("sled_push", "Sled push", "last", ["distance", "kg"], { legs: 0.8, upper: 0.15, work: { distance: 1.2 } }),
  M("sled_pull", "Sled pull", "last", ["distance", "kg"], { legs: 0.45, upper: 0.45, work: { distance: 1.4 } }),
  M("farmers", "Farmers carry", "last", ["distance", "kg"], { legs: 0.4, upper: 0.45, perHand: true, work: { distance: 0.6 } }),
  M("sandbag_carry", "Sandbag carry", "last", ["distance", "kg"], { legs: 0.5, upper: 0.4, work: { distance: 0.7 } }),
  M("sandbag_lunges", "Sandbag lunges", "last", ["distance", "kg"], { legs: 0.85, upper: 0.1, work: { distance: 1.3 } }),
  M("walking_lunges", "Walking lunges", "last", ["distance", "reps", "kg"], { legs: 0.85, upper: 0.05, work: { distance: 1.1, reps: 2 } }),
  M("burpee_bj", "Burpee broad jumps", "last", ["distance", "reps"], { legs: 0.6, upper: 0.3, work: { distance: 1.6, reps: 4 } }),
  M("bear_crawl", "Bear crawl", "last", ["distance"], { legs: 0.35, upper: 0.5, work: { distance: 1.5 } }),
  M("handstand_walk", "Handstand walk", "lichaam", ["distance"], { legs: 0, upper: 0.85, work: { distance: 1.5 } }),

  // lichaamsgewicht
  M("burpees", "Burpees", "lichaam", ["reps"], { legs: 0.45, upper: 0.4, work: { reps: 3.5 } }),
  M("air_squats", "Air squats", "lichaam", ["reps"], { legs: 0.85, upper: 0, work: { reps: 1.8 } }),
  M("push_ups", "Push-ups", "lichaam", ["reps"], { legs: 0, upper: 0.8, work: { reps: 2 } }),
  M("pull_ups", "Pull-ups", "lichaam", ["reps"], { legs: 0, upper: 0.85, work: { reps: 2.2 } }),
  M("c2b", "Chest-to-bar pull-ups", "lichaam", ["reps"], { legs: 0, upper: 0.85, work: { reps: 2.4 } }),
  M("t2b", "Toes-to-bar", "lichaam", ["reps"], { legs: 0.1, upper: 0.6, work: { reps: 2.5 } }),
  M("hspu", "Handstand push-ups", "lichaam", ["reps"], { legs: 0, upper: 0.85, work: { reps: 3 } }),
  M("dips_ring", "Ring dips", "lichaam", ["reps"], { legs: 0, upper: 0.85, work: { reps: 2.5 } }),
  M("muscle_ups", "Muscle-ups (ring of stang)", "lichaam", ["reps"], { legs: 0, upper: 0.85, work: { reps: 5 } }),
  M("box_jumps", "Box jumps", "lichaam", ["reps", "height"], { legs: 0.85, upper: 0.05, work: { reps: 2.5 } }),
  M("box_step_overs", "Box step-overs", "lichaam", ["reps", "kg", "height"], { legs: 0.85, upper: 0.05, work: { reps: 2.5 } }),
  M("pistols", "Pistol squats", "lichaam", ["reps"], { legs: 0.9, upper: 0, work: { reps: 3 } }),
  M("sit_ups", "Sit-ups", "lichaam", ["reps"], { legs: 0.1, upper: 0.3, work: { reps: 1.5 } }),
  M("ghd_sit_ups", "GHD sit-ups", "lichaam", ["reps"], { legs: 0.2, upper: 0.3, work: { reps: 2.5 } }),
  M("v_ups", "V-ups", "lichaam", ["reps"], { legs: 0.15, upper: 0.3, work: { reps: 1.8 } }),
  M("mountain_climbers", "Mountain climbers", "lichaam", ["reps", "time"], { legs: 0.4, upper: 0.35, work: { reps: 0.6, time: 1 } }),
  M("rope_climbs", "Rope climbs", "lichaam", ["reps"], { legs: 0.1, upper: 0.85, work: { reps: 15 } }),

  // gewicht
  M("wall_balls", "Wall balls", "gewicht", ["reps", "kg", "height"], { legs: 0.6, upper: 0.35, work: { reps: 2.5 } }),
  M("thrusters", "Thrusters", "gewicht", ["reps", "kg"], { legs: 0.55, upper: 0.4, work: { reps: 2.5 } }),
  M("db_thrusters", "Dumbbell thrusters", "gewicht", ["reps", "kg"], { legs: 0.55, upper: 0.4, perHand: true, work: { reps: 2.5 } }),
  M("kb_swings", "Kettlebell swings", "gewicht", ["reps", "kg"], { legs: 0.6, upper: 0.3, work: { reps: 1.6 } }),
  M("kb_goblet", "Goblet squats", "gewicht", ["reps", "kg"], { legs: 0.85, upper: 0.1, work: { reps: 2.5 } }),
  M("kb_snatch", "Kettlebell snatch", "gewicht", ["reps", "kg"], { legs: 0.45, upper: 0.45, work: { reps: 2 } }),
  M("db_snatch", "Dumbbell snatch", "gewicht", ["reps", "kg"], { legs: 0.45, upper: 0.45, work: { reps: 2.2 } }),
  M("devil_press", "Devil press", "gewicht", ["reps", "kg"], { legs: 0.4, upper: 0.5, perHand: true, work: { reps: 5 } }),
  M("db_step_ups", "Dumbbell step-ups", "gewicht", ["reps", "kg"], { legs: 0.85, upper: 0.05, perHand: true, work: { reps: 2.5 } }),
  M("power_clean", "Power clean", "gewicht", ["reps", "kg"], { legs: 0.6, upper: 0.35, work: { reps: 3 } }),
  M("hang_power_clean", "Hang power clean", "gewicht", ["reps", "kg"], { legs: 0.5, upper: 0.4, work: { reps: 3 } }),
  M("squat_clean", "Squat clean", "gewicht", ["reps", "kg"], { legs: 0.65, upper: 0.3, work: { reps: 3.5 } }),
  M("clean_jerk", "Clean and jerk", "gewicht", ["reps", "kg"], { legs: 0.55, upper: 0.4, work: { reps: 5 } }),
  M("power_snatch", "Power snatch", "gewicht", ["reps", "kg"], { legs: 0.55, upper: 0.4, work: { reps: 3 } }),
  M("snatch", "Snatch", "gewicht", ["reps", "kg"], { legs: 0.6, upper: 0.35, work: { reps: 4 } }),
  M("push_press", "Push press", "gewicht", ["reps", "kg"], { legs: 0.3, upper: 0.65, work: { reps: 2.5 } }),
  M("push_jerk", "Push jerk", "gewicht", ["reps", "kg"], { legs: 0.35, upper: 0.6, work: { reps: 3 } }),
  M("ohs", "Overhead squat", "gewicht", ["reps", "kg"], { legs: 0.7, upper: 0.25, work: { reps: 3 } }),
  M("front_squat", "Front squat", "gewicht", ["reps", "kg"], { legs: 0.85, upper: 0.1, work: { reps: 3 } }),
  M("back_squat", "Back squat", "gewicht", ["reps", "kg"], { legs: 0.85, upper: 0.05, work: { reps: 3 }, muscle: "quadriceps" }),
  M("deadlift", "Deadlift", "gewicht", ["reps", "kg"], { legs: 0.7, upper: 0.25, work: { reps: 3 }, muscle: "hamstrings" }),
  M("sdhp", "Sumo deadlift high pull", "gewicht", ["reps", "kg"], { legs: 0.5, upper: 0.45, work: { reps: 2.5 } }),
  M("ball_slams", "Medicine ball slams", "gewicht", ["reps", "kg"], { legs: 0.3, upper: 0.55, work: { reps: 2 } }),
  M("tgu", "Turkish get-up", "gewicht", ["reps", "kg"], { legs: 0.35, upper: 0.5, work: { reps: 20 } }),
  M("renegade_row", "Renegade rows", "gewicht", ["reps", "kg"], { legs: 0, upper: 0.8, perHand: true, work: { reps: 3 } }),

  // houding
  M("plank", "Plank", "houding", ["time"], { work: { time: 1 } }),
  M("hollow_hold", "Hollow hold", "houding", ["time"], { work: { time: 1 } }),
  M("wall_sit", "Wall sit", "houding", ["time"], { legs: 0.8, upper: 0, work: { time: 1 } }),
  M("dead_hang", "Dead hang", "houding", ["time"], { legs: 0, upper: 0.7, work: { time: 1 } }),
];

const INDEX = Object.fromEntries(MOVEMENTS.map((m) => [m.id, m]));

/* Bewegingen uit de Nexa-krachtbibliotheek tellen ook mee: altijd
   herhalingen × kg. Verwijzing als "nexa:<id>". */
let nexaIndex = {};
export function registerNexaExercises(list) {
  nexaIndex = Object.fromEntries((list || []).map((e) => [e.id, e]));
}

const LEG_MUSCLES = new Set(["quadriceps", "hamstrings", "bilspieren", "kuiten", "adductoren", "abductoren"]);

export function movementById(id) {
  if (!id) return null;
  if (INDEX[id]) return INDEX[id];
  const nid = id.startsWith("nexa:") ? id.slice(5) : id;
  const ex = nexaIndex[nid];
  if (ex) {
    const legs = (ex.pri || []).some((m) => LEG_MUSCLES.has(m));
    return { id: "nexa:" + ex.id, name: ex.name, cat: "gewicht", metrics: ["reps", "kg"], legs: legs ? 0.85 : 0.05, upper: legs ? 0.05 : 0.85, work: { reps: 3 }, muscle: (ex.pri || [])[0], nexa: true };
  }
  return null;
}

/* Zoeken op naam in beide bibliotheken; hybride bewegingen eerst. */
export function searchMovements(q, limit = 8) {
  const t = String(q || "").trim().toLowerCase();
  if (!t) return [];
  const own = MOVEMENTS.filter((m) => m.name.toLowerCase().includes(t));
  const seen = new Set(own.map((m) => m.name.toLowerCase()));
  const nexa = Object.values(nexaIndex)
    .filter((e) => e.name.toLowerCase().includes(t) && !seen.has(e.name.toLowerCase()))
    .map((e) => movementById("nexa:" + e.id));
  return [...own, ...nexa].slice(0, limit);
}

/* Systeemverdeling van een beweging (vrije beweging: middenwaarde). */
export function movementSystems(mv) {
  if (!mv) return { legs: 0.4, upper: 0.4 };
  const c = CATS[mv.cat] || CATS.gewicht;
  return { legs: mv.legs ?? c.legs, upper: mv.upper ?? c.upper };
}

export const isCardio = (mv) => !!mv && mv.cat === "cardio";
