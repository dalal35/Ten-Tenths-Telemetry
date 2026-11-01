# Managed YouTube tools

Ten Tenths Telemetry invokes these separately distributed executables. They are
not linked into the application. The installed app uses its packaged copies and
does not install Python, media tools, plugins, or executable updates.

- **yt-dlp 2026.10.26**: the official standalone binary bundles Python, EJS and
  third-party modules. This combined executable is **GPL-3.0-or-later**, although
  yt-dlp's own source is Unlicense. The complete upstream aggregate license text
  is in `YT_DLP_THIRD_PARTY_LICENSES.txt`. The pinned yt-dlp source tarball is in
  `sources/`; it does not by itself include corresponding source for every
  bundled third-party component.
- **Deno 2.9.8**: MIT, with separately licensed bundled components. Its license is
  `DENO_LICENSE.md`; the pinned upstream source archive is in `sources/`.
- **FFmpeg and ffprobe 9.0.2**: LGPL-2.1-or-later, built from the exact source in
  `sources/ffmpeg-9.0.2.tar.xz`. See `FFMPEG_COPYING.LGPLv2.1` and
  `FFMPEG_SOURCE.md` for the source authentication and reproducible build recipe.

## Redistribution gate

The upstream yt-dlp standalone download does not supply an audited complete
corresponding-source archive matching every bundled platform component. Deno's
complete bundled-component license inventory also requires review. These are
recorded explicitly in `redistribution.json`. **Tagged publication is blocked**
until the exact corresponding sources and notices are assembled and verified.
The included top-level source archives and upstream links are not claimed to
fulfil that missing work. No new written source offer is made on anyone's behalf.

Development builds and local verification may proceed. Helpers must be updated
through reviewed, pinned application releases; running downloader/runtime
self-updates inside an installed signed bundle is unsupported.

Upstream projects:
https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.26
https://github.com/denoland/deno/releases/tag/v2.9.8
https://ffmpeg.org/download.html

This file accompanies the actual license texts and pinned input manifest.
