# Pocket mode

Hands-free practice with the phone in a pocket. Open an Assistant conversation with voice enabled and tap the moon button (**Pocket mode**) next to the microphone.

## What it does

1. **Screen Wake Lock.** While a voice-enabled conversation is open, and for as long as pocket mode is on, the app holds `navigator.wakeLock.request('screen')` (`src/core/pocket/wake-lock.ts`). The browser drops the lock whenever the page is hidden, so the app re-requests it on `visibilitychange` when the page is visible again. Where the API is missing or the request is refused (battery saver), nothing breaks; the screen just sleeps normally.
2. **Overlay.** A full-screen black (OLED-off) layer, using the Fullscreen API where allowed, swallows every touch/click. **Exit gesture: press and hold anywhere for 0.8 s ("Now swipe up" appears), then without lifting drag up 160 px.** A hint shows for the first 8 s. A very dim status line ("Speaking...", "Listening...") can be hidden with the small button at the bottom. Speech output and input keep running underneath because the page stays visible.

## Limits

- Pressing the power button, switching apps, or an incoming call hides the page: the wake lock is released and, as before, the app cancels speech when the page is hidden. Pocket mode only prevents the *automatic* screen timeout.
- Listening is still started by tapping the mic button, which the overlay blocks. Fully hands-free turn-taking would need auto-listen after each reply (not built).
- Wake lock needs a secure context (HTTPS) and a recent browser (Chrome/Edge Android, Safari/iOS 16.4+). Fullscreen on iPhone Safari is not available for arbitrary elements; the black overlay still covers the page.
- The screen stays on and lit-black: battery use is higher than a locked phone.
- Touch protection is only inside the web page; system gestures and hardware buttons are not blocked.

## Audio-clip alternative (prototype status)

Browsers stop `speechSynthesis` when the page is hidden, but media playback (`<audio>` plus the Media Session API) is allowed to continue with the screen locked. That would allow true locked-screen practice.

- **Audio source.** The only existing path that produces audio *files* is Edge TTS (`src/core/assistant/edge-speech.ts`), and it works only against the local dev server (`DEV_LOCAL_TTS`), not on the deployed PWA. The app uses no cloud TTS in production. A production version would need a bundled on-device/wasm TTS (e.g. Piper or sherpa-onnx; tens of MB of model, Mandarin voice quality to be judged) or a user-configured cloud TTS. None is integrated yet.
- **Measured on real devices: not done.** This runner has no phone. `public/pocket-audio-test.html` (served at `/pocket-audio-test.html`) is the test page: it plays (A) an `<audio>` clip with Media Session or (B) `speechSynthesis`, logs once a second (gaps = frozen page), stores the log, and accepts your own Mandarin clip. Procedure: start A, press the power button, wait 30 s, unlock, read the log; repeat for B, on Android Chrome (browser tab and installed PWA) and iOS Safari (tab and Home Screen PWA).
- **Expected, from general platform behaviour (not verified here):** `speechSynthesis` stops/pauses when hidden on both; `<audio>` started by a user tap continues on Android Chrome with the screen off; iOS Safari tabs usually continue audio too, while iOS Home Screen PWAs have historically been less reliable. Treat the iOS PWA row as unknown until the page is run on a device. References: MDN "Screen Wake Lock API", MDN "Media Session API", W3C Screen Wake Lock spec.

## When a native shell is needed

If the audio-clip test fails on iOS PWAs, or you need continuous background microphone listening (browsers do not allow mic capture with the screen locked), a partly native app (e.g. a Capacitor wrapper with a background-audio / foreground-service plugin) would be required. Pocket mode in the web app deliberately avoids that.
