import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
test('main contains manual synchronization and cache contracts without the automatic estimator', () => {
  const workspace = source('src/video/VideoWorkspace.tsx');
  assert.match(workspace, />Sync Here</);
  assert.match(workspace, />Add segment here</);
  assert.match(workspace, /createHtmlPlayer/);
  assert.match(workspace, /resolveCachedYouTubeVideo/);
  assert.match(source('src/App.tsx'), /useVideoSync\(/);
  assert.doesNotMatch(workspace, /startVideoSync|Estimate sync|Automatic sync estimate/);
  assert.doesNotMatch(source('src/bridge.ts'), /start_video_sync|video_sync_status|cancel_video_sync/);
  assert.doesNotMatch(source('src-tauri/src/lib.rs'), /video_sync/);
  assert.doesNotMatch(source('src-tauri/build.rs'), /opencv|apex_motion|motion\.cpp/);
  for (const path of ['src-tauri/src/video_sync', 'src-tauri/src/video_analysis/motion.rs', 'src-tauri/src/video_analysis/motion.cpp']) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, `${path} belongs on feature/auto-video-sync`);
  }
});
