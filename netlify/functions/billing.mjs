/* Abonnement Nexa Coach.

   GET                                   -> { enabled, trialDays, prices }
   POST { action: "checkout", plan }     -> { url } naar Stripe Checkout
   POST { action: "portal" }             -> { url } naar het Stripe-klantportaal
   POST vereist het toegangstoken van de Supabase-sessie (Authorization: Bearer).

   Proefperiode: zeven dagen, betaalgegevens vooraf, eenmalig per account.
   Stripe mailt vóór het einde van de proef een herinnering als dat in het
   dashboard aanstaat (Settings > Billing > Subscriptions and emails). */
import {
  PLANS,
  TRIAL_DAYS,
  billingEnabled,
  entitled,
  getSub,
  json,
  priceFor,
  sameOrigin,
  stripe,
  upsertSub,
  userFromRequest,
} from "../lib/billing-core.mjs";

export default async (req) => {
  if (req.method === "GET") {
    return json(200, {
      enabled: billingEnabled(),
      trialDays: TRIAL_DAYS,
      prices: { maand: PLANS.maand.amount / 100, jaar: PLANS.jaar.amount / 100 },
    });
  }
  if (req.method !== "POST") return json(405, { ok: false, code: "methode" });
  if (!sameOrigin(req)) return json(403, { ok: false, code: "herkomst", message: "Alleen de app zelf mag deze functie gebruiken." });
  if (!billingEnabled()) return json(503, { ok: false, code: "uit", message: "Abonnementen zijn nog niet ingeschakeld." });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, code: "invoer", message: "Ongeldig verzoek." });
  }

  const user = await userFromRequest(req).catch(() => null);
  if (!user) return json(401, { ok: false, code: "inloggen", message: "Log eerst in met uw Nexa-account." });

  const origin = new URL(req.url).origin;
  try {
    const s = stripe();
    const row = await getSub(user.id);

    if (body.action === "portal") {
      if (!row || !row.stripe_customer_id) return json(404, { ok: false, code: "geen_klant", message: "Er is nog geen abonnement om te beheren." });
      const portal = await s.billingPortal.sessions.create({
        customer: row.stripe_customer_id,
        return_url: `${origin}/app/?abonnement=terug`,
        locale: "nl",
      });
      return json(200, { ok: true, url: portal.url });
    }

    if (body.action === "checkout") {
      const plan = PLANS[body.plan] ? body.plan : "jaar";
      if (row && row.status === "comp") return json(409, { ok: false, code: "comp", message: "U heeft al gratis toegang tot Nexa Coach." });
      if (entitled(row)) {
        // al een lopend abonnement: niet dubbel afsluiten, maar naar beheer
        const portal = await s.billingPortal.sessions.create({ customer: row.stripe_customer_id, return_url: `${origin}/app/?abonnement=terug`, locale: "nl" });
        return json(200, { ok: true, url: portal.url, existing: true });
      }

      let customer = row && row.stripe_customer_id;
      if (!customer) {
        const c = await s.customers.create({ email: user.email || undefined, metadata: { user_id: user.id } });
        customer = c.id;
        await upsertSub({ user_id: user.id, status: (row && row.status) || "none", stripe_customer_id: customer });
      }
      // de gratis proef krijgt u één keer per account
      const hadTrial = !!(row && (row.stripe_subscription_id || row.trial_end));
      const price = await priceFor(plan);
      const session = await s.checkout.sessions.create({
        mode: "subscription",
        customer,
        client_reference_id: user.id,
        line_items: [{ price, quantity: 1 }],
        payment_method_collection: "always",
        allow_promotion_codes: true,
        locale: "nl",
        subscription_data: {
          metadata: { user_id: user.id },
          ...(hadTrial ? {} : { trial_period_days: TRIAL_DAYS }),
        },
        metadata: { user_id: user.id, plan },
        custom_text: {
          submit: {
            message: hadTrial
              ? "U kunt uw abonnement altijd opzeggen in de app, onder Profiel."
              : `De eerste ${TRIAL_DAYS} dagen zijn gratis. U krijgt vooraf een herinnering en kunt tot het einde van de proef kosteloos opzeggen in de app, onder Profiel.`,
          },
        },
        success_url: `${origin}/app/?abonnement=gelukt`,
        cancel_url: `${origin}/app/?abonnement=geannuleerd`,
      });
      return json(200, { ok: true, url: session.url });
    }

    return json(400, { ok: false, code: "actie", message: "Onbekende actie." });
  } catch (e) {
    console.error("billing:", e && e.type, e && e.message);
    return json(502, { ok: false, code: "stripe", message: "Betalen is even niet bereikbaar. Probeer het later opnieuw." });
  }
};
