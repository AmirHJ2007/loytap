# LoyTap — Loyalty Wallet

A one-page, animation-rich **wallet app** — an Apple Wallet–style stack of café
loyalty cards. Tap a peeking card to bring it to the front; press **Stamp** and a
rubber stamp flies in, presses down, and leaves an inked star. Fill a card and it
celebrates with confetti, flips to a scratch-off reward, and reveals a code.

No backend, no build step, no persistence — it resets each visit. Just open the file.

## Run it

```
open index.html      # macOS
```

Or double-click `index.html`. (Google Fonts load over the network with a system
fallback offline. The clipboard "Copy" works best over `http://` — run
`python3 -m http.server` in this folder if you want that.)

## Add or edit cards

Everything is driven by the `CARDS` array at the top of `app.js`. Each entry is:

```js
{
  id, name, tag,
  stamps: 8, cols: 4,               // cols is usually stamps / 2
  reward: { percent, desc, code },  // shown on the scratch-off back
  theme: { "--paper", "--ink", "--terra", "--stamp-ink", ... },  // card colours
  inks: [...],       // ink-splash colours
  confetti: [...],   // celebration colours
  foil: [...],       // 5 scratch-foil gradient stops
}
```

Add an object to the array and a new card appears in the stack automatically.

## Files

- `index.html` — wallet container, shared stamp tool, confetti canvas
- `styles.css` — theme variables, wallet stack, card/stamp/flip/scratch styles
- `app.js` — card data, wallet layout & tap-to-front, stamping, confetti, scratch-off
