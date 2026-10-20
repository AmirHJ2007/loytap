// Subscription reminders on the owner's own phone — registering the service
// worker, and the switch in Settings that turns them on and off.
//
// Kept out of owner.page.js on purpose: that file is the whole dashboard, and
// everything here is behind capability checks that can fail. A browser with
// no push support must end up with a hidden switch and an untouched
// dashboard, never a dashboard that stopped loading halfway.
//
// WHAT THIS IS NOT. staff.push.js looks similar and is nearly three times the
// size, almost all of it the IndexedDB token mirror: a till's notification
// carries Approve/Deny buttons, sw.js handles those taps itself, and a
// service worker cannot read localStorage — so the page has to mirror the
// session token somewhere both can see, re-mirror it on a timer because the
// token is refreshed asynchronously, and wipe it on sign-out or a stale copy
// leaves a button that can still stamp a card.
//
// None of that applies here. A subscription reminder has no buttons; tapping
// it opens /owner. So there is no mirrored token, which means no stale-token
// failure mode and no credential sitting in IndexedDB at all.
//
// THE iOS RULE. Safari only delivers web push to a page that has been added
// to the Home Screen — in an ordinary tab it will not even offer the
// permission prompt. So on an un-installed iPhone the switch says what to do
// first instead of asking for a permission that cannot be granted. This is
// the common case for owners, not an edge case.
(function () {
  "use strict";

  const API = location.port === "8000"
    ? location.protocol + "//" + location.hostname + ":8090"
    : location.origin;

  const row = document.getElementById("setNotifyRow");
  const sw = document.getElementById("notifySwitch");
  if (!row || !sw) return;

  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  // iOS reports standalone separately from the display-mode media query, and
  // only the former is reliable on older iOS versions.
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);

  // Read on each use rather than captured once: owner.page.js mints a fresh
  // 72h token on every page load (refreshOwnerSession) and replaces this
  // value, so a copy taken at startup goes stale within a second.
  const token = () => { try { return localStorage.getItem("loytap_token") || ""; } catch (e) { return ""; } };

  const note = document.getElementById("notifyNote");
  function say(key) {
    if (!note) return;
    note.textContent = (typeof t === "function") ? t(key) : "";
    note.hidden = !key;
  }

  let registration = null;
  let busy = false;

  function setState(state) {
    // on | off | unsupported | needs-install
    sw.dataset.state = state;
    sw.setAttribute("aria-checked", state === "on" ? "true" : "false");
    // The row goes, not just the switch: a settings line reading
    // "Subscription reminders" with no control beside it is a worse answer
    // than no line at all.
    row.hidden = state === "unsupported";
    if (state === "needs-install") say("OWNER_NOTIFY_NEEDS_INSTALL");
    else if (state === "on") say("OWNER_NOTIFY_ON_NOTE");
    else say("OWNER_NOTIFY_OFF_NOTE");
  }

  // The VAPID key arrives as base64url; applicationServerKey wants bytes.
  function keyToBytes(b64url) {
    const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
    const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function currentSubscription() {
    if (!registration) return null;
    try { return await registration.pushManager.getSubscription(); } catch (e) { return null; }
  }

  function postSubscription(sub) {
    const json = sub.toJSON();
    return fetch(API + "/owner/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token() },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        lang: (typeof getLang === "function" ? getLang() : "fa"),
      }),
    });
  }

  // "This phone is still here." Re-registers an EXISTING subscription on page
  // load, which bumps the row's `updated` and keeps the push-stale reaper in
  // push.pb.js from dropping it.
  //
  // This matters more for an owner than for a till. A till is opened every
  // shift; an owner may not open the dashboard for weeks — which is exactly
  // the stretch during which the one notification they care about is due. So
  // the reaper's window has to be survivable without a visit, and the
  // heartbeat is what makes a visit count when it happens.
  //
  // Only ever for a subscription that already exists — never a back door that
  // re-subscribes a phone whose owner turned reminders off.
  function heartbeat(sub) {
    try { postSubscription(sub).catch(() => {}); } catch (e) {}
  }

  async function subscribe() {
    // Must come from a user gesture — every browser refuses the permission
    // prompt otherwise, and Safari refuses silently.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setState("off");
      if (permission === "denied") say("OWNER_NOTIFY_BLOCKED");
      return;
    }

    const keyRes = await fetch(API + "/owner/push/key", { headers: { Authorization: token() } });
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
      // Leave no orphan: a subscription the server does not know about sits
      // in the browser looking enabled forever and delivers nothing.
      try { await sub.unsubscribe(); } catch (e) {}
      throw new Error("subscribe rejected: " + res.status);
    }
    setState("on");
    say("OWNER_NOTIFY_ENABLED");
  }

  async function unsubscribe() {
    const sub = await currentSubscription();
    if (sub) {
      try {
        await fetch(API + "/owner/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: token() },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
      } catch (e) { /* drop it locally regardless — the reaper cleans the row */ }
      try { await sub.unsubscribe(); } catch (e) {}
    }
    setState("off");
  }

  sw.addEventListener("click", async () => {
    if (busy) return;
    if (sw.dataset.state === "needs-install") { say("OWNER_NOTIFY_NEEDS_INSTALL"); return; }
    busy = true;
    sw.classList.add("is-busy");
    try {
      if (sw.dataset.state === "on") await unsubscribe();
      else await subscribe();
    } catch (err) {
      setState("off");
      say("OWNER_NOTIFY_FAILED");
    } finally {
      busy = false;
      sw.classList.remove("is-busy");
    }
  });

  // ---- what sign-out has to undo ----
  //
  // Exported because the sign-out button lives in owner.page.js, and this is
  // the only file that knows the feature stored anything.
  //
  // MUST be awaited, and MUST run BEFORE localStorage is cleared: the
  // unsubscribe POST authenticates with the token it is about to drop.
  //
  // A signed-out phone that keeps its subscription keeps being told when a
  // café it no longer administers is about to lapse. Unlike the till's
  // version there is no token to revoke — a reminder names a deadline, not a
  // customer, and carries no action — so this is a tidiness and privacy fix
  // rather than a security one. It still has to happen: the alternative is a
  // phone nobody can unsubscribe, because the switch that would do it is
  // behind a sign-in that is now someone else's.
  //
  // Never throws: sign-out must complete with the network down. Anything that
  // fails here is still cleaned up server-side, because an unsubscribed
  // endpoint makes the next push 404/410 and push-reap deletes the row.
  window.ownerPushSignout = async function ownerPushSignout() {
    try { await unsubscribe(); } catch (e) {}
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
    // Permission can be revoked in browser settings without the subscription
    // being dropped, which would otherwise show a switch reading "on" for
    // notifications that can no longer be displayed.
    const live = existing && Notification.permission === "granted";
    setState(live ? "on" : "off");
    if (live) heartbeat(existing);

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
