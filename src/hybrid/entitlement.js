/* Toegang tot Nexa Hybrid. Hybrid is de upgrade boven Nexa Coach:
   - open:      Hybrid-abonnement (hybrid_maand/hybrid_jaar), gratis toegang
                (comp), of de betaalmuur staat uit;
   - upgrade:   wel Nexa Coach, nog geen Hybrid;
   - subscribe: geen lopend abonnement.
   Zonder Nexa-account-laag (binnen Claude) is alles open. */

export const ACTIVE = new Set(["trialing", "active", "past_due", "comp"]);
export const PRICES = { maand: 14.99, jaar: 99.99, hybrid_maand: 19.99, hybrid_jaar: 139.99 };
export const isHybridPlan = (plan) => typeof plan === "string" && plan.startsWith("hybrid_");

export function hybridAccess(nx) {
  const b = nx && nx.billing;
  if (!b || !b.enabled) return { on: false, state: "open", locked: false, loggedIn: !!(nx && nx.user) };
  const loggedIn = !!(nx && nx.user);
  const sub = b.sub && loggedIn && b.subUser === nx.user.id ? b.sub : null;
  const active = !!sub && ACTIVE.has(sub.status);
  const hybrid = active && (sub.status === "comp" || isHybridPlan(sub.plan));
  const state = hybrid ? "open" : active ? "upgrade" : "subscribe";
  return {
    on: true,
    state,
    locked: state !== "open",
    loggedIn,
    sub,
    coachPlan: active && !hybrid ? sub.plan : null,
    prices: { ...PRICES, ...(b.prices || {}) },
    trialDays: b.trialDays || 7,
    hadTrial: !!(sub && (sub.trial_end || sub.stripe_subscription_id)),
    trialing: !!sub && sub.status === "trialing",
    busy: !!b.busy,
    error: b.error || null,
  };
}

/* Meerprijs per maand van Coach naar Hybrid, voor de upgradekaart. */
export function upgradeDelta(prices, coachPlan, target) {
  const perMonth = (k) => (k && k.endsWith("jaar") ? prices[k] / 12 : prices[k]);
  return Math.max(0, perMonth(target) - perMonth(coachPlan || "maand"));
}
