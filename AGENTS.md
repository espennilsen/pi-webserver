# Agent Integration Guide

## Install as pi package

```bash
pi install git@github.com:espennilsen/pi-webserver.git
```

The extension auto-discovers via the `pi` manifest in `package.json`.

## What it provides

**Command:** `/web [port|stop|status|auth]` — Manage the shared HTTP server.

**Auth:** `/web auth <password|user:pass|off>` — Optional Basic auth for all endpoints. Also configurable via `PI_WEB_AUTH` env var.

**Events (via `pi.events`):**
- Listens for `web:mount` and `web:unmount` from other extensions
- Emits `web:ready` on session start

**Dashboard:** Root URL (`/`) shows all mounted extensions with links.

## Mounting routes from another extension

```typescript
import { mount } from "pi-webserver/src/server.ts";
import { json, readBody } from "pi-webserver/src/helpers.ts";

mount({
  name: "my-ext",
  label: "My Extension",
  prefix: "/my-ext",
  handler: (req, res, path) => {
    // path has prefix stripped
    json(res, 200, { hello: "world" });
  },
});
```

Or via the event bus (no import needed):

```typescript
pi.events.on("web:ready", () => {
  pi.events.emit("web:mount", { name: "my-ext", prefix: "/my-ext", handler: ... });
});
```
