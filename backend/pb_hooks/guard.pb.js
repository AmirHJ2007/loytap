/// <reference path="../pb_data/types.d.ts" />

// Defense-in-depth for the `users` collection.
//
// The updateRule is already null (see 1700000008_lock_user_writes.js), so the
// public API rejects non-superuser updates outright. This hook is a second wall:
// even if that rule is ever loosened, a non-superuser API request can never change
// the loyalty-critical fields. Our own server logic (card.pb.js, otp.pb.js) mutates
// users via $app.save(), which fires onRecordUpdate — NOT onRecordUpdateRequest —
// so it is unaffected by this guard.
//
// Per-café stamp progress (stamp_count/cycles/stamps) now lives on `memberships`,
// not `users` — that collection has updateRule=null too, so it gets the same
// public-API lockout without needing a field-level guard here.

onRecordUpdateRequest((e) => {
  // PocketBase re-evaluates this handler in a pooled JSVM runtime that does
  // not see enclosing file scope — a module-level const here throws
  // ReferenceError the moment it's read, which used to 500 every request
  // instead of enforcing anything. Declared inside the handler so it's
  // actually reachable.
  const PROTECTED = ["role", "phone"];

  let isSuper = false;
  try { isSuper = e.hasSuperuserAuth(); } catch (_) { isSuper = false; }

  if (!isSuper) {
    let original = null;
    try { original = $app.findRecordById("users", e.record.id); } catch (_) { original = null; }
    if (original) {
      for (const f of PROTECTED) {
        // String() normalises JSON/typed fields to comparable strings —
        // toString() is not a global function and previously fell back to
        // Object.prototype.toString, returning the same constant for every
        // input and never actually comparing anything.
        if (String(e.record.get(f)) !== String(original.get(f))) {
          throw new ForbiddenError("You cannot change this field.");
        }
      }
    }
  }

  e.next();
}, "users");
