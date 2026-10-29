/// <reference path="../pb_data/types.d.ts" />

// Subscription emails to a café owner: the renewal reminder, the one that
// starts the grace period, and the one that confirms stamping has stopped.
//
// A module rather than inline strings in the cron, for two reasons. The copy
// is the part that gets edited most and should not require reading scheduling
// logic to find; and the preview script renders from exactly this file, so
// what is reviewed is what is sent — a template duplicated for previewing is
// a template that quietly diverges.
//
// House style is lifted from the daily-summary email: a 600px presentation
// table, dir="rtl", Vazirmatn with Tahoma and Arial behind it, and the app's
// own greys. Email clients ignore stylesheets and most of flexbox, so this is
// deliberately tables and inline styles.
//
// DATES ARRIVE PREFORMATTED. Goja has neither Intl nor a Persian calendar, so
// the caller passes the string to print — faDate() from jalali.js, which is
// the arithmetic conversion this runtime needs and renders "26 مهر 1405", the
// same shape the dashboard shows for the same subscription.

const INK = "#171717", DIM = "#565656", FAINT = "#9a9a9a", LINE = "#ededed";
const FONT = "Vazirmatn,Tahoma,Arial,sans-serif";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// accent is the state colour — the same green/amber/red the owner panel uses,
// so an email and the dashboard never disagree about how bad things are
function shell(opts) {
  const accent = opts.accent || INK;
  return [
    '<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    '<body style="margin:0;padding:0;background:#f0f0f0;">',
    // the preheader is what a phone shows next to the subject; without one it
    // scrapes the first words of the markup instead
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">', esc(opts.preheader || ""), '</div>',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f0f0;">',
    '<tr><td align="center" style="padding:24px 12px;">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:16px;overflow:hidden;font-family:', FONT, ';">',
    // a 4px band of the state colour, so the email is recognisable before a
    // word of it is read
    '<tr><td style="height:4px;background:', accent, ';font-size:0;line-height:0;">&nbsp;</td></tr>',
    '<tr><td dir="rtl" align="right" style="padding:26px 28px 18px 28px;border-bottom:1px solid ', LINE, ';">',
    '<div style="font-size:20px;font-weight:700;color:', INK, ';line-height:1.6;">', esc(opts.title), '</div>',
    opts.cafe ? '<div style="font-size:13px;color:' + FAINT + ';line-height:1.8;margin-top:2px;">' + esc(opts.cafe) + '</div>' : '',
    '</td></tr>',
    '<tr><td dir="rtl" align="right" style="padding:22px 28px 6px 28px;font-size:14px;color:', DIM, ';line-height:2;">',
    opts.body,
    '</td></tr>',
    opts.cta ? [
      '<tr><td align="center" style="padding:20px 28px 6px 28px;">',
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>',
      '<td align="center" style="border-radius:12px;background:', INK, ';">',
      '<a href="', esc(opts.cta.url), '" style="display:inline-block;padding:13px 30px;font-family:', FONT,
      ';font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">', esc(opts.cta.label), '</a>',
      '</td></tr></table></td></tr>',
    ].join("") : "",
    '<tr><td dir="rtl" align="right" style="padding:18px 28px 26px 28px;font-size:11px;color:', FAINT, ';line-height:1.9;">',
    esc(opts.foot || "این ایمیل از طرف ریلوی برای شما ارسال شده است."),
    '</td></tr>',
    '</table></td></tr></table></body></html>',
  ].join("");
}

// A panel row: a label and a value, used for the date and the plan.
function fact(label, value) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl"' +
    ' style="margin:14px 0;background:#fafafa;border-radius:12px;">' +
    '<tr><td align="right" style="padding:12px 14px;font-size:12px;color:' + FAINT + ';line-height:1.8;">' + esc(label) +
    '<div style="font-size:17px;font-weight:700;color:' + INK + ';line-height:1.7;">' + esc(value) + '</div>' +
    '</td></tr></table>';
}

