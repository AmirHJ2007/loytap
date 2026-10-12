// Reloy service worker — web push for staff tills, and nothing else.
//
// Deliberately NOT a caching/offline worker. The staff panel talks to the API
// on every action and a stale cached build would be worse than useless at a
// till; this exists purely because a push notification cannot be received
// without a service worker to receive it.
//
// Scope is "/" (it is served from the site root), which is what lets it cover
// /staff. Moving this file into a subdirectory would silently narrow the
// scope and stop pushes arriving.

// Take over as soon as a new version is installed, rather than waiting for
// every tab to close. A till that is left open for a week would otherwise
// keep running whatever was deployed when it was first opened.
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// ---------------------------------------------------------------------------
// a push arrives
// ---------------------------------------------------------------------------
// The text comes from the server inside the encrypted payload (push.pb.js),
// so the language was decided at subscribe time and nothing here needs to
// know about i18n.
//
// The fallback matters: Chrome REQUIRES a visible notification for every push
// it delivers, and silently penalises an origin that takes a push without
// showing one — repeated often enough, it revokes the permission. So if the
// payload is missing or unparseable we still show something.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (err) { data = {}; }

  const t = data.i18n || {};
  const title = data.title || "درخواست مهر جدید";
  const tag = data.tag || "stamp-request";

  // Approve/Deny are rendered by Chrome and ignored entirely by iOS Safari,
  // which shows the plain notification instead. That is why there is no
  // platform check here: the array is simply dropped where it is unsupported,
  // and tapping the body still opens the till on every platform.
  const actions = (data.requestId && t.approve && t.deny)
    ? [{ action: "approve", title: t.approve }, { action: "deny", title: t.deny }]
    : [];

  const options = {
    body: data.body || "یک مشتری منتظر تأیید است",
    icon: "/reloy-icon-192.png",
    badge: "/reloy-icon-192.png",
    tag: tag,
    renotify: true,
    vibrate: [120, 60, 120],
    actions: actions,
    // The arrival time the OS displays. Worth setting because the request is
    // only alive for 30s — "2 minutes ago" is the fastest way for staff to
    // know a notification is already dead.
    timestamp: Date.now(),
    data: {
      url: data.url || "/staff",
      requestId: data.requestId || "",
      expiresAt: data.expiresAt || 0,
      i18n: t,
    },
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);

    // Close it when the request expires, so a dead notification does not sit
    // on the lock screen inviting a tap that cannot work. This costs no extra
    // push — driving a live countdown from the server would mean ~30 pushes
    // per request, which push services rate-limit and Chrome penalises.
    //
    // Best-effort by nature: the browser may terminate this worker before the
    // timer fires. That is survivable, because expiry is enforced on the
    // server — /card/stamp/confirm answers 410 for a late approval — so the
    // worst case is a stale notification whose button politely reports that
    // the request had already expired.
    const left = options.data.expiresAt - Date.now();
    if (left > 0 && left < 120000) {
      await new Promise((r) => setTimeout(r, left));
      const open = await self.registration.getNotifications({ tag: tag });
      for (const n of open) n.close();
    }
  })());
});

