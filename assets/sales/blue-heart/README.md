# Blue Heart Clinics demo video (sent to Dell Baines, 9 Oct 2026)

This is the customer demo video for Dell Baines at Blue Heart Clinics. It was recorded before the product was renamed, so the screens and file names say "AppStackX Reports" rather than ClinForms.

| File | What it is |
|---|---|
| `AppStackX-Reports-demo-Blue-Heart-Clinics-voiceover-v2.mp4` | Final voiced video: 6:15 (375.27 s), 1600×900, H.264, 17.7 MB. It is under the Gmail attachment limit, and this is the version to send. |
| `AppStackX-Reports-demo-Blue-Heart-Clinics.srt` | Captions. Each voice-over line starts at its caption's start time. |
| `narration-script.md` | Narration script, with Dell's questions mapped to scenes. |
| `voiceover/` | Scripts used to build the voice-over (see below). |

Rules for this and any future customer video:
- Never mention AI, Claude or any model name.
- Answer the customer's email point by point.
- Use fictional data only.
- Label the simulated TM3 "Simulated TM3 sandbox – demo data, not affiliated with TM3".

## Voice-over build (one-off scripts)
- **Voice:** ElevenLabs `eleven_v4`, voice "Beth" (`utezIGbCLSGO3Z7oKJwL`), one generation per line. The 48 lines are in `segments.json`, and `placement.json` holds the final timings.
- **Placement:** each clip had its leading and trailing silence trimmed. It was then sped up by at most 1.22× and placed on its SRT caption start, starting no more than 0.5 s early. The clips were mixed over the silent video and loudness-normalised to -16 LUFS.
- **Running the scripts again:** they hard-code paths from the cloud container (`/tmp/claude-0/.../scratchpad/vo`), so edit the `V`/`S` variables first. `build.py` takes the old scratchpad root as `argv[1]`.
- **Not kept:** the clip MP3s and the 56 MB 1920×1080 `master.mp4` stayed in the container. To re-dub, re-record the video with `scripts/medreport/video/record-demo.mjs` and regenerate the clips.
