/// <reference path="../pb_data/types.d.ts" />

// This migration used to seed a café owner (admin) account with credentials
// hardcoded in this file. Removed as a security fix — the repo is public, so
// the seeded account was a backdoor into that café's admin. Kept as a no-op
// (deleting the file would renumber migration history for existing DBs);
// 1700000017 removes the account from databases that already ran this.
// Owners are now created by self-serve signup: POST /owner/register
// (backend/pb_hooks/owner.pb.js).

migrate((app) => {
  // no-op
}, (app) => {
  // no-op
});
