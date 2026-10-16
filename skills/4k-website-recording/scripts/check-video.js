#!/usr/bin/env node
// Usage: node check-video.js <video.mp4|.mov>
//
// Verifies a render instead of trusting it:
//   - specs: resolution, fps, codec, pixel format, bt709 colour tags
//   - frozen frames in the middle of motion (a stutter)
//   - single-frame jumps (a hitch; can also be a legitimate cut inside an
//     embedded video, so look at the strip before deciding)
//   - blank frames (a uniform colour: a capture or loading failure)
// Writes <name>-contact.png (12 frames across the video) and, for each
// flagged spot, <name>-flag-<frame>.png (the frames around it) next to the
// video. Look at those images; the numbers alone have missed problems before.
//
// Values are parsed with Number(): ffmpeg prints tiny values in scientific
// notation, which awk misreads (9.97e-05 -> 9.97).
const { execFileSync } = require('child_process');

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const file = process.argv[2];
if (!file) {
    console.log('Usage: node check-video.js <video>');
    process.exit(1);
}
const base = file.replace(/\.[^.]+$/, '');
const run = (bin, a) => execFileSync(bin, a, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });

// Per-frame signalstats values for `key`, optionally after a filter.
function perFrame(filter, keys) {
    const out = run(FFMPEG, ['-v', 'error', '-i', file, '-vf', `${filter}signalstats,metadata=print:file=-`, '-f', 'null', '-']);
    const rows = [];
    let row = null;
    for (const line of out.split(/\r?\n/)) {
        if (line.startsWith('frame:')) { row = {}; rows.push(row); continue; }
        const m = line.match(/^lavfi\.signalstats\.(\w+)=(\S+)/);
        if (m && row && keys.includes(m[1])) row[m[1]] = Number(m[2]);
    }
    return rows;
}

const probe = JSON.parse(run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,color_space,color_transfer,color_primaries,nb_frames,bit_rate:format=duration,size',
    '-of', 'json', file]));
const st = probe.streams[0];
const [fn, fd] = st.r_frame_rate.split('/').map(Number);
const fps = fn / fd;

const diff = perFrame('tblend=all_mode=difference,', ['YAVG']).map((r) => r.YAVG);
const lum = perFrame('', ['YMIN', 'YMAX']);

// diff[i] compares frame i and i+1. "Moving" = clearly above encoder noise
// (a static page's grain refresh is ~0.002). Sub-pixel steps at the very
// start/end of an eased scroll alternate between ~0 and small values; they
// are invisible, so a frozen frame only counts when both neighbours move.
const MOVING = 0.5;
const FROZEN = 0.01;
// Both checks need steady motion on both sides (3 frames each way): that
// excludes the isolated one-pixel steps of a nearly-stopped eased scroll.
const W = 3;
const steady = (from, to) => diff.slice(Math.max(0, from), to).every((d) => d > MOVING);
const frozen = [];
const jumps = [];
for (let i = W; i < diff.length - W; i++) {
    const around = steady(i - W, i) && steady(i + 1, i + 1 + W);
    if (!around) continue;
    if (diff[i] < FROZEN) frozen.push(i + 1);
    if (diff[i] > 3 * Math.max(diff[i - 1], diff[i + 1])) jumps.push(i + 1);
}
const blank = lum.map((r, i) => (r.YMAX - r.YMIN < 8 ? i : -1)).filter((i) => i >= 0);

// Contact sheet + strips around flagged frames.
const total = lum.length;
const picks = Array.from({ length: 12 }, (_, k) => Math.round(((total - 1) * k) / 11));
const sel = (ns) => ns.map((n) => `eq(n\\,${n})`).join('+');
run(FFMPEG, ['-v', 'error', '-y', '-i', file, '-vf', `select='${sel(picks)}',scale=640:-1,tile=4x3`, '-frames:v', '1', `${base}-contact.png`]);
const flagged = [...new Set([...frozen, ...jumps, ...blank])].sort((a, b) => a - b);
const strips = [];
for (const f of flagged.slice(0, 6)) {
    const out = `${base}-flag-${f}.png`;
    run(FFMPEG, ['-v', 'error', '-y', '-i', file, '-vf', `select='between(n\\,${Math.max(0, f - 2)}\\,${f + 1})',scale=960:-1,tile=2x2`, '-frames:v', '1', out]);
    strips.push(out);
}

const tags = [st.color_space, st.color_transfer, st.color_primaries];
const problems = [];
if (st.width < 3840 && !/preview/.test(file)) problems.push(`resolution is ${st.width}x${st.height}, not 3840x2160`);
if (tags.some((t) => t !== 'bt709')) problems.push(`colour tags are ${tags.join('/')}, expected bt709/bt709/bt709`);
if (blank.length) problems.push(`${blank.length} blank (uniform colour) frame(s): ${blank.slice(0, 10).join(', ')}`);
if (frozen.length) problems.push(`${frozen.length} frozen frame(s) during motion: ${frozen.slice(0, 10).join(', ')}`);
if (jumps.length) problems.push(`${jumps.length} single-frame jump(s): ${jumps.slice(0, 10).join(', ')} (a cut inside an embedded video is fine)`);

const mbps = st.bit_rate ? (st.bit_rate / 1e6).toFixed(1) : '?';
console.log(`${file}`);
console.log(`  ${st.codec_name} ${st.profile || ''} ${st.width}x${st.height} @ ${fps}fps, ${st.pix_fmt}, ${tags.join('/')}`);
console.log(`  ${total} frames, ${Number(probe.format.duration).toFixed(2)}s, ${(probe.format.size / 1e6).toFixed(1)} MB, ${mbps} Mbps`);
console.log(problems.length ? `  CHECK:\n    - ${problems.join('\n    - ')}` : '  OK: no blank, frozen or jumping frames');
console.log(`  contact sheet: ${base}-contact.png`);
for (const s of strips) console.log(`  flagged: ${s}`);
