# Repository delivery

Always keep a "Latest download — rolling updates" section in README.md with stable
links to the latest software and release notes/checksums. Update the assets behind
those links when delivering a verified build. Label signing status and previews.

Keep websites in sandboxed WebContentsView instances without a preload or Node
integration. Only the trusted internal main frame may invoke application IPC.
Never sync credentials, browser cookies, provider keys or whole browser profiles.
Keep pair secrets and TLS private keys encrypted at rest using OS protection;
fail closed if encryption is unavailable. No startup registration, background
service, automatic received-tab navigation or silent network deployment.
