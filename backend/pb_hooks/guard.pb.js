/// <reference path="../pb_data/types.d.ts" />

// Defense-in-depth for the `users` collection.
//
// The updateRule is already null (see 1700000008_lock_user_writes.js), so the
// public API rejects non-superuser updates outright. This hook is a second wall:
// even if that rule is ever loosened, a non-superuser API request can never change
// the loyalty-critical fields. Our own server logic (card.pb.js, otp.pb.js) mutates
// users via $app.save(), which fires onRecordUpdate — NOT onRecordUpdateRequest —
// so it is unaffected by this guard.

const PROTECTED = ["stamp_count", "cycles", "stamps", "role", "phone"];

onRecordUpdateRequest((e) => {
  let isSuper = false;
  try { isSuper = e.hasSuperuserAuth(); } catch (_) { isSuper = false; }

  if (!isSuper) {
    let original = null;
    try { original = $app.findRecordById("users", e.record.id); } catch (_) { original = null; }
    if (original) {
      for (const f of PROTECTED) {
        // toString() normalises JSON/typed fields to comparable strings
        if (toString(e.record.get(f)) !== toString(original.get(f))) {
          throw new ForbiddenError("You cannot change this field.");
        }
      }
    }
  }

  e.next();
}, "users");
