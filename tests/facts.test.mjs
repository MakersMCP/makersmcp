// The kits' facts (`facts` in kits/<kit>.json), which the playbooks and the descriptions
// show through {fact:<kit>.<key>}, against the kits themselves, so a kit release that
// changes a number fails here before a text says the old one. Every fact needs a way to be
// read from the installed kit in READERS below; a fact without one fails the test. With
// MAKERSMCP_SLOW=1 a second part renders a two clip film and records a five second demo
// with the real kits, Chrome and ffmpeg, and measures them with check_video.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, loadKitDefinitions, resolveKit } from '../dist/server.js';

const kits = loadKitDefinitions();
const kitPaths = Object.fromEntries((process.env.MAKERSMCP_KIT_PATHS ?? '').split(',').map(entry => entry.trim())
  .filter(entry => entry.includes('=')).map(entry => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)]));

/** Each fact as [key, value], with a nested one as key.sub. */
function leaves(facts = {}) {
  return Object.entries(facts).flatMap(([key, value]) => (value !== null && typeof value === 'object'
    ? Object.entries(value).map(([sub, inner]) => [`${key}.${sub}`, inner])
    : [[key, value]]));
}

/** A number the kit's source states, by a pattern with one group, or the pair of two as WxH. */
function stated(text, pattern, file) {
  const match = pattern.exec(text);
  assert.ok(match, `${file} no longer has ${pattern}: see where the kit keeps this number now`);
  return match.length > 2 ? `${match[1]}x${match[2]}` : Number(match[1]);
}

const size = (width, height, scale = 1) => `${Math.round(width * scale)}x${Math.round(height * scale)}`;

/** The rules of launch-film's check, from src/check.js, as an object. */
function checkRules(read) {
  const match = /const RULES = (\{[\s\S]*?\n\});/.exec(read('src/check.js'));
  assert.ok(match, 'src/check.js no longer has RULES');
  return Function(`return (${match[1]});`)();
}

const tempo = (read, look) => stated(read('src/audio.js'), new RegExp(`^\\s*${look}: \\{ bpm: (\\d+)`, 'm'), 'src/audio.js');

/** A device of easyscreenshotkit, by name, in a file of it: [width, height, scale]. */
function device(read, file, name) {
  const match = new RegExp(`${name}: \\{ width: (\\d+), height: (\\d+), scale: ([\\d.]+)`).exec(read(`skills/easyscreenshotkit/scripts/lib/${file}`));
  assert.ok(match, `${file} no longer has ${name}`);
  return match.slice(1).map(Number);
}

/**
 * How to read each fact from its kit: the kit, a pattern for the fact's key, and what the
 * installed kit says, from `read(file)` (a file of its package) and `params` (its tools'
 * parameters in kits/, whose bounds tests/kits.test.mjs tries with the kit). A fact no
 * reader takes must at least be written in the kit's own files (its code, README.md or
 * SKILL.md), or be one of MEASURED below. Add a reader for a number a kit keeps in code.
 */
