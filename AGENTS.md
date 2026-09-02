# DSHP collection instructions

- Keep generated Cordis overlays at the collection root: relative plugin paths resolve from the overlay file, so generating under `tmp/` breaks source loading. Replace only local placeholders and verify with a real Harness boot.
- On native Windows with Node 24, launch the Corepack `.CMD` shim through `cmd.exe /c` with verbatim arguments; direct `spawn()` fails with `EINVAL`. The accepted path is a real Harness listener and HTTP response on the configured development port.
