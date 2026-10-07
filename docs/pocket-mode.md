# Pocket mode

Hands-free practice with the phone in a pocket. Open an Assistant conversation with voice enabled and tap the moon button (**Pocket mode**) next to the microphone.

## What it does

1. **Screen Wake Lock.** While a voice-enabled conversation is open, and for as long as pocket mode is on, the app holds `navigator.wakeLock.request('screen')` (`src/core/pocket/wake-lock.ts`). The browser drops the lock whenever the page is hidden, so the app re-requests it on `visibilitychange` when the page is visible again. Where the API is missing or the request is refused (battery saver), nothing breaks; the screen just sleeps normally.
2. **Overlay.** A full-screen black (OLED-off) layer, using the Fullscreen API where allowed, swallows every touch/click. **Exit gesture: press and hold anywhere for 0.8 s ("Now swipe up" appears), then without lifting drag up 160 px.** A hint shows for the first 8 s. A very dim status line ("Speaking...", "Listening...") can be hidden with the small button at the bottom. Speech output and input keep running underneath because the page stays visible.

3. **Auto-listen** (`src/core/pocket/auto-listen.ts`, `useAutoListen.ts`). Tapping the moon button starts a loop: listen, send what you said, wait until the reply has been spoken to the end, listen again. A checkbox next to the moon button ("Auto-listen") turns the loop on outside pocket mode too (remembered in localStorage); leaving pocket mode stops the loop unless that option is on.
   - **Stop commands:** saying just "stop", "pause", "stop listening", "quit", "end" (or 停, 停止, 暂停, 停下, 结束, 别说了) pauses with a spoken "Paused." Only a whole-utterance command counts, so "how do I say stop" is sent as normal.
   - **Silence:** each recognition attempt that hears nothing is simply retried; after 30 s with no speech the loop pauses and says so (in the conversation's input language).
   - **Errors:** failed recognition restarts with backoff (0.5, 1, 2, 4, 8 s); a success resets it; after five consecutive failures it pauses with a spoken cue. A denied microphone or unsupported language pauses at once without retrying.
   - **Hidden page:** the loop waits while the page is hidden (browsers stop recognition then) and resumes by itself when it is visible again. Resuming after a pause by a command, silence or errors needs the exit gesture and a tap on the moon button or the mic.

## Limits

- Pressing the power button, switching apps, or an incoming call hides the page: the wake lock is released and, as before, the app cancels speech when the page is hidden. Pocket mode only prevents the *automatic* screen timeout.
- Auto-listen browser limits: the first microphone request needs a user gesture (the moon-button tap or the checkbox click provides it); later restarts reuse the granted permission, but a browser may re-prompt or refuse a restart with no recent gesture. Chrome on Android may beep or show the mic indicator on each restart and ends an attempt after a few seconds of silence; iOS Safari's recognition is shorter-lived and may stop between turns or ask for permission again, and in a Home Screen PWA recognition may be unavailable. Recognition also uses the browser's online speech service. These platform behaviours are expected from general knowledge and have **not** been verified on devices here; the loop logic itself is tested with a fake recognizer (`auto-listen.test.ts`: reply-then-listen ordering, stop commands, silence, backoff, hidden page).
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
