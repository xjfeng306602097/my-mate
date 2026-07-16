# My Mate Bundled Plugins

Bundled capability plugins live one directory below this folder and declare a
`my-mate.plugin.json` manifest. See
`docs/48-capability-registry-and-plugin-host.md` for the current contract.

Do not add capability-specific branches to the Conversation provider. Register
new tools and providers through the Capability Registry and execute them through
the appropriate host boundary.

Remote-host plugins such as `browser.core` declare tool schemas without loading
arbitrary JavaScript into the Control Plane. Their calls are routed through
durable Conversation Actions and require a private Desktop-attested result.
