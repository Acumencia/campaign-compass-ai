# Recording method

The demo is a **continuous Playwright screen recording of real Chrome interactions with the running local app**. It captures an isolated browser context with only synthetic campaign data. It does not capture the desktop, notifications, unrelated tabs or personal accounts. Screenshots are not stitched into the video, and no generated imagery replaces application frames.

The voiceover uses the installed **Microsoft Zira Desktop synthetic voice**, disclosed in the opening narration. It is not the user's voice. Narration is timed to the recorded steps, then mixed into an MP4. A WebVTT transcript is supplied. The actual recorded duration is stored in `recording-timeline.json` and must remain under 300 seconds.

To reproduce on Windows with Node, installed Chrome and FFmpeg:

1. `npm ci --ignore-scripts` and `npm start`.
2. Run `npm run check` and save its actual output to `evidence/test-results.txt`.
3. Run `powershell -File scripts/prepare-demo.ps1`, then `python scripts/narration-timing.py`.
4. Run `node scripts/record-demo.mjs`. Playwright's video encoder must be installed (`npx playwright install ffmpeg` if needed).
5. Run `python scripts/mux-demo.py --ffmpeg <path-to-full-ffmpeg>`.

The bundled Playwright encoder may support only VP8. Mixing narration requires a full FFmpeg build with H.264/AAC. For this build, a task-local `imageio-ffmpeg` package supplied the encoder; no global installation, paid service or new credential was needed.

The development-evidence page shown near the end is generated from the real initial request, actual test log and recorded iterations. It is shown as a current evidence page, not as a reconstruction of earlier development screenshots.

Actual completed recording: 213.0 seconds (3 minutes 33 seconds), 1440 x 1000 pixels. The MP4, WebVTT transcript and raw WebM are local submission artifacts; binary video is excluded from Git history.
