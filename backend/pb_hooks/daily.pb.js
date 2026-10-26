/// <reference path="../pb_data/types.d.ts" />

// Registers the nightly owner report. All of the work lives in dailyreport.js,
// require()d inside each handler because PocketBase gives every handler its own
// goja runtime with no access to this file's scope.
//
// 00:00 Tehran, expressed in UTC. The container is alpine with no tzdata and no
// TZ set (see Dockerfile), so PocketBase schedules on UTC and Tehran is a fixed
// +3:30 — 20:30 UTC. Getting this wrong does not break the report, it just
// delivers it at a strange hour: the handler derives which day to report from
// Date.now(), never from when the cron happened to fire.
//
// Nothing is sent from here. One row per owner goes into mail_outbox and the
// drain in notify.pb.js delivers it within five minutes, so retries, failure
// logging and SMTP configuration all stay in exactly one place.
cronAdd("daily-report", "30 20 * * *", () => {
  try {
    const R = require(`${__hooks}/dailyreport.js`);
    const out = R.run(Date.now());
    $app.logger().info("daily report queued", "day", out.day, "queued", out.queued, "skipped", out.skipped);
  } catch (err) {
    try { $app.logger().error("daily report run failed", "err", String(err)); } catch (e2) {}
  }
});

// ---------------------------------------------------------------------------
// local development only
// ---------------------------------------------------------------------------
// Waiting until midnight to find out whether the report renders is no way to
// work on it. These exist only when OTP_DEV_MODE=1 — which dev.sh sets and
// production must never set — and answer 404 otherwise, so the routes are not
// merely unauthorized in production but absent.
//
//   GET  /dev/daily-report            the first café's report, as HTML
//   GET  /dev/daily-report?cafe=<id>  a specific café
//   GET  /dev/daily-report?back=3     three days earlier, to land on a day
//                                     that actually has stamps in it
//   POST /dev/daily-report            really queue them into mail_outbox
// Everything these handlers use has to be defined INSIDE them or reached
// through require(): a handler runs in its own goja runtime and cannot see this
// file's top-level scope, so a helper declared out here is simply not defined
// by the time the request arrives.
routerAdd("GET", "/dev/daily-report", (e) => {
  if ($os.getenv("OTP_DEV_MODE") !== "1") return e.json(404, { error: "Not found" });

  try {
    const R = require(`${__hooks}/dailyreport.js`);
    const back = parseInt(R.q(e, "back", "0"), 10) || 0;
    const day = R.reportDay(Date.now() - back * 86400000);

    const wanted = R.q(e, "cafe", "");
    let card = null;
    if (wanted) card = $app.findRecordById("cafe_card", wanted);
    else card = $app.findRecordsByFilter("cafe_card", "id != ''", "created", 1, 0, {})[0];
    if (!card) return e.json(404, { error: "No café found" });

    return e.html(200, R.render(R.collect(card, day)));
  } catch (err) {
    return e.json(500, { error: String(err), stack: String(err && err.stack || "") });
  }
});

routerAdd("POST", "/dev/daily-report", (e) => {
  if ($os.getenv("OTP_DEV_MODE") !== "1") return e.json(404, { error: "Not found" });

  try {
    const R = require(`${__hooks}/dailyreport.js`);
    const back = parseInt(R.q(e, "back", "0"), 10) || 0;
    return e.json(200, R.run(Date.now() - back * 86400000));
  } catch (err) {
    return e.json(500, { error: String(err), stack: String(err && err.stack || "") });
  }
});