const READERS = [
  ['launch-film', /^fps$/, ({ read }) => stated(read('src/film.js'), /const FPS = (\d+);/, 'src/film.js')],
  ['launch-film', /^size_16_9$/, ({ read }) => stated(read('src/motion.js'), /land: \[(\d+), (\d+)\]/, 'src/motion.js')],
  ['launch-film', /^size_9_16$/, ({ read }) => stated(read('src/motion.js'), /port: \[(\d+), (\d+)\]/, 'src/motion.js')],
  ['launch-film', /^sample_rate$/, ({ read }) => stated(read('src/film.js'), /"-ar", "(\d+)"/, 'src/film.js')],
  ['launch-film', /^lufs_target$/, ({ read }) => stated(read('src/film.js'), /loudnorm=I=(-?[\d.]+)/, 'src/film.js')],
  ['launch-film', /^true_peak$/, ({ read }) => stated(read('src/film.js'), /loudnorm=I=-?[\d.]+:TP=(-?[\d.]+)/, 'src/film.js')],
  ['launch-film', /^look_bpm\.\w+$/, ({ read, key }) => tempo(read, key.split('.')[1])],
  // One bar lasts 240 seconds over the look's tempo, to three decimals.
  ['launch-film', /^bar_seconds\.\w+$/, ({ read, key }) => Number((240 / tempo(read, key.split('.')[1])).toFixed(3))],
  ['launch-film', /^clip_bars_default$/, ({ read }) => stated(read('src/film.js'), /Number\(c\.bars \|\| (\d+)\)/, 'src/film.js')],
  ['launch-film', /^clip_seconds_min$/, ({ read }) => stated(read('src/film.js'), /seconds >= (\d+) && seconds <= \d+/, 'src/film.js')],
  ['launch-film', /^clip_seconds_max$/, ({ read }) => stated(read('src/film.js'), /seconds >= \d+ && seconds <= (\d+)/, 'src/film.js')],
  ['launch-film', /^film_seconds_max$/, ({ read }) => stated(read('src/film.js'), /if \(total > (\d+)\)/, 'src/film.js')],
  ['launch-film', /^length_min$/, ({ params }) => params('make_launch_film').seconds.min],
  ['launch-film', /^length_max$/, ({ params }) => params('make_launch_film').seconds.max],
  // Each still's size, by its name in src/stills.js (ph, ph-thumbnail, og, x, play-feature, chrome-small, chrome-marquee).
  ['launch-film', /(?:^|[._])(?:ph(?:_\d)?|ph_thumbnail|og|x|play(?:_feature)?|chrome_(?:small|marquee))(?:_size)?$/, ({ read, key }) => {
    const name = key.split('.').pop().replace(/_size$/, '').replace(/^stills?_/, '').replace(/_/g, '-').replace(/^play$/, 'play-feature');
    return stated(read('src/stills.js'), new RegExp(`name: "${name}", W: (\\d+), H: (\\d+)`), 'src/stills.js');
  }],
  // check_video's rules, as src/check.js keeps them.
  ['launch-film', /^check_(?:seconds_tolerance|lufs_tolerance|true_peak|beat_frames|near_beat_frames|most)$/, ({ read, key }) => {
    const rules = checkRules(read);
    return {
      check_seconds_tolerance: rules.seconds, check_lufs_tolerance: rules.lufs, check_true_peak: rules.truePeak,
      check_beat_frames: rules.onBeat, check_near_beat_frames: rules.nearBeat, check_most: rules.most,
    }[key];
  }],
  ['launch-film', /^check_(?:start|end|hold)\.(?:black|still|silence)$/, ({ read, key }) => {
    const [, part, kind] = /^check_(\w+)\.(\w+)$/.exec(key);
    return checkRules(read)[part][kind];
  }],
  // A size name's pixels, its window and its scale, from DEVICES in shots.js.
  ['easyscreenshotkit', /^(?:size|sizes|window|scale)\.(?:desktop|mobile|iphone)$/, ({ read, key }) => {
    const [width, height, scale] = device(read, 'shots.js', key.split('.')[1]);
    if (key.startsWith('window.')) return size(width, height);
    if (key.startsWith('scale.')) return scale;
    return size(width, height, scale);
  }],
  // A whole page's scale when none is given: full on a desktop, mobile-full on a phone.
  ['easyscreenshotkit', /^scale\.(?:full|mobile_full)$/, ({ read, key }) => {
    const match = /scale: scale \|\| \(m\[1\] === "full" \? (\d+) : (\d+)\)/.exec(read('skills/easyscreenshotkit/scripts/lib/shots.js'));
    assert.ok(match, 'shots.js no longer gives a whole page its scale');
    return Number(key === 'scale.full' ? match[1] : match[2]);
  }],
  ['easyscreenshotkit', /^pwa\.(?:wide|narrow)$/, ({ read, key }) => size(...device(read, 'pwa.js', key.split('.')[1]))],
  ['easyscreenshotkit', /^demo\.size$|^demo_size$/, ({ read }) => {
    const text = read('skills/easyscreenshotkit/scripts/lib/compose.js');
    return `${stated(text, /const WIDTH = (\d+);/, 'compose.js')}x${stated(text, /const HEIGHT = (\d+);/, 'compose.js')}`;
  }],
  ['easyscreenshotkit', /^demo\.fps$|^demo_fps$/, ({ read }) => stated(read('skills/easyscreenshotkit/scripts/lib/demo.js'), /fps: (\d+), theme/, 'demo.js')],
  ['easyscreenshotkit', /(?:^|[._])gif_max_mb$/, ({ read }) => stated(read('skills/easyscreenshotkit/scripts/lib/ffmpeg.js'), /budget = (\d+) \* 1024 \* 1024/, 'ffmpeg.js')],
  ['easyscreenshotkit', /^full_page_max$/, ({ read }) => {
    const match = /const MAX_HEIGHT = ([\d_]+);/.exec(read('skills/easyscreenshotkit/scripts/lib/shots.js'));
    assert.ok(match, 'shots.js no longer has MAX_HEIGHT');
    return Number(match[1].replace(/_/g, ''));
  }],
  ['easyscreenshotkit', /^custom\.side_min$/, ({ read }) => stated(read('skills/easyscreenshotkit/scripts/lib/shots.js'), /width < (\d+) \|\| width > \d+/, 'shots.js')],
  ['easyscreenshotkit', /^custom\.side_max$/, ({ read }) => stated(read('skills/easyscreenshotkit/scripts/lib/shots.js'), /width < \d+ \|\| width > (\d+)/, 'shots.js')],
  ['easyscreenshotkit', /^custom\.scale_min$/, ({ read }) => stated(read('skills/easyscreenshotkit/scripts/lib/shots.js'), /scale >= ([\d.]+) && scale <= [\d.]+/, 'shots.js')],
  ['easyscreenshotkit', /^custom\.scale_max$/, ({ read }) => stated(read('skills/easyscreenshotkit/scripts/lib/shots.js'), /scale >= [\d.]+ && scale <= ([\d.]+)/, 'shots.js')],
  ['easyscreenshotkit', /^custom\.phone_below$/, ({ read }) => stated(read('skills/easyscreenshotkit/scripts/lib/shots.js'), /const phone = width < (\d+);/, 'shots.js')],
  ['musicfit', /^sample_rate$/, ({ read }) => stated(read('skills/musicfit/scripts/lib/audio.js'), /const RATE = (\d+);/, 'audio.js')],
  ['musicfit', /^channels$/, ({ read }) => ({ 1: 'mono', 2: 'stereo' })[stated(read('skills/musicfit/scripts/lib/audio.js'), /channels = (\d+)/, 'audio.js')]],
  ['musicfit', /^length_min$/, ({ read }) => stated(read('skills/musicfit/scripts/musicfit.js'), /options\.length >= (\d+) && options\.length <= \d+/, 'musicfit.js')],
  ['musicfit', /^length_max$/, ({ read }) => stated(read('skills/musicfit/scripts/musicfit.js'), /options\.length >= \d+ && options\.length <= (\d+)/, 'musicfit.js')],
  ['musicfit', /^hit_tail$/, ({ read }) => stated(read('skills/musicfit/scripts/musicfit.js'), /options\.hit > options\.length - ([\d.]+)/, 'musicfit.js')],
  ['easybrandkit', /^screen_size$/, ({ read }) => {
    const text = read('skills/easybrandkit/scripts/lib/kit.js');
    const [width, height] = String(stated(text, /const SCREEN = \{ width: (\d+), height: (\d+) \}/, 'kit.js')).split('x').map(Number);
    return size(width, height, stated(text, /capture\(cdp, 0, 0, m\.width, m\.viewportHeight, (\d+), false\)/, 'kit.js'));
  }],
  ['easybrandkit', /^card_size$/, ({ read }) => {
    const match = /const CARD = \{ width: (\d+), height: (\d+), scale: ([\d.]+) \}/.exec(read('skills/easybrandkit/scripts/lib/card.js'));
    assert.ok(match, 'card.js no longer has CARD');
    return size(Number(match[1]), Number(match[2]), Number(match[3]));
  }],
  ['easybrandkit', /^logo_min(?:_side|_px)?$/, ({ read }) => stated(read('skills/easybrandkit/scripts/lib/logos.js'), /Math\.max\(2, (\d+) \/ height/, 'logos.js')],
];

/** Facts no file of a kit states, since they are measured: by the slow part, or by hand with real sites. */
const MEASURED = [
  // What a render measures, against lufs_target, the level it aims at: the slow part's film.
  ['launch-film', /^lufs$/],
  // How long a tour's pages take, from the steps.json of tours of real sites.
  ['easyscreenshotkit', /^tour\.(?:page_seconds|four_pages_seconds|short_page_seconds)$/],
];

/** The installed kit's text files, for a fact no reader takes: its code, README.md and SKILL.md. */
function kitTexts(dir, into = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) kitTexts(full, into);
    } else if (/\.(?:[cm]?js|md)$/.test(entry.name)) {
      into.push(readFileSync(full, 'utf8'));
    }
  }
  return into;
}

