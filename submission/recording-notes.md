# Refreshed demo recording — 12 October 2026

The current demo is a continuous Playwright video of real interactions with the running app in an isolated Chrome profile. Application commit: `6977f67c6a3878e78000424e6d1039cdc7c016d9`. The later publication updates recording assets and documentation only. It shows the dashboard, shared filters, campaign search, time series, the CPA glossary, grounded deterministic answers, reviewed budget scenarios and disconnected ChatGPT controls.

The last two evidence scenes show the actual request, published source excerpt and saved exact-commit test output. They are explicitly labelled current saved evidence, not a live terminal or reconstructed development session. No still images replace application frames. No desktop, notifications, unrelated tabs or account details are captured. External browser traffic and authentication routes are blocked during recording.

Microsoft Zira Desktop supplies the disclosed synthetic narration; this is not the user's voice. The encoded MP4 is **260.80 seconds**, below five minutes, with H.264 video and AAC audio at 1440 × 1000. `campaign-compass-demo.vtt` provides a transcript. Audio, decoded video and isolated-browser playback were checked; `evidence/refreshed-video-qa.json` records the results.

Live AI is blocked by organization policy. The video does not start authorization or claim successful live inference. The current application milestone passed 94 automated tests and 35 browser checks; OAuth and provider tests use synthetic mocks.

The original 213.22-second take at `c5dee6f908ff60f4d812bf28b81419624b42e260` is preserved separately in the submission bundle under `original-recording/`. Its SHA-256 is `a63c70f696fe85cf87788fb80a0b60df6051165a238e4c73897b273b730e5be2`. It remains historical evidence, while the refreshed video is the current submission asset.

## Reproduce

1. Install Node, Python, Chrome and a full FFmpeg build with H.264/AAC. Run `npm ci --ignore-scripts` and `npm start`.
2. Verify source with `npm run check` and the browser commands in README. The committed evidence HTML is a fixed, explicitly labelled 6977f67 milestone. Update its source/test excerpts and narration only from actual newer evidence when changing the app.
3. Run `powershell -File scripts/prepare-demo.ps1`, then `python scripts/narration-timing.py`.
4. Ensure Playwright's video encoder is available (`npx playwright install ffmpeg`). Optionally set `DEMO_PREFLIGHT=1` for a short interaction rehearsal; unset it before recording.
5. Run `node scripts/record-demo.mjs`. It refuses to record saved account entries and never clicks Continue with ChatGPT.
6. Run `python scripts/mux-demo.py --ffmpeg <full-ffmpeg-path>`. Check duration, audio, playback and privacy before delivery. Raw WebM and WAV intermediates remain local and are excluded from Git.

One attempted take stopped when Escape cleared the glossary search without closing the modal. The recorder now uses the explicit Close buttons; a full fourteen-step rehearsal passed before the continuous take. That unsuccessful recording is not a submission asset.
