/* ============================================================================
   Reloy — "for business" onboarding site behaviour.

   No framework, no CDN, no GSAP: the site is served by the same PocketBase
   origin as the app, whose CSP is `script-src 'self'` with no 'unsafe-inline'
   and no external hosts (see backend/pb_hooks/headers.pb.js). Every effect
   here is CSS or the Web Animations API.

   Everything degrades: until this file adds `.js` to <html>, every revealed
   element is fully visible, so a no-JS visitor (or a crawler) sees the whole
   page. Every motion path checks prefers-reduced-motion first.
   ========================================================================== */
(function () {
  "use strict";

  /* ==========================================================================
     EDIT ME — every commercial fact on the page lives here.
     Values left as null render an honest "ask us" state rather than a made-up
     number, so the page is publishable before pricing is finalised.
     ========================================================================== */
  var SITE = {
    trialDays:    30,                 // e.g. 30  → "30 days free". null → "Free trial"
    priceMonthly: 6000000,            // Toman per month, per café. null → "Talk to us"
    priceYearly:  60000000,           // Toman per year, per café — must stay < priceMonthly*12
                                       // for the "N months free" badge to read as a real saving
    currency:     "Toman",
    email:        "reloy.ir@gmail.com",
    phone:        "0930 628 9746",
    // social handles, with or without the @. null hides that icon entirely
    // rather than shipping a dead link.
    telegram:     "reloy_ir",         // TODO confirm handle → t.me/<handle>
    instagram:    "reloy_ir",         // → instagram.com/<handle>
    setupFee:     false
  };

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  var fine    = window.matchMedia("(hover: hover) and (pointer: fine)");
  var root    = document.documentElement;

  var $  = function (id) { return document.getElementById(id); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  var on = function (el, ev, fn, opt) { if (el) el.addEventListener(ev, fn, opt); };

  var FB_STRINGS = {
    en: {
      FB_ABOUT_EYEBROW: "About Reloy",
      FB_ABOUT_P1: "Reloy was built for the cafés we actually go to. We kept watching good places hand out paper stamp cards that customers lost within a week, while the loyalty apps on offer wanted a download, a password, and a fee that only makes sense at twenty branches.",
      FB_ABOUT_P2: "So we built the version a single café can live with: one stamp behind the counter, two fields for the customer, and a dashboard that finally answers “are people coming back?” — a question most owners have only ever been able to guess at.",
      FB_ABOUT_P3: "<strong>We are a small team from Mashhad.</strong> We met at Hasheminejad 2 and most of us never left, which is why getting you set up means one of us walking into your café — not a courier and a PDF.",
      FB_ABOUT_P4: "<strong>We are early, and we are not hiding it.</strong> Reloy is live in its first cafés right now, which is exactly why joining now is worth it: you get our full attention and a direct line to the person building it. If it does not work for you, you walk away — there is no contract and nothing installed on your machines.",
      FB_ADDR: "Karimi 5, Aghdasie 15, Mashhad, Iran",
      FB_BACK_TOP: "Back to top",
      FB_BILLING_MONTHLY: "Monthly",
      FB_BILLING_YEARLY: "Yearly",
      FB_CONTACT_H: "Contact",
      FB_DAYS_UNIT: "days",
      FB_DEMO_CAPTION: "The exact card your customers keep on their phone",
      FB_DONE_H3: "Thanks — your email is ready to send",
      FB_DONE_P: "We have opened a prefilled message for <strong id=\"doneCafe\"></strong>.\n                  Press send in your mail app and we will come back to you within a day.\n                  If nothing opened, write to <a data-email href=\"#\">reloy.ir@gmail.com</a> directly.",
      FB_FAQ_A1: "No — and this is the part that makes the difference at the counter. Reloy is a web page. One press of the stamp opens it instantly, with nothing from the App Store or Play Store, nothing to install, and no storage used. They can add it to their home screen so it opens like an app, but that is a shortcut, not a download.",
      FB_FAQ_A10: "Yes. Every reward carries an expiry date, 30 days from when it is earned by default. Change that number for your whole café from your dashboard, or set a different one on an individual reward. It is also why the 71% claimed rate on this page means something: it only counts rewards that got redeemed before the clock ran out.",
      FB_FAQ_A11: "A name and a mobile number. That is everything. No email, no password, no address, no payment details, no location, and no access to their contacts or photos.",
      FB_FAQ_A12: "Yes. Everything travels over HTTPS and is stored on our own server — we do not sell, share or rent your customer list to anyone, and no other café using Reloy can see it. Your customers' data belongs to your café, and you can ask us to delete it at any time.",
      FB_FAQ_A13: "No, and that is on purpose. If tapping the tag meant a café could call or text customers directly, people would think twice before tapping it, and the tap is the whole product. We keep phone numbers on our own server for exactly that reason, so customers trust the tap and keep using it. Reaching people who have drifted is a feature we are building, and it will work by sending a message inside the card already on their home screen, not by handing their number to anyone.",
      FB_FAQ_A14: "Not yet, but it is in development for an upcoming version. The plan is to let you reach customers who have drifted past their usual rhythm with a message inside the card already on their home screen, and send an offer to the people it would actually bring back instead of discounting everyone who was already on their way in. Ask us where it stands if it matters for your decision to start now.",
      FB_FAQ_A2: "It does not matter. The Reloy stamp is a completely separate object that lives behind your counter — it has nothing to do with your card machine, your till, or your payment provider, and it needs no power, no wiring and no internet connection of its own.",
      FB_FAQ_A3: "You can set one, and it shows right on the customer's card so they know the threshold going in. We are not connected to your till or accounting system, so we cannot check the bill ourselves. It is your cashier's call to only press the stamp once the purchase clears it. Leave it at zero, the default, and there is nothing to enforce at all.",
      FB_FAQ_A4: "Yes, whenever you like, from your dashboard. You control both the discount and how many stamps it takes to earn it. Existing cards pick up the change automatically — nobody has to be issued a new card.",
      FB_FAQ_A5: "Nothing is lost. Their card lives on our server against their mobile number, not on the handset. Your cashier stamps the new phone, they confirm their number, and every stamp they have collected is already there.",
      FB_FAQ_A6: "Cafés running loyalty programmes overseas do see more repeat visits, so the pattern is real. But nobody can promise you an exact number sight unseen, because every café, menu and neighbourhood is different, and no honest answer skips that. That is exactly what the free trial is for: run it at your own counter, watch your own dashboard, and decide for yourself whether it is actually bringing your customers back before you pay anything.",
      FB_FAQ_A9: "Multi-location is in development. The plan is one dashboard for your whole brand with a sub-dashboard underneath it for each branch, every branch connected under the same account, and one bill for the brand rather than one per branch. Today a subscription covers a single café. Ask us where multi-location stands if it matters for your decision to start now.",
      FB_FAQ_CAT1: "How it works",
      FB_FAQ_CAT2: "Money & the business case",
      FB_FAQ_CAT3: "Privacy & your customers",
      FB_FAQ_EYEBROW: "Questions",
      FB_FAQ_H2: "The things owners ask us first.",
      FB_FAQ_Q1: "Does my customer have to download an app?",
      FB_FAQ_Q10: "Do unclaimed rewards expire?",
      FB_FAQ_Q11: "What information does the customer give up?",
      FB_FAQ_Q12: "Is my customers' data secure?",
      FB_FAQ_Q13: "Can I get my customers' phone numbers?",
      FB_FAQ_Q14: "Can I target specific customers with messages or discounts?",
      FB_FAQ_Q2: "What if my payment terminal does not support NFC?",
      FB_FAQ_Q3: "Can I require a minimum purchase before a stamp counts?",
      FB_FAQ_Q4: "Can I change the reward later?",
      FB_FAQ_Q5: "What happens if a customer changes their phone?",
      FB_FAQ_Q6: "Will this actually increase my sales?",
      FB_FAQ_Q7: "How long is the free trial?",
      FB_FAQ_Q8: "What does it cost after the trial?",
      FB_FAQ_Q9: "What if I have more than one location?",
      FB_FEATURES_H3: "Everything included",
      FB_FEATURES_SUB: "One price. No tier above this one, and nothing held back for it.",
      FB_FEAT_1: "Your NFC tag, delivered and ready to use",
      FB_FEAT_2: "Staff walked through it on your floor",
      FB_FEAT_3: "Your own card design, logo and reward",
      FB_FEAT_4: "Unlimited customers, unlimited stamps",
      FB_FEAT_5: "The full owner dashboard — visits, regulars, trends",
      FB_FEAT_6: "Staff scanner with real-time stamp confirmation",
      FB_FEAT_7: "Change your reward whenever you want",
      FB_FEAT_8: "No commission on anything you sell",
      FB_FIELD_CAFE_LABEL: "Café or restaurant name",
      FB_FIELD_CAFE_PH: "Filo",
      FB_FIELD_CITY_LABEL: "City",
      FB_FIELD_CITY_PH: "Mashhad",
      FB_FIELD_CONTACT_HINT: "Whichever you would rather we used.",
      FB_FIELD_CONTACT_LABEL: "Phone or email",
      FB_FIELD_PERSON_LABEL: "Who should we talk to?",
      FB_FIELD_PERSON_PH: "Your name",
      FB_FOOT_APP_LINK: "The customer app",
      FB_FOOT_BIZ_TERMS: "Business terms",
      FB_FOOT_COL1_H: "The product",
      FB_FOOT_COL2_H: "Get in touch",
      FB_FOOT_COL3_H: "Small print",
      FB_FOOT_CUST_TERMS: "Customer terms & privacy",
      FB_FOOT_LEGAL: "© <span id=\"footYear\">2026</span> Reloy. All rights reserved. Digital stamp cards for cafés and restaurants.",
      FB_FOOT_PITCH: "\n          A digital stamp card that lives on your customer's home screen.\n          One stamp behind the counter, one press at checkout.\n        ",
      FB_FORM_PRIVACY_HINT: "We will only use your details to talk to you about Reloy.",
      FB_FORM_SUBMIT: "Request early access",
      FB_FORM_SUMMARY_H3: "Please check these before sending",
      FB_HEAT_FRI: "Fri",
      FB_HEAT_MON: "Mon",
      FB_HEAT_SAT: "Sat",
      FB_HEAT_SUN: "Sun",
      FB_HEAT_THU: "Thu",
      FB_HEAT_TUE: "Tue",
      FB_HEAT_WED: "Wed",
      FB_HERO_EYEBROW: "For cafés & restaurants",
      FB_HERO_LEDE: "\n            Reloy is a digital stamp card for your counter. Your cashier presses one NFC\n            stamp to the customer's phone, no app store, no download, no password, and\n            their card fills itself. You finally see who keeps coming back, and when.\n          ",
      FB_HERO_NOTE: "NFC tag, staff training and setup included — live in about a week.",
      FB_HERO_SEE_HOW: "See how it works",
      FB_HERO_TITLE_HTML: "<span class=\"line\"><span class=\"w\" style=\"--d:60ms\">Turn</span> <span class=\"w\" style=\"--d:115ms\">every</span> <span class=\"w\" style=\"--d:170ms\">tap</span></span><span class=\"line\"><span class=\"w\" style=\"--d:225ms\">into</span> <span class=\"w\" style=\"--d:280ms\">a</span> <span class=\"w\" style=\"--d:335ms\">customer</span></span><span class=\"line\"><span class=\"w\" style=\"--d:400ms\">who</span> <span class=\"w hero__accent\" style=\"--d:455ms\">comes back.<svg aria-hidden=\"true\" preserveAspectRatio=\"none\" viewBox=\"0 0 200 12\"><path d=\"M3 8.6C40 3.2 96 2 197 5.8\"></path></svg></span></span>",
      FB_HOW_EYEBROW: "How Reloy works",
      FB_HOW_G1_H: "Stamp their phone at checkout",
      FB_HOW_G1_P: "The Reloy stamp stays on your side of the counter. The customer holds out their own phone and your cashier presses the stamp to it — that is their whole side of it.",
      FB_HOW_G2_H: "First time? Name and mobile number",
      FB_HOW_G2_P: "Two fields. The account is created instantly — no app store, no password, no email confirmation, nothing to install.",
      FB_HOW_G3_H: "They add it to their home screen",
      FB_HOW_G3_P: "It looks and opens like an app icon, but there is nothing to download and nothing to update. It is a web page that behaves like an app.",
      FB_HOW_G4_H: "Staff confirm the tap on their panel",
      FB_HOW_G4_P: "The request shows up live on the staff panel. A stamp is only added once staff approve it — that is what stops anyone claiming a free one.",
      FB_HOW_G5_H: "Every visit after that is one tap",
      FB_HOW_G5_P: "Tap, stamp added, card updated. No card to carry, no card to lose, no app to open first — fill the card and the reward is theirs.",
      FB_HOW_GROUP_LABEL: "First time only",
      FB_HOW_H2: "Two moments. Five steps each.",
      FB_HOW_TAB_GAIN: "Gaining a reward",
      FB_HOW_TAB_HOW_LINK: "How it works",
      FB_HOW_TAB_USE: "Using a reward",
      FB_HOW_U1_H: "They bring up their card",
      FB_HOW_U1_P: "A completed card turns into a ticket — a QR code and a short backup code, ready to show at the counter.",
      FB_HOW_U2_H: "Staff scan it, or type the code",
      FB_HOW_U2_P: "The staff scanner reads the QR in a beat. Mid-rush and awkward to scan? Staff can type the short code by hand instead.",
      FB_HOW_U3_H: "Checked before anything is given",
      FB_HOW_U3_P: "It is verified against our server instantly — an expired or already-used code is caught right there, before any discount is handed out.",
      FB_HOW_U4_H: "Redeemed — apply the discount",
      FB_HOW_U4_P: "The screen turns to \"Redeemed ✓.\" Staff apply it on the customer's bill right there at the register.",
      FB_HOW_U5_H: "Used once, then it is gone",
      FB_HOW_U5_P: "The same code cannot be scanned twice. No reused screenshots, no double discounts — every reward is spent exactly once.",
      FB_INS1_BODY: "Every stamp is time-stamped, so the grid fills in on its own. Thursday evening is this café’s peak — nearly four times a Friday morning.",
      FB_INS1_EYEBROW: "When they come",
      FB_INS1_H3: "Your week has a shape, and now you can see it",
      FB_INS1_USE: "<span class=\"ins__use-tag\">Use it to</span> put your strongest staff on the Thursday rush, stop paying for a quiet Monday morning, and time your bake and prep to the hours that actually earn.",
      FB_INS2_BODY: "One counts every first-timer you have ever served and asks how many came back even once. The other splits this month between faces your staff had seen before and faces they had not.",
      FB_INS2_CAP1: "of first-timers came back at least once",
      FB_INS2_CAP2: "<b>38%</b> new this month · <b>62%</b> returning",
      FB_INS2_EYEBROW: "Whether they come back",
      FB_INS2_H3: "Are you building regulars, or serving strangers?",
      FB_INS2_USE: "<span class=\"ins__use-tag\">Use it to</span> see whether you are adding regulars or only replacing the ones you lose. A café can look busy all month and still be serving a different room every week.",
      FB_INS3_BODY: "Rewards issued against rewards actually redeemed, next to the normal gap between one customer’s visits — the median, so one person wandering back after three months does not distort it.",
      FB_INS3_CAP1: "typical gap between one customer’s visits",
      FB_INS3_CAP2: "of issued rewards actually claimed",
      FB_INS3_EYEBROW: "Whether the reward works",
      FB_INS3_H3: "Is the prize pulling its weight?",
      FB_INS3_USE: "<span class=\"ins__use-tag\">Use it to</span> fix a prize that gets earned but never claimed. And once you know the normal gap is four days, someone at twenty days has clearly drifted.",
      FB_INS_EYEBROW: "What you get",
      FB_INS_H2: "Who is coming back, in real time, without a spreadsheet.",
      FB_INS_LEDE: "\n            Every tap is a data point you never had before. This is the owner dashboard,\n            with sample figures from a café doing a few hundred stamps a month.\n          ",
      FB_NAV_CTA: "Get early access",
      FB_NAV_FAQ: "FAQ",
      FB_NAV_HOW: "How it works",
      FB_NAV_INSIGHTS: "What you get",
      FB_NAV_PRICING: "Pricing",
      FB_NEXT1_H3: "Targeted messages, in the card they kept",
      FB_NEXT1_P: "Reach the customers who have drifted past their usual rhythm — inside the card already on their home screen, not in the message app where they hear from family.",
      FB_NEXT2_H3: "Offers aimed at the people they would move",
      FB_NEXT2_P: "Send a reward to the customers it would actually bring back, instead of discounting everyone who was already on their way in.",
      FB_NEXT_LABEL: "<span aria-hidden=\"true\" class=\"next__dot\"></span>In development",
      FB_PLAN_FOOT: "Your trial starts the day your tag goes live at your counter — not the day you sign up. By starting a trial you agree to our <a href=\"business-terms.html\">Business Terms</a>.",
      FB_PLAN_NOTE: "No setup fee, no per-tap charge, no per-member fee. The number on the left is the whole bill.",
      FB_PRICING_EYEBROW: "Pricing",
      FB_PRICING_H2: "Grow your regulars.<br/>Not your software bill.",
      FB_PRICING_LEDE: "Every feature, unlimited customers and unlimited stamps for one flat price.",
      FB_PRIZE_HINT: "Show this to the staff",
      FB_PRIZE_OFF: "off your next order",
      FB_PRIZE_TITLE: "Congratulation!",
      FB_REQCARD_SUB: "wants a stamp",
      FB_SCENE_G1_H: "Tap to collect",
      FB_SCENE_G1_P: "Hold it out — your cashier presses the stamp to it.",
      FB_SCENE_G2_H: "Two fields, once",
      FB_SCENE_G2_P: "Name and mobile number. No password.",
      FB_SCENE_G3_H: "On the home screen",
      FB_SCENE_G3_P: "Opens like an app. Nothing installed.",
      FB_SCENE_G4_H: "Staff sees it live",
      FB_SCENE_G4_P: "They confirm — no confirm, no stamp.",
      FB_SCENE_G5_H: "Two of eight",
      FB_SCENE_G5_P: "The stamp lands the moment your staff confirm.",
      FB_SCENE_U1_H: "Their ticket, on screen",
      FB_SCENE_U1_P: "A QR code and a short backup code.",
      FB_SCENE_U2_H: "One scan, or one code",
      FB_SCENE_U2_P: "Camera busy? Type it in by hand.",
      FB_SCENE_U3_H: "Checking…",
      FB_SCENE_U3_P: "Verified against our server, live.",
      FB_SCENE_U4_H: "Redeemed ✓",
      FB_SCENE_U4_P: "Applied — give the customer their discount.",
      FB_SCENE_U5_H: "Spent once, for good",
      FB_SCENE_U5_P: "That exact code will never work again.",
      FB_SIGNUP_ASIDE_1: "We send the tag and set your card up for you.",
      FB_SIGNUP_ASIDE_2: "We show your staff how it works, on your floor.",
      FB_SIGNUP_ASIDE_3: "Your trial only starts once it is actually live.",
      FB_SIGNUP_ASIDE_4: "No contract. Stop whenever you want.",
      FB_SIGNUP_EYEBROW: "Get early access",
      FB_SIGNUP_H2: "Let's get a tag on your counter.",
      FB_SIGNUP_LEDE: "Tell us where you are and we will get back to you. We will set up your NFC kit within about a week.",
      FB_TEAM_1: "Founder. Builds it. Reading computer science at UCL, on Reloy year-round.",
      FB_TEAM_2: "Co-founder. Reading computer engineering in Mashhad — and the one who turns up at your counter.",
      FB_TOMAN: "Toman",
      FB_TRUST_1: "No card needed",
      FB_TRUST_2: "No contract",
      FB_TRUST_3: "Live in about a week",
      FB_USED_BADGE: "Used",
      FB_WHY_EYEBROW: "Why cafés choose Reloy",
      FB_WHY_H2: "It has to survive the morning rush, or it is useless.",
      FB_WHY_LIST_HTML: "<div class=\"why__row rv\"><span aria-hidden=\"true\" class=\"why__ico\"><svg aria-hidden=\"true\" fill=\"none\" height=\"22\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" viewBox=\"0 0 24 24\" width=\"22\"><circle cx=\"12\" cy=\"12\" r=\"9\"></circle><path d=\"M12 7v5l3 2\"></path></svg></span><div><h3>It does not slow the queue down</h3><p>A press takes about as long as a card payment. The customer holds out their own phone, your cashier presses the stamp to it, and nobody types anything, just one tap to confirm on the panel already open behind the counter.</p></div><span class=\"why__stat\">~2 seconds</span></div><div class=\"why__row rv\"><span aria-hidden=\"true\" class=\"why__ico\"><svg aria-hidden=\"true\" fill=\"none\" height=\"22\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" viewBox=\"0 0 24 24\" width=\"22\"><path d=\"M6 9V3h12v6\"></path><rect height=\"7\" rx=\"2\" width=\"18\" x=\"3\" y=\"9\"></rect><path d=\"M7 16h10v5H7z\"></path></svg></span><div><h3>No more printing paper cards</h3><p>No reprints when the design changes, no boxes of cards behind the counter, no stamp pad drying out.</p></div><span class=\"why__stat\">Zero print cost</span></div><div class=\"why__row rv\"><span aria-hidden=\"true\" class=\"why__ico\"><svg aria-hidden=\"true\" fill=\"none\" height=\"22\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" viewBox=\"0 0 24 24\" width=\"22\"><path d=\"M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1\"></path><circle cx=\"9.5\" cy=\"7\" r=\"3.5\"></circle><path d=\"M16 11l2 2 4-4\"></path></svg></span><div><h3>Almost nothing asked of the customer</h3><p>A name and a mobile number, once. No app store visit, no password to invent, no email to verify, no storage used on their phone.</p></div><span class=\"why__stat\">2 fields, once</span></div><div class=\"why__row rv\"><span aria-hidden=\"true\" class=\"why__ico\"><svg aria-hidden=\"true\" fill=\"none\" height=\"22\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" viewBox=\"0 0 24 24\" width=\"22\"><path d=\"M3 9h18l-1.6-5H4.6L3 9Z\"></path><path d=\"M5 9v11h14V9\"></path><path d=\"M9.5 20v-6h5v6\"></path></svg></span><div><h3>Your café stays front and centre</h3><p>Your colours, your logo and your name are on every screen a customer sees. Reloy stays behind the scenes.</p></div><span class=\"why__stat\">Your brand</span></div><div class=\"why__row rv\"><span aria-hidden=\"true\" class=\"why__ico\"><svg aria-hidden=\"true\" fill=\"none\" height=\"22\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" viewBox=\"0 0 24 24\" width=\"22\"><path d=\"M3 17l6-6 4 4 7-7\"></path><path d=\"M14 7h7v7\"></path></svg></span><div><h3>See when your regulars return</h3><p>Compare 7 or 30 days of real stamp data to spot your busiest days, your strongest hours, and whether repeat visits are growing.</p></div><span class=\"why__stat\">7 or 30 days</span></div><div class=\"why__row rv\"><span aria-hidden=\"true\" class=\"why__ico\"><svg aria-hidden=\"true\" fill=\"none\" height=\"22\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" viewBox=\"0 0 24 24\" width=\"22\"><path d=\"M9.5 3h5v3.5a3 3 0 0 0 .9 2.1L16.5 10h-9l1.1-1.4a3 3 0 0 0 .9-2.1Z\"></path><rect height=\"4\" rx=\"1.5\" width=\"16\" x=\"4\" y=\"13\"></rect><path d=\"M5.5 21h13\"></path></svg></span><div><h3>It still feels like a stamp</h3><p>The tag we send you is a classic stamp with the chip inside. Your staff press it onto the phone the way they always pressed paper, the same ritual your counter already had, without the ink pad.</p></div><span class=\"why__stat\">Still a stamp</span></div><div class=\"why__row rv\"><span aria-hidden=\"true\" class=\"why__ico\"><svg aria-hidden=\"true\" fill=\"none\" height=\"22\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" viewBox=\"0 0 24 24\" width=\"22\"><path d=\"M3 7h11v9H3z\"></path><path d=\"M14 10h4l3 3v3h-7z\"></path><circle cx=\"7\" cy=\"18\" r=\"2\"></circle><circle cx=\"17\" cy=\"18\" r=\"2\"></circle></svg></span><div><h3>We set it up, not you</h3><p>We send the NFC tag, get your card and reward configured, and show your staff how it works on the floor. You are running in about a week.</p></div><span class=\"why__stat\">~1 week</span></div>",
    },
    fa: {
      FB_ABOUT_EYEBROW: "درباره رلوی",
      FB_ABOUT_P1: "رلوی برای کافه‌هایی ساخته شده که خودمان هم می‌رویم. دیدیم جاهای خوب کارت‌های کاغذی پخش می‌کنند که مشتری ظرف یک هفته گمشان می‌کند، درحالی‌که اپ‌های وفاداری موجود یک دانلود، یک رمز عبور، و هزینه‌ای می‌خواهند که فقط برای بیست شعبه معنی دارد.",
      FB_ABOUT_P2: "پس نسخه‌ای ساختیم که یک کافه تنها هم بتواند باهاش زندگی کند: یک استمپ پشت پیشخوان، دو فیلد برای مشتری، و داشبوردی که بالاخره به این سؤال جواب می‌دهد «آیا مردم برمی‌گردند؟» — سؤالی که بیشتر صاحبان کسب‌وکار فقط حدس می‌زدند.",
      FB_ABOUT_P3: "<strong>ما یک تیم کوچک از مشهد هستیم.</strong> در هاشمی‌نژاد ۲ آشنا شدیم و بیشترمان همان‌جا ماندیم، برای همین راه‌اندازی شما یعنی یکی از ما وارد کافه‌تان می‌شود — نه یک پیک با یک PDF.",
      FB_ABOUT_P4: "<strong>ما تازه‌کاریم و پنهانش نمی‌کنیم.</strong> رلوی همین حالا در اولین کافه‌هایش فعال است، و دقیقاً برای همین همین حالا پیوستن می‌ارزد: توجه کامل ما و ارتباط مستقیم با کسی که آن را می‌سازد، نصیبتان می‌شود. اگر برایتان کار نکرد، کنار می‌کشید — نه قراردادی هست و نه چیزی روی دستگاه‌هایتان نصب شده.",
      FB_ADDR: "کریمی ۵، اقدسیه ۱۵، مشهد، ایران",
      FB_BACK_TOP: "بازگشت به بالا",
      FB_BILLING_MONTHLY: "ماهانه",
      FB_BILLING_YEARLY: "سالانه",
      FB_CONTACT_H: "تماس با ما",
      FB_DAYS_UNIT: "روز",
      FB_DEMO_CAPTION: "همان کارتی که مشتری‌های شما روی گوشی‌شان نگه می‌دارند",
      FB_DONE_H3: "ممنون — ایمیل شما آماده ارسال است",
      FB_DONE_P: "یک پیام از پیش پرشده برای <strong id=\"doneCafe\"></strong> باز کرده‌ایم.\n                  در اپ ایمیل خود دکمه ارسال را بزنید و ما ظرف یک روز پاسخ می‌دهیم.\n                  اگر چیزی باز نشد، مستقیم به <a data-email href=\"#\">reloy.ir@gmail.com</a> بنویسید.",
      FB_FAQ_A1: "نه — و همین نکته فرق را در پیشخوان می‌سازد. رلوی یک صفحه وب است. یک تپ استمپ، آن را فوراً باز می‌کند، بدون چیزی از اپ‌استور یا پلی‌استور، بدون نصب، و بدون فضای اشغال‌شده. می‌توانند آن را به صفحه اصلی گوشی‌شان اضافه کنند تا مثل اپ باز شود، اما این یک میان‌بر است، نه دانلود.",
      FB_FAQ_A10: "بله. هر پاداش یک تاریخ انقضا دارد، به‌طور پیش‌فرض ۳۰ روز از زمان کسبش. این عدد را برای کل کافه‌تان از داشبورد عوض کنید، یا برای یک پاداش خاص عدد دیگری بگذارید. برای همین است که نرخ ۷۱٪ استفاده‌شده در این صفحه معنی دارد: فقط پاداش‌هایی را می‌شمارد که پیش از تمام‌شدن زمان، استفاده شده‌اند.",
      FB_FAQ_A11: "یک نام و یک شماره موبایل. همین. بدون ایمیل، بدون رمز عبور، بدون آدرس، بدون اطلاعات پرداخت، بدون موقعیت مکانی، و بدون دسترسی به مخاطبین یا عکس‌هایشان.",
      FB_FAQ_A12: "بله. همه‌چیز از طریق HTTPS منتقل و روی سرور خودمان ذخیره می‌شود — لیست مشتریان شما را به کسی نمی‌فروشیم، به اشتراک نمی‌گذاریم یا اجاره نمی‌دهیم، و هیچ کافه دیگری که از رلوی استفاده می‌کند نمی‌تواند آن را ببیند. اطلاعات مشتریان شما متعلق به کافه شماست، و هر زمان بخواهید می‌توانید از ما بخواهید حذفش کنیم.",
      FB_FAQ_A13: "نه، و این عمدی است. اگر تپ زدن به تگ به این معنی بود که یک کافه می‌تواند مستقیم با مشتری تماس بگیرد یا پیام بدهد، مردم قبل از تپ زدن دو بار فکر می‌کردند، و همین تپ تمام محصول است. ما شماره‌ها را دقیقاً برای همین روی سرور خودمان نگه می‌داریم، تا مشتری به تپ اعتماد کند و به استفاده ادامه دهد. رساندن پیام به کسانی که فاصله گرفته‌اند ویژگی‌ای است که در حال ساختنش هستیم، و از طریق پیامی داخل همان کارتی که روی صفحه اصلی گوشی‌شان است کار خواهد کرد، نه با دادن شماره‌شان به کسی.",
      FB_FAQ_A14: "هنوز نه، اما برای نسخه بعدی در دست ساخت است. برنامه این است که بتوانید مشتریانی را که از ریتم معمولشان فاصله گرفته‌اند با پیامی داخل همان کارت روی صفحه اصلی گوشی‌شان پیدا کنید، و به کسانی که واقعاً برمی‌گردند پیشنهاد بدهید، به‌جای تخفیف به همه کسانی که در هر صورت می‌آمدند. اگر برای تصمیم شما اهمیت دارد، از ما درباره وضعیتش بپرسید.",
      FB_FAQ_A2: "فرقی نمی‌کند. استمپ رلوی یک وسیله کاملاً جدا است که پشت پیشخوان شما می‌ماند — هیچ ربطی به دستگاه کارت‌خوان، صندوق، یا درگاه پرداخت شما ندارد، و نیازی به برق، سیم‌کشی یا اینترنت مخصوص خودش هم ندارد.",
      FB_FAQ_A3: "می‌توانید تعیین کنید، و همان روی کارت مشتری نشان داده می‌شود تا از قبل بداند. ما به صندوق یا سیستم حسابداری شما وصل نیستیم، پس نمی‌توانیم خودمان صورت‌حساب را چک کنیم. تصمیم با کارمند شماست که فقط بعد از رسیدن به آن حد استمپ بزند. آن را روی صفر — پیش‌فرض — بگذارید تا چیزی برای اجرا نباشد.",
      FB_FAQ_A4: "بله، هر وقت خواستید، از داشبوردتان. هم تخفیف و هم تعداد استمپ لازم برای گرفتنش دست شماست. کارت‌های موجود خودکار تغییر را می‌گیرند — نیازی نیست کارت جدیدی صادر شود.",
      FB_FAQ_A5: "چیزی از دست نمی‌رود. کارت او روی سرور ما و بر اساس شماره موبایلش ذخیره است، نه روی گوشی. کارمند شما گوشی جدید را استمپ می‌زند، مشتری شماره‌اش را تأیید می‌کند، و همه استمپ‌هایی که جمع کرده همان‌جا هستند.",
      FB_FAQ_A6: "کافه‌هایی که در دنیا برنامه وفاداری اجرا می‌کنند بازدید تکراری بیشتری می‌بینند، پس این الگو واقعی است. اما کسی نمی‌تواند بدون دیدن کافه شما عدد دقیقی قول بدهد، چون هر کافه، منو و محله‌ای فرق دارد، و جواب صادقانه این را نادیده نمی‌گیرد. دقیقاً برای همین دوره آزمایشی رایگان هست: آن را روی پیشخوان خودتان اجرا کنید، داشبورد خودتان را ببینید، و پیش از پرداخت هر پولی خودتان تصمیم بگیرید که آیا واقعاً مشتری‌هایتان را برمی‌گرداند یا نه.",
      FB_FAQ_A9: "چند‌شعبه‌ای در دست ساخت است. برنامه این است: یک داشبورد برای کل برند شما با یک زیر‌داشبورد برای هر شعبه، همه شعبه‌ها زیر یک حساب متصل، و یک صورت‌حساب برای کل برند به‌جای یکی برای هر شعبه. امروز یک اشتراک فقط یک کافه را پوشش می‌دهد. اگر برای تصمیم شما اهمیت دارد، از ما درباره وضعیت چند‌شعبه‌ای بپرسید.",
      FB_FAQ_CAT1: "روش کار",
      FB_FAQ_CAT2: "پول و توجیه کسب‌وکار",
      FB_FAQ_CAT3: "حریم خصوصی و مشتریان شما",
      FB_FAQ_EYEBROW: "سوالات",
      FB_FAQ_H2: "چیزهایی که صاحبان کسب‌وکار اول از همه می‌پرسند.",
      FB_FAQ_Q1: "آیا مشتری من باید اپی دانلود کند؟",
      FB_FAQ_Q10: "آیا پاداش‌های استفاده‌نشده منقضی می‌شوند؟",
      FB_FAQ_Q11: "مشتری چه اطلاعاتی می‌دهد؟",
      FB_FAQ_Q12: "آیا اطلاعات مشتریانم امن است؟",
      FB_FAQ_Q13: "می‌توانم شماره تلفن مشتریانم را داشته باشم؟",
      FB_FAQ_Q14: "می‌توانم مشتریان خاصی را با پیام یا تخفیف هدف بگیرم؟",
      FB_FAQ_Q2: "اگر دستگاه پرداخت من NFC نداشته باشد چه؟",
      FB_FAQ_Q3: "می‌توانم برای ثبت استمپ حداقل خرید تعیین کنم؟",
      FB_FAQ_Q4: "می‌توانم بعداً پاداش را عوض کنم؟",
      FB_FAQ_Q5: "اگر مشتری گوشی‌اش را عوض کند چه می‌شود؟",
      FB_FAQ_Q6: "آیا این واقعاً فروش من را بالا می‌برد؟",
      FB_FAQ_Q7: "دوره آزمایشی رایگان چقدر طول می‌کشد؟",
      FB_FAQ_Q8: "بعد از دوره آزمایشی چقدر هزینه دارد؟",
      FB_FAQ_Q9: "اگر بیش از یک شعبه داشته باشم چه؟",
      FB_FEATURES_H3: "همه‌چیز شامل می‌شود",
      FB_FEATURES_SUB: "یک قیمت. هیچ پلن بالاتری وجود ندارد و چیزی کنار گذاشته نشده.",
      FB_FEAT_1: "تگ NFC شما، تحویل‌شده و آماده استفاده",
      FB_FEAT_2: "آموزش پرسنل، در محل کار شما",
      FB_FEAT_3: "طراحی کارت، لوگو و پاداش مخصوص خودتان",
      FB_FEAT_4: "مشتری نامحدود، استمپ نامحدود",
      FB_FEAT_5: "داشبورد کامل صاحب کسب‌وکار — بازدیدها، مشتری ثابت، روندها",
      FB_FEAT_6: "اسکنر پرسنل با تأیید زنده استمپ",
      FB_FEAT_7: "هر وقت خواستید پاداش را عوض کنید",
      FB_FEAT_8: "بدون کمیسیون روی هرچه می‌فروشید",
      FB_FIELD_CAFE_LABEL: "نام کافه یا رستوران",
      FB_FIELD_CAFE_PH: "فیلو",
      FB_FIELD_CITY_LABEL: "شهر",
      FB_FIELD_CITY_PH: "مشهد",
      FB_FIELD_CONTACT_HINT: "هرکدام که ترجیح می‌دهید استفاده کنیم.",
      FB_FIELD_CONTACT_LABEL: "تلفن یا ایمیل",
      FB_FIELD_PERSON_LABEL: "با چه کسی صحبت کنیم؟",
      FB_FIELD_PERSON_PH: "نام شما",
      FB_FOOT_APP_LINK: "اپ مشتری",
      FB_FOOT_BIZ_TERMS: "شرایط کسب‌وکار",
      FB_FOOT_COL1_H: "محصول",
      FB_FOOT_COL2_H: "در تماس باشید",
      FB_FOOT_COL3_H: "نکات حقوقی",
      FB_FOOT_CUST_TERMS: "شرایط و حریم خصوصی مشتری",
      FB_FOOT_LEGAL: "© <span id=\"footYear\">2026</span> رلوی. تمام حقوق محفوظ است. کارت‌های امتیاز دیجیتال برای کافه‌ها و رستوران‌ها.",
      FB_FOOT_PITCH: "یک کارت امتیاز دیجیتال که روی صفحه اصلی گوشی مشتری شما زندگی می‌کند.\n          یک استمپ پشت پیشخوان، یک تپ در لحظه پرداخت.",
      FB_FORM_PRIVACY_HINT: "اطلاعات شما را فقط برای صحبت درباره رلوی استفاده می‌کنیم.",
      FB_FORM_SUBMIT: "درخواست دسترسی زودهنگام",
      FB_FORM_SUMMARY_H3: "پیش از ارسال، این موارد را بررسی کنید",
      FB_HEAT_FRI: "جمعه",
      FB_HEAT_MON: "دوشنبه",
      FB_HEAT_SAT: "شنبه",
      FB_HEAT_SUN: "یکشنبه",
      FB_HEAT_THU: "پنجشنبه",
      FB_HEAT_TUE: "سه‌شنبه",
      FB_HEAT_WED: "چهارشنبه",
      FB_HERO_EYEBROW: "برای کافه‌ها و رستوران‌ها",
      FB_HERO_LEDE: "رلوی یک کارت امتیاز دیجیتال برای پیشخوان شماست. کارمند شما فقط یک تگ NFC را به گوشی مشتری می‌زند؛ بدون اپ‌استور، بدون دانلود، بدون رمز عبور، و کارت او خودش پر می‌شود. بالاخره می‌بینید چه کسانی برمی‌گردند و چه زمانی.",
      FB_HERO_NOTE: "تگ NFC، آموزش پرسنل و راه‌اندازی — همه در قیمت. کمتر از یک هفته آماده می‌شوید.",
      FB_HERO_SEE_HOW: "ببینید چگونه کار می‌کند",
      FB_HERO_TITLE_HTML: "<span class=\"line\"><span class=\"w\" style=\"--d:60ms\">هر</span> <span class=\"w\" style=\"--d:115ms\">تپ</span> <span class=\"w\" style=\"--d:170ms\">را</span></span><span class=\"line\"><span class=\"w\" style=\"--d:225ms\">به</span> <span class=\"w\" style=\"--d:280ms\">مشتری‌ای</span></span><span class=\"line\"><span class=\"w\" style=\"--d:335ms\">تبدیل</span> <span class=\"w\" style=\"--d:400ms\">کنید</span> <span class=\"w\" style=\"--d:400ms\">که</span> <span class=\"w hero__accent\" style=\"--d:455ms\">برمی‌گردد.<svg aria-hidden=\"true\" preserveAspectRatio=\"none\" viewBox=\"0 0 200 12\"><path d=\"M197 5.8C96 2 40 3.2 3 8.6\"></path></svg></span></span>",
      FB_HOW_EYEBROW: "رلوی چگونه کار می‌کند",
      FB_HOW_G1_H: "در لحظه پرداخت، گوشی را استمپ بزنید",
      FB_HOW_G1_P: "استمپ رلوی همیشه دست شماست. مشتری گوشی خودش را جلو می‌آورد، کارمند شما استمپ را به آن می‌زند، و کسی چیزی تایپ نمی‌کند — فقط یک تأیید روی پنلی که پشت پیشخوان باز است.",
      FB_HOW_G2_H: "بار اول؟ نام و شماره موبایل",
      FB_HOW_G2_P: "فقط دو فیلد. حساب فوراً ساخته می‌شود — بدون اپ‌استور، بدون رمز عبور، بدون تأیید ایمیل، بدون نصب چیزی.",
      FB_HOW_G3_H: "به صفحه اصلی گوشی اضافه‌اش می‌کنند",
      FB_HOW_G3_P: "مثل یک آیکون اپ باز می‌شود، اما چیزی برای دانلود یا آپدیت وجود ندارد. یک صفحه وب است که مثل اپ رفتار می‌کند.",
      FB_HOW_G4_H: "پرسنل، استمپ را روی پنل خود تأیید می‌کنند",
      FB_HOW_G4_P: "درخواست به‌صورت زنده روی پنل پرسنل نمایش داده می‌شود. استمپ فقط با تأیید پرسنل ثبت می‌شود — همین جلوی سوءاستفاده را می‌گیرد.",
      FB_HOW_G5_H: "از این به بعد، هر بازدید فقط یک تپ است",
      FB_HOW_G5_P: "تپ می‌زند، استمپ ثبت می‌شود، کارت به‌روز می‌شود. کارتی برای حمل یا گم‌کردن نیست، اپی برای باز کردن نیست — کارت را پر کند، پاداش مال اوست.",
      FB_HOW_GROUP_LABEL: "فقط بار اول",
      FB_HOW_H2: "دو لحظه. هر کدام پنج مرحله.",
      FB_HOW_TAB_GAIN: "گرفتن پاداش",
      FB_HOW_TAB_HOW_LINK: "روش کار",
      FB_HOW_TAB_USE: "استفاده از پاداش",
      FB_HOW_U1_H: "کارت خود را باز می‌کنند",
      FB_HOW_U1_P: "یک کارت تکمیل‌شده به یک بلیت تبدیل می‌شود — یک کد QR و یک کد پشتیبان کوتاه، آماده برای نشان‌دادن در پیشخوان.",
      FB_HOW_U2_H: "پرسنل اسکن می‌کنند، یا کد را تایپ می‌کنند",
      FB_HOW_U2_P: "اسکنر پرسنل در یک لحظه QR را می‌خواند. وسط شلوغی و اسکن سخت است؟ پرسنل می‌توانند کد کوتاه را دستی تایپ کنند.",
      FB_HOW_U3_H: "قبل از هر چیز بررسی می‌شود",
      FB_HOW_U3_P: "همان لحظه در سرور ما بررسی می‌شود — کد منقضی‌شده یا قبلاً استفاده‌شده همان‌جا مشخص می‌شود، پیش از آنکه تخفیفی داده شود.",
      FB_HOW_U4_H: "استفاده شد — تخفیف را اعمال کنید",
      FB_HOW_U4_P: "صفحه به «استفاده شد ✓» تغییر می‌کند. پرسنل همان‌جا روی صورت‌حساب مشتری اعمالش می‌کنند.",
      FB_HOW_U5_H: "یک‌بار استفاده شد، تمام",
      FB_HOW_U5_P: "همان کد دوباره قابل اسکن نیست. بدون اسکرین‌شات تکراری، بدون تخفیف دوبل — هر پاداش دقیقاً یک‌بار خرج می‌شود.",
      FB_INS1_BODY: "هر استمپ زمان‌دار است، پس جدول خودش پر می‌شود. عصر پنجشنبه، اوج این کافه است — تقریباً چهار برابر صبح جمعه.",
      FB_INS1_EYEBROW: "چه زمانی می‌آیند",
      FB_INS1_H3: "هفته شما شکل خاص خودش را دارد، و حالا می‌توانید ببینیدش",
      FB_INS1_USE: "<span class=\"ins__use-tag\">از این استفاده کنید تا</span> قوی‌ترین پرسنل خود را برای شلوغی پنجشنبه بگذارید، برای صبح آرام دوشنبه هزینه اضافه ندهید، و پخت و آماده‌سازی را با ساعت‌هایی که واقعاً درآمد دارند هماهنگ کنید.",
      FB_INS2_BODY: "یکی همه کسانی را که تا حالا یک بار سرویس داده‌اید می‌شمارد و می‌پرسد چند نفر حتی یک‌بار برگشته‌اند. دیگری این ماه را بین چهره‌های آشنا و چهره‌های تازه تقسیم می‌کند.",
      FB_INS2_CAP1: "از مشتریان بار اولی، دست‌کم یک‌بار برگشته‌اند",
      FB_INS2_CAP2: "<b>۳۸٪</b> مشتری تازه این ماه · <b>۶۲٪</b> برگشتی",
      FB_INS2_EYEBROW: "آیا برمی‌گردند یا نه",
      FB_INS2_H3: "دارید مشتری ثابت می‌سازید یا فقط به غریبه‌ها سرویس می‌دهید؟",
      FB_INS2_USE: "<span class=\"ins__use-tag\">از این استفاده کنید تا</span> ببینید دارید مشتری ثابت اضافه می‌کنید یا فقط جای آنهایی که از دست می‌دهید را پر می‌کنید. یک کافه می‌تواند تمام ماه شلوغ به‌نظر برسد و هنوز هر هفته به آدم‌های متفاوتی سرویس بدهد.",
      FB_INS3_BODY: "پاداش‌های صادرشده در برابر پاداش‌های واقعاً استفاده‌شده، کنار فاصله معمول بین دو بازدید یک مشتری — میانه، تا برگشتن یک نفر بعد از سه ماه آمار را خراب نکند.",
      FB_INS3_CAP1: "فاصله معمول بین دو بازدید یک مشتری",
      FB_INS3_CAP2: "از پاداش‌های صادرشده واقعاً استفاده شده",
      FB_INS3_EYEBROW: "آیا پاداش اثر دارد",
      FB_INS3_H3: "آیا جایزه ارزشش را دارد؟",
      FB_INS3_USE: "<span class=\"ins__use-tag\">از این استفاده کنید تا</span> جایزه‌ای را که کسب می‌شود اما هرگز گرفته نمی‌شود اصلاح کنید. و وقتی بدانید فاصله معمول چهار روز است، کسی که به بیست روز رسیده مشخصاً فاصله گرفته.",
      FB_INS_EYEBROW: "چیزی که به‌دست می‌آورید",
      FB_INS_H2: "بدانید چه کسی برمی‌گردد، همان لحظه، بدون اکسل.",
      FB_INS_LEDE: "هر تپ، یک داده است که قبلاً نداشتید. این داشبورد صاحب کسب‌وکار است، با اعداد نمونه از کافه‌ای که چند صد استمپ در ماه دارد.",
      FB_NAV_CTA: "دسترسی زودهنگام",
      FB_NAV_FAQ: "سوالات متداول",
      FB_NAV_HOW: "روش کار",
      FB_NAV_INSIGHTS: "امکانات",
      FB_NAV_PRICING: "قیمت‌گذاری",
      FB_NEXT1_H3: "پیام‌های هدفمند، در همان کارتی که نگه داشته‌اند",
      FB_NEXT1_P: "به مشتریانی برسید که از ریتم معمولشان فاصله گرفته‌اند — داخل همان کارتی که از قبل روی صفحه اصلی گوشی‌شان است، نه در اپ پیام‌رسانی که از خانواده‌شان خبر می‌گیرند.",
      FB_NEXT2_H3: "پیشنهادهایی برای کسانی که واقعاً تکان می‌خورند",
      FB_NEXT2_P: "پاداشی بفرستید برای مشتری‌هایی که واقعاً برمی‌گردانتشان، به‌جای تخفیف به همه کسانی که در هر صورت می‌آمدند.",
      FB_NEXT_LABEL: "<span aria-hidden=\"true\" class=\"next__dot\"></span>در حال ساخت",
      FB_PLAN_FOOT: "دوره آزمایشی شما از روزی شروع می‌شود که تگتان روی پیشخوان فعال شود — نه روزی که ثبت‌نام می‌کنید. با شروع دوره آزمایشی، <a href=\"business-terms.html\">شرایط کسب‌وکار</a> ما را می‌پذیرید.",
      FB_PLAN_NOTE: "بدون هزینه راه‌اندازی، بدون هزینه به‌ازای هر تپ، بدون هزینه به‌ازای هر عضو. عددی که سمت چپ می‌بینید کل صورت‌حساب است.",
      FB_PRICING_EYEBROW: "قیمت‌گذاری",
      FB_PRICING_H2: "مشتری‌های ثابتتان را زیاد کنید.<br/>نه صورت‌حساب نرم‌افزارتان را.",
      FB_PRICING_LEDE: "همه امکانات، مشتری نامحدود و استمپ نامحدود، با یک قیمت ثابت.",
      FB_PRIZE_HINT: "این را به پرسنل نشان دهید",
      FB_PRIZE_OFF: "تخفیف روی سفارش بعدی",
      FB_PRIZE_TITLE: "تبریک!",
      FB_REQCARD_SUB: "درخواست استمپ دارد",
      FB_SCENE_G1_H: "تپ برای دریافت",
      FB_SCENE_G1_P: "گوشی را جلو بیاورید — کارمند شما استمپ را به آن می‌زند.",
      FB_SCENE_G2_H: "دو فیلد، فقط یک بار",
      FB_SCENE_G2_P: "نام و شماره موبایل. بدون رمز عبور.",
      FB_SCENE_G3_H: "روی صفحه اصلی گوشی",
      FB_SCENE_G3_P: "مثل یک اپ باز می‌شود. چیزی نصب نشده.",
      FB_SCENE_G4_H: "پرسنل آن را زنده می‌بینند",
      FB_SCENE_G4_P: "تأیید می‌کنند — بدون تأیید، استمپی هم نیست.",
      FB_SCENE_G5_H: "دو از هشت",
      FB_SCENE_G5_P: "استمپ همان لحظه‌ای ثبت می‌شود که پرسنل تأیید کنند.",
      FB_SCENE_U1_H: "بلیت آن‌ها، روی صفحه",
      FB_SCENE_U1_P: "یک کد QR و یک کد پشتیبان کوتاه.",
      FB_SCENE_U2_H: "یک اسکن، یا یک کد",
      FB_SCENE_U2_P: "دوربین مشغول است؟ دستی واردش کنید.",
      FB_SCENE_U3_H: "در حال بررسی…",
      FB_SCENE_U3_P: "به‌صورت زنده روی سرور ما بررسی می‌شود.",
      FB_SCENE_U4_H: "استفاده شد ✓",
      FB_SCENE_U4_P: "اعمال شد — تخفیف را به مشتری بدهید.",
      FB_SCENE_U5_H: "یک‌بار خرج شد، برای همیشه",
      FB_SCENE_U5_P: "همان کد دیگر هرگز کار نخواهد کرد.",
      FB_SIGNUP_ASIDE_1: "تگ را می‌فرستیم و کارتتان را برایتان راه‌اندازی می‌کنیم.",
      FB_SIGNUP_ASIDE_2: "به پرسنل شما، در محل کارتان، نشان می‌دهیم چگونه کار می‌کند.",
      FB_SIGNUP_ASIDE_3: "دوره آزمایشی شما فقط وقتی شروع می‌شود که واقعاً فعال شود.",
      FB_SIGNUP_ASIDE_4: "بدون قرارداد. هر وقت خواستید تمامش کنید.",
      FB_SIGNUP_EYEBROW: "دسترسی زودهنگام",
      FB_SIGNUP_H2: "بیایید یک تگ روی پیشخوان شما بگذاریم.",
      FB_SIGNUP_LEDE: "بگویید کجا هستید تا با شما تماس بگیریم. کیت NFC شما را ظرف حدود یک هفته راه‌اندازی می‌کنیم.",
      FB_TEAM_1: "بنیان‌گذار. سازنده. دانشجوی علوم کامپیوتر در UCL، تمام سال روی رلوی.",
      FB_TEAM_2: "هم‌بنیان‌گذار. دانشجوی مهندسی کامپیوتر در مشهد — و کسی که پایش به پیشخوان شما می‌رسد.",
      FB_TOMAN: "تومان",
      FB_TRUST_1: "بدون نیاز به کارت",
      FB_TRUST_2: "بدون قرارداد",
      FB_TRUST_3: "کمتر از یک هفته فعال می‌شوید",
      FB_USED_BADGE: "استفاده‌شده",
      FB_WHY_EYEBROW: "چرا کافه‌ها رلوی را انتخاب می‌کنند",
      FB_WHY_H2: "اگر ساعت شلوغی صبح دوامش نیاورد، به‌دردنخور است.",
      FB_WHY_LIST_HTML: "<div class=\"why__row rv\"><span aria-hidden=\"true\" class=\"why__ico\"><svg aria-hidden=\"true\" fill=\"none\" height=\"22\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" viewBox=\"0 0 24 24\" width=\"22\"><circle cx=\"12\" cy=\"12\" r=\"9\"></circle><path d=\"M12 7v5l3 2\"></path></svg></span><div><h3>سرعت صف را کم نمی‌کند</h3><p>یک تپ تقریباً به اندازه یک پرداخت کارتی طول می‌کشد. مشتری گوشی خودش را جلو می‌آورد، کارمند شما استمپ را به آن می‌زند، و کسی چیزی تایپ نمی‌کند — فقط یک تأیید روی پنلی که پشت پیشخوان از قبل باز است.</p></div><span class=\"why__stat\">~۲ ثانیه</span></div><div class=\"why__row rv\"><span aria-hidden=\"true\" class=\"why__ico\"><svg aria-hidden=\"true\" fill=\"none\" height=\"22\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" viewBox=\"0 0 24 24\" width=\"22\"><path d=\"M6 9V3h12v6\"></path><rect height=\"7\" rx=\"2\" width=\"18\" x=\"3\" y=\"9\"></rect><path d=\"M7 16h10v5H7z\"></path></svg></span><div><h3>دیگر کارت کاغذی چاپ نمی‌کنید</h3><p>موقع تغییر طرح، تجدید چاپ لازم نیست، جعبه‌های کارت پشت پیشخوان نیست، مهر جوهری هم خشک نمی‌شود.</p></div><span class=\"why__stat\">هزینه چاپ صفر</span></div><div class=\"why__row rv\"><span aria-hidden=\"true\" class=\"why__ico\"><svg aria-hidden=\"true\" fill=\"none\" height=\"22\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" viewBox=\"0 0 24 24\" width=\"22\"><path d=\"M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1\"></path><circle cx=\"9.5\" cy=\"7\" r=\"3.5\"></circle><path d=\"M16 11l2 2 4-4\"></path></svg></span><div><h3>تقریباً چیزی از مشتری خواسته نمی‌شود</h3><p>یک نام و یک شماره موبایل، فقط یک‌بار. بدون سر زدن به اپ‌استور، بدون رمز عبور جدید، بدون تأیید ایمیل، بدون اشغال فضای گوشی.</p></div><span class=\"why__stat\">۲ فیلد، یک‌بار</span></div><div class=\"why__row rv\"><span aria-hidden=\"true\" class=\"why__ico\"><svg aria-hidden=\"true\" fill=\"none\" height=\"22\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" viewBox=\"0 0 24 24\" width=\"22\"><path d=\"M3 9h18l-1.6-5H4.6L3 9Z\"></path><path d=\"M5 9v11h14V9\"></path><path d=\"M9.5 20v-6h5v6\"></path></svg></span><div><h3>کافه شما همیشه در مرکز توجه است</h3><p>رنگ‌ها، لوگو و نام شما روی هر صفحه‌ای که مشتری می‌بیند هست. رلوی پشت صحنه می‌ماند.</p></div><span class=\"why__stat\">برند خودتان</span></div><div class=\"why__row rv\"><span aria-hidden=\"true\" class=\"why__ico\"><svg aria-hidden=\"true\" fill=\"none\" height=\"22\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" viewBox=\"0 0 24 24\" width=\"22\"><path d=\"M3 17l6-6 4 4 7-7\"></path><path d=\"M14 7h7v7\"></path></svg></span><div><h3>ببینید مشتری‌های ثابتتان کی برمی‌گردند</h3><p>داده واقعی ۷ یا ۳۰ روز اخیر را مقایسه کنید تا شلوغ‌ترین روزها، قوی‌ترین ساعت‌ها، و روند بازدید تکراری را ببینید.</p></div><span class=\"why__stat\">۷ یا ۳۰ روز</span></div><div class=\"why__row rv\"><span aria-hidden=\"true\" class=\"why__ico\"><svg aria-hidden=\"true\" fill=\"none\" height=\"22\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" viewBox=\"0 0 24 24\" width=\"22\"><path d=\"M9.5 3h5v3.5a3 3 0 0 0 .9 2.1L16.5 10h-9l1.1-1.4a3 3 0 0 0 .9-2.1Z\"></path><rect height=\"4\" rx=\"1.5\" width=\"16\" x=\"4\" y=\"13\"></rect><path d=\"M5.5 21h13\"></path></svg></span><div><h3>هنوز حس یک استمپ واقعی را دارد</h3><p>تگی که برایتان می‌فرستیم یک استمپ کلاسیک با یک تراشه داخلش است. پرسنل شما آن را روی گوشی می‌فشارند، درست مثل همیشه که کاغذ را فشار می‌دادند — همان رسم همیشگی پیشخوانتان، بدون بالشتک جوهر.</p></div><span class=\"why__stat\">هنوز یک استمپ</span></div><div class=\"why__row rv\"><span aria-hidden=\"true\" class=\"why__ico\"><svg aria-hidden=\"true\" fill=\"none\" height=\"22\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" viewBox=\"0 0 24 24\" width=\"22\"><path d=\"M3 7h11v9H3z\"></path><path d=\"M14 10h4l3 3v3h-7z\"></path><circle cx=\"7\" cy=\"18\" r=\"2\"></circle><circle cx=\"17\" cy=\"18\" r=\"2\"></circle></svg></span><div><h3>ما راه‌اندازی می‌کنیم، نه شما</h3><p>تگ NFC را می‌فرستیم، کارت و پاداش شما را تنظیم می‌کنیم، و به پرسنل شما نشان می‌دهیم چگونه کار می‌کند. ظرف حدود یک هفته آماده‌اید.</p></div><span class=\"why__stat\">~۱ هفته</span></div>",
    }
  };

  /* ================================================================ i18n ===
     A self-contained EN/FA switch for this page — mirrors the app's own
     i18n.js (same "loytap_lang" localStorage key, so a visitor's language
     choice stays consistent moving between here and the app) but keeps its
     own string table since this page's copy is unique to it. Elements carry
     data-i18n (textContent), data-i18n-html (innerHTML, for copy that has to
     keep a nested tag) or data-i18n-placeholder (input placeholder). Applying
     a language re-renders those attributes, then fillCommercials() and the
     pricing card's own refreshLang() re-run so numbers/plan copy pick up the
     new language too. */
  var LANG_KEY = "loytap_lang";
  function getLang() {
    try { var v = localStorage.getItem(LANG_KEY); if (v === "en" || v === "fa") return v; } catch (e) {}
    return "fa";
  }
  var currentLang = getLang();
  function t(key) {
    var dict = FB_STRINGS[currentLang] || FB_STRINGS.en;
    return dict[key] != null ? dict[key] : (FB_STRINGS.en[key] || "");
  }
  function applyI18n() {
    root.lang = currentLang;
    root.dir = currentLang === "fa" ? "rtl" : "ltr";
    var dict = FB_STRINGS[currentLang] || FB_STRINGS.en;
    $$("[data-i18n]").forEach(function (el) {
      var k = el.getAttribute("data-i18n");
      if (dict[k] != null) el.textContent = dict[k];
    });
    $$("[data-i18n-html]").forEach(function (el) {
      var k = el.getAttribute("data-i18n-html");
      if (dict[k] != null) el.innerHTML = dict[k];
    });
    $$("[data-i18n-placeholder]").forEach(function (el) {
      var k = el.getAttribute("data-i18n-placeholder");
      if (dict[k] != null) el.placeholder = dict[k];
    });
    $$(".lang-switch__btn").forEach(function (b) {
      var on = b.dataset.lang === currentLang;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", String(on));
    });
  }
  function langSwitch(onChange) {
    $$(".lang-switch__btn").forEach(function (b) {
      on(b, "click", function () {
        if (b.dataset.lang === currentLang) return;
        currentLang = b.dataset.lang;
        try { localStorage.setItem(LANG_KEY, currentLang); } catch (e) {}
        applyI18n();
        onChange && onChange();
      });
    });
  }

  /* Every in-page link within `container` glides to its target instead of
     jumping — scroll-margin-top on the sections (see CSS) keeps them clear
     of the fixed header. Shared by the toolbar and the footer. */
  function wireSmoothLink(a) {
    var href = a.getAttribute("href");
    if (!href || href.length < 2 || href.charAt(0) !== "#") return;
    on(a, "click", function (e) {
      var target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "start" });
      history.pushState(null, "", href);
    });
  }
  function wireSmoothLinks(container) {
    $$('a[href^="#"]', container).forEach(wireSmoothLink);
  }

  /* Retriggers a one-shot CSS animation class on click, so repeat clicks
     replay it instead of no-op'ing on a class that's already set. Skipped
     under prefers-reduced-motion, per the file's rule (see header comment). */
  function wireBump(el, cls) {
    if (!el || reduced.matches) return;
    on(el, "click", function () {
      el.classList.remove(cls);
      void el.offsetWidth; // reflow so the animation can restart
      el.classList.add(cls);
    });
    on(el, "animationend", function () { el.classList.remove(cls); });
  }
  var fmt = function (n) { return n.toLocaleString("en-US"); };
  // how many months the yearly price effectively waives, versus paying monthly all year
  var monthsFree = function () { return Math.round((SITE.priceMonthly * 12 - SITE.priceYearly) / SITE.priceMonthly); };

  root.classList.add("js");

  /* ======================================================== commercials === */
  function fillCommercials() {
    var currency = currentLang === "fa" ? t("FB_TOMAN") : SITE.currency;
    var trial = SITE.trialDays
      ? (currentLang === "fa" ? SITE.trialDays + " روز رایگان" : SITE.trialDays + " days free")
      : (currentLang === "fa" ? "دوره آزمایشی رایگان" : "Free trial");
    $$("[data-trial]").forEach(function (el) { el.textContent = trial; });

    // the plan card's own price (monthly/yearly, switchable) is filled by
    // pricingPlan() below — it needs interactive state, not a static fill.

    var faqPrice = $("faqPrice");
    if (faqPrice) {
      faqPrice.textContent = SITE.priceMonthly
        ? (currentLang === "fa"
            ? "ماهانه " + fmt(SITE.priceMonthly) + " " + currency + " برای هر کافه، یا " + fmt(SITE.priceYearly) + " " + currency + " در سال (" + monthsFree() + " ماه رایگان). بدون هزینه به‌ازای هر تپ، و بدون کمیسیون روی هرچه می‌فروشید."
            : "A flat " + fmt(SITE.priceMonthly) + " " + currency + " a month per café, or " + fmt(SITE.priceYearly) + " " + currency + " a year (" + monthsFree() + " months free). No per-tap charges, and no commission on anything you sell.")
        : (currentLang === "fa"
            ? "یک هزینه ماهانه ثابت به‌ازای هر کافه — بدون هزینه به‌ازای هر تپ و بدون کمیسیون روی هرچه می‌فروشید. عدد نهایی را با کافه‌های پایلوت خود مشخص می‌کنیم، پس از ما بپرسید و نرخ پایلوت را بگیرید."
            : "A flat monthly fee per café — no per-tap charges and no commission on what you sell. We are finalising the number with our pilot cafés, so ask us and you will get the pilot rate.");
    }
    var faqTrial = $("faqTrial");
    if (faqTrial && SITE.trialDays) {
      faqTrial.textContent = currentLang === "fa"
        ? SITE.trialDays + " روز، از روزی که تگ NFC شما روی پیشخوان فعال شود — نه روزی که ثبت‌نام می‌کنید."
        : SITE.trialDays + " days, counted from the day your NFC tag goes live at your counter — not the day you sign up.";
    }

    $$("[data-email]").forEach(function (a) {
      a.href = "mailto:" + SITE.email;
      a.textContent = SITE.email;
    });

    var footPhone = $("footPhone");
    if (footPhone) {
      if (SITE.phone) {
        footPhone.hidden = false;
        var link = footPhone.querySelector("a");
        link.href = "tel:" + SITE.phone.replace(/\s+/g, "");
        link.textContent = SITE.phone;
      } else {
        footPhone.hidden = true;
      }
    }

    // an unset handle hides its icon rather than pointing at a dead profile
    function socialLink(id, base, handle, label) {
      var li = $(id);
      if (!li) return;
      if (!handle) { li.hidden = true; return; }
      var name = String(handle).replace(/^@/, "");
      var a = li.querySelector("a");
      a.href = base + name;
      a.setAttribute("aria-label", label + ", @" + name + " (opens in a new tab)");
      li.hidden = false;
    }
    socialLink("footTelegram",  "https://t.me/",         SITE.telegram,  "Reloy on Telegram");
    socialLink("footInstagram", "https://instagram.com/", SITE.instagram, "Reloy on Instagram");

    var year = $("footYear");
    if (year) year.textContent = String(new Date().getFullYear());
  }

  /* ============================================================= reveal === */
  /* One observer for the whole page. `.is-in` both fades an element in and
     starts any chart animation nested inside it (see the CSS). One-shot. */
  function reveals() {
    var items = $$(".rv");
    if (!("IntersectionObserver" in window) || reduced.matches) {
      items.forEach(function (el) { el.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.12 });
    items.forEach(function (el) { io.observe(el); });
  }

  /* The hero headline animates on load rather than on scroll — it is already
     in view, and waiting for an intersection callback shows a blank line. */
  function heroTitle() {
    var t = $("heroTitle");
    if (!t) return;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { t.classList.add("is-in"); });
    });
  }

  /* Every button that sends you to a section — the hero pair and the pricing
     card's own call to action — glides there instead of jumping, and gives a
     launched-off click cue on top of its existing hover/press states. */
  function ctaButtons() {
    $$(".hero__cta .btn, .plan__cta").forEach(function (btn) {
      wireSmoothLink(btn);
      wireBump(btn, "is-launch");
    });
  }

  /* ================================================================ nav === */
  function nav() {
    var bar  = $("nav");
    var prog = $("prog");
    var links = $$(".nav__links a");
    var targets = links
      .map(function (a) { return document.querySelector(a.getAttribute("href")); })
      .filter(Boolean);
    var ticking = false;

    function frame() {
      ticking = false;
      var y = window.scrollY || 0;
      if (bar) bar.classList.toggle("is-stuck", y > 24);

      if (prog) {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        prog.style.setProperty("--p", max > 0 ? Math.min(1, y / max).toFixed(4) : "0");
      }

      // the section whose top has most recently passed the middle of the screen
      var mid = y + window.innerHeight * 0.4, active = -1;
      targets.forEach(function (sec, i) { if (sec.offsetTop <= mid) active = i; });
      links.forEach(function (a, i) {
        if (i === active) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      });
    }
    function queue() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }

    on(window, "scroll", queue, { passive: true });
    on(window, "resize", queue);
    frame();

    wireSmoothLinks(bar);
  }

  /* ============================================================== foot === */
  /* The section links, "Request early access", and "Back to top" all glide
     rather than jump. Back to top also gets a little kick in its arrow so
     the click reads as an action, not a dead link. */
  function footNav() {
    var foot = document.querySelector(".foot");
    if (!foot) return;
    wireSmoothLinks(foot);
    wireBump(foot.querySelector(".foot__top"), "is-bump");
  }

  /* =============================================================== logo === */
  /* Both "home" links (header logo, footer logo) hop on click, so landing
     back at the top reads as a place you arrived rather than a dead jump. */
  function logoJump() {
    $$(".logo").forEach(function (el) { wireBump(el, "is-jump"); });
  }

  /* ========================================================== pointer fx == */
  function spotlight() {
    if (reduced.matches || !fine.matches) return;
    root.classList.add("has-pointer");
    var spot = $("spot"), pending = false, mx = 0, my = 0;
    on(window, "pointermove", function (e) {
      mx = e.clientX; my = e.clientY;
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        spot.style.setProperty("--mx", mx + "px");
        spot.style.setProperty("--my", my + "px");
      });
    }, { passive: true });
  }

  /* Buttons lean a few pixels towards the cursor. Pure decoration: the
     transform is cleared on leave, blur, and whenever motion is reduced. */
  function magnetic() {
    if (reduced.matches || !fine.matches) return;
    $$("[data-magnetic]").forEach(function (el) {
      on(el, "pointermove", function (e) {
        var r = el.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) / r.width;
        var dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        el.style.transform = "translate(" + (dx * 9).toFixed(2) + "px," + (dy * 7).toFixed(2) + "px)";
      });
      ["pointerleave", "blur"].forEach(function (ev) {
        on(el, ev, function () { el.style.transform = ""; });
      });
    });
  }

  /* ======================================================= how it works === */
  /* The step list and the phone are one control: clicking a step shows its
     scene, and while the section is on screen the steps advance themselves.
     Any click (or keyboard focus) stops the auto-advance for good, so the
     visitor is never fighting the page. Scoped to one panel (`gain` or
     `use`) rather than the whole document, since "How Reloy works" now has
     two of these side by side under the tab switcher — see tabs() below,
     which owns switching between them. Returns a small controller so tabs()
     can pause the panel going out of view and reset the one coming in. */
  function howItWorks(panel) {
    var list = $$(".steps", panel)[0];
    if (!list) return null;
    var steps  = $$(".step", list);
    var scenes = $$(".scene", panel);
    var timer  = null;
    var manual = false;
    var i = 0;

    function show(next) {
      i = next;
      steps.forEach(function (s, k) {
        s.classList.toggle("is-on", k === i);
        s.setAttribute("aria-pressed", String(k === i));
      });
      scenes.forEach(function (s, k) { s.classList.toggle("is-on", k === i); });
    }

    function stop() {
      manual = true;
      list.classList.add("is-manual");
      if (timer) { clearInterval(timer); timer = null; }
    }
    function start() {
      if (manual || timer || reduced.matches || panel.hidden) return;
      timer = setInterval(function () { show((i + 1) % steps.length); }, 6400);
    }
    function pause() { if (timer) { clearInterval(timer); timer = null; } }
    /* back to step one, auto-advance re-armed — so switching tabs away and
       back always replays the story from the start rather than resuming
       wherever a stopped clock left off. */
    function reset() {
      manual = false;
      list.classList.remove("is-manual");
      show(0);
    }

    steps.forEach(function (s, k) {
      on(s, "click", function () { stop(); show(k); });
      on(s, "focus", function () { if (!manual) show(k); });
    });

    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { e.isIntersecting ? start() : pause(); });
      }, { threshold: 0.35 });
      io.observe(list);
    } else {
      start();
    }
    on(document, "visibilitychange", function () { document.hidden ? pause() : start(); });

    return { start: start, pause: pause, reset: reset };
  }

  /* Two panels, one visible at a time. Switching tabs pauses the outgoing
     panel's clock and restarts the incoming one from its first step, so a
     visitor always sees a fresh run-through rather than a frozen mid-point. */
  function howTabs() {
    var tabGain = $("howTabGain"), tabUse = $("howTabUse");
    var panelGain = $("howPanelGain"), panelUse = $("howPanelUse");
    if (!tabGain || !tabUse || !panelGain || !panelUse) return;

    var ctrlGain = howItWorks(panelGain);
    var ctrlUse  = howItWorks(panelUse);

    function activate(tab, panel, ctrl, otherTab, otherPanel, otherCtrl) {
      otherCtrl && otherCtrl.pause();
      otherPanel.hidden = true;
      otherTab.classList.remove("is-on");
      otherTab.setAttribute("aria-selected", "false");
      otherTab.tabIndex = -1;

      panel.hidden = false;
      tab.classList.add("is-on");
      tab.setAttribute("aria-selected", "true");
      tab.tabIndex = 0;
      ctrl && ctrl.reset();
      ctrl && ctrl.start();
    }

    on(tabGain, "click", function () { activate(tabGain, panelGain, ctrlGain, tabUse, panelUse, ctrlUse); });
    on(tabUse,  "click", function () { activate(tabUse,  panelUse,  ctrlUse,  tabGain, panelGain, ctrlGain); });
  }

  /* =========================================================== counters === */
  /* Numbers count up once, when their tile scrolls in. The final value is
     already in the HTML, so a no-JS visitor reads the real figure. */
  function counters() {
    var nums = $$("[data-to]");
    if (!nums.length) return;
    if (reduced.matches || !("IntersectionObserver" in window)) return;

    function run(el) {
      var to  = parseFloat(el.getAttribute("data-to"));
      var dec = parseInt(el.getAttribute("data-dec") || "0", 10);
      var sfx = el.getAttribute("data-suffix") || "";
      var t0  = null, dur = 1100;
      function frame(t) {
        if (t0 === null) t0 = t;
        var p = Math.min(1, (t - t0) / dur);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = (to * eased).toFixed(dec) + sfx;
        if (p < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        run(e.target);
        io.unobserve(e.target);
      });
    }, { threshold: 0.6 });
    nums.forEach(function (el) { io.observe(el); });
  }

  /* =============================================================== faq ==== */
  /* <details> has no animatable height, so the body is measured and animated
     with the Web Animations API; the element's own open state is the source of
     truth throughout, which keeps the built-in keyboard and search behaviour. */
  function faq() {
    $$(".qa").forEach(function (qa) {
      var summary = qa.querySelector("summary");
      var body    = qa.querySelector(".qa__body");
      var anim    = null;

      function animate(opening) {
        if (anim) anim.cancel();
        if (reduced.matches) return;
        var h = body.scrollHeight;
        anim = body.animate(
          [{ height: (opening ? 0 : h) + "px", opacity: opening ? 0 : 1 },
           { height: (opening ? h : 0) + "px", opacity: opening ? 1 : 0 }],
          { duration: opening ? 380 : 260, easing: "cubic-bezier(0.22,1,0.36,1)" }
        );
        anim.onfinish = function () { body.style.height = ""; anim = null; };
      }

      on(summary, "click", function (e) {
        if (reduced.matches) return;
        if (qa.open) {
          e.preventDefault();          // hold the panel open while it closes
          animate(false);
          setTimeout(function () { qa.open = false; }, 250);
        } else {
          requestAnimationFrame(function () { animate(true); });
        }
      });
    });
  }

  /* ============================================================= signup === */
  function signup() {
    var form = $("signupForm");
    if (!form) return;
    var summary = $("formSummary");
    var sumList = $("formSummaryList");
    var done    = $("formDone");

    function fieldDefs() {
      return currentLang === "fa" ? [
        { id: "f-cafe",    label: "نام کافه یا رستوران", msg: "نام کافه‌تان را بگویید." },
        { id: "f-person",  label: "با چه کسی صحبت کنیم؟",  msg: "بگویید با چه کسی صحبت کنیم." },
        { id: "f-contact", label: "تلفن یا ایمیل",          msg: "یک شماره تلفن یا ایمیل بگذارید تا بتوانیم پاسخ دهیم." },
        { id: "f-city",    label: "شهر",                    msg: "در کدام شهر هستید؟" }
      ] : [
        { id: "f-cafe",    label: "Café or restaurant name", msg: "Tell us the name of your café." },
        { id: "f-person",  label: "Who should we talk to?",  msg: "Tell us who we should ask for." },
        { id: "f-contact", label: "Phone or email",          msg: "Leave a phone number or an email so we can reply." },
        { id: "f-city",    label: "City",                    msg: "Which city are you in?" }
      ];
    }
    var FIELDS = fieldDefs();

    function setError(f, message) {
      var input = $(f.id);
      var err   = $("err-" + f.id.slice(2));
      if (message) {
        input.setAttribute("aria-invalid", "true");
        err.textContent = message;
      } else {
        input.removeAttribute("aria-invalid");
        err.textContent = "";
      }
    }

    FIELDS.forEach(function (f) {
      var input = $(f.id);
      on(input, "input", function () {
        if (input.getAttribute("aria-invalid") === "true" && input.value.trim()) setError(f, "");
      });
    });

    on(form, "submit", function (e) {
      e.preventDefault();
      var bad = [];
      fieldDefs().forEach(function (f) {
        var v = $(f.id).value.trim();
        if (!v) { bad.push(f); setError(f, f.msg); } else { setError(f, ""); }
      });

      if (bad.length) {
        sumList.innerHTML = "";
        bad.forEach(function (f) {
          var li = document.createElement("li");
          var a  = document.createElement("a");
          a.href = "#" + f.id;
          a.textContent = f.label + " — " + f.msg;
          li.appendChild(a);
          sumList.appendChild(li);
        });
        summary.hidden = false;
        summary.focus();
        return;
      }

      summary.hidden = true;

      var cafe    = $("f-cafe").value.trim();
      var person  = $("f-person").value.trim();
      var contact = $("f-contact").value.trim();
      var city    = $("f-city").value.trim();

      var body = [
        "Café: " + cafe,
        "Contact person: " + person,
        "Phone or email: " + contact,
        "City: " + city,
        "",
        "We would like to try Reloy at our counter."
      ].join("\n");

      var href = "mailto:" + SITE.email +
        "?subject=" + encodeURIComponent("Reloy early access — " + cafe) +
        "&body=" + encodeURIComponent(body);

      $("doneCafe").textContent = cafe;
      form.hidden = true;
      done.hidden = false;
      done.focus();
      window.location.href = href;
    });
  }

  /* ============================================================= pricing === */
  /* The plan card's monthly/yearly switch. A price change is worth a small
     beat of motion — the figure dips out and the new one rises in, and the
     glider slides to match whichever button is active, measured rather than
     hardcoded since "Yearly" is wider (it carries the savings badge). */
  function pricingPlan() {
    var card = $("planCard");
    if (!card || !SITE.priceMonthly) return null; // nothing to wire up in the "Talk to us" state
    var billing = card.querySelector(".billing");
    var glider  = card.querySelector(".billing__glider");
    var btns    = $$(".billing__btn", billing);
    var amount  = $("planAmount"), per = $("planPer"), equiv = $("planEquiv"), save = $("billingSave");
    var was     = $("planWas"), day = $("planDay"), cta = $("ctaLabel"), nudge = $("planNudge");
    var figure  = amount.closest(".plan__figure");
    var PLANS;

    // a per-day figure lands harder than a per-month one on a café owner who
    // thinks in covers and cups — rounded to the nearest 1,000 so it reads as
    // an honest approximation rather than false precision
    function perDay(total, days) {
      var v = fmt(Math.round(total / days / 1000) * 1000);
      var currency = currentLang === "fa" ? t("FB_TOMAN") : SITE.currency;
      return currentLang === "fa" ? "≈ " + v + " " + currency + " در روز" : "≈ " + v + " " + currency + " a day";
    }

    function buildPlans() {
      var currency = currentLang === "fa" ? t("FB_TOMAN") : SITE.currency;
      if (currentLang === "fa") {
        return {
          monthly: {
            amount: fmt(SITE.priceMonthly),
            per: "در ماه، به‌ازای هر کافه",
            day: perDay(SITE.priceMonthly, 30),
            to: "yearly",
            nudge: "به‌جای آن سالانه پرداخت کنید — <b>" + fmt(SITE.priceYearly) + "</b> به‌جای " +
                   fmt(SITE.priceMonthly * 12) + ". " + monthsFree() + " ماه رایگان."
          },
          yearly: {
            amount: fmt(SITE.priceYearly),
            per: "در سال، به‌ازای هر کافه",
            day: perDay(SITE.priceYearly, 365),
            was: fmt(SITE.priceMonthly * 12),
            equiv: "≈ " + fmt(Math.round(SITE.priceYearly / 12)) + " " + currency + " در ماه — <b>" + monthsFree() + " ماه رایگان</b> نسبت به پرداخت ماهانه",
            to: "monthly",
            nudge: "نمی‌خواهید یک‌ساله متعهد شوید؟ <b>" + fmt(SITE.priceMonthly) + "</b> در ماه، بدون قرارداد."
          }
        };
      }
      return {
        monthly: {
          amount: fmt(SITE.priceMonthly),
          per: "a month, per café",
          day: perDay(SITE.priceMonthly, 30),
          // the other option, priced out, one click away — the toggle above is
          // easy to miss, and this is the cheaper answer for most cafés
          to: "yearly",
          nudge: "Pay for the year instead — <b>" + fmt(SITE.priceYearly) + "</b> rather than " +
                 fmt(SITE.priceMonthly * 12) + ". " + monthsFree() + " months free."
        },
        yearly: {
          amount: fmt(SITE.priceYearly),
          per: "a year, per café",
          day: perDay(SITE.priceYearly, 365),
          // what twelve monthly payments would actually cost — a real anchor, not a fake one
          was: fmt(SITE.priceMonthly * 12),
          equiv: "≈ " + fmt(Math.round(SITE.priceYearly / 12)) + " " + currency + " a month — <b>" + monthsFree() + " months free</b> versus paying monthly",
          to: "monthly",
          nudge: "Would rather not commit for a year? <b>" + fmt(SITE.priceMonthly) + "</b> a month, no contract."
        }
      };
    }

    function refreshLang() {
      if (save) save.textContent = currentLang === "fa" ? monthsFree() + " ماه رایگان" : monthsFree() + " months free";
      // the offer restated at the moment of the click, not a generic verb
      if (cta && SITE.trialDays) {
        cta.textContent = currentLang === "fa"
          ? "شروع دوره آزمایشی " + SITE.trialDays + " روزه"
          : "Start your " + SITE.trialDays + " days free";
      }
      PLANS = buildPlans();
      show(current, false);
    }

    function moveGlider(btn) {
      if (!glider || !btn) return;
      glider.style.width = btn.offsetWidth + "px";
      glider.style.transform = "translateX(" + btn.offsetLeft + "px)";
    }

    /* The biggest number on the page arrives by counting up, once, the first
       time the card is actually seen. It cannot use the shared counters()
       helper: that one writes toFixed(), and a price without its thousands
       separators reads as a different number entirely. */
    var current = "monthly", raf = 0;
    function stopCount() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
    function countUp(to) {
      var t0 = null, dur = 1150;
      stopCount();
      raf = requestAnimationFrame(function frame(t) {
        if (t0 === null) t0 = t;
        var prog = Math.min(1, (t - t0) / dur);
        var eased = 1 - Math.pow(1 - prog, 3);
        amount.textContent = fmt(Math.round(to * eased));
        raf = prog < 1 ? requestAnimationFrame(frame) : 0;
      });
    }

    function show(period, animate) {
      var btn = btns.filter(function (b) { return b.dataset.billing === period; })[0];
      btns.forEach(function (b) {
        var isOn = b === btn;
        b.classList.toggle("is-on", isOn);
        b.setAttribute("aria-pressed", String(isOn));
      });
      moveGlider(btn);

      current = period;
      var p = PLANS[period];
      function apply() {
        stopCount();          // a toggle mid-count wins; the figure is the truth
        amount.textContent = p.amount;
        per.textContent = p.per;
        if (day)   { day.textContent = p.day || ""; }
        if (was)   { was.textContent = p.was || ""; was.hidden = !p.was; }
        if (equiv) { equiv.innerHTML = p.equiv || ""; equiv.hidden = !p.equiv; }
        if (nudge) {
          nudge.innerHTML = p.nudge || "";
          nudge.dataset.switchTo = p.to || "";
          nudge.hidden = !p.nudge;
        }
      }
      if (!animate || reduced.matches) { apply(); return; }
      figure.classList.add("is-swapping");
      setTimeout(function () { apply(); figure.classList.remove("is-swapping"); }, 160);
    }

    btns.forEach(function (b) {
      on(b, "click", function () { show(b.dataset.billing, true); });
    });
    if (nudge) on(nudge, "click", function () { if (nudge.dataset.switchTo) show(nudge.dataset.switchTo, true); });
    on(window, "resize", function () {
      moveGlider(btns.filter(function (b) { return b.classList.contains("is-on"); })[0]);
    });

    refreshLang();

    if (!reduced.matches && "IntersectionObserver" in window) {
      var pio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          pio.disconnect();
          countUp(current === "yearly" ? SITE.priceYearly : SITE.priceMonthly);
        });
      }, { threshold: 0.55 });
      pio.observe(card);
    }

    return { refreshLang: refreshLang };
  }

  /* ================================================================ go ==== */
  applyI18n();
  fillCommercials();
  reveals();
  heroTitle();
  ctaButtons();
  nav();
  footNav();
  logoJump();
  spotlight();
  magnetic();
  howTabs();
  var pricingCtrl = pricingPlan();
  counters();
  faq();
  signup();
  langSwitch(function () {
    fillCommercials();
    pricingCtrl && pricingCtrl.refreshLang();
  });
})();