// ---------------------------------------------------------------------------
// EDITABLE COPY
// ---------------------------------------------------------------------------
// Every sentence in these letters can be reworded from /hq without a deploy.
// What CANNOT be edited from there is the markup, the dates, the colours or
// the escaping — those stay in this file.
//
// That split is the whole design. A subscription letter is transactional mail
// a paying café acts on; the failure that matters is not clumsy wording, it
// is a letter that arrives broken, or with a mangled date, or carrying an
// unescaped café name. So an override is PLAIN TEXT and nothing else: it is
// escaped on the way in, dropped into a <p> this file owns, and the only
// formatting it may carry is *asterisks for bold*. There is no way to type a
// tag into the editor and have it reach an inbox.
//
// LETTERS is also the editor. /hq builds its form from this manifest — the
// labels, the defaults, the list of placeholders each slot accepts — so a slot
// added here appears there with no second declaration to keep in step. A
// manifest read by both is the only arrangement where the editor cannot
// describe a letter the sender does not send.
//
// The defaults below are the exact wording these letters carried before they
// became editable, so an empty override map (the seeded state) reproduces
// them. Clearing a field in /hq restores the default rather than sending an
// empty line — see settings.js `pick`.
//
// WHY THE "LAST DAY" VARIANTS ARE SEPARATE LETTERS. renewalReminder and
// graceStarted each read differently on the final day: "tomorrow" instead of
// a countdown, the consequence instead of the reassurance. Expressing that as
// its own letter in the manifest means /hq shows the two wordings side by
// side as the distinct things they are, rather than hiding one behind a
// conditional nobody editing copy can see.

