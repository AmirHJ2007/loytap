#!/usr/bin/env node
// Renders the three subscription emails to one page so the copy can be read
// as it will land. Renders from backend/pb_hooks/submail.js itself — the same
// file the cron will send from — so what is reviewed here cannot drift from
// what goes out.
//
//   node preview-subscription-emails.js && open subscription-emails-preview.html
const fs = require("fs");
const m = require("./backend/pb_hooks/submail.js");
const J = require("./backend/pb_hooks/jalali.js");

const sample = {
  cafe: "کافه آرورا",
  days: 7,
  graceDays: 7,
  // the same formatter the cron passes in — Jalali, Tehran
  endDate: J.faDate(Date.now() + 7 * 86400000),
  url: "https://reloy.ir/owner",
};

// the reminder goes out three times; the other two once each
const mails = [
  ["۷ روز مانده — یادآوری اول", m.renewalReminder(Object.assign({}, sample, { days: 7 }))],
  ["۳ روز مانده — یادآوری دوم", m.renewalReminder(Object.assign({}, sample, { days: 3 }))],
  ["فردا — آخرین یادآوری",      m.renewalReminder(Object.assign({}, sample, { days: 1 }))],
  ["اشتراک تمام شد — شروع مهلت", m.graceStarted(Object.assign({}, sample, { graceDays: 7 }))],
  ["۳ روز تا توقف مهر",          m.graceStarted(Object.assign({}, sample, { graceDays: 3 }))],
  ["فردا مهر متوقف می‌شود",       m.graceStarted(Object.assign({}, sample, { graceDays: 1 }))],
  ["پایان مهلت — توقف مهر",      m.shutdown(sample)],
];

// each email in its own iframe: these are whole documents with their own
// <body> background, and dropping three of them into one page would let the
// last one's styles decide what the others look like
const page = [
  '<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8">',
  '<title>Subscription emails</title>',
  '<style>body{margin:0;background:#1f2328;font-family:Vazirmatn,Tahoma,Arial,sans-serif;padding:28px}',
  'h2{color:#fff;font-size:15px;margin:28px 0 6px}',
  '.sub{color:#9aa0a6;font-size:12px;margin:0 0 10px;direction:rtl}',
  'iframe{width:100%;max-width:640px;height:500px;border:0;border-radius:14px;background:#f0f0f0}',
  'body{padding-bottom:60px}',
  '</style></head><body>',
  mails.map(([label, mail]) =>
    '<h2>' + label + '</h2>' +
    '<p class="sub"><b>Subject:</b> ' + m.esc(mail.subject) + '</p>' +
    '<iframe srcdoc="' + mail.body.replace(/"/g, "&quot;") + '"></iframe>'
  ).join(""),
  '</body></html>',
].join("");

fs.writeFileSync("subscription-emails-preview.html", page);
console.log("wrote subscription-emails-preview.html (" + page.length + " bytes)");

// and one file per email, because a long scrolling page is awkward to read
// side by side and awkward to screenshot
["reminder-7", "reminder-3", "reminder-tomorrow", "grace-7", "grace-3", "grace-tomorrow", "shutdown"].forEach((name, i) => {
  const f = "subscription-email-" + name + ".html";
  fs.writeFileSync(f, mails[i][1].body);
  console.log("  " + f);
});