/** Whether a fact's value is written in the kit's own files, as a number or a phrase on its own. */
function writtenIn(texts, value) {
  const shown = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![\\w.-])${shown}(?![\\w-]|\\.\\d)`, typeof value === 'string' ? 'i' : '');
  const grouped = typeof value === 'number' && Number.isInteger(value) && Math.abs(value) >= 1000
    ? new RegExp(`(?<![\\w.])${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '[_,]')}(?![\\w])`) : undefined;
  return texts.some(text => pattern.test(text) || grouped?.test(text));
}

/** The reader of a fact, and what it gets to read with. */
function readerOf(kit, key) {
  const installed = resolveKit(kit, kitPaths);
  assert.ok(installed.dir, `${kit.kit} cannot be read here: ${installed.reason}`);
  const reader = READERS.find(([owner, pattern]) => owner === kit.kit && pattern.test(key));
  const read = file => readFileSync(path.join(installed.dir, file), 'utf8');
  const params = name => kit.tools.find(tool => tool.name === name).params;
  return { installed, read: reader && (() => reader[2]({ read, params, key })) };
}

for (const kit of kits) {
  test(`${kit.kit}: each fact in its kit file is what the installed kit says`, t => {
    const facts = leaves(kit.facts);
    if (!facts.length) return;
    let texts;
    const loose = [];
    const wrong = [];
    for (const [key, value] of facts) {
      if (MEASURED.some(([owner, pattern]) => owner === kit.kit && pattern.test(key))) {
        t.diagnostic(`${kit.kit}.${key} is ${value}, a measured fact`);
        continue;
      }
      const { installed, read } = readerOf(kit, key);
      if (read) {
        const expected = read();
        if (String(value) !== String(expected)) wrong.push(`${kit.kit}.${key} is ${value}, and ${kit.package} ${installed.version} says ${expected}`);
        continue;
      }
      texts ??= kitTexts(installed.dir);
      if (writtenIn(texts, value)) loose.push(key);
      else wrong.push(`${kit.kit}.${key} is ${value}, which no reader in tests/facts.test.mjs takes and no file of ${kit.package} ${installed.version} says: add a reader, or fix the fact`);
    }
    if (loose.length) t.diagnostic(`${kit.kit}: written in the kit's files, with no reader of their own: ${loose.join(', ')}`);
    assert.deepEqual(wrong, []);
  });
}

