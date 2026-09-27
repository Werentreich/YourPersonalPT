/* Webhook van Stripe: houdt nexa_subscriptions in Supabase gelijk met de
   abonnementen in Stripe. Stel in Stripe (Developers > Webhooks) een
   endpoint in op https://<site>/.netlify/functions/stripe-webhook met deze
   gebeurtenissen:
     checkout.session.completed
     customer.subscription.created
     customer.subscription.updated
     customer.subscription.deleted
     customer.subscription.paused
     customer.subscription.resumed
   en zet het ondertekeningsgeheim in STRIPE_WEBHOOK_SECRET.

   Elke aanvraag wordt gecontroleerd op de handtekening van Stripe; zonder
   geldige handtekening gebeurt er niets. */
import { billingEnabled, json, stripe, syncSubscription } from "../lib/billing-core.mjs";

const SUB_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

export default async (req) => {
  if (req.method !== "POST") return json(405, { ok: false });
  if (!billingEnabled()) return json(503, { ok: false, code: "uit" });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return json(400, { ok: false, code: "handtekening" });

  const raw = await req.text();
  let event;
  try {
    event = await stripe().webhooks.constructEventAsync(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("stripe-webhook: ongeldige handtekening", e && e.message);
    return json(400, { ok: false, code: "handtekening" });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.mode === "subscription" && session.subscription) {
        const sub = await stripe().subscriptions.retrieve(typeof session.subscription === "string" ? session.subscription : session.subscription.id);
        await syncSubscription(sub, session.client_reference_id || (session.metadata && session.metadata.user_id));
      }
    } else if (SUB_EVENTS.has(event.type)) {
      await syncSubscription(event.data.object);
    }
    return json(200, { ok: true });
  } catch (e) {
    // 500: Stripe probeert het later opnieuw
    console.error("stripe-webhook:", event.type, e && e.message);
    return json(500, { ok: false });
  }
};
