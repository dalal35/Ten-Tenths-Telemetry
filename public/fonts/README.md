# Desktop font additions — Ember B.1

Evaluated the bundled IBM Plex Sans/Mono faces first. Geist supplies the UI's
more open, contemporary text shapes; existing Plex Mono stays on lap times,
deltas and instruments. Only Geist is an additional family.

- `geist-latin-variable.woff2`: 29,400 bytes, weights 100–900, Latin subset,
  downloaded 2026-11-04 from
  https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMEwcGFU.woff2
  (Google Fonts' Geist CSS Latin face). Upstream:
  https://github.com/vercel/geist-font ; license: `geist-OFL.txt`.
- `ibm-plex-mono-latin.woff2`: 10,052 bytes, regular Latin face reused from the
  existing website asset without modifying the website. Original source:
  https://fonts.gstatic.com/s/ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n1i8q131nj-o.woff2
  License: existing `plex-mono-OFL.txt`.

Both are served locally with `font-display: swap` and fallback stacks. Existing
broader Plex files remain available to legacy styles and fallback text.
