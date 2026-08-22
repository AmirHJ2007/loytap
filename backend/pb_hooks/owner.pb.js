/// <reference path="../pb_data/types.d.ts" />

// Café owner login by phone + password (no registration):
//   POST /owner/login { phone, password } -> { token, name, role }

routerAdd("POST", "/owner/login", (e) => {
  const norm = (raw) => {
    let d = String(raw || "").replace(/\D/g, "");
    if (d.indexOf("98") === 0) d = d.slice(2);
    if (d.indexOf("0") === 0) d = d.slice(1);
    return d;
  };
  const phone = norm(e.requestInfo().body.phone);
  const password = String(e.requestInfo().body.password || "");
  if (!/^9\d{9}$/.test(phone)) return e.json(400, { error: "Invalid phone number" });

  let u = null;
  try { u = $app.findFirstRecordByFilter("users", "phone = {:phone}", { phone }); } catch (err) { u = null; }
  if (!u || u.getString("role") !== "admin") {
    return e.json(404, { error: "No owner account for this number", notRegistered: true });
  }
  if (!password) return e.json(400, { error: "Enter your password" });
  if (!u.validatePassword(password)) return e.json(401, { error: "Wrong password" });

  const token = u.newAuthToken();
  return e.json(200, { token, name: u.getString("name"), role: u.getString("role") });
});
