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
// the caller passes the string to print. Today that means these Persian emails
// carry Gregorian dates — the one place in the product that still does. Fixing
// it needs an arithmetic Jalali converter written for Goja, since the client's
// jalaliToISO leans on Intl.

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
  const tomorrow = days <= 1;
  const soon = days <= 3;

  // "فردا" / "tomorrow" reads as a deadline; a number reads as a countdown
  const whenPhrase = tomorrow ? "فردا" : days + " روز دیگر";
  const subject = tomorrow
    ? "اشتراک " + o.cafe + " فردا تمام می‌شود"
    : "اشتراک " + o.cafe + " تا " + days + " روز دیگر تمام می‌شود";

  const title = tomorrow ? "اشتراک شما فردا تمام می‌شود"
    : soon ? "فقط " + days + " روز تا پایان اشتراک"
    : "اشتراک شما رو به پایان است";

  const lead = tomorrow
    ? "<p style='margin:0;'>اشتراک " + esc(o.cafe) + " <b>فردا</b> به پایان می‌رسد.</p>"
    : "<p style='margin:0;'>اشتراک " + esc(o.cafe) + " تا <b>" + esc(whenPhrase) + "</b> به پایان می‌رسد.</p>";

  // On the last day the reason to act stops being "you lose nothing" and
  // starts being "here is what happens next" — a café owner deciding at
  // midnight needs the consequence, not the reassurance.
  const close = tomorrow
    ? "<p style='margin:0;'>بعد از آن ۷ روز مهلت دارید و اگر تمدید نشود، کد QR و تگ NFC شما دیگر مهر نمی‌دهند.</p>"
    : "<p style='margin:0;'>اگر همین حالا تمدید کنید، اشتراک تازه از پایان اشتراک فعلی شروع می‌شود و حتی یک روز از دست نمی‌رود.</p>";

  return {
    subject: subject,
    body: shell({
      accent: "#b58100",
      cafe: o.cafe,
      title: title,
      preheader: tomorrow ? "فردا آخرین روز اشتراک " + o.cafe : whenPhrase + " تا پایان اشتراک " + o.cafe,
      body: [
        "<p style='margin:0 0 10px;'>سلام،</p>",
        lead,
        fact("پایان اشتراک در", o.endDate),
        close,
      ].join(""),
      cta: { label: "تمدید اشتراک", url: o.url },
      // NOT "ignore this if you have already renewed" — this email only goes
      // to cafés that have not, because renewing moves the end date out of
      // the window the cron looks at. The footer is better spent on the one
      // thing the reminder otherwise never says: what happens if they do
      // nothing.
      foot: tomorrow
        ? "اطلاعات کافه، مشتری‌ها و جایزه‌ها در هر حالت محفوظ می‌مانند."
        : "اگر تمدید نشود، پس از پایان اشتراک ۷ روز مهلت دارید و بعد از آن جمع‌کردن مهر متوقف می‌شود.",
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
  const tomorrow = left <= 1;
  const soon = left <= 3;

  const subject = tomorrow
    ? "فردا جمع‌کردن مهر در " + o.cafe + " متوقف می‌شود"
    : soon
      ? left + " روز تا توقف جمع‌کردن مهر در " + o.cafe
      : "اشتراک " + o.cafe + " تمام شد — " + left + " روز مهلت دارید";

  const title = tomorrow ? "فردا جمع‌کردن مهر متوقف می‌شود"
    : soon ? "فقط " + left + " روز تا توقف مهر"
    : "اشتراک شما تمام شد";

  // The opening carries the state. Early in the grace the useful fact is that
  // the counter still works; at the end it is the date it stops.
  const lead = tomorrow
    ? "<p style='margin:0;'>مهلت تمدید اشتراک " + esc(o.cafe) + " <b>فردا</b> تمام می‌شود. تا امشب همه‌چیز مثل قبل کار می‌کند.</p>"
    : "<p style='margin:0;'>اشتراک " + esc(o.cafe) + " به پایان رسیده است. فعلاً همه‌چیز مثل قبل کار می‌کند و تا <b>" +
      esc(left) + " روز</b> فرصت دارید آن را تمدید کنید.</p>";

  const consequence = tomorrow
    ? "<p style='margin:0 0 10px;'>از فردا <b>کد QR و تگ NFC شما دیگر مهر نمی‌دهند</b> و مشتری‌ها نمی‌توانند مهر جمع کنند.</p>"
    : "<p style='margin:0 0 10px;'>اگر تا پایان این مهلت تمدید نشود، <b>کد QR و تگ NFC شما دیگر مهر نمی‌دهند</b> و مشتری‌ها نمی‌توانند مهر جمع کنند.</p>";

  return {
    subject: subject,
    body: shell({
      accent: "#c2560f",
      cafe: o.cafe,
      title: title,
      preheader: tomorrow ? "فردا آخرین روز مهلت تمدید" : left + " روز مهلت برای تمدید",
      body: [
        "<p style='margin:0 0 10px;'>سلام،</p>",
        lead,
        fact("اشتراک تمام شد در", o.endDate),
        consequence,
        // kept in every sending on purpose: the customer standing at the
        // counter has done nothing wrong, and the owner should never think
        // their regulars are about to lose what they collected
        "<p style='margin:0;'>جایزه‌هایی که مشتری‌ها تا امروز گرفته‌اند معتبر می‌مانند و می‌توانند از آن‌ها استفاده کنند.</p>",
      ].join(""),
      cta: { label: "تمدید اشتراک", url: o.url },
      foot: "اگر همین حالا تمدید کنید، اشتراک تازه از پایان اشتراک قبلی شروع می‌شود.",
    }),
  };
}

// ---------------------------------------------------------------------------
// 3. the grace ran out
// ---------------------------------------------------------------------------
function shutdown(o) {
  return {
    subject: "جمع‌کردن مهر در " + o.cafe + " متوقف شد",
    body: shell({
      accent: "#b02020",
      cafe: o.cafe,
      title: "جمع‌کردن مهر متوقف شد",
      preheader: "کد QR و تگ NFC شما فعلاً مهر نمی‌دهند",
      body: [
        "<p style='margin:0 0 10px;'>سلام،</p>",
        "<p style='margin:0 0 10px;'>مهلت تمدید اشتراک ", esc(o.cafe),
        " تمام شد و از امروز <b>کد QR و تگ NFC شما مهر نمی‌دهند</b>.</p>",
        "<p style='margin:0 0 10px;'>مشتری‌هایی که جایزه‌ای گرفته‌اند همچنان می‌توانند از آن استفاده کنند؛ فقط مهر تازه ثبت نمی‌شود.</p>",
        // after a shutdown the clock restarts, unlike renewing inside the
        // grace — said here so nobody is surprised by the new date later
        "<p style='margin:0;'>هر زمان اشتراک بخرید، همان روز دوباره فعال می‌شود و دورهٔ تازه از روز خرید حساب می‌شود.</p>",
      ].join(""),
      cta: { label: "فعال‌سازی دوباره", url: o.url },
      foot: "اطلاعات کافه، مشتری‌ها و جایزه‌ها همگی محفوظ است و چیزی پاک نشده.",
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


  return {
    subject: "رسید پرداخت اشتراک " + o.cafe,
    body: shell({
      accent: "#1f7a4d",
      cafe: o.cafe,
      title: "پرداخت شما دریافت شد",
      preheader: "رسید پرداخت " + o.amount + " تومان — شماره پیگیری " + o.refId,
      body: [
        "<p style='margin:0 0 10px;'>سلام،</p>",
        "<p style='margin:0 0 10px;'>از اینکه ریلوی را انتخاب کردید سپاسگزاریم. پرداخت شما با موفقیت انجام شد و اشتراک ",
        esc(o.cafe), " فعال است.</p>",
        table,
        "<p style='margin:0;'>این رسید را نزد خود نگه دارید؛ برای هر پیگیری، شماره بالا لازم است.</p>",
      ].join(""),
      cta: { label: "مشاهده پنل", url: o.url },
      foot: "اگر سوالی دربارهٔ این پرداخت دارید، کافی است به همین ایمیل پاسخ دهید.",
    }),
  };
}

module.exports = { renewalReminder, graceStarted, shutdown, paymentReceipt, esc };
