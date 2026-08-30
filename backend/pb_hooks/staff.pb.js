/// <reference path="../pb_data/types.d.ts" />

// Café staff login by shared code:  POST /staff/login { code } -> { token, cafe_name }
// The code maps to that café's staff service-account and returns its session token.
// Each café has its own code, so this matches across every café, not just one.

routerAdd("POST", "/staff/login", (e) => {
  const code = String(e.requestInfo().body.code || "").trim();
  if (!code) return e.json(400, { error: "Enter the café code" });

  const codes = $app.findRecordsByFilter("staff_codes", "code != ''", "", 500, 0, {});
  const codeRec = codes.find((c) => String(c.getString("code") || "").toUpperCase() === code.toUpperCase());
  if (!codeRec) return e.json(401, { error: "Wrong code" });

  let card = null;
  try { card = $app.findRecordById("cafe_card", codeRec.getString("cafe")); } catch (err) { card = null; }
  if (!card) return e.json(500, { error: "Café missing" });

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
