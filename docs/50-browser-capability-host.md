# Browser Capability Host

My Mate now exposes browser automation through the Capability Registry instead of hard-coded Conversation behavior.

## Delivered modes

- `isolated`: a hidden Electron browser with a fresh task-scoped, non-persistent partition.
- `chrome`: a visible Google Chrome window using a persistent My Mate profile.
- `edge`: a visible Microsoft Edge window using a persistent My Mate profile.

Chrome and Edge deliberately do not attach to the user's normal browser profile. This matches the safer Hermes Agent pattern: My Mate launches a dedicated remote-debugging profile that the user may sign into, while keeping normal browser history, cookies, extensions, and tabs outside the agent boundary.

## Typed tools

- `browser_navigate`
- `browser_snapshot`
- `browser_click`
- `browser_type`
- `browser_back`
- `browser_close`

`browser_snapshot` returns bounded page text plus references such as `@e1`. Interaction tools accept only these references. There is no arbitrary JavaScript, selector, CDP, shell, or file-path tool exposed to the model or Renderer.

## Execution chain

1. `browser.core` is discovered as a bundled `browser` plugin.
2. Remote tool schemas are injected into the Conversation provider by the Capability Registry.
3. A tool call creates a durable Conversation Action with its executor and risk level.
4. The WebSocket sends a typed Desktop capability request.
5. Studio forwards it through the named `capability.execute` preload API.
6. Electron Browser Host executes the operation and reports the result through the private Desktop bridge.
7. Control Plane validates that the result matches the registered Action and capability before the model can claim success.

## Security boundaries

- HTTP and HTTPS only; embedded credentials are rejected.
- Localhost, private, reserved, documentation, multicast, and non-routable destinations are blocked after DNS resolution.
- Isolated browser subrequests are checked through its dedicated Electron session.
- Popups, renderer permissions, downloads, Node integration, and direct filesystem access are denied.
- Chrome/Edge CDP binds to a random loopback port and is never exposed to Studio or the model.
- Chrome/Edge use a dedicated persistent profile under Desktop user data.
- Opening a user-visible browser, cross-origin navigation, clicks, and typing require Desktop confirmation where applicable.
- Typing never submits a form automatically.
- Browser sessions are owned by the originating task and cannot be reused by another task ID.
- Closing the last controlled Chrome/Edge session closes the dedicated browser process.

## Current limits

- No file upload or download flow is exposed yet.
- No arbitrary keyboard shortcuts, raw selectors, screenshots, vision analysis, or form-submit tool is exposed yet.
- Existing normal Chrome/Edge tabs are intentionally not attachable. A future signed browser extension can add selected-tab authorization without weakening the current boundary.

## Verification

```powershell
cd C:\project\my-mate\apps\desktop
npm run check
npm run smoke:browser
$env:MY_MATE_BROWSER_SMOKE_MODE='chrome'; npm run smoke:browser:user
$env:MY_MATE_BROWSER_SMOKE_MODE='edge'; npm run smoke:browser:user
```

All smoke commands navigate to `https://example.com/`, read the title and text, and close the task-scoped browser session.
