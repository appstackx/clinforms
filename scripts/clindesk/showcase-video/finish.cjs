// Sound, encodes and side files: narration placed per paragraph and levelled to -16 LUFS (two-pass linear loudnorm),
// master 1920x1080 + e-mail 1280x720 (size-capped), SRT, chapters (text + embedded), poster.
//   node finish.cjs [--audio-only] [--preview]   (preview: fast 720p encode to work/mix/preview.mp4)
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const SRC = path.resolve(__dirname, "..");
const OUT = path.resolve(SRC, "../showcase-video-v1");
const MIX = path.join(SRC, "work/mix");
fs.mkdirSync(MIX, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const TL = JSON.parse(fs.readFileSync(path.join(SRC, "work/timeline.json"), "utf8"));
const has = (f) => process.argv.includes(f);
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-y", ...args], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 }).toString();
const ffErr = (args) => { const r = require("child_process").spawnSync("ffmpeg", ["-hide_banner", "-y", ...args], { maxBuffer: 1 << 28 }); if (r.status !== 0) throw new Error(String(r.stderr).slice(-2000)); return String(r.stderr); };
const fmt = (s) => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), x = Math.floor((ms % 60000) / 1000), r = ms % 1000; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")},${String(r).padStart(3, "0")}`; };
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const NAME = "ClinDesk-showcase";

/* ---- narration ---- */
const raw = path.join(MIX, "voice-raw.wav");
{
  const args = [];
  const parts = [];
  TL.audio.forEach((a, i) => {
    args.push("-i", path.join(SRC, a.file));
    const d = a.out - a.in;
    parts.push(`[${i}:a]atrim=${a.in}:${a.out},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=mono,afade=t=in:d=0.012,afade=t=out:st=${(d - 0.04).toFixed(3)}:d=0.04,adelay=${Math.round(a.at * 1000)}:all=1[a${i}]`);
  });
  const mix = `${parts.join(";")};${TL.audio.map((_, i) => `[a${i}]`).join("")}amix=inputs=${TL.audio.length}:normalize=0:dropout_transition=0,apad=whole_dur=${TL.dur},atrim=0:${TL.dur}[m]`;
  ff([...args, "-filter_complex", mix, "-map", "[m]", "-ar", "48000", "-ac", "1", raw]);
}
// two-pass loudnorm, linear
const voice = path.join(MIX, "voice.wav");
{
  const pre = "acompressor=threshold=-24dB:ratio=2:attack=8:release=120:makeup=2,alimiter=limit=0.89:attack=4:release=60";
  const s = ffErr(["-i", raw, "-af", `${pre},loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json`, "-f", "null", "-"]);
  const j = JSON.parse(s.slice(s.lastIndexOf("{"), s.lastIndexOf("}") + 1));
  let gain = -16 - parseFloat(j.input_i), j2 = null;
  for (let k = 0; k < 3; k++) {
    const chain = `${pre},volume=${gain.toFixed(2)}dB,alimiter=limit=0.84:attack=3:release=50:level=false`;
    ffErr(["-i", raw, "-af", chain, "-ar", "48000", "-ac", "2", voice]);
    const m = ffErr(["-i", voice, "-af", "loudnorm=I=-16:TP=-1.5:print_format=json", "-f", "null", "-"]);
    j2 = JSON.parse(m.slice(m.lastIndexOf("{"), m.lastIndexOf("}") + 1));
    j2.output_i = j2.input_i; j2.output_tp = j2.input_tp;
    if (Math.abs(parseFloat(j2.input_i) + 16) < 0.3) break;
    gain += -16 - parseFloat(j2.input_i);
  }
  fs.writeFileSync(path.join(MIX, "loudnorm.json"), JSON.stringify({ pass1: j, final: j2, gainDb: gain }, null, 1));
  console.log("narration levelled:", j2.output_i, "LUFS, TP", j2.output_tp);
}
if (has("--audio-only")) process.exit(0);

/* ---- side files ---- */
const srt = TL.srt.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}\n`).join("\n");
fs.writeFileSync(path.join(OUT, `${NAME}.srt`), srt);
const chapTxt = TL.chapters.map((c) => `${mmss(c.start)} ${c.title}`).join("\n") + "\n";
fs.writeFileSync(path.join(OUT, "chapters.txt"), chapTxt);
const meta = [";FFMETADATA1", "title=ClinDesk – a day at Pebblegate Physio (fictional)", "artist=ClinDesk", "comment=Product showcase. Sample data is fictional. clindesk.co.uk", ""];
TL.chapters.forEach((c) => meta.push("[CHAPTER]", "TIMEBASE=1/1000", `START=${Math.round(c.start * 1000)}`, `END=${Math.round(c.end * 1000)}`, `title=${c.title}`, ""));
const metaFile = path.join(MIX, "meta.txt");
fs.writeFileSync(metaFile, meta.join("\n"));

const frames = path.join(SRC, "work/frames/%05d.jpg");
if (has("--preview")) {
  ff(["-framerate", "30", "-i", frames, "-i", voice, "-vf", "scale=1280:720", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest", path.join(MIX, "preview.mp4")]);
  console.log("preview written");
  process.exit(0);
}
const common = ["-map_metadata", "2", "-map_chapters", "2", "-metadata:s:v", "handler_name=", "-metadata:s:a", "handler_name=", "-movflags", "+faststart"];
const vcol = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
const master = path.join(OUT, `${NAME}.mp4`);
ff(["-framerate", "30", "-i", frames, "-i", voice, "-f", "ffmetadata", "-i", metaFile,
  "-map", "0:v", "-map", "1:a", "-vf", "scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p",
  "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high", "-level", "4.1", "-x264-params", "ref=4", ...vcol,
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", ...common, master]);
let crf = 24, email = path.join(OUT, `${NAME}-email.mp4`);
for (;;) {
  ff(["-framerate", "30", "-i", frames, "-i", voice, "-f", "ffmetadata", "-i", metaFile,
    "-map", "0:v", "-map", "1:a", "-vf", "scale=1280:720:flags=lanczos:in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-profile:v", "high", "-level", "4.0", "-x264-params", "ref=4", ...vcol,
    "-c:a", "aac", "-b:a", "96k", "-ac", "1", "-ar", "48000", "-shortest", ...common, email]);
  const mb = fs.statSync(email).size / 1e6;
  console.log(`email crf ${crf}: ${mb.toFixed(1)} MB`);
  if (mb <= 13.5 || crf >= 32) break;
  crf += 2;
}
for (const f of [master, email]) console.log(path.basename(f), (fs.statSync(f).size / 1e6).toFixed(1), "MB");
