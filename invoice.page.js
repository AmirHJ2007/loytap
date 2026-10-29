// ===================================================================
// Reloy — the printable invoice (فاکتور) behind one payment.
//
// Everything here is CLIENT-side for one reason: dates. An Iranian café
// files this with an accountant, so it has to carry Jalali dates — and
// PocketBase's JS engine has neither Intl nor a Persian calendar, which is
// why the receipt EMAIL still shows 20.10.26. A browser has both. So the
// server hands over raw ISO timestamps (see /owner/invoice/data in
// zarinpal.pb.js) and the formatting happens where it can be done properly.
//
// The same reasoning covers the amount in words and the Persian digits.
// ===================================================================
(function () {
  "use strict";

  var API = location.port === "8000"
    ? location.protocol + "//" + location.hostname + ":8090"
    : location.origin;
  var root = document.getElementById("root");
  var token = (function () { try { return localStorage.getItem("loytap_token") || ""; } catch (e) { return ""; } })();

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---- digits ----------------------------------------------------------
  var FA = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
  function fa(s) { return String(s).replace(/[0-9]/g, function (d) { return FA[+d]; }); }
  function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "،"); }

  // ---- dates -----------------------------------------------------------
  // PocketBase stores "2026-10-20 12:00:00.000Z" — space-separated, which
  // Safari refuses to parse. Normalised before it reaches Date().
  function toDate(v) {
    if (!v) return null;
    var d = new Date(String(v).replace(" ", "T"));
    return isNaN(d.getTime()) ? null : d;
  }
  // Latin numbering requested from Intl, then converted — asking for Persian
  // digits directly also returns Persian-Arabic separators, which makes the
  // string harder to pick apart than to rebuild.
  function jalali(v) {
    var d = toDate(v);
    if (!d) return "—";
    try {
      var parts = new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", {
        timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(d).reduce(function (o, p) { o[p.type] = p.value; return o; }, {});
      return fa(parts.year + "/" + parts.month + "/" + parts.day);
    } catch (e) {
      return fa(d.toISOString().slice(0, 10));
    }
  }
  // formatToParts, not format(). Formatting a BARE year on the Persian
  // calendar appends the era — "1405 AP" — and that string went straight into
  // the invoice number, which read «۱۴۰۵ AP-۰۰۰۱». Asking for the year part
  // by name returns the number alone, whatever the locale decides to do
  // around it.
  function jalaliYear(v) {
    var d = toDate(v);
    if (!d) return "";
    try {
      var parts = new Intl.DateTimeFormat("en-u-ca-persian-nu-latn",
        { timeZone: "Asia/Tehran", year: "numeric" }).formatToParts(d);
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === "year") return parts[i].value.replace(/\D/g, "");
      }
      return "";
    } catch (e) { return ""; }
  }

  // ---- the amount in words --------------------------------------------
  // Iranian invoices carry «مبلغ به حروف». It is not decoration: it is the
  // line that settles an argument when a digit is smudged or disputed.
  var ONES = ["", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه"];
  var TEENS = ["ده", "یازده", "دوازده", "سیزده", "چهارده", "پانزده", "شانزده", "هفده", "هجده", "نوزده"];
  var TENS = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"];
  var HUNDREDS = ["", "صد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد"];
  var SCALES = ["", " هزار", " میلیون", " میلیارد", " بیلیون"];

  function under1000(n) {
    var out = [];
    var h = Math.floor(n / 100), r = n % 100;
    if (h) out.push(HUNDREDS[h]);
    if (r >= 10 && r < 20) out.push(TEENS[r - 10]);
    else {
      var t = Math.floor(r / 10), o = r % 10;
      if (t) out.push(TENS[t]);
      if (o) out.push(ONES[o]);
    }
    return out.join(" و ");
  }

  function words(n) {
    n = Math.floor(Math.abs(Number(n) || 0));
    if (n === 0) return "صفر";
    var chunks = [], i = 0;
    while (n > 0 && i < SCALES.length) {
      var c = n % 1000;
      if (c) {
        // "هزار و پانصد", never "یک هزار و پانصد" — Persian drops the یک in
        // front of هزار the same way it says صد rather than یک صد. Only the
        // thousands scale does this; "یک میلیون" is correct and stays.
        var w = (c === 1 && i === 1) ? "" : under1000(c);
        chunks.unshift(w + SCALES[i]);
      }
      n = Math.floor(n / 1000);
      i++;
    }
    return chunks.join(" و ").replace(/^\s+/, "");
  }

  // ---- render ----------------------------------------------------------
  function row(k, v) {
    if (!v) return "";                       // an unset seller field prints nothing
    return '<div class="party__r"><span>' + esc(k) + '</span><b>' + esc(v) + "</b></div>";
  }

  function render(d) {
    var planLabel = d.plan === "yearly" ? "سالانه" : "ماهانه";
    var months = d.plan === "yearly" ? "۱۲ ماه" : "۱ ماه";

    // The price we charge is what the café paid. If VAT applies it is
    // BACKED OUT of that figure rather than added on top — the gateway
    // already took `amount`, and an invoice whose total differs from the
    // money that actually moved is worse than no invoice.
    var total = Number(d.amount) || 0;
    var vatPct = Number(d.vat_percent) || 0;
    var net = vatPct > 0 ? Math.round(total / (1 + vatPct / 100)) : total;
    var vat = total - net;

    var seller = d.seller || {}, buyer = d.buyer || {};
    var issued = d.paid_at;
    var no = d.invoice_no > 0
      ? fa(jalaliYear(issued) + "-" + String(d.invoice_no).padStart(4, "0"))
      : "—";

    var totals =
      (vatPct > 0
        ? '<div class="trow"><span>مبلغ کل</span><b>' + fa(group(net)) + "</b></div>" +
          '<div class="trow"><span>مالیات بر ارزش افزوده (' + fa(vatPct) + "٪)</span><b>" + fa(group(vat)) + "</b></div>"
        : "") +
      '<div class="trow trow--grand"><span>مبلغ قابل پرداخت (تومان)</span><b>' + fa(group(total)) + "</b></div>";

    root.innerHTML =
      '<div class="sheet">' +
        '<div class="head">' +
          '<div class="brand">' +
            '<div class="brand__name">' + esc(seller.name || "ریلوی") + "</div>" +
            '<div class="brand__tag">باشگاه مشتریان کافه‌ها</div>' +
          "</div>" +
          '<div class="doc">' +
            '<div class="doc__t">فاکتور فروش</div>' +
            '<div class="doc__meta">شماره: <b>' + esc(no) + "</b></div>" +
            '<div class="doc__meta">تاریخ: <b>' + esc(jalali(issued)) + "</b></div>" +
          "</div>" +
        "</div>" +

        '<div class="parties">' +
          '<div class="party">' +
            '<div class="party__h">فروشنده</div>' +
            '<div class="party__n">' + esc(seller.legal_name || seller.name || "ریلوی") + "</div>" +
            row("شناسه ملی", seller.national_id) +
            row("کد اقتصادی", seller.economic_code) +
            row("شماره ثبت", seller.reg_no) +
            row("نشانی", seller.address) +
            row("کد پستی", seller.postal_code) +
            row("تلفن", seller.phone) +
            row("ایمیل", seller.email) +
          "</div>" +
          '<div class="party">' +
            '<div class="party__h">خریدار</div>' +
            '<div class="party__n">' + esc(buyer.cafe || "—") + "</div>" +
            row("نام", buyer.name) +
            row("تلفن", buyer.phone) +
            row("ایمیل", buyer.email) +
          "</div>" +
        "</div>" +

        '<table class="items"><thead><tr>' +
          "<th>ردیف</th><th>شرح خدمات</th><th>مدت</th><th>مبلغ (تومان)</th>" +
        "</tr></thead><tbody><tr>" +
          '<td class="num">۱</td>' +
          '<td class="items__desc"><b>اشتراک ریلوی — طرح ' + esc(planLabel) + "</b>" +
            '<span class="items__sub">باشگاه مشتریان، کارت وفاداری، کد QR و تگ NFC برای ' +
            esc(buyer.cafe || "این مجموعه") + "</span>" +
            (d.period_end ? '<span class="items__sub">اعتبار اشتراک تا ' + esc(jalali(d.period_end)) + "</span>" : "") +
          "</td>" +
          "<td>" + esc(months) + "</td>" +
          '<td class="money">' + fa(group(net)) + "</td>" +
        "</tr></tbody></table>" +

        '<div class="totals"><div class="totals__box">' + totals + "</div></div>" +

        '<div class="inwords">مبلغ به حروف: <b>' + esc(words(total)) + " تومان</b></div>" +

        '<div class="payref">' +
          '<div class="payref__h">اطلاعات پرداخت</div>' +
          '<div class="payref__b">' +
            '<div class="payref__i"><div class="payref__k">درگاه</div><div class="payref__v">ZarinPal</div></div>' +
            '<div class="payref__i"><div class="payref__k">شماره پیگیری</div><div class="payref__v">' +
              esc(d.ref_id || "—") + "</div></div>" +
            '<div class="payref__i"><div class="payref__k">تاریخ پرداخت</div><div class="payref__v">' +
              esc(jalali(issued)) + "</div></div>" +
          "</div>" +
        "</div>" +

        '<div class="sign">' +
          '<div class="sign__b">مهر و امضای فروشنده</div>' +
          '<div class="sign__b">مهر و امضای خریدار</div>' +
        "</div>" +

        '<div class="foot">' +
          "این فاکتور به صورت الکترونیکی صادر شده و بدون مهر و امضا معتبر است. " +
          "پرداخت از طریق درگاه زرین‌پال انجام شده و شماره پیگیری بالا مرجع هر گونه بررسی است." +
        "</div>" +
      "</div>";

    document.title = "فاکتور " + no + " · " + (buyer.cafe || "ریلوی");
  }

  function fail(msg) {
    root.innerHTML = '<div class="state">' + esc(msg) + "</div>";
  }

  document.getElementById("printBtn").addEventListener("click", function () { window.print(); });
  document.getElementById("backBtn").addEventListener("click", function () { location.href = "/owner"; });

  (function load() {
    var id = new URLSearchParams(location.search).get("p");
    if (!id) return fail("این لینک فاکتوری را مشخص نمی‌کند.");

    fetch(API + "/owner/invoice/data?p=" + encodeURIComponent(id), {
      headers: { Authorization: token },
    })
      .then(function (r) {
        if (r.status === 404) throw new Error("این فاکتور پیدا نشد.");
        if (r.status === 409) throw new Error("این پرداخت هنوز تکمیل نشده است.");
        if (r.status === 403) throw new Error("برای دیدن این فاکتور باید با حساب مدیر وارد شوید.");
        if (!r.ok) throw new Error("دریافت فاکتور ممکن نشد.");
        return r.json();
      })
      .then(render)
      .catch(function (err) { fail(err.message || "دریافت فاکتور ممکن نشد."); });
  })();
})();
