# FFmpeg 9.0.2 source and build

Source: https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz

SHA-256: `8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e`

Source size: 12,040,788 bytes. Matching source is included in `sources/`.
Upstream tag `n9.0.2` points to commit
`946fcce07b6dcd0331c8cc609192aeff5e1924f8`.

The source was authenticated against the accompanying upstream detached signature
`ffmpeg-9.0.2.tar.xz.asc` and key `ffmpeg-devel.asc`, fingerprint
`FCF986EA15E6E293A5644F10B4322F04D67658D8`. Initial signature verification used
OpenPGP.js 6.2.2 as temporary build tooling. Subsequent builds verify the pinned
SHA-256 before extraction. The installed app has no OpenPGP.js dependency.

Run `node scripts/prepare-youtube-tools.mjs --download` on the native build host.
The exact configure flags are in `manifest.json` and copied to the generated
`src-tauri/binaries/toolchain-<target>.json` build receipt. No FFmpeg source patches
are applied. macOS uses Apple clang targeting arm64/macOS 13; Windows uses MSYS2
UCRT64 GCC targeting x86_64 Windows with static runtime linking and assembly
disabled. Only operating system libraries remain external.

The build disables GPL/nonfree/version3 components, network access and automatic
external dependency detection. It enables local file/pipe access, MOV/MP4, AAC,
MPEG-TS and concat demuxing, H.264/AAC decoding, stream-copy remuxing, the null
verification output and required parsers/bitstream filters. It contains no H.264
video encoder. Actual app downloads use source streams and never re-encode.

`node scripts/verify-youtube-tools.mjs` checks versions, architecture, LGPL output,
absence of network/decryption protocols, H.264/AAC remux, decoded presentation
timestamps of an original VFR fixture, corrupt-file rejection and Deno execution.

This FFmpeg executable distribution is separate from TTT. The exact source archive,
license text and build recipe permit recipients to rebuild or replace it. See
https://ffmpeg.org/legal.html for upstream licensing information.
