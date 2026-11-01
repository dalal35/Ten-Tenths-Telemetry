import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('provisioning ignores modified or incomplete cached source', { skip: process.platform !== 'darwin' || process.arch !== 'arm64' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'opencv-provision-test-'));
  try {
    const root = join(dir, '.tools/opencv-4.13.0');
    mkdirSync(join(root, 'opencv-4.13.0'), { recursive: true });
    copyFileSync(resolve('.tools/opencv-4.13.0/opencv.tar.gz'), join(root, 'opencv.tar.gz'));
    writeFileSync(join(root, 'opencv-4.13.0/CMakeLists.txt'), 'tampered');
    mkdirSync(join(root, 'install/lib'), { recursive: true });
    writeFileSync(join(root, 'install/lib/existing.a'), 'in use');
    const bin = join(dir, 'bin'); mkdirSync(bin);
    writeFileSync(join(bin, 'cmake'), `#!/bin/sh\nif [ "$1" = "-S" ]; then\n  [ -f "$2/CMakeLists.txt" ] || exit 1\n  grep -q OpenCV "$2/CMakeLists.txt" || exit 1\n  for arg in "$@"; do case "$arg" in -DCMAKE_INSTALL_PREFIX=*) mkdir -p "\${arg#*=}";; esac; done\nfi\nexit 0\n`, { mode: 0o755 });
    const result = spawnSync(process.execPath, [resolve('scripts/prepare-opencv.mjs')], { cwd: dir, env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(root, 'opencv-4.13.0/CMakeLists.txt'), 'utf8'), 'tampered');
    assert.equal(readFileSync(join(root, 'install/lib/existing.a'), 'utf8'), 'in use');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
