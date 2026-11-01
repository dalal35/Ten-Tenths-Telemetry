// Provision the pinned official source and build only the static libraries used by motion.cpp.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, existsSync, rmSync, mkdtempSync, readdirSync, copyFileSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('OpenCV provisioning requires Apple Silicon macOS.');
const root = resolve('.tools/opencv-4.13.0');
const archive = join(root, 'opencv.tar.gz');
const install = join(root, 'install');
// Matches Buildroot's independently recorded OpenCV 4.13.0 source hash:
// https://lists.buildroot.org/pipermail/buildroot/2026-January/793523.html
const digest = '1d40ca017ea51c533cf9fd5cbde5b5fe7ae248291ddf2af99d4c17cf8e13017d';
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
mkdirSync(root, { recursive: true });
const work = mkdtempSync(join(root, 'provision-'));
const source = join(work, 'opencv-4.13.0');
const build = join(work, 'build');
const staged = join(work, 'install');
try {
if (!existsSync(archive)) {
  const download = join(work, 'download.tar.gz');
  run('curl', ['--fail', '--location', '--output', download, 'https://github.com/opencv/opencv/archive/refs/tags/4.13.0.tar.gz']);
  if (createHash('sha256').update(readFileSync(download)).digest('hex') !== digest) throw new Error('OpenCV source digest mismatch');
  renameSync(download, archive);
}
if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== digest) throw new Error('OpenCV source digest mismatch; delete the archive and retry.');
run('tar', ['-xzf', archive, '-C', work]);
run('cmake', ['-S', source, '-B', build, `-DCMAKE_INSTALL_PREFIX=${staged}`, '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_OSX_ARCHITECTURES=arm64', '-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0', '-DBUILD_LIST=core,imgproc,video', '-DBUILD_SHARED_LIBS=OFF', '-DBUILD_ZLIB=OFF', '-DBUILD_TESTS=OFF', '-DBUILD_PERF_TESTS=OFF', '-DBUILD_EXAMPLES=OFF', '-DBUILD_opencv_apps=OFF', '-DBUILD_opencv_gapi=OFF', '-DWITH_IPP=OFF', '-DWITH_ADE=OFF', '-DWITH_KLEIDICV=OFF', '-DWITH_JPEG=OFF', '-DWITH_PNG=OFF', '-DWITH_TIFF=OFF', '-DWITH_WEBP=OFF', '-DWITH_OPENJPEG=OFF', '-DWITH_OPENEXR=OFF', '-DWITH_JASPER=OFF', '-DWITH_ITT=OFF', '-DWITH_OPENCL=OFF', '-DWITH_FFMPEG=OFF', '-DWITH_GSTREAMER=OFF', '-DWITH_AVFOUNDATION=OFF', '-DBUILD_JAVA=OFF', '-DBUILD_opencv_python3=OFF']);
run('cmake', ['--build', build, '--parallel', '4']);
run('cmake', ['--install', build]);

// Replace individual files atomically, so concurrent Rust builds keep valid open files.
function publish(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name), dst = join(to, entry.name);
    if (entry.isDirectory()) publish(src, dst);
    else if (entry.isFile()) {
      const tmp = join(to, `.opencv-${process.pid}-${entry.name}`);
      copyFileSync(src, tmp);
      renameSync(tmp, dst);
    } else throw new Error(`Unexpected OpenCV install entry: ${src}`);
  }
}
publish(staged, install);
} finally { rmSync(work, { recursive: true, force: true }); }