// ---------------------------------------------------------------------------
// the notification is tapped
// ---------------------------------------------------------------------------
// Focus a staff panel that is already open rather than opening a second one —
// a till that accumulates tabs is a till whose camera permission stops
// working in the one the user is looking at.
self.addEventListener("notificationclick", (event) => {
  const d = event.notification.data || {};
  const t = d.i18n || {};
  event.notification.close();

  // No action tapped means the body was tapped: just open the till.
  if (event.action !== "approve" && event.action !== "deny") {
    event.waitUntil(openTill(d.url || "/staff"));
    return;
  }

  event.waitUntil((async () => {
    // Expired before the tap even reached us. Checked here as a courtesy so
    // the staff member gets a straight answer immediately; the server check
    // below is the one that actually protects the stamp.
    if (d.expiresAt && Date.now() > d.expiresAt) return toast(t.expired);

    const token = await readToken();
    // No token means this till was signed out since the push was sent. There
    // is nothing useful a worker can do about that, so hand it back to the UI.
    if (!token) return toast(t.failed, d.url);

    let res;
    try {
      res = await fetch("/card/stamp/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token },
        body: JSON.stringify({ request_id: d.requestId, approve: event.action === "approve" }),
      });
    } catch (err) {
      return toast(t.failed, d.url);   // offline, or the till's wifi dropped
    }

    // 410 REQUEST_EXPIRED and 409 ALREADY_HANDLED are both normal: the window
    // closed, or another till got there first. Neither is an error worth
    // alarming anyone about — they just need saying plainly.
    if (res.status === 410) return toast(t.expired);
    if (res.status === 409) return toast(t.expired);

    // The session is gone: signed out, or the token simply expired. Delete
    // our own copy rather than keep presenting buttons that cannot work.
    //
    // Belt and braces. staff.push.js's tillSignout() already clears this on
    // both sign-out paths, but that is page-side code — it cannot run if the
    // page was never opened again, and a future third sign-out path could
    // forget to call it. This is the one place that always notices, because
    // it is the thing actually using the token.
    if (res.status === 401 || res.status === 403) {
      await deleteToken();
      return toast(t.failed, d.url);
    }

    if (!res.ok) return toast(t.failed, d.url);

    return toast(event.action === "approve" ? t.approved : t.denied);
  })());
});

async function openTill(url) {
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of all) {
    if (client.url.indexOf("/staff") !== -1 && "focus" in client) return client.focus();
  }
  if (self.clients.openWindow) return self.clients.openWindow(url);
}

// A short confirmation that clears itself. Staff are mid-service with a
// customer in front of them; an outcome they have to stop and dismiss is
// worse than no outcome at all. If `url` is given the toast is tappable and
// opens the till, which is the escape hatch when something did not work.
async function toast(message, url) {
  if (!message) return;
  const tag = "stamp-result-" + Date.now();
  await self.registration.showNotification(message, {
    icon: "/reloy-icon-192.png",
    badge: "/reloy-icon-192.png",
    tag: tag,
    data: { url: url || "/staff" },
  });
  await new Promise((r) => setTimeout(r, 5000));
  const open = await self.registration.getNotifications({ tag: tag });
  for (const n of open) n.close();
}

// Drops this worker's copy of the session token. See the 401/403 branch above.
function deleteToken() {
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open("reloy-till", 1); } catch (e) { return resolve(false); }
    req.onupgradeneeded = () => { try { req.result.createObjectStore("kv"); } catch (e) {} };
    req.onerror = () => resolve(false);
    req.onsuccess = () => {
      try {
        const tx = req.result.transaction("kv", "readwrite");
        tx.objectStore("kv").delete("staff_token");
        tx.oncomplete = () => { req.result.close(); resolve(true); };
        tx.onerror = () => { req.result.close(); resolve(false); };
      } catch (e) { resolve(false); }
    };
  });
}

// The session token, mirrored into IndexedDB by staff.push.js because a
// service worker cannot reach the localStorage the page keeps it in.
function readToken() {
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open("reloy-till", 1); } catch (e) { return resolve(""); }
    req.onupgradeneeded = () => { try { req.result.createObjectStore("kv"); } catch (e) {} };
    req.onerror = () => resolve("");
    req.onsuccess = () => {
      try {
        const tx = req.result.transaction("kv", "readonly");
        const get = tx.objectStore("kv").get("staff_token");
        get.onsuccess = () => { const v = get.result; req.result.close(); resolve(v || ""); };
        get.onerror = () => { req.result.close(); resolve(""); };
      } catch (e) { resolve(""); }
    };
  });
}

// ---------------------------------------------------------------------------
// the browser rotates the subscription behind our back
// ---------------------------------------------------------------------------
// It does this periodically, and the old endpoint stops working the moment it
// happens. Re-subscribing needs the VAPID key and a staff token, and a
// service worker cannot read the localStorage the token lives in — so all
// this can do is drop a flag. staff.push.js checks it on next load and
// re-subscribes properly.
//
// Meanwhile the server's reaper notices the dead endpoint via 404/410 and
// removes the row, so nothing is left pushing into the void.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) client.postMessage({ type: "resubscribe" });
  })());
});
