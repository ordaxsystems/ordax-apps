# ORDAX Studio local-first distribution invariant

This file records the product-level invariant that the Windows distribution of ORDAX Studio is a separately installable local-first product.

- `ORDAX Studio.exe` must launch without requiring OrdaX OS.
- Local device-owner use must not require an ORDAX account, Cloudflare pairing, or internet connectivity.
- `ORDAX Runtime.exe` owns local device identity and local action authorization on Windows.
- Connecting an ORDAX account may add remote/account capabilities, but it must not replace the local device identity or become a prerequisite for local Studio use.
- Provider connectors and Control Plane availability must not select a different Studio implementation.
- OrdaX OS uses platform-owned runtime ports and must not bundle a second ORDAX Runtime.
- Both targets consume the same portable Studio source and canonical application version after cutover.

This invariant grants no authority and does not enable source cutover by itself.
