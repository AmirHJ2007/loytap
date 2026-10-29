/// <reference path="../pb_data/types.d.ts" />

// مرکز فرمان — the routes behind /hq.
//
//   GET  /hq/stats          the whole platform aggregate (hq.js)
//   GET  /hq/settings       price + letter wording + the letter manifest
//   POST /hq/settings       save either or both
//   POST /hq/mail/preview   render one letter, including unsaved wording
//
// SUPERUSER ONLY, AND NOT role=admin. Every café owner carries role "admin"
// — that is what the owner panel checks — so an endpoint gated on the role
// would hand every café on the platform the revenue of every other one. The
// gate here is $apis.requireSuperuserAuth(), i.e. the same credential as the
// PocketBase dashboard, plus a second explicit hasSuperuserAuth() check in
// each handler so loosening the middleware cannot silently open the data.
//
// NB: each handler is self-contained and requires its shared code inside
// itself. PocketBase re-evaluates handlers in a pooled JSVM runtime that does
// NOT see this file's top-level scope, so a const declared up here reads back
// as "not defined" at request time and surfaces as a bare 400.

routerAdd("GET", "/hq/stats", (e) => {
  if (!e.hasSuperuserAuth()) return e.json(403, { error: "HQ access only", code: "HQ_ONLY" });
  return e.json(200, require(`${__hooks}/hq.js`).report());
}, $apis.requireSuperuserAuth());

// The editor's own data: what the price is, what wording is saved, and the
// manifest describing every editable slot. Sent together because the form
// cannot be drawn without all three, and separate requests would let it paint
// fields before knowing their labels.
routerAdd("GET", "/hq/settings", (e) => {
  if (!e.hasSuperuserAuth()) return e.json(403, { error: "HQ access only", code: "HQ_ONLY" });

  const S = require(`${__hooks}/settings.js`);
  const M = require(`${__hooks}/submail.js`);

  // The manifest as plain data. LETTERS is keyed for the sender's benefit; the
  // form needs it ordered, because the order the slots are declared in is the
  // order they appear in the letter.
  const letters = [];
  for (const id of ["renewal", "renewal_last", "grace", "grace_last", "shutdown", "receipt"]) {
    const L = M.LETTERS[id];
    if (!L) continue;
    letters.push({
      id: id, label: L.label, vars: L.vars,
      slots: L.slots.map((s) => ({ k: s.k, label: s.label, def: s.def })),
    });
  }

  return e.json(200, {
    pricing: S.prices(),
    mail_copy: S.mailCopy(),
    letters: letters,
    grace_days: M.GRACE_DAYS,
  });
}, $apis.requireSuperuserAuth());

// Save the price, the wording, or both.
//
// Partial on purpose: a body carrying only `pricing` leaves the letters alone
// and vice versa, so the two halves of the page save independently and
// neither can wipe the other by being absent.
routerAdd("POST", "/hq/settings", (e) => {
  if (!e.hasSuperuserAuth()) return e.json(403, { error: "HQ access only", code: "HQ_ONLY" });

  const body = e.requestInfo().body || {};
  const S = require(`${__hooks}/settings.js`);

  let row = S.row();
  if (!row) {
    // The migration seeds this row, so a missing one means the migration has
    // not run here. Creating it silently would be the wrong repair: the
    // fallback prices in settings.js are what billing is currently using, and
    // a row invented now might disagree with them.
    return e.json(409, {
      error: "تنظیمات پلتفرم پیدا نشد؛ مهاجرت اجرا نشده است",
      code: "NO_SETTINGS_ROW",
    });
  }

  if (body.pricing) {
    const m = Math.round(Number(body.pricing.monthly));
    const y = Math.round(Number(body.pricing.yearly));
    // Validated here and not only in the browser: this endpoint is the last
    // thing standing between a typo and what the gateway charges.
    if (!(m > 0) || !(y > 0)) {
      return e.json(400, { error: "قیمت باید یک عدد مثبت باشد", code: "PRICE_INVALID" });
    }
    // A yearly price at or above twelve months of the monthly one makes the
    // "N months free" badge on the marketing page read as a saving of zero or
    // less — which is worse than a wrong number, because the page then argues
    // against itself. Refused rather than silently hidden.
    if (y >= m * 12) {
      return e.json(400, {
        error: "قیمت سالانه باید کمتر از 12 برابر قیمت ماهانه باشد",
        code: "PRICE_YEARLY_NOT_SAVING",
      });
    }
    row.set("price_monthly", m);
    row.set("price_yearly", y);
  }

  if (body.mail_copy) {
    const M = require(`${__hooks}/submail.js`);
    const incoming = body.mail_copy;
    // Only keys the manifest actually declares are stored. An unknown key
    // would be dead weight no letter reads, and keeping the stored map to
    // exactly the editable surface is what lets /hq show "modified" honestly.
    const clean = {};
    for (const id in M.LETTERS) {
      for (const slot of M.LETTERS[id].slots) {
        const key = id + "." + slot.k;
        const v = incoming[key];
        if (typeof v !== "string") continue;
        const t = v.trim();
        // Equal to the default, or blank, means "no override" — so the stored
        // map holds only genuine changes and clearing a field restores the
        // default rather than persisting a copy of it.
        if (!t || t === slot.def) continue;
        if (t.length > 600) {
          return e.json(400, {
            error: "متن «" + slot.label + "» بیش از حد بلند است",
            code: "COPY_TOO_LONG",
          });
        }
        clean[key] = t;
      }
    }
    row.set("mail_copy", clean);
  }

  try { $app.save(row); } catch (err) {
    $app.logger().error("hq settings save failed", "error", String(err));
    return e.json(500, { error: "ذخیره نشد", code: "SAVE_FAILED" });
  }

  const S2 = require(`${__hooks}/settings.js`);
  return e.json(200, { ok: true, pricing: S2.prices(), mail_copy: S2.mailCopy() });
}, $apis.requireSuperuserAuth());

