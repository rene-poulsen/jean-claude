// ffmpeg side of the pipeline.
//
// 1. SegmentWriter: while a page is recorded, each screenshot is piped
//    straight into ffmpeg and stored as a lossless RGB intermediate
//    (libx264rgb -qp 0). This keeps many GB of 4K PNGs off the disk.
// 2. finalize(): joins the segments (one per page) with xfade crossfades
//    and encodes the deliverables: ProRes 422 HQ .mov and/or H.264 .mp4,
//    converted RGB -> YUV with the bt709 matrix and tagged bt709, so
//    colours match the site in Premiere/DaVinci/After Effects.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG = process.env.FFMPEG || 'ffmpeg';

function run(args, { stdin = false } = {}) {
    const proc = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
        stdio: [stdin ? 'pipe' : 'ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d; });
    const done = new Promise((resolve, reject) => {
        proc.on('error', (e) => reject(new Error(`Could not start ffmpeg (${FFMPEG}): ${e.message}`)));
        proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}:\n${stderr}`))));
    });
    return { proc, done };
}

class SegmentWriter {
    constructor(file, { fps, imageFormat, framesDir }) {
        this.file = file;
        this.frames = 0;
        this.imageFormat = imageFormat;
        this.framesDir = framesDir;
        if (framesDir) fs.mkdirSync(framesDir, { recursive: true });
        const { proc, done } = run([
            '-f', 'image2pipe', '-framerate', String(fps),
            '-c:v', imageFormat === 'png' ? 'png' : 'mjpeg', '-i', 'pipe:0',
            '-c:v', 'libx264rgb', '-qp', '0', '-preset', 'ultrafast',
            file,
        ], { stdin: true });
        this.proc = proc;
        this.done = done;
        this.failed = null;
        done.catch((e) => { this.failed = e; });
    }

    async write(buf) {
        if (this.failed) throw this.failed;
        if (this.framesDir) {
            const ext = this.imageFormat === 'png' ? 'png' : 'jpg';
            fs.writeFileSync(path.join(this.framesDir, `f${String(this.frames).padStart(6, '0')}.${ext}`), buf);
        }
        this.frames++;
        if (!this.proc.stdin.write(buf)) {
            await new Promise((r) => this.proc.stdin.once('drain', r));
        }
    }

    async close() {
        this.proc.stdin.end();
        await this.done;
    }
}

const COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
// setparams stamps the colour description onto the frames themselves;
// the -color_* flags alone are overridden by the filtered frames' (unset) values.
const TO_YUV = 'scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,'
    + 'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv';

const OUTPUTS = {
    prores: () => ({
        ext: 'mov',
        filter: `${TO_YUV},format=yuv422p10le`,
        args: ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', ...COLOR_TAGS],
    }),
    mp4: (preview, codec) => codec === 'h265' && !preview ? {
        ext: 'mp4',
        filter: `${TO_YUV},format=yuv420p10le`,
        args: [
            '-c:v', 'libx265', '-preset', 'slow', '-crf', '14', '-profile:v', 'main10',
            '-x265-params', 'log-level=error', '-tag:v', 'hvc1', // hvc1: plays in QuickTime/Finder too
            '-movflags', '+faststart', ...COLOR_TAGS,
        ],
    } : {
        ext: 'mp4',
        filter: `${TO_YUV},format=yuv420p`,
        args: [
            '-c:v', 'libx264',
            '-preset', preview ? 'veryfast' : 'slow',
            '-crf', preview ? '18' : '12',
            '-profile:v', 'high', '-level:v', preview ? '4.2' : '5.2',
            '-movflags', '+faststart', ...COLOR_TAGS,
        ],
    },
};

// segments: [{ file, frames }], formats: ['prores', 'mp4']
async function finalize({ segments, fps, crossfade, outBase, formats, preview, codec = 'h264' }) {
    const inputs = segments.flatMap((s) => ['-i', s.file]);
    const graph = [];
    let last = '[0:v]';
    let elapsed = segments[0].frames / fps;
    if (crossfade <= 0 && segments.length > 1) {
        // Hard cuts.
        graph.push(`${segments.map((_, i) => `[${i}:v]`).join('')}concat=n=${segments.length}:v=1:a=0[cat]`);
        last = '[cat]';
        elapsed = segments.reduce((sum, s) => sum + s.frames / fps, 0);
    }
    for (let i = 1; crossfade > 0 && i < segments.length; i++) {
        const offset = elapsed - crossfade;
        const out = `[x${i}]`;
        graph.push(`${last}[${i}:v]xfade=transition=fade:duration=${crossfade}:offset=${offset.toFixed(4)}${out}`);
        last = out;
        elapsed = offset + segments[i].frames / fps;
    }
    const outs = formats.map((f) => OUTPUTS[f](preview, codec));
    if (outs.length === 1) {
        graph.push(`${last}${outs[0].filter}[o0]`);
    } else {
        graph.push(`${last}split=${outs.length}${outs.map((_, i) => `[s${i}]`).join('')}`);
        outs.forEach((o, i) => graph.push(`[s${i}]${o.filter}[o${i}]`));
    }

    const files = [];
    const args = [...inputs, '-filter_complex', graph.join(';')];
    outs.forEach((o, i) => {
        const file = `${outBase}.${o.ext}`;
        files.push(file);
        args.push('-map', `[o${i}]`, '-r', String(fps), ...o.args, file);
    });
    await run(args).done;
    return { files, seconds: elapsed };
}

module.exports = { SegmentWriter, finalize };
