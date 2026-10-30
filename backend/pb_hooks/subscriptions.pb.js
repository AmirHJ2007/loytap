/// <reference path="../pb_data/types.d.ts" />

// The daily sweep: decide which subscription notice each café is due, send it
// by email and by push, and move a café that has run out of grace to
// `expired`.
//
// WHY A SWEEP AND NOT A TIMER PER CAFÉ. Nothing here fires at an exact moment;
// every stage is "which day is it relative to the end date". A sweep is also
// the only shape that recovers on its own — if the server is down for a day,
// the next run still sees a café sitting at three-days-left and sends the
// right letter, where a missed one-shot timer would be lost for good.
//
// WHAT STOPS DUPLICATES. subscriptions.last_mail holds a tag like
// "r3|2026-12-17": the stage plus the period it belongs to. The sweep only
// sends when the tag it computes differs from the one stored, so running twice
// in a day sends nothing twice — and a renewal changes the period, which
// changes every tag, which is what lets the next period's reminders go out
// without anyone clearing a flag.
//
// The field is named last_mail because mail was the only channel when it was
// added. It now marks the whole day's sending, push included — one tag per
// stage per period, not one per channel.
//
// STAMPING IS NOT GATED HERE. card.pb.js decides that from the dates, so a
// café is never switched off by a cron that failed to run. This job only
// writes the status the dashboard reads and the mail it sends; if it stops,
// nobody is wrongly cut off, they just stop hearing from us.
//
// TWO CHANNELS, ONE DECISION. Each sending is an email (submail.js) and, for
// an owner who turned the switch on in Settings, a push to their own phone
// (subpush.js, scope "owner" in push_subs). They are deliberately decided
// together and guarded by the same tag: an owner who got the push but not the
// letter, or three pushes for one letter, would reasonably conclude the
// billing is as unreliable as the notifications.
//
// NOTE: self-contained apart from the templates, which it requires — the
// PocketBase JS runtime does not give a cron callback access to sibling
// top-level declarations.

