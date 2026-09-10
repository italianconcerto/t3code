# OpenRouter

OpenRouter support uses OpenCode as coding-agent runtime. OpenRouter supplies model access;
OpenCode supplies tools, permissions, project context, and resumable sessions.

## Set up OpenRouter

Install OpenCode 1.14.19 or newer. In **Settings → Providers**, add **OpenRouter**. Under
**Environment → Variables**, add `OPENROUTER_API_KEY`, paste the key, and leave it marked
**Sensitive** so T3 Code stores it separately and redacts it from clients. Set **OpenCode binary
path** when `opencode` is not on the environment's `PATH`.

Leave **OpenCode server URL** blank for normal use. If you connect an existing OpenCode
server, configure its OpenRouter credential on the server; local environment variables cannot
alter an already-running remote process. When that server requires HTTP basic authentication,
add `OPENCODE_SERVER_PASSWORD` as another **Sensitive** environment variable.

Refresh provider status after changing credentials. The model picker shows only OpenRouter's
catalog, using OpenCode model slugs such as `openrouter/auto` or
`openrouter/anthropic/claude-sonnet-4.6`.

OpenRouter supports normal T3 threads, model and provider switching, `/goal`, `/loop`, manual
compaction, and OpenCode permission handling.
