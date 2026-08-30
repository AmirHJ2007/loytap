/// <reference path="../pb_data/types.d.ts" />

// A phone number used to map to exactly one account, period — so someone who
// already had a customer account could never also register a business with
// the same number. Loosen that to "one account per (phone, role)": the same
// person can have a separate customer account and a separate business
// (admin) account under the same phone number.

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.indexes = users.indexes.filter((x) => !x.includes("idx_users_phone"));
  users.indexes = users.indexes.concat(["CREATE UNIQUE INDEX `idx_users_phone_role` ON `users` (`phone`, `role`)"]);
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.indexes = users.indexes.filter((x) => !x.includes("idx_users_phone_role"));
  users.indexes = users.indexes.concat(["CREATE UNIQUE INDEX `idx_users_phone` ON `users` (`phone`)"]);
  app.save(users);
});
