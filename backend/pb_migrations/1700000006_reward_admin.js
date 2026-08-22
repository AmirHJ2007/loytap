/// <reference path="../pb_data/types.d.ts" />

// Let the café owner (admin) manage the reward pool from the app.
migrate((app) => {
  const rc = app.findCollectionByNameOrId("reward_options");
  rc.createRule = '@request.auth.role = "admin"';
  rc.updateRule = '@request.auth.role = "admin"';
  rc.deleteRule = '@request.auth.role = "admin"';
  app.save(rc);
}, (app) => {
  const rc = app.findCollectionByNameOrId("reward_options");
  rc.createRule = null; rc.updateRule = null; rc.deleteRule = null;
  app.save(rc);
});