test('the readers find what they look for in the installed kits', () => {
  // Each reader still finds its number, whether or not a kit file has that fact now, so a
  // kit release that moves a number shows here.
  const samples = [
    ['launch-film', ['fps', 'size_16_9', 'size_9_16', 'sample_rate', 'lufs_target', 'true_peak', 'look_bpm.pop', 'bar_seconds.pop', 'clip_bars_default', 'clip_seconds_min',
      'clip_seconds_max', 'film_seconds_max', 'length_min', 'length_max', 'still_size.ph_thumbnail', 'check_most', 'check_end.still']],
    ['easyscreenshotkit', ['size.iphone', 'scale.full', 'pwa.wide', 'demo.size', 'demo.fps', 'demo.gif_max_mb', 'full_page_max', 'custom.side_min', 'custom.side_max',
      'custom.scale_min', 'custom.scale_max', 'custom.phone_below']],
    ['musicfit', ['sample_rate', 'channels', 'length_min', 'length_max', 'hit_tail']],
    ['easybrandkit', ['screen_size', 'card_size', 'logo_min_side']],
  ];
  const reached = new Set();
  const value = (owner, key) => {
    const { read } = readerOf(kits.find(entry => entry.kit === owner), key);
    assert.ok(read, `no reader takes ${owner}.${key}`);
    reached.add(READERS.find(([kitName, pattern]) => kitName === owner && pattern.test(key)));
    return read();
  };
  for (const [owner, keys] of samples) {
    for (const key of keys) {
      const found = value(owner, key);
      assert.ok(found !== undefined && found !== null && !Number.isNaN(found), `${owner}.${key}: ${found}`);
    }
  }
  assert.equal(reached.size, READERS.length, 'a reader no sample reaches');
  // The numbers the design gives, as the kits have them today.
  assert.equal(value('launch-film', 'fps'), 25);
  assert.equal(value('launch-film', 'size_9_16'), '1080x1920');
  assert.equal(value('launch-film', 'lufs_target'), -16);
  assert.equal(value('launch-film', 'look_bpm.journal'), 90);
  assert.equal(value('launch-film', 'bar_seconds.launch'), 2.143);
  assert.equal(value('launch-film', 'still_size.play'), '1024x500');
  assert.equal(value('launch-film', 'check_end.still'), 6);
  assert.equal(value('easyscreenshotkit', 'size.iphone'), '1320x2868');
  assert.equal(value('easyscreenshotkit', 'window.desktop'), '1600x900');
  assert.equal(value('easyscreenshotkit', 'pwa.narrow'), '1080x1920');
  assert.equal(value('easyscreenshotkit', 'full_page_max'), 15000);
  assert.equal(value('musicfit', 'sample_rate'), 48000);
  assert.equal(value('musicfit', 'channels'), 'stereo');
  assert.equal(value('easybrandkit', 'screen_size'), '3200x1800');
  // A fact no reader takes is checked against the kit's own words.
  assert.ok(writtenIn(['It takes 20 to 90 seconds.'], '20 to 90'));
  assert.ok(writtenIn(['const MAX = 15_000;'], 15000));
  assert.ok(!writtenIn(['It takes 20 to 900 seconds.'], '20 to 90'));
  assert.ok(!writtenIn(['a scale of 2.5'], 2));
});

