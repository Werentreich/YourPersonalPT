/* Bewegingenbibliotheek voor hybride training.

   Anders dan in een krachtschema wordt niet alles in sets × herhalingen × kg
   gemeten: roeien in meters, tijd of calorieën, een sled push in meters met
   gewicht, een plank in seconden, box jumps in herhalingen met hoogte.
   `metrics` geeft per beweging de mogelijke maten, de eerste is de standaard.

   - cat:   cardio (monostructureel), last (sled, dragen, strongman), lichaam
            (gymnastiek, lichaamsgewicht, plyometrie), gewicht (halter,
            kettlebell, dumbbell, medicine ball, sandbag), houding (core,
            vasthouden), mobiliteit
   - sport: duursport waar de meters bij optellen (roeimeters in een WOD
            tellen mee bij roeien)
   - legs/upper: aandeel benen en bovenlichaam (de rest is centraal)
   - perHand: gewicht per hand (dumbbells, kettlebells bij dragen)
   - uni:   eenzijdig mogelijk; herhalingen kunnen "per kant" zijn
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
  mobiliteit: { label: "Mobiliteit", legs: 0.3, upper: 0.3 },
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
  M("side_plank", "Side plank", "houding", ["time"], { uni: true, work: { time: 1 } }),
  M("copenhagen", "Copenhagen plank", "houding", ["time"], { legs: 0.5, upper: 0.1, uni: true, work: { time: 1 } }),
  M("l_sit", "L-sit", "houding", ["time"], { legs: 0.2, upper: 0.5, work: { time: 1 } }),
  M("handstand_hold", "Handstand hold", "houding", ["time"], { legs: 0, upper: 0.8, work: { time: 1 } }),
  M("farmers_hold", "Farmers hold", "houding", ["time", "kg"], { legs: 0.2, upper: 0.6, perHand: true, work: { time: 1 } }),
  M("dead_bug", "Dead bug", "houding", ["reps", "time"], { legs: 0.1, upper: 0.1, work: { reps: 2, time: 1 } }),
  M("bird_dog", "Bird dog", "houding", ["reps", "time"], { legs: 0.2, upper: 0.2, uni: true, work: { reps: 2.5, time: 1 } }),
  M("pallof", "Pallof press", "houding", ["reps", "kg"], { legs: 0.1, upper: 0.4, uni: true, work: { reps: 2 } }),

  // extra cardio en conditie
  M("treadmill_walk", "Hellingwandelen (loopband)", "cardio", ["time", "distance"], { sport: "wandelen", legs: 0.75, upper: 0.05, work: { time: 1, distance: 0.6 } }),
  M("stair", "Stepper / traploper", "cardio", ["time", "reps"], { sport: "stepper", legs: 0.8, upper: 0.05, work: { time: 1, reps: 0.8 } }),
  M("sprint", "Sprint", "cardio", ["distance", "time"], { sport: "hardlopen", legs: 0.85, upper: 0.05, work: { distance: 0.18, time: 1 } }),
  M("hill_sprint", "Heuvelsprint", "cardio", ["distance", "time"], { sport: "hardlopen", legs: 0.85, upper: 0.05, work: { distance: 0.25, time: 1 } }),
  M("ruck", "Rucken (wandelen met gewicht)", "cardio", ["distance", "time", "kg"], { sport: "wandelen", legs: 0.7, upper: 0.15, work: { distance: 0.6, time: 1 } }),
  M("walk", "Wandelen", "cardio", ["distance", "time"], { sport: "wandelen", legs: 0.5, upper: 0.05, work: { distance: 0.5, time: 1 } }),
  M("cycle", "Fietsen (buiten of spinning)", "cardio", ["distance", "time", "cal"], { sport: "fietsen", legs: 0.65, upper: 0.05, work: { distance: 0.12, time: 1, cal: 3.5 } }),
  M("swim_free", "Zwemmen: borstcrawl", "cardio", ["distance", "time"], { sport: "zwemmen", legs: 0.15, upper: 0.6, work: { distance: 1, time: 1 } }),
  M("swim_breast", "Zwemmen: schoolslag", "cardio", ["distance", "time"], { sport: "zwemmen", legs: 0.45, upper: 0.35, work: { distance: 1.3, time: 1 } }),
  M("swim_back", "Zwemmen: rugslag", "cardio", ["distance", "time"], { sport: "zwemmen", legs: 0.15, upper: 0.6, work: { distance: 1.1, time: 1 } }),
  M("swim_fly", "Zwemmen: vlinderslag", "cardio", ["distance", "time"], { sport: "zwemmen", legs: 0.2, upper: 0.65, work: { distance: 1.2, time: 1 } }),
  M("battle_ropes", "Battle ropes", "cardio", ["time"], { legs: 0.15, upper: 0.65, work: { time: 1 } }),
  M("burpee_over_bar", "Burpees over de stang", "lichaam", ["reps"], { legs: 0.45, upper: 0.4, work: { reps: 4 } }),
  M("lateral_burpee", "Laterale burpees (over iets)", "lichaam", ["reps"], { legs: 0.45, upper: 0.4, work: { reps: 4 } }),
  M("burpee_box_jump_over", "Burpee box jump-overs", "lichaam", ["reps", "height"], { legs: 0.55, upper: 0.35, work: { reps: 5 } }),
  M("box_jump_over", "Box jump-overs", "lichaam", ["reps", "height"], { legs: 0.85, upper: 0.05, work: { reps: 3 } }),

  // plyometrie
  M("broad_jumps", "Broad jumps", "lichaam", ["reps", "distance"], { legs: 0.9, upper: 0.05, work: { reps: 3, distance: 1.5 } }),
  M("tuck_jumps", "Tuck jumps", "lichaam", ["reps"], { legs: 0.85, upper: 0.05, work: { reps: 2 } }),
  M("jump_squats", "Jump squats", "lichaam", ["reps", "kg"], { legs: 0.9, upper: 0, work: { reps: 2 } }),
  M("jumping_lunges", "Jumping lunges", "lichaam", ["reps"], { legs: 0.9, upper: 0, work: { reps: 1.8 } }),
  M("skater_jumps", "Skater jumps", "lichaam", ["reps"], { legs: 0.85, upper: 0.05, work: { reps: 1.5 } }),
  M("bounding", "Bounding", "lichaam", ["distance", "reps"], { legs: 0.9, upper: 0.05, work: { distance: 0.4, reps: 1 } }),
  M("lateral_hops", "Laterale sprongen", "lichaam", ["reps", "time"], { legs: 0.85, upper: 0, work: { reps: 0.8, time: 1 } }),
  M("depth_jumps", "Depth jumps", "lichaam", ["reps", "height"], { legs: 0.9, upper: 0, work: { reps: 6 } }),

  // extra gymnastiek
  M("strict_pull_ups", "Strikte pull-ups", "lichaam", ["reps", "kg"], { legs: 0, upper: 0.85, work: { reps: 3 } }),
  M("ring_rows", "Ring rows", "lichaam", ["reps"], { legs: 0, upper: 0.8, work: { reps: 2 } }),
  M("inverted_rows", "Inverted rows", "lichaam", ["reps"], { legs: 0, upper: 0.8, work: { reps: 2 } }),
  M("k2e", "Knees-to-elbows", "lichaam", ["reps"], { legs: 0.1, upper: 0.6, work: { reps: 2.5 } }),
  M("hanging_knee_raise", "Hanging knee raises", "lichaam", ["reps"], { legs: 0.1, upper: 0.5, work: { reps: 2 } }),
  M("strict_hspu", "Strikte handstand push-ups", "lichaam", ["reps"], { legs: 0, upper: 0.85, work: { reps: 4 } }),
  M("pike_push_ups", "Pike push-ups", "lichaam", ["reps"], { legs: 0, upper: 0.8, work: { reps: 2.5 } }),
  M("hr_push_ups", "Hand-release push-ups", "lichaam", ["reps"], { legs: 0, upper: 0.8, work: { reps: 2.5 } }),
  M("wall_walks", "Wall walks", "lichaam", ["reps"], { legs: 0.05, upper: 0.8, work: { reps: 10 } }),
  M("bar_muscle_ups", "Bar muscle-ups", "lichaam", ["reps"], { legs: 0, upper: 0.85, work: { reps: 5 } }),
  M("ring_muscle_ups", "Ring muscle-ups", "lichaam", ["reps"], { legs: 0, upper: 0.85, work: { reps: 6 } }),
  M("legless_rope", "Legless rope climbs", "lichaam", ["reps"], { legs: 0, upper: 0.9, work: { reps: 20 } }),
  M("pegboard", "Pegboard", "lichaam", ["reps"], { legs: 0, upper: 0.9, work: { reps: 25 } }),
  M("back_ext", "Back extensions", "lichaam", ["reps", "kg"], { legs: 0.5, upper: 0.2, work: { reps: 2 } }),
  M("ghd_hip_ext", "GHD hip extensions", "lichaam", ["reps"], { legs: 0.5, upper: 0.2, work: { reps: 2 } }),
  M("nordic", "Nordic hamstring curls", "lichaam", ["reps"], { legs: 0.9, upper: 0, work: { reps: 5 } }),
  M("step_ups", "Step-ups", "lichaam", ["reps", "kg", "height"], { legs: 0.85, upper: 0.05, uni: true, work: { reps: 2.5 } }),
  M("bulgarian", "Bulgarian split squats", "gewicht", ["reps", "kg"], { legs: 0.9, upper: 0.05, uni: true, perHand: true, work: { reps: 3 } }),
  M("cossack", "Cossack squats", "lichaam", ["reps", "kg"], { legs: 0.85, upper: 0, uni: true, work: { reps: 3 } }),

  // extra halter, kettlebell en dumbbell
  M("bench_press", "Bankdrukken", "gewicht", ["reps", "kg"], { legs: 0, upper: 0.9, work: { reps: 3 }, muscle: "borst" }),
  M("strict_press", "Strict press", "gewicht", ["reps", "kg"], { legs: 0.05, upper: 0.85, work: { reps: 3 } }),
  M("split_jerk", "Split jerk", "gewicht", ["reps", "kg"], { legs: 0.4, upper: 0.55, work: { reps: 3.5 } }),
  M("hang_squat_clean", "Hang squat clean", "gewicht", ["reps", "kg"], { legs: 0.6, upper: 0.35, work: { reps: 3.5 } }),
  M("clean", "Clean (vanaf de vloer)", "gewicht", ["reps", "kg"], { legs: 0.6, upper: 0.35, work: { reps: 3.5 } }),
  M("hang_power_snatch", "Hang power snatch", "gewicht", ["reps", "kg"], { legs: 0.5, upper: 0.45, work: { reps: 3 } }),
  M("muscle_snatch", "Muscle snatch", "gewicht", ["reps", "kg"], { legs: 0.3, upper: 0.65, work: { reps: 2.5 } }),
  M("snatch_balance", "Snatch balance", "gewicht", ["reps", "kg"], { legs: 0.6, upper: 0.35, work: { reps: 3 } }),
  M("clusters", "Clusters (squat clean thruster)", "gewicht", ["reps", "kg"], { legs: 0.6, upper: 0.35, work: { reps: 4 } }),
  M("rdl", "Roemeense deadlift", "gewicht", ["reps", "kg"], { legs: 0.75, upper: 0.15, work: { reps: 3 }, muscle: "hamstrings" }),
  M("trap_bar_dl", "Trap bar deadlift", "gewicht", ["reps", "kg"], { legs: 0.8, upper: 0.15, work: { reps: 3 }, muscle: "quadriceps" }),
  M("sumo_dl", "Sumo deadlift", "gewicht", ["reps", "kg"], { legs: 0.8, upper: 0.15, work: { reps: 3 }, muscle: "quadriceps" }),
  M("good_morning", "Good mornings", "gewicht", ["reps", "kg"], { legs: 0.7, upper: 0.15, work: { reps: 3 }, muscle: "hamstrings" }),
  M("hip_thrust", "Hip thrusts", "gewicht", ["reps", "kg"], { legs: 0.9, upper: 0, work: { reps: 2.5 }, muscle: "bilspieren" }),
  M("lunge_bb", "Lunges met halter", "gewicht", ["reps", "kg", "distance"], { legs: 0.9, upper: 0.05, uni: true, work: { reps: 3, distance: 1.2 } }),
  M("front_rack_lunge", "Front rack lunges", "gewicht", ["reps", "kg", "distance"], { legs: 0.85, upper: 0.1, uni: true, work: { reps: 3, distance: 1.2 } }),
  M("weighted_pull_ups", "Pull-ups met gewicht", "gewicht", ["reps", "kg"], { legs: 0, upper: 0.9, work: { reps: 3.5 }, muscle: "rug" }),
  M("weighted_dips", "Dips met gewicht", "gewicht", ["reps", "kg"], { legs: 0, upper: 0.9, work: { reps: 3 }, muscle: "borst" }),
  M("bb_row", "Barbell rows", "gewicht", ["reps", "kg"], { legs: 0.1, upper: 0.8, work: { reps: 2.5 }, muscle: "rug" }),
  M("kb_clean", "Kettlebell cleans", "gewicht", ["reps", "kg"], { legs: 0.5, upper: 0.4, uni: true, work: { reps: 2 } }),
  M("kb_press", "Kettlebell press", "gewicht", ["reps", "kg"], { legs: 0.05, upper: 0.85, uni: true, work: { reps: 2.5 } }),
  M("kb_swing_american", "Kettlebell swings (boven het hoofd)", "gewicht", ["reps", "kg"], { legs: 0.55, upper: 0.35, work: { reps: 2 } }),
  M("kb_swing_1arm", "Eenarmige kettlebell swings", "gewicht", ["reps", "kg"], { legs: 0.55, upper: 0.35, uni: true, work: { reps: 1.7 } }),
  M("db_clean_jerk", "Dumbbell clean and jerk", "gewicht", ["reps", "kg"], { legs: 0.45, upper: 0.45, uni: true, work: { reps: 3 } }),
  M("db_box_step_over", "Dumbbell box step-overs", "gewicht", ["reps", "kg", "height"], { legs: 0.85, upper: 0.05, perHand: true, work: { reps: 2.8 } }),
  M("man_makers", "Man makers", "gewicht", ["reps", "kg"], { legs: 0.4, upper: 0.5, perHand: true, work: { reps: 7 } }),
  // aanvullend voor hybride kracht (spiergroei, lopers)
  M("db_bench", "Dumbbell bankdrukken", "gewicht", ["reps", "kg"], { legs: 0, upper: 0.9, perHand: true, work: { reps: 3 }, muscle: "borst" }),
  M("incline_db", "Schuine dumbbell press", "gewicht", ["reps", "kg"], { legs: 0, upper: 0.9, perHand: true, work: { reps: 3 }, muscle: "borst" }),
  M("db_row", "Eenarmige dumbbell row", "gewicht", ["reps", "kg"], { legs: 0.05, upper: 0.85, uni: true, work: { reps: 2.5 }, muscle: "rug" }),
  M("lat_pulldown", "Lat pulldown", "gewicht", ["reps", "kg"], { legs: 0, upper: 0.9, work: { reps: 3 }, muscle: "rug" }),
  M("face_pull", "Face pulls", "gewicht", ["reps", "kg"], { legs: 0, upper: 0.8, work: { reps: 2.5 }, muscle: "schouders" }),
  M("lateral_raise", "Lateral raises", "gewicht", ["reps", "kg"], { legs: 0, upper: 0.8, perHand: true, work: { reps: 2.5 }, muscle: "schouders" }),
  M("sl_rdl", "Eenbenige Roemeense deadlift", "gewicht", ["reps", "kg"], { legs: 0.8, upper: 0.1, uni: true, work: { reps: 3 }, muscle: "hamstrings" }),
  M("leg_curl", "Hamstring curl", "gewicht", ["reps", "kg"], { legs: 0.85, upper: 0, work: { reps: 3 }, muscle: "hamstrings" }),
  M("leg_press", "Leg press", "gewicht", ["reps", "kg"], { legs: 0.9, upper: 0, work: { reps: 3 }, muscle: "quadriceps" }),
  M("calf_raise", "Kuitheffen (staand)", "gewicht", ["reps", "kg"], { legs: 0.6, upper: 0, work: { reps: 2 }, muscle: "kuiten" }),
  M("tib_raise", "Tibialis raises", "lichaam", ["reps"], { legs: 0.4, upper: 0, work: { reps: 1.5 }, muscle: "kuiten" }),
  M("pogo", "Pogo jumps", "lichaam", ["reps", "time"], { legs: 0.7, upper: 0, work: { reps: 0.6, time: 1 } }),
  M("landmine_press", "Landmine press", "gewicht", ["reps", "kg"], { legs: 0.1, upper: 0.8, uni: true, work: { reps: 2.5 } }),
  M("med_ball_clean", "Medicine ball cleans", "gewicht", ["reps", "kg"], { legs: 0.6, upper: 0.3, work: { reps: 2 } }),
  M("ball_over_shoulder", "Slam ball over de schouder", "gewicht", ["reps", "kg"], { legs: 0.55, upper: 0.35, work: { reps: 2.5 } }),
  M("chest_pass", "Medicine ball chest pass", "gewicht", ["reps", "kg"], { legs: 0.1, upper: 0.7, work: { reps: 1.5 } }),
  M("rot_throw", "Rotatieworp medicine ball", "gewicht", ["reps", "kg"], { legs: 0.3, upper: 0.5, uni: true, work: { reps: 2 } }),
  M("russian_twist", "Russian twists", "gewicht", ["reps", "kg"], { legs: 0.05, upper: 0.3, work: { reps: 1 } }),

  // strongman en dragen
  M("yoke", "Yoke carry", "last", ["distance", "kg"], { legs: 0.7, upper: 0.2, work: { distance: 1.2 } }),
  M("suitcase_carry", "Suitcase carry", "last", ["distance", "kg"], { legs: 0.35, upper: 0.45, uni: true, work: { distance: 0.6 } }),
  M("overhead_carry", "Overhead carry", "last", ["distance", "kg"], { legs: 0.3, upper: 0.6, work: { distance: 0.7 } }),
  M("front_rack_carry", "Front rack carry", "last", ["distance", "kg"], { legs: 0.4, upper: 0.5, perHand: true, work: { distance: 0.7 } }),
  M("sled_drag", "Sled drag (achteruit)", "last", ["distance", "kg"], { legs: 0.8, upper: 0.1, work: { distance: 1.1 } }),
  M("sled_sprint", "Sled sprint", "last", ["distance", "kg"], { legs: 0.85, upper: 0.1, work: { distance: 0.6 } }),
  M("sandbag_clean", "Sandbag cleans", "gewicht", ["reps", "kg"], { legs: 0.55, upper: 0.4, work: { reps: 3 } }),
  M("sandbag_shoulder", "Sandbag to shoulder", "gewicht", ["reps", "kg"], { legs: 0.55, upper: 0.4, work: { reps: 3.5 } }),
  M("atlas_stone", "Atlas stones", "gewicht", ["reps", "kg"], { legs: 0.55, upper: 0.4, work: { reps: 8 } }),
  M("tire_flip", "Bandenflip", "gewicht", ["reps", "kg"], { legs: 0.55, upper: 0.4, work: { reps: 8 } }),
  M("keg_carry", "Keg carry", "last", ["distance", "kg"], { legs: 0.5, upper: 0.4, work: { distance: 0.8 } }),

  // mobiliteit
  M("mob_flow", "Mobiliteitsflow", "mobiliteit", ["time"], { legs: 0.3, upper: 0.3, work: { time: 1 } }),
  M("yoga", "Yoga", "mobiliteit", ["time"], { legs: 0.3, upper: 0.3, work: { time: 1 } }),
  M("foam_roll", "Foamrollen", "mobiliteit", ["time"], { legs: 0.4, upper: 0.2, work: { time: 1 } }),
  M("stretch_hips", "Heupen stretchen", "mobiliteit", ["time"], { legs: 0.6, upper: 0, uni: true, work: { time: 1 } }),
  M("stretch_hamstrings", "Hamstrings stretchen", "mobiliteit", ["time"], { legs: 0.7, upper: 0, uni: true, work: { time: 1 } }),
  M("stretch_shoulders", "Schouders en borst stretchen", "mobiliteit", ["time"], { legs: 0, upper: 0.7, uni: true, work: { time: 1 } }),
  M("ankle_mob", "Enkelmobiliteit", "mobiliteit", ["time", "reps"], { legs: 0.7, upper: 0, uni: true, work: { time: 1, reps: 2 } }),
  M("thoracic_mob", "Thoracale mobiliteit", "mobiliteit", ["time", "reps"], { legs: 0, upper: 0.5, work: { time: 1, reps: 2 } }),
  M("cars", "CARs (gecontroleerde gewrichtsrotaties)", "mobiliteit", ["reps", "time"], { legs: 0.3, upper: 0.3, work: { reps: 6, time: 1 } }),
  M("breathing", "Ademhaling / ontspanning", "mobiliteit", ["time"], { legs: 0, upper: 0, work: { time: 1 } }),
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
