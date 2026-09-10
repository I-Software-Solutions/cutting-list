---
name: GitHub connector push workflow
description: How to push this project to GitHub when raw tokens aren't available
---
The GitHub connector here never exposes a raw access token: `listConnections('github')` and the credential proxy (`/api/v2/connection?include_secrets=true`) both return 0 items even when the connection is active. Only `@replit/connectors-sdk` (`new ReplitConnectors().proxy('github', path, opts)`) works — it injects auth server-side.

**Why:** direct git push over HTTPS is impossible without a token, so pushes must go through the GitHub Git Data API (blobs → tree → commit → PATCH ref) via the SDK proxy.

**How to apply:** install `@replit/connectors-sdk` with `pnpm add -w`, run scripts from the workspace root (imports don't resolve from /tmp), throttle to <10 RPS (proxy rate limit, retry on 429), and cache blob SHAs to a file for resumability. Target repo: i-framer/cutting-list (main). Note: `.local/` files can vanish between commands — keep transient scripts at workspace root and delete after.
