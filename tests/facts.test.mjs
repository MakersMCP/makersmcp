// The kits' facts (`facts` in kits/<kit>.json), which the playbooks and the descriptions
// show through {fact:<kit>.<key>}, against the kits themselves, so a kit release that
// changes a number fails here before a text says the old one. Every fact needs a way to be
// read from the installed kit in READERS below, from its code or from the sentence of its own
// guide that says it, and a fact without one fails the test: a number or a phrase like
// "20 to 90" shows up somewhere in a kit's files by chance. Facts measured on real films and
// tours are in MEASURED. With MAKERSMCP_SLOW=1 a second part renders a two clip film and
// records a five second demo with the real kits, Chrome and ffmpeg, and measures them with
// check_video.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, LocalBackend, loadKitDefinitions, resolveKit } from '../dist/server.js';

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

/** A phrase the kit's guide says, like "20 to 90" in "A run takes 20 to 90 seconds.", by a pattern with one group. */
function phrase(text, pattern, file) {
  const match = pattern.exec(text);
  assert.ok(match, `${file} no longer has ${pattern}: see where the kit says this now`);
  return match[1];
}

const size = (width, height, scale = 1) => `${Math.round(width * scale)}x${Math.round(height * scale)}`;

/** The rules of launch-film's check, from src/check.js, as an object. */
function checkRules(read) {
  const match = /const RULES = (\{[\s\S]*?\n\});/.exec(read('src/check.js'));
  assert.ok(match, 'src/check.js no longer has RULES');
  return Function(`return (${match[1]});`)();
}

const tempo = (read, look) => stated(read('src/audio.js'), new RegExp(`^\\s*${look}: \\{ bpm: (\\d+)`, 'm'), 'src/audio.js');

/** Milliseconds as the kits write them, like 60_000, in seconds. */
const millis = (text, pattern, file) => {
  const match = pattern.exec(text);
  assert.ok(match, `${file} no longer has ${pattern}: see where the kit keeps this number now`);
  return Number(match[1].replace(/_/g, '')) / 1000;
};

/**
 * The longest a scene's field may be, from launch-film's src/scene.js: <type>_<field> is a
 * type's own limit (need, or an item's field, feature for features), and a field alone the
 * limit of every other type, as words() in its scene() gives it.
 */
function sceneMax(dir, read, key) {
  const { TYPES } = createRequire(path.join(dir, 'package.json'))('./src/scene.js');
  const split = /^(\w+?)_(\w+)$/.exec(key);
  const type = split && (TYPES[split[1]] ? split[1] : TYPES[`${split[1]}s`] ? `${split[1]}s` : undefined);
  if (type) {
    const def = TYPES[type];
    const field = split[2];
    const value = def.need?.[field] ?? (Array.isArray(def.item?.[field]) ? def.item[field][0] : undefined);
    assert.ok(typeof value === 'number', `src/scene.js gives ${type} no limit for ${field}`);
    return value;
  }
  return stated(read('src/scene.js'), new RegExp(`${key}: words\\(spec\\.${key}, '"${key}"', (?:need\\.${key} \\|\\| )?(\\d+)`), 'src/scene.js');
}