// Render one letter with sample data, optionally using wording that has not
// been saved yet, so the copy can be read as it will land before committing
// to it.
//
// Rendered by submail.js itself — the file the cron sends from — for the same
// reason preview-subscription-emails.js does: a preview built by a second
// renderer is a preview that can flatter copy the real sender would break.
routerAdd("POST", "/hq/mail/preview", (e) => {
  if (!e.hasSuperuserAuth()) return e.json(403, { error: "HQ access only", code: "HQ_ONLY" });

  const body = e.requestInfo().body || {};
  const id = String(body.letter || "");
  const M = require(`${__hooks}/submail.js`);
  if (!M.LETTERS[id]) return e.json(400, { error: "Unknown letter", code: "LETTER_UNKNOWN" });

  // Draft wording wins for this one request only; each handler has its own
  // runtime, so nothing set here can reach a real send.
  if (body.mail_copy && typeof body.mail_copy === "object") M.setOverrides(body.mail_copy);
  else M.setOverrides(require(`${__hooks}/settings.js`).mailCopy());

  const J = require(`${__hooks}/jalali.js`);
  const prices = require(`${__hooks}/settings.js`).prices();
  const now = Date.now();

  // A café name with a space and a Persian word in it, because that is what
  // the letters actually carry and a one-word placeholder hides wrapping
  // problems. The reference number is the shape ZarinPal returns.
  const sample = {
    cafe: "کافه آرورا",
    url: ($os.getenv("APP_ORIGIN") || "https://reloy.ir") + "/owner",
    endDate: J.faDate(now + 7 * 86400000),
    amount: String(prices.monthly).replace(/\B(?=(\d{3})+(?!\d))/g, ","),
    planLabel: "ماهانه",
    paidAt: J.faDate(now),
    refId: "143339585874",
  };

  // Each manifest entry maps to one call with the day count that selects it.
  // The last-day letters are reached by passing 1, which is the same path a
  // real send takes — not a separate flag.
  let mail = null;
  if (id === "renewal") mail = M.renewalReminder(Object.assign({}, sample, { days: 7 }));
  else if (id === "renewal_last") mail = M.renewalReminder(Object.assign({}, sample, { days: 1 }));
  else if (id === "grace") mail = M.graceStarted(Object.assign({}, sample, { graceDays: 7 }));
  else if (id === "grace_last") mail = M.graceStarted(Object.assign({}, sample, { graceDays: 1 }));
  else if (id === "shutdown") mail = M.shutdown(sample);
  else if (id === "receipt") mail = M.paymentReceipt(sample);

  if (!mail) return e.json(400, { error: "Unknown letter", code: "LETTER_UNKNOWN" });
  return e.json(200, { subject: mail.subject, body: mail.body });
}, $apis.requireSuperuserAuth());