const LETTERS = {
  renewal: {
    label: "یادآوری تمدید — 7 و 3 روز مانده",
    vars: ["cafe", "days", "date", "grace"],
    slots: [
      { k: "subject", label: "موضوع", def: "اشتراک {cafe} تا {days} روز دیگر تمام می‌شود" },
      { k: "title", label: "تیتر", def: "اشتراک شما رو به پایان است" },
      { k: "title_soon", label: "تیتر (3 روز مانده)", def: "فقط {days} روز تا پایان اشتراک" },
      { k: "preheader", label: "پیش‌نمایش کنار موضوع", def: "{days} روز دیگر تا پایان اشتراک {cafe}" },
      { k: "lead", label: "بند اول", def: "اشتراک {cafe} تا *{days} روز دیگر* به پایان می‌رسد." },
      { k: "fact", label: "برچسب تاریخ", def: "پایان اشتراک در" },
      { k: "close", label: "بند آخر", def: "اگر همین حالا تمدید کنید، اشتراک تازه از پایان اشتراک فعلی شروع می‌شود و حتی یک روز از دست نمی‌رود." },
      { k: "cta", label: "دکمه", def: "تمدید اشتراک" },
      { k: "foot", label: "پانویس", def: "اگر تمدید نشود، پس از پایان اشتراک {grace} روز مهلت دارید و بعد از آن جمع‌کردن مهر متوقف می‌شود." },
    ],
  },
  renewal_last: {
    label: "یادآوری تمدید — فردا آخرین روز",
    vars: ["cafe", "date", "grace"],
    slots: [
      { k: "subject", label: "موضوع", def: "اشتراک {cafe} فردا تمام می‌شود" },
      { k: "title", label: "تیتر", def: "اشتراک شما فردا تمام می‌شود" },
      { k: "preheader", label: "پیش‌نمایش کنار موضوع", def: "فردا آخرین روز اشتراک {cafe}" },
      { k: "lead", label: "بند اول", def: "اشتراک {cafe} *فردا* به پایان می‌رسد." },
      { k: "fact", label: "برچسب تاریخ", def: "پایان اشتراک در" },
      { k: "close", label: "بند آخر", def: "بعد از آن {grace} روز مهلت دارید و اگر تمدید نشود، کد QR و تگ NFC شما دیگر مهر نمی‌دهند." },
      { k: "cta", label: "دکمه", def: "تمدید اشتراک" },
      { k: "foot", label: "پانویس", def: "اطلاعات کافه، مشتری‌ها و جایزه‌ها در هر حالت محفوظ می‌مانند." },
    ],
  },
  grace: {
    label: "مهلت تمدید — 7 و 3 روز مانده",
    vars: ["cafe", "days", "date"],
    slots: [
      { k: "subject", label: "موضوع", def: "اشتراک {cafe} تمام شد — {days} روز مهلت دارید" },
      { k: "subject_soon", label: "موضوع (3 روز مانده)", def: "{days} روز تا توقف جمع‌کردن مهر در {cafe}" },
      { k: "title", label: "تیتر", def: "اشتراک شما تمام شد" },
      { k: "title_soon", label: "تیتر (3 روز مانده)", def: "فقط {days} روز تا توقف مهر" },
      { k: "preheader", label: "پیش‌نمایش کنار موضوع", def: "{days} روز مهلت برای تمدید" },
      { k: "lead", label: "بند اول", def: "اشتراک {cafe} به پایان رسیده است. فعلاً همه‌چیز مثل قبل کار می‌کند و تا *{days} روز* فرصت دارید آن را تمدید کنید." },
      { k: "fact", label: "برچسب تاریخ", def: "اشتراک تمام شد در" },
      { k: "consequence", label: "بند پیامد", def: "اگر تا پایان این مهلت تمدید نشود، *کد QR و تگ NFC شما دیگر مهر نمی‌دهند* و مشتری‌ها نمی‌توانند مهر جمع کنند." },
      { k: "reassure", label: "بند اطمینان", def: "جایزه‌هایی که مشتری‌ها تا امروز گرفته‌اند معتبر می‌مانند و می‌توانند از آن‌ها استفاده کنند." },
      { k: "cta", label: "دکمه", def: "تمدید اشتراک" },
      { k: "foot", label: "پانویس", def: "اگر همین حالا تمدید کنید، اشتراک تازه از پایان اشتراک قبلی شروع می‌شود." },
    ],
  },
  grace_last: {
    label: "مهلت تمدید — فردا مهر متوقف می‌شود",
    vars: ["cafe", "date"],
    slots: [
      { k: "subject", label: "موضوع", def: "فردا جمع‌کردن مهر در {cafe} متوقف می‌شود" },
      { k: "title", label: "تیتر", def: "فردا جمع‌کردن مهر متوقف می‌شود" },
      { k: "preheader", label: "پیش‌نمایش کنار موضوع", def: "فردا آخرین روز مهلت تمدید" },
      { k: "lead", label: "بند اول", def: "مهلت تمدید اشتراک {cafe} *فردا* تمام می‌شود. تا امشب همه‌چیز مثل قبل کار می‌کند." },
      { k: "fact", label: "برچسب تاریخ", def: "اشتراک تمام شد در" },
      { k: "consequence", label: "بند پیامد", def: "از فردا *کد QR و تگ NFC شما دیگر مهر نمی‌دهند* و مشتری‌ها نمی‌توانند مهر جمع کنند." },
      { k: "reassure", label: "بند اطمینان", def: "جایزه‌هایی که مشتری‌ها تا امروز گرفته‌اند معتبر می‌مانند و می‌توانند از آن‌ها استفاده کنند." },
      { k: "cta", label: "دکمه", def: "تمدید اشتراک" },
      { k: "foot", label: "پانویس", def: "اگر همین حالا تمدید کنید، اشتراک تازه از پایان اشتراک قبلی شروع می‌شود." },
    ],
  },
  shutdown: {
    label: "پایان مهلت — مهر متوقف شد",
    vars: ["cafe"],
    slots: [
      { k: "subject", label: "موضوع", def: "جمع‌کردن مهر در {cafe} متوقف شد" },
      { k: "title", label: "تیتر", def: "جمع‌کردن مهر متوقف شد" },
      { k: "preheader", label: "پیش‌نمایش کنار موضوع", def: "کد QR و تگ NFC شما فعلاً مهر نمی‌دهند" },
      { k: "lead", label: "بند اول", def: "مهلت تمدید اشتراک {cafe} تمام شد و از امروز *کد QR و تگ NFC شما مهر نمی‌دهند*." },
      { k: "reassure", label: "بند اطمینان", def: "مشتری‌هایی که جایزه‌ای گرفته‌اند همچنان می‌توانند از آن استفاده کنند؛ فقط مهر تازه ثبت نمی‌شود." },
      { k: "close", label: "بند آخر", def: "هر زمان اشتراک بخرید، همان روز دوباره فعال می‌شود و دورهٔ تازه از روز خرید حساب می‌شود." },
      { k: "cta", label: "دکمه", def: "فعال‌سازی دوباره" },
      { k: "foot", label: "پانویس", def: "اطلاعات کافه، مشتری‌ها و جایزه‌ها همگی محفوظ است و چیزی پاک نشده." },
    ],
  },
  receipt: {
    label: "رسید پرداخت",
    vars: ["cafe", "amount", "ref"],
    slots: [
      { k: "subject", label: "موضوع", def: "رسید پرداخت اشتراک {cafe}" },
      { k: "title", label: "تیتر", def: "پرداخت شما دریافت شد" },
      { k: "preheader", label: "پیش‌نمایش کنار موضوع", def: "رسید پرداخت {amount} تومان — شماره پیگیری {ref}" },
      { k: "lead", label: "بند اول", def: "از اینکه ریلوی را انتخاب کردید سپاسگزاریم. پرداخت شما با موفقیت انجام شد و اشتراک {cafe} فعال است." },
      { k: "close", label: "بند آخر", def: "این رسید را نزد خود نگه دارید؛ برای هر پیگیری، شماره بالا لازم است." },
      { k: "cta", label: "دکمه", def: "مشاهده پنل" },
      { k: "foot", label: "پانویس", def: "اگر سوالی دربارهٔ این پرداخت دارید، کافی است به همین ایمیل پاسخ دهید." },
    ],
  },
};

