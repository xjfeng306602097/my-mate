# Web Search And Fetch Capability

## Status

The first bundled capability plugin is implemented under `plugins/web-core`.
It is enabled by default because it is bundled and exposes two stable tools:

- `web_search`
- `web_fetch`

Both tools are registered through the Capability Registry and run through the
normal Conversation Action, risk, progress, timeout, and audit flow.

## Search Providers

Set `MY_MATE_WEB_SEARCH_PROVIDER` to one of:

- `auto` (default)
- `brave`
- `tavily`
- `bing`
- `duckduckgo`

`auto` selects providers in this order:

1. Brave when `BRAVE_SEARCH_API_KEY` is configured;
2. Tavily when `TAVILY_API_KEY` is configured;
3. Bing public HTML search without an API key.

DuckDuckGo public HTML search remains available as an explicit provider. It is
not the default because availability varies by network and region.

Provider choice is returned in each `web_search` result. The model-facing tool
schema does not change when the provider changes.

## Web Fetch

`web_fetch` accepts one absolute HTTP or HTTPS URL and returns bounded text or
HTML. HTML text extraction uses a DOM parser and removes script, style, iframe,
navigation, footer, and other non-content elements before returning the page to
the model.

The response includes:

- final URL;
- HTTP status;
- content type;
- page title and description;
- extracted content;
- truncation state;
- `untrusted_content: true`.

Binary documents are not extracted in this phase. PDF and Office document URLs
should be handled by the later document/artifact capability rather than decoded
inside the Web plugin.

## Network Security

Every request and redirect is checked independently.

The implementation:

- allows HTTP and HTTPS only;
- rejects credentials embedded in URLs;
- rejects localhost and local-only hostname suffixes;
- resolves DNS before connecting;
- rejects any hostname resolving to private, loopback, link-local, reserved,
  documentation, benchmark, multicast, or non-routable addresses;
- pins the validated DNS result into the HTTP connection lookup;
- strips authentication and API-key headers on cross-origin redirects;
- limits redirects, request duration, and response bytes;
- does not expose arbitrary response cookies to the model;
- returns typed, safe network errors through Conversation Actions.

This prevents the Web plugin from becoming an SSRF path to the Control Plane,
Desktop services, Docker network, cloud metadata endpoints, or LAN devices.

## Current Boundary

`web_fetch` is intended for static public content. Pages requiring JavaScript,
login state, clicking, scrolling, forms, or visual inspection belong to the
next isolated Browser and Desktop Chrome/Edge plugin phase.
