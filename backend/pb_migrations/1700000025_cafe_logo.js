/// <reference path="../pb_data/types.d.ts" />

// An optional logo per café, shown as a circle before the name + tagline on the
// customer's loyalty card. Optional on purpose: a café with no logo keeps
// exactly the card it has today, with no placeholder and no reserved space.
//
// Uploaded through POST /owner/cafe/logo (owner.pb.js), never by PATCHing the
// record — cafe_card.updateRule is null and stays null.
//
// mimeTypes deliberately excludes image/svg+xml. cafe_card is world-readable,
// so its files are served to anyone; an SVG is a document that can carry
// <script>, and serving one from our own origin would hand an uploader script
// execution in our origin — the exact thing the CSP added in
// 1700000012_security_headers.js exists to prevent. Raster only.
//
// The 240x240 thumb is what the wallet actually loads: the card renders the
// logo at ~44px, so shipping the full 2MB original to every customer on every
// card would be wasteful. PocketBase generates it on first request and caches it.

migrate((app) => {
  const cafes = app.findCollectionByNameOrId("cafe_card");
  cafes.fields.add(new FileField({
    name: "logo",
    maxSelect: 1,
    maxSize: 2097152, // 2MB
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    thumbs: ["240x240"], // centre-cropped square — the card masks it to a circle
  }));
  app.save(cafes);
}, (app) => {
  const cafes = app.findCollectionByNameOrId("cafe_card");
  cafes.fields.removeByName("logo");
  app.save(cafes);
});