// The greeting is one word and shared by every letter, so it is not worth a
// slot in each of them.
const HELLO = "سلام،";

// The grace period, for the letters that mention its length. Must match
// GRACE_DAYS in subscriptions.pb.js and card.pb.js — stated as a placeholder
// rather than typed into the copy so the three cannot drift into claiming
// different numbers of days.
const GRACE_DAYS = 7;

// The override map, read once per runtime.
//
// Lazy and cached because PocketBase hands each handler its own goja runtime:
// the daily sweep requires this module once and sends to every café from it,
// so one read covers the whole run, and a single callback (the payment
// receipt) pays for exactly one.
//
// Returns {} when there is no PocketBase to ask — which is the case under
// plain node, where preview-subscription-emails.js requires this file
// directly. The previews therefore render the defaults, which is what makes
// them a check on the copy in this file rather than on whatever is currently
// saved in production.
let _copy = null;
function overrides() {
  if (_copy) return _copy;
  _copy = {};
  try {
    if (typeof $app !== "undefined" && typeof __hooks !== "undefined") {
      _copy = require(`${__hooks}/settings.js`).mailCopy() || {};
    }
  } catch (err) {
    _copy = {};
  }
  return _copy;
}

// Preview support: prime the cache with wording that has not been saved yet.
//
// /hq previews a letter as you type, which means rendering overrides that are
// still in a textarea. Priming the same cache the sender reads is what makes
// the preview trustworthy — it goes through the identical escaping, bolding
// and placeholder substitution as a real send, rather than a second renderer
// that could flatter the copy.
//
// Safe because each PocketBase handler gets its own goja runtime: a value set
// here lives for one request and cannot leak into the sweep that actually
// sends mail.
function setOverrides(map) {
  _copy = (map && typeof map === "object" && !Array.isArray(map)) ? map : {};
}

// Plain text -> safe inline HTML.
//
// Order matters and is not arbitrary: escape, then turn *pairs* into <b>, and
// only THEN substitute the values. Substituting last is what stops a café
// called "Mo*men's" from pairing its asterisk with one in the template and
// bolding the rest of the sentence. Values are escaped individually as they
// go in.
function fill(text, vars) {
  let out = esc(text).replace(/\*([^*]+)\*/g, "<b>$1</b>");
  const v = vars || {};
  return out.replace(/\{(\w+)\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(v, key) ? esc(v[key]) : m);
}

// The wording for one slot, before any rendering: the /hq override if there
// is one, else the manifest default. An unknown letter or slot gives "" rather
// than throwing — a missing sentence still makes a letter worth sending, where
// an exception in the sweep stops every café's mail behind it.
function slotText(letter, slot) {
  const L = LETTERS[letter];
  if (!L) return "";
  for (const s of L.slots) {
    if (s.k === slot) {
      const ov = overrides()[letter + "." + slot];
      // Blank or whitespace-only means "use the default" — same rule as
      // settings.js `pick`, so clearing a field in /hq restores the wording
      // rather than sending an empty line.
      return (typeof ov === "string" && ov.trim()) ? ov.trim() : s.def;
    }
  }
  return "";
}

// One slot as inline HTML, for the body of a letter.
function txt(letter, slot, vars) {
  return fill(slotText(letter, slot), vars);
}

// One slot as a plain string, for a subject line and a preheader.
//
// NOT txt() with the tags stripped. Both of these are escaped by whoever
// consumes them — shell() escapes the preheader into its hidden div, and the
// subject goes out as a mail header, where HTML escaping would turn a café
// called "Ben & Jerry" into "Ben &amp; Jerry" in the inbox list. So this
// substitutes the values raw and only drops the bold markers, which have no
// meaning outside a body.
function plain(letter, slot, vars) {
  const v = vars || {};
  return String(slotText(letter, slot))
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\{(\w+)\}/g, (m, key) =>
      Object.prototype.hasOwnProperty.call(v, key) ? String(v[key]) : m);
}

