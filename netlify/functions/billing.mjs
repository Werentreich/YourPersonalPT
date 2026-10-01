/* Abonnement Nexa Coach.

   GET                                   -> { enabled, trialDays, prices }
   POST { action: "checkout", plan }     -> { url } naar Stripe Checkout
   POST { action: "portal" }             -> { url } naar het Stripe-klantportaal
   POST { action: "withdraw" }           -> herroepen binnen 14 dagen: stoppen en terugbetalen
   POST { action: "cancel_now" }         -> alle abonnementen direct stoppen (account verwijderen)
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

const WITHDRAW_DAYS = 14;

export default async (req) => {
  if (req.method === "GET") {
    return json(200, {
      enabled: billingEnabled(),
      trialDays: TRIAL_DAYS,
      prices: { maand: PLANS.maand.amount / 100, jaar: PLANS.jaar.amount / 100 },
      withdrawDays: WITHDRAW_DAYS,
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

    /* Herroepen (Europese herroepingsknop, art. 11a richtlijn 2011/83/EU):
       binnen 14 dagen na het afsluiten direct stoppen en alles terugbetalen.
       Opzeggen bij het verwijderen van het account: direct stoppen. */
    if (body.action === "withdraw" || body.action === "cancel_now") {
      if (!row || !row.stripe_customer_id) {
        return body.action === "cancel_now" ? json(200, { ok: true, canceled: 0 }) : json(404, { ok: false, code: "geen_klant", message: "Er is geen abonnement om te herroepen." });
      }
      const LIVE = new Set(["trialing", "active", "past_due", "unpaid", "incomplete", "paused"]);
      const subs = (await s.subscriptions.list({ customer: row.stripe_customer_id, status: "all", limit: 20 })).data.filter((x) => LIVE.has(x.status));
      if (body.action === "cancel_now") {
        for (const sub of subs) await s.subscriptions.cancel(sub.id);
        return json(200, { ok: true, canceled: subs.length });
      }
      const sub = subs.sort((a, b) => b.created - a.created)[0];
      if (!sub) return json(404, { ok: false, code: "geen_abonnement", message: "Er is geen lopend abonnement om te herroepen." });
      if (Date.now() / 1000 - sub.created > WITHDRAW_DAYS * 86400) {
        return json(409, { ok: false, code: "termijn_voorbij", message: `De herroepingstermijn van ${WITHDRAW_DAYS} dagen is voorbij. U kunt wel opzeggen via Abonnement beheren.` });
      }
      let refunded = 0;
      const invoices = await s.invoices.list({ subscription: sub.id, status: "paid", limit: 20 });
      for (const inv of invoices.data) {
        if (!inv.amount_paid) continue;
        const pays = await s.invoicePayments.list({ invoice: inv.id, status: "paid", limit: 10 });
        for (const p of pays.data) {
          const pay = p.payment || {};
          const target = pay.payment_intent ? { payment_intent: typeof pay.payment_intent === "string" ? pay.payment_intent : pay.payment_intent.id } : pay.charge ? { charge: typeof pay.charge === "string" ? pay.charge : pay.charge.id } : null;
          if (!target) continue;
          await s.refunds.create({ ...target, reason: "requested_by_customer", metadata: { nexa: "herroeping", user_id: user.id } });
          refunded += p.amount_paid || 0;
        }
      }
      await s.subscriptions.cancel(sub.id);
      return json(200, { ok: true, refunded: refunded / 100 });
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