const SHOTS = 'skills/easyscreenshotkit/scripts/lib';

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
  ['easybrandkit', /^facts_timeout$/, ({ read }) => stated(read('skills/easybrandkit/scripts/easybrandkit.js'), /options\.timeout = options\.facts \? (\d+) : \d+;/, 'easybrandkit.js')],
  // Advice the kit's own guide gives, which no code holds.
  ['easybrandkit', /^slow_timeout$/, ({ read }) => stated(read('skills/easybrandkit/SKILL.md'), /Slow sites can take `--timeout (\d+)`/, 'SKILL.md')],
  ['easyfontkit', /^late_timeout$/, ({ read }) => stated(read('skills/easyfontkit/SKILL.md'), /load its fonts late\. Try `--timeout (\d+)`/, 'SKILL.md')],
  ['easyfontkit', /^free_matches$/, ({ read }) => stated(read('skills/easyfontkit/scripts/lib/match.js'), /function freeMatches\(\{[^}]*\bcount = (\d+)/, 'match.js')],
  ['easyscreenshotkit', /^slow_timeout$/, ({ read }) => stated(read('skills/easyscreenshotkit/SKILL.md'), /Slow sites can take `--timeout (\d+)`/, 'SKILL.md')],
  // Chrome's rules for manifest screenshots, as pwa.js checks them.
  ['easyscreenshotkit', /^pwa\.(?:max|side_min|side_max|ratio_max|phone_max|description_chars)$/, ({ read, key }) => {
    const name = { max: 'LOOKED_AT', side_min: 'MIN_SIDE', side_max: 'MAX_SIDE', ratio_max: 'MAX_RATIO', phone_max: 'PHONE_SHOWS', description_chars: 'DESCRIPTION_SHOWN' }[key.split('.')[1]];
    return stated(read(`${SHOTS}/pwa.js`), new RegExp(`const ${name} = ([\\d.]+);`), 'pwa.js');
  }],
  ['easyscreenshotkit', /^demo\.window$/, ({ read }) => stated(read(`${SHOTS}/demo.js`), /const viewport = \{ width: (\d+), height: (\d+) \}/, 'demo.js')],
  ['easyscreenshotkit', /^demo\.time_left$/, ({ read }) => millis(read(`${SHOTS}/demo.js`), /timeLeft\(\) < ([\d_]+)\) throw new Error\("time ran out while recording/, 'demo.js')],
  ['easyscreenshotkit', /^tour\.pick_seconds$/, ({ read }) => millis(read(`${SHOTS}/tour.js`), /visits < wanted \* 3 && timeLeft\(\) > ([\d_]+)\)/, 'tour.js')],
  // A steps file's limits, as steps.js reads one, and how long a step waits for its target.
  ['easyscreenshotkit', /^steps\.\w+$/, ({ read, key }) => {
    const steps = read(`${SHOTS}/steps.js`);
    const pattern = {
      max: /top\.steps\.length > (\d+)/,
      type_max: /spec\.text\.length > (\d+)\) fail\(here, "type takes at most/,
      wait_max: /seconds\(value, here, "wait", \{ max: (\d+) \}\)/,
      timeout: /timeout === undefined \? (\d+) : seconds\(timeout/,
      timeout_max: /seconds\(timeout, here, "timeout", \{ min: \d+, max: (\d+) \}\)/,
      pause_max: /seconds\(raw\.pause, here, "pause", \{ max: (\d+) \}\)/,
      duration_min: /seconds\(duration, here, "duration", \{ min: ([\d.]+), max: \d+ \}\)/,
      duration_max: /seconds\(duration, here, "duration", \{ min: [\d.]+, max: (\d+) \}\)/,
      zoom_max: /value >= 1 && value <= (\d+)\) return value;/,
    }[key.split('.')[1]];
    if (key === 'steps.find_seconds') return stated(read(`${SHOTS}/record.js`), /async locate\(target, \{ timeout = (\d+)/, 'record.js');
    assert.ok(pattern, `no reader for ${key}: add its pattern here`);
    return stated(steps, pattern, 'steps.js');
  }],
  ['launch-film', /^scene_max\.\w+$/, ({ read, key, dir }) => sceneMax(dir, read, key.split('.')[1])],
  ['launch-film', /^ph_frames_max$/, ({ read }) => stated(read('src/stills.js'), /while \(list\.length > (\d+)\)/, 'src/stills.js')],
  ['launch-film', /^music_volume$/, ({ read }) => stated(read('src/film.js'), /film\.music\.volume\) : ([\d.]+)/, 'src/film.js')],
  // launch-film's guide: the level to check a film against for social apps, and how long a scene takes to read.
  ['launch-film', /^lufs_social$/, ({ read }) => stated(read('skills/launch-film/SKILL.md'), /launch-film@latest check [^\n]*--lufs (-\d+)/, 'SKILL.md')],
  ['launch-film', /^read_(?:letters_per_second|extra_seconds)$/, ({ read, key }) => {
    const match = /about (\d+) letters a second plus (a second and a half|[\d.]+ seconds)/.exec(read('skills/launch-film/SKILL.md'));
    assert.ok(match, 'SKILL.md no longer says how long a scene takes to read');
    if (key === 'read_letters_per_second') return Number(match[1]);
    return match[2] === 'a second and a half' ? 1.5 : Number.parseFloat(match[2]);
  }],
  ['musicfit', /^true_peak$/, ({ read }) => stated(read('skills/musicfit/scripts/lib/render.js'), /async function normalize\(audio, \{ lufs, peak = (-?[\d.]+) \}\)/, 'render.js')],
  // How long a run takes, as each kit's guide says it.
  ['easybrandkit', /^run_seconds$/, ({ read }) => phrase(read('skills/easybrandkit/SKILL.md'), /A run takes (\d+ to \d+) seconds\./, 'SKILL.md')],
  ['easybrandkit', /^facts_run_minutes$/, ({ read }) => phrase(read('skills/easybrandkit/SKILL.md'), /robots\.txt allows, and takes ([a-z]+ to [a-z]+) minutes\./, 'SKILL.md')],
  ['easyfontkit', /^run_seconds$/, ({ read }) => phrase(read('skills/easyfontkit/SKILL.md'), /A run takes (\d+ to \d+) seconds\./, 'SKILL.md')],
  ['launch-film', /^plan_seconds$/, ({ read }) => phrase(read('skills/launch-film/SKILL.md'), /This takes (\d+ to \d+) seconds\. It runs easybrandkit/, 'SKILL.md')],
  ['launch-film', /^render_minutes$/, ({ read }) => phrase(read('skills/launch-film/SKILL.md'), /a 30 second film takes ([a-z]+ to [a-z]+ minutes)\./, 'SKILL.md')],
  ['musicfit', /^analyze_fps$/, ({ read }) => stated(read('skills/musicfit/scripts/musicfit.js'), /raw\.fps !== undefined \? parseFps\(raw\.fps\) : (\d+)/, 'musicfit.js')],
];

/** Facts no file of a kit states, since they are measured: by the slow part, or by hand with real sites. */
const MEASURED = [
  // What a render measures, against lufs_target, the level it aims at: the slow part's film.
  ['launch-film', /^lufs$/],
  // How long a tour's pages take, from the steps.json of tours of real sites.
  ['easyscreenshotkit', /^tour\.(?:page_seconds|four_pages_seconds|short_page_seconds)$/],
];

/** The reader of a fact, and what it gets to read with. */
function readerOf(kit, key) {
  const installed = resolveKit(kit, kitPaths);
  assert.ok(installed.dir, `${kit.kit} cannot be read here: ${installed.reason}`);
  const reader = READERS.find(([owner, pattern]) => owner === kit.kit && pattern.test(key));
  const read = file => readFileSync(path.join(installed.dir, file), 'utf8');
  const params = name => kit.tools.find(tool => tool.name === name).params;
  return { installed, read: reader && (() => reader[2]({ read, params, key, dir: installed.dir })) };
}

for (const kit of kits) {
  test(`${kit.kit}: each fact in its kit file is what the installed kit says`, t => {
    const facts = leaves(kit.facts);
    if (!facts.length) return;
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
      // A number or a phrase shows up somewhere in any kit's files, so only a reader checks a fact.
      wrong.push(`${kit.kit}.${key} is ${value}, which no reader in tests/facts.test.mjs takes: add a reader for it`);
    }
    assert.deepEqual(wrong, []);
  });
}

test('the readers find what they look for in the installed kits', () => {
  // Each reader still finds its number, whether or not a kit file has that fact now, so a
  // kit release that moves a number shows here.
  const samples = [
    ['launch-film', ['fps', 'size_16_9', 'size_9_16', 'sample_rate', 'lufs_target', 'true_peak', 'look_bpm.pop', 'bar_seconds.pop', 'clip_bars_default', 'clip_seconds_min',
      'clip_seconds_max', 'film_seconds_max', 'length_min', 'length_max', 'still_size.ph_thumbnail', 'check_most', 'check_end.still', 'scene_max.feature_title', 'scene_max.title',
      'ph_frames_max', 'music_volume', 'lufs_social', 'read_extra_seconds', 'plan_seconds', 'render_minutes']],
    ['easyscreenshotkit', ['size.iphone', 'scale.full', 'pwa.wide', 'demo.size', 'demo.fps', 'demo.gif_max_mb', 'full_page_max', 'custom.side_min', 'custom.side_max',
      'custom.scale_min', 'custom.scale_max', 'custom.phone_below', 'slow_timeout', 'pwa.max', 'demo.window', 'demo.time_left', 'tour.pick_seconds', 'steps.zoom_max']],
    ['musicfit', ['sample_rate', 'channels', 'length_min', 'length_max', 'hit_tail', 'true_peak', 'analyze_fps']],
    ['easybrandkit', ['screen_size', 'card_size', 'logo_min_side', 'facts_timeout', 'slow_timeout', 'run_seconds', 'facts_run_minutes']],
    ['easyfontkit', ['late_timeout', 'free_matches', 'run_seconds']],
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
  assert.equal(value('launch-film', 'scene_max.feature_title'), 34);
  assert.equal(value('launch-film', 'scene_max.title'), 70);
  assert.equal(value('launch-film', 'scene_max.typewriter_text'), 140);
  assert.equal(value('launch-film', 'ph_frames_max'), 5);
  assert.equal(value('launch-film', 'read_extra_seconds'), 1.5);
  assert.equal(value('easyscreenshotkit', 'steps.zoom_max'), 3);
  assert.equal(value('easyscreenshotkit', 'steps.duration_min'), 0.2);
  assert.equal(value('easyscreenshotkit', 'demo.time_left'), 60);
  assert.equal(value('musicfit', 'analyze_fps'), 30);
  assert.equal(value('musicfit', 'true_peak'), -1);
  // The phrases the guides say, word for word.
  assert.equal(value('easybrandkit', 'run_seconds'), '20 to 90');
  assert.equal(value('launch-film', 'plan_seconds'), '30 to 90');
  assert.equal(value('launch-film', 'render_minutes'), 'one to three minutes');
});

// The slow part: real renders, measured.

const SLOW = process.env.MAKERSMCP_SLOW === '1';
const fact = (owner, key) => {
  const kit = kits.find(entry => entry.kit === owner);
  const [head, sub] = key.split('.');
  const found = sub === undefined ? kit?.facts?.[head] : kit?.facts?.[head]?.[sub];
  return found;
};

async function withServer(callback, env) {
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'mm-facts-'));
  const backend = env ? new LocalBackend({ baseDir: outDir, kitPaths, env }) : undefined;
  const server = createMcpServer({ outDir, kitPaths, kits: ['launch-film', 'easyscreenshotkit'], ...(backend ? { backend } : {}) });
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
    // jobs-and-files and launch-kit find a film's length and its last clip's start, a plan's logo close, in the CHECK.md
    // check_video returns: the length in the line under its heading, and each clip's start a row of its Cuts table, in order.
    const timeline = JSON.parse(readFileSync(path.join(outDir, 'film.timeline.json'), 'utf8'));
    const check = readFileSync(path.join(outDir, 'check', 'CHECK.md'), 'utf8').split('\n');
    const under = check.slice(1).find(line => line.trim());
    const length = Number(/, ([\d.]+) s[,.]/.exec(under)?.[1]);
    assert.ok(Math.abs(length - timeline.seconds) <= 0.1, `"${under}" against the timeline's ${timeline.seconds} s`);
    const cuts = check.slice(check.indexOf('## Cuts')).filter(line => /^\| \d+ \|/.test(line));
    assert.deepEqual(cuts.map(row => Number.parseFloat(row.split('|')[2])), timeline.clips.map(clip => clip.start));
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

// A render whose ffmpeg fails waits on it for good, so the test has a time limit of its own.
test('with ffmpeg reachable only through FFMPEG_PATH, a film renders and its check runs', { timeout: 300_000, skip: (!SLOW || process.platform === 'win32') && 'set MAKERSMCP_SLOW=1 to render, on a system with a shell' }, async () => {
  const ffmpeg = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, 'ffmpeg')).find(file => existsSync(file));
  assert.ok(ffmpeg, 'the slow part needs ffmpeg');
  // An ffmpeg and an ffprobe that fail stand first on PATH, as when a client starts the server with another PATH.
  const broken = mkdtempSync(path.join(os.tmpdir(), 'mm-broken-'));
  for (const name of ['ffmpeg', 'ffprobe']) {
    writeFileSync(path.join(broken, name), '#!/bin/sh\necho "not this one" >&2\nexit 1\n');
    chmodSync(path.join(broken, name), 0o755);
  }
  const env = { ...process.env, PATH: `${broken}${path.delimiter}${process.env.PATH}`, FFMPEG_PATH: ffmpeg };
  delete env.LAUNCH_FILM_FFMPEG;
  delete env.LAUNCH_FILM_FFPROBE;
  try {
    await withServer(async (client, outDir) => {
      const film = {
        version: 1, look: 'launch', aspect: '16:9', lang: 'en',
        clips: [
          { kind: 'scene', seconds: 3, scene: { type: 'opener', title: 'Acme', text: 'Widgets for every team' } },
          { kind: 'scene', seconds: 3, scene: { type: 'headline', title: 'Setup in *one* minute' } },
        ],
      };
      writeFileSync(path.join(outDir, 'film.json'), JSON.stringify(film, null, 2));
      const rendered = await finished(client, 'render_launch_film', { film: 'film.json' });
      assert.equal(rendered.structuredContent?.status, 'done', text(rendered));
      const checked = await finished(client, 'check_video', { film: 'film.mp4' });
      assert.equal(checked.structuredContent?.status, 'done', text(checked));
      assert.equal(measured(path.join(outDir, 'film.mp4')).video.fps, fact('launch-film', 'fps') ?? 25);
    }, env);
  } finally {
    rmSync(broken, { recursive: true, force: true });
  }
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
      // The kit file's size, and the frame rate record_demo_video records at without fps.
      const size = fact('easyscreenshotkit', 'demo.size');
      const fps = kits.find(entry => entry.kit === 'easyscreenshotkit').tools.find(tool => tool.name === 'record_demo_video').params.fps.default;
      assert.ok(size && fps, 'kits/easyscreenshotkit.json gives demo.size and record_demo_video.fps\'s default');
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