cronAdd("subscription-sweep", "30 5 * * *", () => {
  const GRACE_DAYS = require(`${__hooks}/grace.js`).GRACE_DAYS;
  const DAY = 86400000;
  const mail = require(`${__hooks}/submail.js`);
  const panelUrl = ($os.getenv("APP_ORIGIN") || "https://reloy.ir") + "/owner";

  // Push is optional infrastructure: no VAPID keys configured means no owner
  // has a subscription anyway, and the emails must still go out. Resolved
  // once, outside the loop, rather than per café.
  let W = null, push = null, cfg = null, spool = null;
  try {
    W = require(`${__hooks}/webpush.js`);
    cfg = W.vapidConfig();
    if (cfg) { push = require(`${__hooks}/subpush.js`); spool = W.spoolPath(); }
  } catch (err) {
    $app.logger().warn("subscription sweep could not load web push; sending email only", "error", String(err));
    cfg = null;
  }

  // Local midnight is what an owner means by "three days left", so the maths
  // is done on whole Tehran days rather than on elapsed milliseconds. Iran
  // dropped DST in 2022, so a fixed +03:30 is correct all year.
  const IRAN_OFF = 3.5 * 3600000;
  const startOfTehranDay = (ms) => {
    const d = new Date(ms + IRAN_OFF);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - IRAN_OFF;
  };
  const today = startOfTehranDay(Date.now());

  const z = (n) => (n < 10 ? "0" + n : "" + n);
  const dayKey = (ms) => {
    const d = new Date(ms + IRAN_OFF);
    return d.getUTCFullYear() + "-" + z(d.getUTCMonth() + 1) + "-" + z(d.getUTCDate());
  };
  // "26 مهر 1405" — the date these Persian letters print, in the reader's own
  // calendar and in Tehran time. jalali.js carries the conversion because goja
  // has no Intl; it is the same shape the dashboard shows for the same
  // subscription, so an owner comparing the two sees one date, not two.
  const shown = require(`${__hooks}/jalali.js`).faDate;

  let subs = [];
  try { subs = $app.findRecordsByFilter("subscriptions", "status != 'cancelled'", "created", 2000, 0, {}); }
  catch (err) { $app.logger().error("subscription sweep could not read subscriptions", "error", String(err)); return; }

  // 20 hours. Long, and deliberately the opposite of the stamp-request push's
  // 45 seconds: that one arrives as a lie if it is late, because the request
  // it describes is dead in half a minute. A deadline is still true tomorrow
  // morning, so a push held back by a throttled network — the normal case for
  // Chrome in Iran — should still be delivered. Short of 24h so it can never
  // outlive the next sweep and land next to the following day's notice.
  const PUSH_TTL_S = 20 * 3600;

  let queued = 0, expired = 0, pushed = 0;

  for (const sub of subs) {
    try {
      const status = sub.getString("status");
      const rawEnd = status === "trialing" ? sub.get("trial_ends") : sub.get("current_period_end");
      if (!rawEnd) continue;                       // nothing to count towards
      const endMs = new Date(String(rawEnd).replace(" ", "T")).getTime();
      if (!endMs) continue;

      const endDay = startOfTehranDay(endMs);
      const daysLeft = Math.round((endDay - today) / DAY);       // + before, - after

      // Which letter is due today, if any. Only these exact days send: a café
      // five days out is between letters and should hear nothing.
      let stage = null;
      if (daysLeft === 7 || daysLeft === 3 || daysLeft === 1) {
        stage = "r" + daysLeft;
      } else if (daysLeft <= 0 && daysLeft > -GRACE_DAYS) {
        const graceLeft = GRACE_DAYS + daysLeft;
        if (graceLeft === 7 || graceLeft === 3 || graceLeft === 1) stage = "g" + graceLeft;
      } else if (daysLeft === -GRACE_DAYS) {
        stage = "off";
      }

      // The café has run out of grace: say so in the status the dashboard
      // reads. card.pb.js already refuses stamps from the dates alone, so this
      // is bookkeeping catching up with reality, not the thing enforcing it.
      if (daysLeft <= -GRACE_DAYS && status !== "expired") {
        sub.set("status", "expired");
        $app.save(sub);
        expired++;
      }

      if (!stage) continue;
      const tag = stage + "|" + dayKey(endMs);
      if (sub.getString("last_mail") === tag) continue;          // already sent

      const cafeId = sub.getString("cafe");

      // Who to write to. No owner or no address is not an error worth
      // stopping the sweep for — it is a café that predates the email field.
      //
      // NOT a `continue` any more. A café whose owner row carries a
      // placeholder address has no email, but it may well have a phone with
      // the switch on, and that owner has more right to the warning than
      // anyone: they are the one we cannot otherwise reach.
      let owner = null;
      try { owner = $app.findRecordById("users", sub.getString("owner_user")); } catch (err) { owner = null; }
      const to = owner ? String(owner.getString("email") || "").trim() : "";

      let cafeName = "";
      try { cafeName = $app.findRecordById("cafe_card", cafeId).getString("cafe_name"); } catch (err) { cafeName = ""; }

      const graceLeftNow = GRACE_DAYS + daysLeft;
      const kind = stage.charAt(0);     // r | g | o(ff)

      // ---- the letter ----
      if (to) {
        const args = { cafe: cafeName, endDate: shown(endMs), url: panelUrl };
        let letter = null;
        if (kind === "r") letter = mail.renewalReminder(Object.assign({ days: daysLeft }, args));
        else if (kind === "g") letter = mail.graceStarted(Object.assign({ graceDays: graceLeftNow }, args));
        else letter = mail.shutdown(args);

        // Queued, not sent: mail-outbox in notify.pb.js drains it every five
        // minutes with its own retries, so a provider having a bad morning
        // does not cost a café its warning.
        const row = new Record($app.findCollectionByNameOrId("mail_outbox"));
        row.set("to", to);
        row.set("subject", letter.subject);
        row.set("body", letter.body);
        row.set("sent", false);
        row.set("attempts", 0);
        $app.save(row);
      } else {
        $app.logger().warn("subscription mail skipped, no owner email", "cafe", cafeId);
      }

      // ---- the push ----
      //
      // WRAPPED SEPARATELY, and this is the important part: a push failure
      // must not stop last_mail being written below. If it could, a café
      // whose phone is unreachable would fail the whole stage, keep its old
      // tag, and be sent the same EMAIL again on the next run — a broken
      // notification turning into mail the owner never asked for twice.
      //
      // So everything here ends in a logged line and a sweep that carries on.
      if (cfg) {
        try {
          // scope = "owner" is the whole point of the field: these rows are
          // phones that asked about billing, never a café's tills.
          let devices = [];
          try {
            devices = $app.findRecordsByFilter("push_subs",
              'cafe = {:c} && scope = "owner"', "-created", 10, 0, { c: cafeId });
          } catch (err) { devices = []; }

          for (const dev of devices) {
            try {
              const lang = dev.getString("lang") === "en" ? "en" : "fa";
              const pargs = { cafe: cafeName, lang: lang };
              let note = null;
              if (kind === "r") note = push.renewalReminder(Object.assign({ days: daysLeft }, pargs));
              else if (kind === "g") note = push.graceStarted(Object.assign({ graceDays: graceLeftNow }, pargs));
              else note = push.shutdown(pargs);

              W.sendOne({
                endpoint: dev.getString("endpoint"),
                p256dh: dev.getString("p256dh"),
                auth: dev.getString("auth"),
              }, JSON.stringify({
                title: note.title,
                body: note.body,
                url: "/owner",
                // ONE shared tag, so today's reminder REPLACES yesterday's on
                // the lock screen. The opposite of the stamp-request push,
                // which uses a per-request tag because collapsing two waiting
                // customers into one notification loses a person. Here only
                // the current state matters, and a stack of seven notices
                // counting down to the same deadline is just noise.
                tag: "reloy-subscription",
                // No requestId, so sw.js renders no action buttons — there is
                // nothing to approve, and tapping the body opens /owner.
              }), cfg, PUSH_TTL_S, { spool: spool });
            } catch (err) {
              $app.logger().warn("subscription push failed for one device",
                "cafe", cafeId, "sub", dev.id, "error", String(err));
            }
          }
          if (devices.length) pushed += devices.length;
        } catch (err) {
          $app.logger().warn("subscription push failed", "cafe", cafeId, "error", String(err));
        }
      }

      // Written only after both channels have had their turn. The other order
      // would mark a stage sent that a crash then threw away, and silence is
      // the one failure an owner cannot detect.
      //
      // Written even when neither channel had anywhere to go — no address and
      // no phone. The stage was genuinely handled; leaving the tag unset
      // would re-run the same dead lookup on every sweep for a café that
      // cannot be reached at all.
      sub.set("last_mail", tag);
      $app.save(sub);
      if (to) queued++;
    } catch (err) {
      // One bad row must not cost every café behind it its warning
      $app.logger().error("subscription sweep failed for one café",
        "cafe", sub.getString("cafe"), "error", String(err));
    }
  }

  if (queued || expired || pushed) {
    $app.logger().info("subscription sweep",
      "queued", queued, "pushed", pushed, "expired", expired, "checked", subs.length);
  }
});
