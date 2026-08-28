/// <reference path="../pb_data/types.d.ts" />

// LoyTap phone OTP — dev mode returns the code in the response (no SMS).
// Set KAVENEGAR_API_KEY (+ KAVENEGAR_TEMPLATE) in prod to send a real SMS instead.
//
//   POST /otp/request  { phone }                     -> { ok:true, devCode? }
//   POST /otp/verify   { phone, code, name?, role? }  -> { token, user }
//
// NOTE: PocketBase runs each handler in an isolated runtime, so helper functions
// must be declared INSIDE the handler (no shared file-level scope).

routerAdd("POST", "/otp/request", (e) => {
  const norm = (raw) => {
    let d = String(raw || "").replace(/\D/g, "");
    if (d.indexOf("98") === 0) d = d.slice(2);
    if (d.indexOf("0") === 0) d = d.slice(1);
    return d;
  };
  const phone = norm(e.requestInfo().body.phone);
  if (!/^9\d{9}$/.test(phone)) return e.json(400, { error: "Invalid phone number" });

  // Sign-in requires an existing account; register creates one on verify.
  if (e.requestInfo().body.mode === "signin") {
    let exists = null;
    try { exists = $app.findFirstRecordByFilter("users", "phone = {:phone}", { phone }); } catch (err) { exists = null; }
    if (!exists) return e.json(404, { error: "This number isn't registered yet", notRegistered: true });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = new Date(Date.now() + 3 * 60 * 1000).toISOString();

  try {
    const old = $app.findRecordsByFilter("otp_codes", "phone = {:phone}", "", 100, 0, { phone });
    for (const r of old) $app.delete(r);
  } catch (err) {}

  const rec = new Record($app.findCollectionByNameOrId("otp_codes"));
  rec.set("phone", phone);
  rec.set("code_hash", code); // TODO: hash before prod
  rec.set("expires", expires);
  rec.set("attempts", 0);
  $app.save(rec);

  const kavKey = $os.getenv("KAVENEGAR_API_KEY");
  if (kavKey) {
    const tmpl = $os.getenv("KAVENEGAR_TEMPLATE") || "loytap";
    try {
      $http.send({
        url: "https://api.kavenegar.com/v1/" + kavKey + "/verify/lookup.json?receptor=0" + phone + "&token=" + code + "&template=" + tmpl,
        method: "GET",
        timeout: 10,
      });
    } catch (err) {
      $app.logger().error("Kavenegar send failed", "error", String(err));
      return e.json(502, { error: "Could not send SMS" });
    }
    return e.json(200, { ok: true });
  }

  $app.logger().info("OTP (dev)", "phone", phone, "code", code);
  return e.json(200, { ok: true, devCode: code });
});

routerAdd("POST", "/otp/verify", (e) => {
  const norm = (raw) => {
    let d = String(raw || "").replace(/\D/g, "");
    if (d.indexOf("98") === 0) d = d.slice(2);
    if (d.indexOf("0") === 0) d = d.slice(1);
    return d;
  };
  const body = e.requestInfo().body;
  const phone = norm(body.phone);
  const code = String(body.code || "").trim();
  const name = String(body.name || "").trim();
  const wantRole = (body.role === "cafe" || body.role === "staff" || body.role === "admin") ? "admin" : "customer";

  if (!/^9\d{9}$/.test(phone) || !/^\d{6}$/.test(code)) {
    return e.json(400, { error: "Invalid phone or code" });
  }

  let otp = null;
  try {
    otp = $app.findFirstRecordByFilter(
      "otp_codes",
      "phone = {:phone} && code_hash = {:code} && expires > {:now}",
      { phone, code, now: new Date().toISOString().replace("T", " ") }
    );
  } catch (err) { otp = null; }
  if (!otp) return e.json(400, { error: "Invalid or expired code" });
  $app.delete(otp);

  let user = null;
  try {
    user = $app.findFirstRecordByFilter("users", "phone = {:phone}", { phone });
  } catch (err) { user = null; }

  if (!user) {
    user = new Record($app.findCollectionByNameOrId("users"));
    user.set("phone", phone);
    user.set("email", phone + "@phone.loytap"); // auth collection requires an email; phone is unique
    user.set("name", name || "Guest");
    user.set("role", wantRole);
    user.set("verified", true);
    user.setPassword($security.randomString(30));
    $app.save(user);
  } else if (name && !user.getString("name")) {
    user.set("name", name);
    $app.save(user);
  }

  const token = user.newAuthToken();
  return e.json(200, {
    token,
    user: {
      id: user.id,
      name: user.getString("name"),
      phone: user.getString("phone"),
      role: user.getString("role"),
    },
  });
});