// A paragraph, with the margin the layout expects. `last` means "no bottom
// margin" — the final paragraph in a body sits flush, which is how these
// letters were built before the copy became editable.
function para(html, last) {
  return "<p style='margin:0" + (last ? "" : " 0 10px") + ";'>" + html + "</p>";
}

// ---------------------------------------------------------------------------
// 1. the plan is about to end — sent at 7, 3 and 1 days out
// ---------------------------------------------------------------------------
// Three sendings of one letter, not three letters. The facts do not change as
// the date approaches; only how it is said does, and the last one says
// "tomorrow" because "1 روز دیگر" is how a machine counts, not how anyone
// speaks.
//
// The band stays amber for all three. Colour here means STATE, not volume —
// the owner panel paints this whole stretch yellow, and an email that turned
// orange on the last day would claim the café had already lapsed.
function renewalReminder(o) {
  const days = Number(o.days);
  // Which of the two letters this is. "Tomorrow" is its own entry in the
  // manifest rather than a branch inside one, so the two wordings are edited
  // as the separate things they are.
  const L = days <= 1 ? "renewal_last" : "renewal";
  const soon = days <= 3;
  const v = { cafe: o.cafe, days: days, date: o.endDate, grace: GRACE_DAYS };

  // The three-days-out title is a slot of its own; on the last day there is
  // only one title to choose from.
  const title = (L === "renewal" && soon) ? plain(L, "title_soon", v) : plain(L, "title", v);

  return {
    subject: plain(L, "subject", v),
    body: shell({
      accent: "#b58100",
      cafe: o.cafe,
      title: title,
      preheader: plain(L, "preheader", v),
      body: [
        para(esc(HELLO)),
        para(txt(L, "lead", v), true),
        fact(plain(L, "fact", v), o.endDate),
        para(txt(L, "close", v), true),
      ].join(""),
      cta: { label: plain(L, "cta", v), url: o.url },
      // NOT "ignore this if you have already renewed" — this email only goes
      // to cafés that have not, because renewing moves the end date out of
      // the window the cron looks at. The footer is better spent on the one
      // thing the reminder otherwise never says: what happens if they do
      // nothing.
      foot: plain(L, "foot", v),
    }),
  };
}

// ---------------------------------------------------------------------------
// 2. it has ended; the grace is running — sent at 7, 3 and 1 days left
// ---------------------------------------------------------------------------
// Same shape as the reminder, one stage further on. The first says "nothing
// has changed yet"; the last says "tomorrow it does". What must NOT drift
// between them is the reassurance — a café owner reading the final warning
// still needs to know their customers keep what they earned, or the email
// reads as a threat against the wrong people.
function graceStarted(o) {
  const left = Number(o.graceDays);
  const L = left <= 1 ? "grace_last" : "grace";
  const soon = left <= 3;
  const v = { cafe: o.cafe, days: left, date: o.endDate };

  // Early in the grace the subject and title say "it ended, you have time";
  // from three days out they say how little is left. Both are slots, so the
  // turn can be reworded without touching this condition.
  const subject = (L === "grace" && soon) ? plain(L, "subject_soon", v) : plain(L, "subject", v);
  const title = (L === "grace" && soon) ? plain(L, "title_soon", v) : plain(L, "title", v);

  return {
    subject: subject,
    body: shell({
      accent: "#c2560f",
      cafe: o.cafe,
      title: title,
      preheader: plain(L, "preheader", v),
      body: [
        para(esc(HELLO)),
        para(txt(L, "lead", v), true),
        fact(plain(L, "fact", v), o.endDate),
        para(txt(L, "consequence", v)),
        // kept in every sending on purpose: the customer standing at the
        // counter has done nothing wrong, and the owner should never think
        // their regulars are about to lose what they collected
        para(txt(L, "reassure", v), true),
      ].join(""),
      cta: { label: plain(L, "cta", v), url: o.url },
      foot: plain(L, "foot", v),
    }),
  };
}

