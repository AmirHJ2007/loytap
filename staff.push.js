// Staff till notifications — registering the service worker, and turning the
// subscription on and off from the bell button.
//
// Kept out of staff.js on purpose: that file is the scanner and the request
// queue, both of which must keep working on any browser. Everything here is
// behind capability checks and degrades to a hidden button, so a device
// without push support sees no trace of the feature rather than a control
// that does nothing.
//
// THE iOS RULE. Safari only delivers web push to a page that has been added
// to the Home Screen — not to a normal tab, where it will not even offer the
// permission prompt. So on an un-installed iPhone the button explains that
// instead of asking for a permission that cannot be granted.
(function () {
  "use strict";

  const API = location.port === "8000"
    ? location.protocol + "//" + location.hostname + ":8090"
    : location.origin;

  const btn = document.getElementById("notifyBtn");
  if (!btn) return;

  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  // iOS reports standalone separately from the display-mode media query, and
  // only the former is reliable on older iOS versions.
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);

  const token = () => { try { return localStorage.getItem("loytap_token") || ""; } catch (e) { return ""; } };

  // The staff page has no toast(); app.js (which defines one) is not loaded
  // here. #scannerNote is the page's existing message line and sits on the
  // landing tab, which is where someone setting a till up will be.
  function say(key) {
    const note = document.getElementById("scannerNote");
    if (note && typeof t === "function") note.textContent = t(key);
  }

  // ---- the service worker's copy of the session token ----
  //
  // The Approve/Deny buttons are handled inside sw.js, which has to call
  // /card/stamp/confirm itself — and a service worker cannot read
  // localStorage, where staff.js keeps the token. IndexedDB is the only
  // storage both sides can see, so the page mirrors the token into it.
  //
  // Re-mirrored on a timer and on tab focus, not just once: staff.js mints a
  // fresh 7-day token asynchronously on every page load
  // (refreshStaffSession()), so a single mirror at startup would copy the
  // token that is about to be replaced and leave the worker holding a stale
  // one. A stale token means a button that 401s — which looks exactly like a
  // broken feature.
  const IDB_NAME = "reloy-till";
  const IDB_STORE = "kv";

  function idbSet(key, value) {
    return new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(IDB_NAME, 1); } catch (e) { return resolve(false); }
      req.onupgradeneeded = () => {
        try { req.result.createObjectStore(IDB_STORE); } catch (e) {}
      };
      req.onerror = () => resolve(false);
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).put(value, key);
          tx.oncomplete = () => { req.result.close(); resolve(true); };
          tx.onerror = () => { req.result.close(); resolve(false); };
        } catch (e) { resolve(false); }
      };
    });
  }

  function idbDel(key) {
    return new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(IDB_NAME, 1); } catch (e) { return resolve(false); }
      req.onupgradeneeded = () => {
        try { req.result.createObjectStore(IDB_STORE); } catch (e) {}
      };
      req.onerror = () => resolve(false);
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).delete(key);
          tx.oncomplete = () => { req.result.close(); resolve(true); };
          tx.onerror = () => { req.result.close(); resolve(false); };
        } catch (e) { resolve(false); }
      };
    });
  }

  function mirrorToken() {
    const tk = token();
    if (tk) idbSet("staff_token", tk);
  }

  let registration = null;
  let busy = false;

  function setState(state) {
    // on | off | unsupported | needs-install
    btn.dataset.state = state;
    const label =
      state === "on" ? "STAFF_NOTIFY_ON" :
      state === "needs-install" ? "STAFF_NOTIFY_NEEDS_INSTALL" :
      "STAFF_NOTIFY_OFF";
    const text = (typeof t === "function") ? t(label) : "";
    btn.setAttribute("aria-label", text);
    btn.setAttribute("title", text);
    btn.setAttribute("aria-pressed", state === "on" ? "true" : "false");
    btn.hidden = state === "unsupported";
  }

  // The VAPID key arrives as base64url; applicationServerKey wants bytes.
  function keyToBytes(b64url) {
    const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
    const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function toBase64Url(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function currentSubscription() {
    if (!registration) return null;
    try { return await registration.pushManager.getSubscription(); } catch (e) { return null; }
  }

  // Registers this device with the server. Upserts on endpoint, so calling it
  // again for a subscription the server already knows about simply refreshes
  // the row — which is the whole point of the heartbeat below.
  function postSubscription(sub) {
    const json = sub.toJSON();
    return fetch(API + "/staff/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token() },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        // so the owner can tell two tills apart in a list later
        label: (navigator.userAgent.match(/\((.*?)\)/) || [, ""])[1].slice(0, 80),
        lang: (typeof getLang === "function" ? getLang() : "fa"),
      }),
    });
  }

  // "This device is still here." Re-registers an EXISTING subscription on
  // every page load, which bumps the row's `updated` timestamp and lets the
  // server reap rows nothing has checked in on (see push-stale in push.pb.js).
  //
  // WHY THE SERVER CANNOT WORK THIS OUT ALONE. A subscription dies silently.
  // Delete a home-screen web app on iOS and its storage — service worker,
  // subscription and all — goes with it, but the server is never told: the
  // next push to that endpoint was observed returning 201 from APNs, not the
  // 404/410 the reaper keys on. So the row lingers, and a reinstall adds a
  // SECOND row beside it. That is why a till can end up notified twice for
  // one stamp request.
  //
  // Deliberately only for a subscription that already exists — never a way to
  // re-subscribe a till whose staff turned notifications off.
  //
  // Fire-and-forget: a failed heartbeat costs one missed refresh out of a
  // 30-day window, so it is never worth interrupting page load for.
  function heartbeat(sub) {
    try { postSubscription(sub).catch(() => {}); } catch (e) {}
  }

  async function subscribe() {
    // Must be called from a user gesture — every browser refuses the
    // permission prompt otherwise, and Safari refuses silently.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setState("off");
      if (permission === "denied") say("STAFF_NOTIFY_BLOCKED");
      return;
    }

    const keyRes = await fetch(API + "/staff/push/key", { headers: { Authorization: token() } });
    if (!keyRes.ok) throw new Error("no vapid key: " + keyRes.status);
    const { key } = await keyRes.json();

    const sub = await registration.pushManager.subscribe({
      // Mandatory on Chrome: it will not grant a subscription that promises
      // to handle pushes invisibly.
      userVisibleOnly: true,
      applicationServerKey: keyToBytes(key),
    });

    const res = await postSubscription(sub);
    if (!res.ok) {
      // Leave no orphan: a subscription the server does not know about would
      // sit in the browser forever looking enabled and never deliver anything.
      try { await sub.unsubscribe(); } catch (e) {}
      throw new Error("subscribe rejected: " + res.status);
    }
    mirrorToken();
    setState("on");
    say("STAFF_NOTIFY_ENABLED");
  }

  async function unsubscribe() {
    const sub = await currentSubscription();
    if (sub) {
      try {
        await fetch(API + "/staff/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: token() },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
      } catch (e) { /* drop it locally regardless — the reaper cleans the row */ }
      try { await sub.unsubscribe(); } catch (e) {}
    }
    setState("off");
  }

  btn.addEventListener("click", async () => {
    if (busy) return;
    if (btn.dataset.state === "needs-install") {
      say("STAFF_NOTIFY_NEEDS_INSTALL");
      return;
    }
    busy = true;
    btn.classList.add("is-busy");
    try {
      if (btn.dataset.state === "on") await unsubscribe();
      else await subscribe();
    } catch (err) {
      setState("off");
      say("STAFF_NOTIFY_FAILED");
    } finally {
      busy = false;
      btn.classList.remove("is-busy");
    }
  });

  // ---- what sign-out has to undo ----
  //
  // Exported because the sign-out paths live in other files (staff.page.js's
  // button, and staff.js's "the server rejected this token" path) and this is
  // the only file that knows what the push feature stored.
  //
  // MUST be awaited, and MUST run BEFORE the caller clears localStorage:
  //   - the unsubscribe POST authenticates with the token it is about to drop
  //   - an IndexedDB delete is asynchronous, so a caller that fires it and
  //     immediately runs location.replace() can navigate away before the
  //     transaction commits, leaving the token exactly where it was
  //
  // Two separate jobs, and both matter:
  //   the subscription   a signed-out till that keeps its subscription keeps
  //                      receiving notifications — with customer names on its
  //                      lock screen. Dropping it is a privacy fix.
  //   the mirrored token the service worker's copy of the session. Left
  //                      behind, the Approve button on one of those
  //                      notifications still stamps a card, because a static
  //                      staff token stays valid server-side for a week and
  //                      nothing can revoke it. That is the security fix.
  //
  // Never throws: sign-out must complete even if the network is down or
  // IndexedDB is unavailable. Anything that fails here is still cleaned up
  // server-side — an unsubscribed endpoint makes the next push 404/410, which
  // the push-reap cron turns into a deleted row.
  window.tillSignout = async function tillSignout() {
    try { await unsubscribe(); } catch (e) {}
    try { await idbDel("staff_token"); } catch (e) {}
  };

  (async function init() {
    if (!supported) { setState("unsupported"); return; }
    if (isIOS && !isStandalone) { setState("needs-install"); return; }

    try {
      registration = await navigator.serviceWorker.register("/sw.js");
    } catch (err) {
      setState("unsupported");
      return;
    }

    const existing = await currentSubscription();
    const live = existing && Notification.permission === "granted";
    setState(live ? "on" : "off");
    if (live) heartbeat(existing);

    // Mirror now, again once staff.js's async token refresh has had time to
    // land, and whenever the till is brought back to the foreground.
    mirrorToken();
    setTimeout(mirrorToken, 4000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") mirrorToken();
    });

    // The worker asks for this when the browser rotates a subscription out
    // from under us (see sw.js). Re-subscribing needs the token, which only
    // this side can read.
    navigator.serviceWorker.addEventListener("message", async (ev) => {
      if (!ev.data || ev.data.type !== "resubscribe") return;
      if (Notification.permission !== "granted") return;
      try { await subscribe(); } catch (e) { setState("off"); }
    });
  })();
})();