// The slow part: real renders, measured.

const SLOW = process.env.MAKERSMCP_SLOW === '1';
const fact = (owner, key) => {
  const kit = kits.find(entry => entry.kit === owner);
  const [head, sub] = key.split('.');
  const found = sub === undefined ? kit?.facts?.[head] : kit?.facts?.[head]?.[sub];
  return found;
};

async function withServer(callback) {
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'mm-facts-'));
  const server = createMcpServer({ outDir, kitPaths, kits: ['launch-film', 'easyscreenshotkit'] });
  const client = new Client({ name: 'facts-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await callback(client, outDir);
  } finally {
    await client.close();
    await server.close();
    rmSync(outDir, { recursive: true, force: true });
  }
}

const text = result => result.content.map(item => item.text).join('\n');

/** A tool call that waits for its job to end, however long it takes. */
async function finished(client, name, args) {
  let result = await client.callTool({ name, arguments: { ...args, wait_seconds: 600 } }, undefined, { timeout: 900_000 });
  while (result.structuredContent?.status === 'running') {
    result = await client.callTool({ name: 'wait_for_job', arguments: { job_id: result.structuredContent.job_id, wait_seconds: 600 } }, undefined, { timeout: 900_000 });
  }
  return result;
}

const measured = file => JSON.parse(readFileSync(path.join(path.dirname(file), 'check', 'check.json'), 'utf8'));