// ---------------------------------------------------------------------------
// 3. the grace ran out
// ---------------------------------------------------------------------------
function shutdown(o) {
  const v = { cafe: o.cafe };
  return {
    subject: plain("shutdown", "subject", v),
    body: shell({
      accent: "#b02020",
      cafe: o.cafe,
      title: plain("shutdown", "title", v),
      preheader: plain("shutdown", "preheader", v),
      body: [
        para(esc(HELLO)),
        para(txt("shutdown", "lead", v)),
        para(txt("shutdown", "reassure", v)),
        // after a shutdown the clock restarts, unlike renewing inside the
        // grace — said here so nobody is surprised by the new date later
        para(txt("shutdown", "close", v), true),
      ].join(""),
      cta: { label: plain("shutdown", "cta", v), url: o.url },
      foot: plain("shutdown", "foot", v),
    }),
  };
}

// ---------------------------------------------------------------------------
// 4. the receipt — money actually moved
// ---------------------------------------------------------------------------
// The one email here that reports something good, and the only one an owner is
// likely to keep. So it leads with the thanks and carries the numbers as a
// table rather than the single `fact` panel the others use: a receipt is read
// by scanning down a column for one value, usually the reference number when
// something needs chasing.
//
// WHY THE REFERENCE NUMBER IS THE HERO. Everything else on the receipt we also
// hold in our own database, so an owner asking "did my payment go through"
// could be answered from the panel. The ZarinPal ref_id is the only line that
// means anything to ZarinPal or to a bank, which makes it the one thing worth
// keeping an email for. It is given its own emphasis and left-to-right, since
// it is a Latin/numeric token inside a Persian page.
//
function paymentReceipt(o) {
  const rows = [
    ["کافه", o.cafe],
    ["طرح", o.planLabel],
    ["مبلغ", o.amount + " تومان"],
    ["تاریخ پرداخت", o.paidAt],
    ["شماره پیگیری", o.refId],
    ["اشتراک تا", o.endDate],
  ];

  // A receipt is a column of label/value pairs. Borders between rows rather
  // than around the block: the eye is travelling down one axis.
  const table =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl"' +
    ' style="margin:16px 0;background:#fafafa;border-radius:12px;">' +
    rows.map(function (r, i) {
      const last = i === rows.length - 1;
      const isRef = r[0] === "شماره پیگیری";
      return '<tr>' +
        '<td align="right" style="padding:11px 14px;font-size:12px;color:' + FAINT +
          ';line-height:1.8;white-space:nowrap;' + (last ? '' : 'border-bottom:1px solid #efefef;') + '">' +
          esc(r[0]) + '</td>' +
        // LTR + a monospace stack for the reference: it is digits, and a
        // Persian paragraph would otherwise reorder a long number around the
        // punctuation inside it.
        '<td align="left" style="padding:11px 14px;font-size:' + (isRef ? '15' : '14') +
          'px;font-weight:700;color:' + INK + ';line-height:1.8;' +
          (isRef ? 'direction:ltr;font-family:Menlo,Consolas,monospace;' : '') +
          (last ? '' : 'border-bottom:1px solid #efefef;') + '">' +
          esc(r[1]) + '</td>' +
        '</tr>';
    }).join("") +
    '</table>';


  const v = { cafe: o.cafe, amount: o.amount, ref: o.refId };

  return {
    subject: plain("receipt", "subject", v),
    body: shell({
      accent: "#1f7a4d",
      cafe: o.cafe,
      title: plain("receipt", "title", v),
      preheader: plain("receipt", "preheader", v),
      body: [
        para(esc(HELLO)),
        para(txt("receipt", "lead", v)),
        table,
        para(txt("receipt", "close", v), true),
      ].join(""),
      cta: { label: plain("receipt", "cta", v), url: o.url },
      foot: plain("receipt", "foot", v),
    }),
  };
}

module.exports = {
  renewalReminder, graceStarted, shutdown, paymentReceipt, esc,
  // LETTERS is the editor's source of truth as well as the sender's — /hq
  // builds its form from this, so a slot cannot exist in one and not the
  // other. GRACE_DAYS travels with it because the form shows what {grace}
  // will expand to.
  LETTERS, GRACE_DAYS, setOverrides,
};
