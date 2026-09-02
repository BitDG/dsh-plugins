# DSHP collection instructions

- Keep generated Cordis overlays at the collection root: relative plugin paths resolve from the overlay file, so generating under `tmp/` breaks source loading. Replace only local placeholders and verify with a real Harness boot.
- On native Windows with Node 24, launch the Corepack `.CMD` shim through `cmd.exe /c` with verbatim arguments; direct `spawn()` fails with `EINVAL`. The accepted path is a real Harness listener and HTTP response on the configured development port.
- Before moving a plugin referenced by a DSH Profile `file:` dependency, update that manifest path while the old source still exists; `dsh plugin add` resolves existing dependencies first and otherwise fails with `ENOENT`. Regenerate the Profile lockfile and verify the installed module, real Harness listener, and plugin runtime.
