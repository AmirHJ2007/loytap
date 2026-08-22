/// <reference path="../pb_data/types.d.ts" />

// Café staff login by shared code:  POST /staff/login { code } -> { token, cafe_name }
// The code maps to the café's staff service-account and returns its session token.

routerAdd("POST", "/staff/login", (e) => {
  const code = String(e.requestInfo().body.code || "").trim();
  if (!code) return e.json(400, { error: "Enter the café code" });

  const card = $app.findRecordsByFilter("cafe_card", "stamps_required >= 0", "", 1, 0, {})[0];
  if (!card) return e.json(500, { error: "No café configured" });

  const real = String(card.getString("staff_code") || "").trim();
  if (!real || real.toUpperCase() !== code.toUpperCase()) {
    return e.json(401, { error: "Wrong code" });
  }

  let staff = null;
  try { staff = $app.findRecordById("users", card.getString("staff_user")); } catch (err) { staff = null; }
  if (!staff) return e.json(500, { error: "Staff account missing" });

  const token = staff.newAuthToken();
  return e.json(200, {
    token,
    cafe_name: card.getString("cafe_name"),
    name: staff.getString("name"),
    role: staff.getString("role"),
  });
});