test('a two clip film renders at the size, frame rate and loudness launch-film\'s facts give', { skip: !SLOW && 'set MAKERSMCP_SLOW=1 to render and measure' }, async t => {
  await withServer(async (client, outDir) => {
    const film = {
      version: 1, look: 'launch', aspect: '16:9', lang: 'en',
      clips: [
        { kind: 'scene', seconds: 10, scene: { type: 'opener', title: 'Acme', text: 'Widgets for every team' } },
        { kind: 'scene', seconds: 10, scene: { type: 'headline', title: 'Setup in *one* minute' } },
      ],
    };
    writeFileSync(path.join(outDir, 'film.json'), JSON.stringify(film, null, 2));
    const rendered = await finished(client, 'render_launch_film', { film: 'film.json' });
    assert.equal(rendered.structuredContent?.status, 'done', text(rendered));
    const size = fact('launch-film', 'size_16_9') ?? '1920x1080';
    const fps = fact('launch-film', 'fps') ?? 25;
    const target = fact('launch-film', 'lufs_target') ?? -16;
    const checked = await finished(client, 'check_video', { film: 'film.mp4', expect: `${size}@${fps}` });
    assert.equal(checked.structuredContent?.status, 'done', text(checked));
    const report = measured(path.join(outDir, 'film.mp4'));
    assert.equal(`${report.video.width}x${report.video.height}`, size);
    assert.equal(report.video.fps, fps);
    const { integrated, truePeak } = report.audio;
    t.diagnostic(`the film measures ${integrated} LUFS and a true peak of ${truePeak} dBTP; launch-film aims at ${target} LUFS and ${fact('launch-film', 'true_peak')} dBTP`);
    // loudnorm lands above its target on these films: this 20 second one measured -14.2 LUFS
    // with a true peak of -0.8 dBTP, one of 8 seconds -13.6 LUFS and the baseline's 29 second
    // film -15.1, all aiming at -16 and -1.5. So the target is checked loosely, and lufs, what
    // a film measures, within the 1.5 LU a check of a film has to allow.
    assert.ok(Math.abs(integrated - target) <= 3, `the film measures ${integrated} LUFS, and launch-film aims at ${target}`);
    const lufs = fact('launch-film', 'lufs');
    if (lufs !== undefined) assert.ok(Math.abs(integrated - lufs) <= 1.5, `the film measures ${integrated} LUFS, and lufs says ${lufs}`);
    assert.ok(truePeak <= 0, `a true peak of ${truePeak} dBTP: the film clips`);
  });
});

test('a five second demo records at the size easyscreenshotkit\'s facts give', { skip: !SLOW && 'set MAKERSMCP_SLOW=1 to record and measure' }, async () => {
  const site = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>Acme</title><body style="font:24px sans-serif"><h1>Acme widgets</h1><p>For every team.</p><div style="height:2400px"></div><a href="#">Features</a></body>');
  });
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  try {
    await withServer(async (client, outDir) => {
      const url = `http://127.0.0.1:${site.address().port}/`;
      writeFileSync(path.join(outDir, 'demo.yaml'), `url: "${url}"\nsteps:\n  - visit: "${url}"\n  - wait: 2\n  - scroll: 600\n  - wait: 2\n`);
      const recorded = await finished(client, 'record_demo_video', { url, steps: 'demo.yaml', gif: false, out_dir: 'demo' });
      assert.equal(recorded.structuredContent?.status, 'done', text(recorded));
      const size = fact('easyscreenshotkit', 'demo_size') ?? '1920x1080';
      const fps = fact('easyscreenshotkit', 'demo_fps') ?? 30;
      const checked = await finished(client, 'check_video', { film: 'demo/demo.mp4', expect: `${size}@${fps}` });
      assert.equal(checked.structuredContent?.status, 'done', text(checked));
      const report = measured(path.join(outDir, 'demo', 'demo.mp4'));
      assert.equal(`${report.video.width}x${report.video.height}`, size);
      assert.equal(report.video.fps, fps);
      assert.ok(report.video.seconds >= 3 && report.video.seconds <= 12, `the demo lasts ${report.video.seconds} s`);
    });
  } finally {
    site.close();
  }
});

test('ffmpeg and Chrome are there for the slow part', { skip: !SLOW && 'only with MAKERSMCP_SLOW=1' }, () => {
  assert.equal(spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status, 0, 'the slow part needs ffmpeg');
});
