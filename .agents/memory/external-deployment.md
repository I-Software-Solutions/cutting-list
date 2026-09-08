---
name: External deployment diagnostics
description: Avoid confusing this app's self-hosted production environment with Replit's development or publishing databases.
---

The user runs the cutting-list production app on their own server behind nginx. Replit's production-database status does not establish whether that external server has a database.

**Why:** A live saved-jobs endpoint returned a database error while development CRUD worked. Replit reported no provisioned production database, but that observation cannot diagnose the separate server.

**How to apply:** Distinguish development verification from external production checks. Use the live endpoint and the external server's logs/configuration to diagnose production; never infer that its tables or database are missing solely from Replit database status.