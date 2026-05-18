# Ruby High Patch Note

This is the crates.io `glib` 0.18.5 source with the upstream fix for
RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g applied to `src/variant_iter.rs`.

The current Tauri 2 Linux webview stack still depends on `gtk` 0.18, which in
turn requires `glib` 0.18. The local Cargo patch keeps native Linux support
while applying the same two-line mutability fix merged upstream in
gtk-rs-core PR 1343.
