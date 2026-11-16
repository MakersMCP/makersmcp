// The kit definitions in kits/ against the kits themselves. Every kit is a dependency, and
// the bounds of every number are tried with each kit's own parser, so a schema never offers
// a value the kit refuses. MAKERSMCP_KIT_PATHS runs a kit's checkout instead of its package,
// the way the CLI takes it, like MAKERSMCP_KIT_PATHS=musicfit=../musicfit npm test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildCommand, createMcpServer, LocalBackend, loadKitDefinitions, resolveKit, validateKitDefinition } from '../dist/server.js';
import { kitEnvironment, settingProblems, settingsRead, setupReport } from '../dist/setup.js';
import { flagWords, inParameterWords } from '../dist/texts.js';

const kitPaths = Object.fromEntries((process.env.MAKERSMCP_KIT_PATHS ?? '').split(',').map(entry => entry.trim())
  .filter(entry => entry.includes('=')).map(entry => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)]));
const kits = loadKitDefinitions();
const text = result => result.content.map(item => item.text).join('\n');
const hasFfmpeg = ['ffmpeg', 'ffprobe'].every(name => spawnSync(name, ['-version'], { stdio: 'ignore' }).status === 0);

test('every kit in kits/ comes with makersmcp, and every other dependency is a library makersmcp uses', () => {
  const { dependencies } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const kit of kits) assert.ok(dependencies[kit.package], `${kit.package} is not in the dependencies in package.json`);
  const others = Object.keys(dependencies).filter(name => !kits.some(kit => kit.package === name)).sort();
  assert.deepEqual(others, ['@modelcontextprotocol/sdk', 'zod'], 'a dependency that is no kit\'s: add its kit to kits/, or remove it');
});

test('every check tool says what its report is, so a kit error is not taken for a failed check', () => {
  for (const kit of kits) {
    for (const tool of kit.tools.filter(entry => entry.check)) assert.ok(tool.report, `${tool.name} has no report`);
  }
});

test('every number has its bounds, and every address an example with https://', () => {
  for (const kit of kits) {
    for (const tool of kit.tools) {
      for (const [name, param] of Object.entries(tool.params)) {
        if (param.type === 'integer' || param.type === 'number') {
          assert.ok(param.min !== undefined && param.max !== undefined, `${tool.name}.${name} needs min and max`);
        }
        if (param.type === 'url' || param.type === 'url_or_path') {
          assert.match(param.description, /https:\/\/\S+/, `${tool.name}.${name}`);
        }
      }
    }
  }
});

test('every tool that writes says it is destructive, as each deletes or replaces what an earlier run left in its folder', () => {
  // In MCP a tool that is not destructive only adds. An ownOnly tool deletes the earlier run as it starts, a tool with
  // replaces deletes those folders, and every other tool that writes saves its files over an earlier run's.
  for (const kit of kits) {
    for (const tool of kit.tools) {
      assert.equal(tool.destructive === true, tool.readOnly !== true, `${tool.name} is ${tool.readOnly ? 'read only' : 'not read only'}`);
      if (tool.out?.replaces) assert.equal(tool.destructive, true, tool.name);
    }
  }
});

// How each kit reads its arguments and stops before it opens a browser or the network.
// `ran` tells from the run whether the kit took the arguments.
function dryRun(kit, tool, extra, folder) {
  const placeholder = name => {
    const param = tool.params[name];
    if (param.type === 'enum') return param.values[0];
    if (param.type === 'url' || param.type === 'url_or_path') return 'https://example.com';
    return path.join(folder, `no-${name}`);
  };
  const positional = tool.args.map(arg => /^\{(\w+)\}$/.test(arg) ? placeholder(arg.slice(1, -1)) : arg);
  switch (kit.kit) {
    case 'easybrandkit':
    case 'easyfontkit':
    case 'easyscreenshotkit':
      // These check every value before they look at --help.
      return { args: [...positional, ...extra, '--help'], ran: run => run.status === 0 };
    case 'musicfit':
      // It checks its numbers before it reads the track, and --analyze needs no length.
      // A track that is not there then ends it with 1; a refused value with 2.
      return { args: [...positional, '--analyze', ...extra], ran: run => run.status === 1 };
    case 'reframekit':
      // It checks its numbers as it reads its arguments, and its dry run reads no video and starts no ffmpeg: it ends with 0
      // whether or not the run would go ahead, and a refused value with 2.
      return { args: [...positional, ...extra, '--dry-run'], ran: run => run.status === 0 };
    case 'easycaptionkit':
      // The same, and a caption needs its words, which a dry run does not read.
      return { args: [...positional, ...(tool.name === 'caption_video' ? ['--words', path.join(folder, 'no-words')] : []), ...extra, '--dry-run'], ran: run => run.status === 0 };
    case 'launch-film': {
      if (tool.name !== 'check_video') return { args: [...positional, ...extra, '--help'], ran: run => run.status === 0 };
      // A check reads its numbers once it has read the video, and writes CHECK.md once it has run.
      const out = mkdtempSync(path.join(folder, 'check-'));
      return {
        args: ['check', path.join(folder, 'tiny.mp4'), ...extra, '--out', out],
        ran: () => existsSync(path.join(out, 'CHECK.md')),
        needsVideo: true,
      };
    }
    default:
      return undefined;
  }
}

// One value each kit must refuse, to show its dry run tells a refusal at all.
const REFUSED = {
  easybrandkit: ['make_brand_kit', ['--timeout', '601']],
  easyfontkit: ['make_font_kit', ['--timeout', '29']],
  easyscreenshotkit: ['take_screenshots', ['--timeout', '901']],
  musicfit: ['fit_music', ['--lufs', '-4']],
  'launch-film': ['check_video', ['--lufs', '0']],
  reframekit: ['reframe_video', ['--lufs', '-4']],
  easycaptionkit: ['caption_video', ['--size', '21']],
};

function tinyVideo(folder) {
  const file = path.join(folder, 'tiny.mp4');
  if (existsSync(file)) return;
  const made = spawnSync('ffmpeg', [
    '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file,
  ]);
  assert.equal(made.status, 0, String(made.stderr));
}

for (const kit of kits) {
  const installed = resolveKit(kit, kitPaths);

  test(`${kit.kit}: the kit takes every number at the bounds its tools offer`, () => {
    assert.ok(installed.script, `${kit.kit} cannot run here: ${installed.reason}`);
    const folder = mkdtempSync(path.join(os.tmpdir(), 'makersmcp-kits-'));
    try {
      const run = (tool, extra) => {
        const dry = dryRun(kit, tool, extra, folder);
        assert.ok(dry, `${kit.kit} has no dry run in tests/kits.test.mjs: add one`);
        if (dry.needsVideo) {
          if (!hasFfmpeg) return undefined;
          tinyVideo(folder);
        }
        const result = spawnSync(process.execPath, [installed.script, ...dry.args], { cwd: folder, encoding: 'utf8', timeout: 60_000 });
        return { ran: dry.ran(result), result };
      };

      let tried = 0;
      for (const tool of kit.tools) {
        for (const [name, param] of Object.entries(tool.params)) {
          if (param.type !== 'integer' && param.type !== 'number') continue;
          for (const bound of [param.min, param.max].filter(value => value !== undefined)) {
            const outcome = run(tool, [param.flag, String(bound)]);
            if (!outcome) continue;
            tried++;
            assert.ok(outcome.ran, `${tool.name}.${name} ${bound}: the kit refused it:\n${outcome.result.stderr}${outcome.result.stdout}`);
          }
        }
      }
      const [refusedTool, refusedArgs] = REFUSED[kit.kit] ?? [];
      assert.ok(refusedTool, `${kit.kit} has no refused value in tests/kits.test.mjs: add one`);
      const refused = run(kit.tools.find(tool => tool.name === refusedTool), refusedArgs);
      if (refused) assert.equal(refused.ran, false, `${refusedTool} ${refusedArgs.join(' ')} should be refused, so the dry run can tell`);
      assert.ok(tried > 0 || !kit.tools.some(tool => Object.values(tool.params).some(param => param.min !== undefined)), 'nothing was tried');
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
}

async function withLaunchFilm(callback, { backendEnv, ...options } = {}) {
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'makersmcp-kits-'));
  const backend = backendEnv ? new LocalBackend({ baseDir: outDir, kitPaths, env: backendEnv }) : undefined;
  const server = createMcpServer({ kits: ['launch-film'], outDir, ...(backend ? { backend } : {}), ...options });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
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

const launchFilm = resolveKit(kits.find(kit => kit.kit === 'launch-film'));

test('plan_launch_film never deletes a brand folder of the user\'s, and the tools say they may replace one', async () => {
  await withLaunchFilm(async (client, outDir) => {
    const write = (file, body) => {
      mkdirSync(path.dirname(path.join(outDir, file)), { recursive: true });
      writeFileSync(path.join(outDir, file), body);
    };
    // A brand kit made elsewhere, the page's words so nothing is fetched, and the team's own brand/ folder.
    write('easybrandkit-acme.com/brand.json', JSON.stringify({
      version: 1, name: 'Acme', url: 'https://acme.com',
      colors: [{ hex: '#112233', role: 'primary' }, { hex: '#ffcc00', role: 'button' }],
    }));
    write('words.json', JSON.stringify({
      title: 'Acme widgets', description: 'Acme makes widgets for teams.',
      headings: [{ level: 1, text: 'Widgets for every team' }, { level: 2, text: 'Fast setup' }, { level: 2, text: 'Clear pricing' }],
      ctas: [], paragraphs: [], jsonld: [],
    }));
    write('project/brand/team-logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    write('project/brand/guidelines.md', '# Team guidelines\n');
    // A brand/ whose brand.json is the team's own design tokens, next to their logo.
    write('tokens/brand/brand.json', JSON.stringify({ color: { primary: { value: '#0055ff' } } }));
    write('tokens/brand/team-logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const plan = (out_dir, more = {}) => client.callTool({
      name: 'plan_launch_film',
      arguments: { url: 'https://acme.com', brand: 'easybrandkit-acme.com', words: 'words.json', out_dir, wait_seconds: 60, ...more },
    });
    const files = folder => readdirSync(path.join(outDir, folder)).sort();

    const refused = await plan('project');
    assert.equal(refused.isError, true);
    assert.match(text(refused), /not started[\s\S]*already holds other files[\s\S]*Give another out_dir/);
    assert.deepEqual(files('project/brand'), ['guidelines.md', 'team-logo.svg']);

    for (const more of [{}, { url: 'https://apps.apple.com/us/app/acme/id1234567890', brand: undefined }]) {
      const tokens = await plan('tokens', more);
      assert.equal(tokens.isError, true, JSON.stringify(more));
      assert.match(text(tokens), /not started[\s\S]*brand\.json is not one a kit made \(no "version": 1 in it\)/);
      assert.deepEqual(files('tokens/brand'), ['brand.json', 'team-logo.svg']);
      assert.match(readFileSync(path.join(outDir, 'tokens', 'brand', 'brand.json'), 'utf8'), /#0055ff/);
    }

    const fresh = await plan('fresh');
    assert.equal(fresh.structuredContent.status, 'done', text(fresh));
    assert.ok(existsSync(path.join(outDir, 'fresh', 'film.json')));
    assert.deepEqual(fresh.structuredContent.files.map(file => file.path).sort(), [path.join('brand', 'brand.json'), 'film.json', 'words.json']);

    // A brand/ an earlier run made is the kit's to replace, until a file is added to it by hand.
    const again = await plan('fresh');
    assert.equal(again.structuredContent.status, 'done', text(again));
    write('fresh/brand/our-notes.md', '# Our notes\n');
    const noted = await plan('fresh');
    assert.equal(noted.isError, true);
    assert.match(text(noted), /not started[\s\S]*brand holds our-notes\.md, which its brand\.json does not list/);
    assert.deepEqual(files('fresh/brand'), ['brand.json', 'our-notes.md']);

    const { tools } = await client.listTools();
    for (const name of ['make_launch_film', 'plan_launch_film', 'make_launch_stills']) {
      const entry = tools.find(item => item.name === name);
      assert.equal(entry.annotations.destructiveHint, true, name);
      const when = name === 'make_launch_stills' ? 'for an App Store page' : 'when given brand, or for an App Store page';
      assert.ok(entry.inputSchema.properties.out_dir.description.includes(
        ` The kit deletes the brand/ folder in it and makes it again ${when}, so it does not start then while that folder holds a file other than a kit's own that would be lost.`
        + ' Otherwise it makes the kit in brand/ again where it is, so it does not start while brand/ holds a file named like a kit\'s own, in any letter case, that its brand.json does not list.',
      ), name);
    }
    assert.match(tools.find(item => item.name === 'plan_launch_film').inputSchema.properties.out_dir.description, / To use that brand\/ folder where it is, give brand as out_dir with \/brand added, written the same way\.$/);
    // A check writes its report over an earlier one's in the same folder.
    assert.equal(tools.find(item => item.name === 'check_video').annotations.destructiveHint, true);
  });
});

// A brand kit and the page's words, so a plan reads nothing from the network.
const ACME_KIT = { version: 1, name: 'Acme', url: 'https://acme.com', colors: [{ hex: '#112233', role: 'primary' }, { hex: '#ffcc00', role: 'button' }] };
const ACME_WORDS = {
  title: 'Acme widgets', description: 'Acme makes widgets for teams.',
  headings: [{ level: 1, text: 'Widgets for every team' }, { level: 2, text: 'Fast setup' }, { level: 2, text: 'Clear pricing' }],
  ctas: [], paragraphs: [], jsonld: [],
};
const fakeEasybrandkit = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-easybrandkit');

test('plan_launch_film plans again from the kit folder it copied, with the files that folder holds', async () => {
  await withLaunchFilm(async (client, outDir) => {
    const write = (file, body) => {
      mkdirSync(path.dirname(path.join(outDir, file)), { recursive: true });
      writeFileSync(path.join(outDir, file), body);
    };
    // A kit kept with a note, a .gitkeep and its fonts: launch-film copies all of it into brand/.
    write('kit-with-note/brand.json', JSON.stringify(ACME_KIT));
    write('kit-with-note/notes.md', '# Kept with the kit\n');
    write('kit-with-note/.gitkeep', '');
    write('kit-with-note/fonts/brand.woff2', 'font');
    write('other-kit/brand.json', JSON.stringify({ ...ACME_KIT, name: 'Other' }));
    write('words.json', JSON.stringify(ACME_WORDS));
    const plan = brand => client.callTool({
      name: 'plan_launch_film',
      arguments: { url: 'https://acme.com', brand, words: 'words.json', out_dir: 'film', wait_seconds: 60 },
    });
    const files = folder => readdirSync(path.join(outDir, folder), { recursive: true }).map(String).sort();
    const kept = ['.gitkeep', 'brand.json', 'fonts', path.join('fonts', 'brand.woff2'), 'notes.md'];

    for (const round of [1, 2]) {
      const result = await plan('kit-with-note');
      assert.equal(result.structuredContent?.status, 'done', `round ${round}: ${text(result)}`);
      assert.deepEqual(files('film/brand'), kept);
    }
    // Another kit would not bring the note back.
    const other = await plan('other-kit');
    assert.equal(other.isError, true);
    assert.match(text(other), /not started[\s\S]*film\/brand holds \.gitkeep, fonts\/ and notes\.md, which its brand\.json does not list and the copy would not bring back/);
    assert.deepEqual(files('film/brand'), kept);
    assert.deepEqual(files('kit-with-note'), kept);
  });
});

test('plan_launch_film from a website has easybrandkit make brand/ again where it is, keeping a file of the user\'s', async () => {
  await withLaunchFilm(async (client, outDir) => {
    const write = (file, body) => {
      mkdirSync(path.dirname(path.join(outDir, file)), { recursive: true });
      writeFileSync(path.join(outDir, file), body);
    };
    write('words.json', JSON.stringify(ACME_WORDS));
    write('project/brand/team-logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const plan = out_dir => client.callTool({
      name: 'plan_launch_film',
      arguments: { url: 'https://acme.com', words: 'words.json', out_dir, wait_seconds: 60 },
    });
    const files = folder => readdirSync(path.join(outDir, folder)).sort();

    const first = await plan('site');
    assert.equal(first.structuredContent?.status, 'done', text(first));
    assert.deepEqual(files('site/brand'), ['BRAND.md', 'brand.json']);
    // A note added to that kit stays: easybrandkit replaces only the kit's own files.
    write('site/brand/our-notes.md', '# Our notes\n');
    const again = await plan('site');
    assert.equal(again.structuredContent?.status, 'done', text(again));
    assert.deepEqual(files('site/brand'), ['BRAND.md', 'brand.json', 'our-notes.md']);
    assert.equal(readFileSync(path.join(outDir, 'site', 'brand', 'our-notes.md'), 'utf8'), '# Our notes\n');

    // A file named like the kit's own logos would be replaced, so the tool does not start.
    write('site/brand/logo-03.png', 'ours');
    const named = await plan('site');
    assert.equal(named.isError, true);
    assert.match(text(named), /not started[\s\S]*makes the brand folder in .*site again[\s\S]*holds logo-03\.png, which its brand\.json does not list/);
    assert.equal(readFileSync(path.join(outDir, 'site', 'brand', 'logo-03.png'), 'utf8'), 'ours');

    // A brand/ that holds no kit: easybrandkit does not start in it, and nothing goes.
    const project = await plan('project');
    assert.equal(project.isError, true);
    assert.equal(project.structuredContent?.status, 'failed');
    assert.match(text(project), /is not empty and holds no earlier brand kit/);
    assert.deepEqual(files('project/brand'), ['team-logo.svg']);
  }, { kitPaths: { easybrandkit: fakeEasybrandkit } });
});

test('plan_launch_film refuses a kit that is the brand/ folder by another path, or a folder around it, and loses nothing', async () => {
  await withLaunchFilm(async (client, outDir) => {
    const write = (file, body) => {
      mkdirSync(path.dirname(path.join(outDir, file)), { recursive: true });
      writeFileSync(path.join(outDir, file), body);
    };
    write('words.json', JSON.stringify(ACME_WORDS));
    // The team's kit with their notes and logo, and a second path to it through a link to the folder above.
    write('marketing/brand/brand.json', JSON.stringify(ACME_KIT));
    write('marketing/brand/notes.md', '# The team notes\n');
    write('marketing/brand/team-logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    symlinkSync(path.join(outDir, 'marketing'), path.join(outDir, 'alias'));
    // A kit folder that holds a film's folder, with the brand/ copied from it before.
    write('big/brand.json', JSON.stringify(ACME_KIT));
    write('big/film/brand/brand.json', JSON.stringify(ACME_KIT));
    // A kit with only its own files, and a kit folder whose brand.json is a link to that kit's.
    write('pure/brand/brand.json', JSON.stringify(ACME_KIT));
    mkdirSync(path.join(outDir, 'linked-kit'));
    symlinkSync(path.join('..', 'pure', 'brand', 'brand.json'), path.join(outDir, 'linked-kit', 'brand.json'));
    const plan = (brand, out_dir) => client.callTool({
      name: 'plan_launch_film',
      arguments: { url: 'https://acme.com', brand, words: 'words.json', out_dir, wait_seconds: 60 },
    });
    const files = folder => readdirSync(path.join(outDir, folder)).sort();
    const team = ['brand.json', 'notes.md', 'team-logo.svg'];

    for (const [brand, out_dir] of [['alias/brand', 'marketing'], ['marketing/brand', 'alias']]) {
      const aliased = await plan(brand, out_dir);
      assert.equal(aliased.isError, true, brand);
      assert.match(text(aliased), /not started[\s\S]*is that same folder under another name\. Give brand as .*\/brand to use it where it is\./);
      assert.deepEqual(files('marketing/brand'), team);
    }
    // As the refusal says, the kit then uses the folder where it is.
    const inPlace = await plan('marketing/brand', 'marketing');
    assert.equal(inPlace.structuredContent?.status, 'done', text(inPlace));
    assert.deepEqual(files('marketing/brand'), team);

    const around = await plan('big', 'big/film');
    assert.equal(around.isError, true);
    assert.match(text(around), /not started[\s\S]*film\/brand is inside .*big, and a folder cannot be copied into itself\. Give an out_dir outside/);
    assert.deepEqual(files('big/film/brand'), ['brand.json']);

    // launch-film would delete pure/brand and then read the kit's brand.json from a copy of a link to it.
    const linked = await plan('linked-kit', 'pure');
    assert.equal(linked.isError, true);
    assert.match(text(linked), /not started[\s\S]*linked-kit\/brand\.json is inside it\. Give another out_dir/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(outDir, 'pure', 'brand', 'brand.json'), 'utf8')), ACME_KIT);
    assert.deepEqual(JSON.parse(readFileSync(path.join(outDir, 'linked-kit', 'brand.json'), 'utf8')), ACME_KIT);
  });
});

test('plan_launch_film from a website refuses a kit folder with a file named like a kit\'s own in other letters, or with pages/ a link, and loses nothing', async () => {
  await withLaunchFilm(async (client, outDir) => {
    const write = (file, body) => {
      mkdirSync(path.dirname(path.join(outDir, file)), { recursive: true });
      writeFileSync(path.join(outDir, file), body);
    };
    write('words.json', JSON.stringify(ACME_WORDS));
    // A kit easybrandkit made, with the team's card and logo next to its own logo.
    write('cards/brand/brand.json', JSON.stringify({ ...ACME_KIT, logos: [{ file: 'logo-01.png' }] }));
    write('cards/brand/logo-01.png', 'kit logo');
    write('cards/brand/Card.png', 'THE TEAM CARD');
    write('cards/brand/Logo-02.PNG', 'THE TEAM LOGO');
    // A kit whose pages/ is the team's own folder of pages.
    write('team-pages/home.md', '# Our home page\n');
    write('team-pages/about.md', '# About us\n');
    write('team-pages/roadmap.md', '# Roadmap\n');
    write('paged/brand/brand.json', JSON.stringify(ACME_KIT));
    symlinkSync(path.join(outDir, 'team-pages'), path.join(outDir, 'paged', 'brand', 'pages'));
    const plan = out_dir => client.callTool({
      name: 'plan_launch_film',
      arguments: { url: 'https://acme.com', words: 'words.json', out_dir, wait_seconds: 60 },
    });

    const cards = await plan('cards');
    assert.equal(cards.isError, true);
    assert.match(text(cards), /not started[\s\S]*cards\/brand holds Card\.png and Logo-02\.PNG, which its brand\.json does not list/);
    assert.equal(readFileSync(path.join(outDir, 'cards', 'brand', 'Card.png'), 'utf8'), 'THE TEAM CARD');
    assert.equal(readFileSync(path.join(outDir, 'cards', 'brand', 'Logo-02.PNG'), 'utf8'), 'THE TEAM LOGO');
    assert.equal(readFileSync(path.join(outDir, 'cards', 'brand', 'logo-01.png'), 'utf8'), 'kit logo');

    const paged = await plan('paged');
    assert.equal(paged.isError, true);
    assert.match(text(paged), /not started[\s\S]*paged\/brand\/pages is a link, so the kit would delete files named like its own where it leads/);
    assert.deepEqual(readdirSync(path.join(outDir, 'team-pages')).sort(), ['about.md', 'home.md', 'roadmap.md']);
  }, { kitPaths: { easybrandkit: fakeEasybrandkit } });
});

// Whether a folder is on a disk that ignores letter case, as macOS and Windows have by default.
function ignoresCase(folder) {
  writeFileSync(path.join(folder, 'case.txt'), '');
  try {
    return existsSync(path.join(folder, 'CASE.TXT'));
  } finally {
    rmSync(path.join(folder, 'case.txt'), { force: true });
  }
}

test('on a real disk that ignores letter case, and through a bind mount, a kit given as brand/ by another path loses nothing', t => {
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'alias-disk.mjs');
  const folder = mkdtempSync(path.join(os.tmpdir(), 'makersmcp-alias-'));
  try {
    let run;
    if (ignoresCase(folder)) {
      run = spawnSync(process.execPath, [fixture, folder], { encoding: 'utf8', timeout: 120_000 });
    } else if (process.platform === 'linux') {
      // Linux makes both where only this test sees them: a tmpfs that folds letter case, in a
      // user and mount namespace of the test's own, where it may mount.
      const script = 'mount -t tmpfs -o casefold,size=16m makersmcp "$1" && mkdir "$1/ci" && chattr +F "$1/ci" || exit 77\nexec "$2" "$3" "$1/ci" --bind';
      run = spawnSync('unshare', ['--user', '--map-root-user', '--mount', 'sh', '-c', script, 'sh', folder, process.execPath, fixture], { encoding: 'utf8', timeout: 120_000 });
      if (run.error || run.status === 77 || /^unshare:/m.test(run.stderr)) {
        t.skip(`no such disk can be made here: ${(run.error?.message ?? run.stderr).trim().split('\n').pop()}`);
        return;
      }
    } else {
      t.skip('the temporary folder minds letter case, and no disk that ignores it can be made here');
      return;
    }
    assert.equal(run.status, 0, run.stderr);
    const calls = run.stdout.trim().split('\n').map(line => JSON.parse(line));
    const refused = {
      'kit given in other letters': /is that same folder under another name/,
      'kit with only its own files, as its brand.json in other letters': /is that same folder under another name/,
      'website, the team card named like the kit card': /site\/brand holds Card\.png, which its brand\.json does not list/,
      'website, the team notes named like BRAND.md but for a character that does not show': /unseen\/brand holds BRAND\u200b\.md, which its brand\.json does not list/,
      'kit given through a bind mount': /is that same folder under another name/,
      'out_dir through a bind mount': /is that same folder under another name/,
      'website, pages/ another disk': /mounted\/brand\/pages is another disk mounted there, so the kit would delete files named like its own on it/,
    };
    for (const call of calls) {
      if (call.name === 'kit given the way out_dir is') {
        assert.equal(call.status, 'done', call.said);
      } else {
        assert.equal(call.status, 'not started', `${call.name}: ${call.said}`);
        assert.match(call.said, refused[call.name], call.name);
      }
      assert.ok(call.kept, `${call.name}: a file went or changed. ${call.said}`);
    }
    assert.ok(calls.length >= 4, run.stdout);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('make_launch_stills takes for a film.json what launch-film takes for one, and the rest for an address', () => {
  const stills = kits.find(kit => kit.kit === 'launch-film').tools.find(tool => tool.name === 'make_launch_stills');
  const asFile = new RegExp(`^(?:${stills.params.source.filePattern})$`);
  const folder = mkdtempSync(path.join(os.tmpdir(), 'makersmcp-kits-'));
  try {
    // Values none of which reach the network: the kit fails on each, saying how it took it.
    const values = [
      'https://example.com/film.json', 'https://example.com/plans/FILM.JSON', 'http://example.com/a.Json',
      path.join(folder, 'missing.json'), path.join(folder, 'Missing.JSON'),
      path.join(folder, 'film.txt'), path.join(folder, 'film.json.bak'), path.join(folder, 'film.jsonx'),
    ];
    for (const value of values) {
      const run = spawnSync(process.execPath, [launchFilm.script, 'stills', value], { cwd: folder, encoding: 'utf8', timeout: 30_000 });
      const tookFile = /is not a file/.test(run.stderr);
      assert.ok(tookFile || /is not an address or a film\.json/.test(run.stderr), `${value}: ${run.stderr}`);
      assert.equal(asFile.test(value), tookFile, value);
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('render_launch_film and make_launch_stills read the brand and every picture a film.json names, as launch-film\'s loader reads them', () => {
  const source = name => readFileSync(path.join(launchFilm.dir, 'src', name), 'utf8');
  const film = source('film.js');
  // loadFilm reads the brand from film.json's folder, and each clip's files through fileOf, a list of them like images too,
  // and from launch-film 0.3 the user's own track that music names, a path from that folder too (musicOf).
  const brand = /readBrand\(path\.resolve\(dir, film\.(\w+)\)\)/.exec(film)?.[1];
  assert.ok(brand && /Array\.isArray\(film\.clips\)/.test(film) && /fileOf\(rel,/.test(film), 'launch-film\'s loadFilm reads its brand and clips another way now');
  const track = /musicOf\(film\.(\w+), dir, problems\)/.exec(film)?.[1];
  assert.ok(track && /track: path\.resolve\(dir, value\)/.test(film), 'launch-film\'s loadFilm reads a track another way now');
  const lists = [...film.matchAll(/Array\.isArray\(c\.(\w+)\) \? c\.\1 : \[\]/g)];
  const places = [brand, track, ...[...film.matchAll(/fileOf\(c\.(\w+),/g), ...lists].map(match => `clips.${match[1]}`)];
  assert.deepEqual([...new Set(places)].sort(), ['brand', 'clips.icon', 'clips.image', 'clips.images', 'clips.logo', 'music']);
  assert.match(source('stills.js'), /loadFilm\(filmFile\)/, 'make_launch_stills reads its film.json with loadFilm');
  const tools = kits.find(kit => kit.kit === 'launch-film').tools;
  const folder = mkdtempSync(path.join(os.tmpdir(), 'makersmcp-kits-'));
  try {
    mkdirSync(path.join(folder, 'film'));
    const filmJson = path.join(folder, 'film', 'film.json');
    writeFileSync(filmJson, JSON.stringify({
      brand: 'brand/brand.json',
      music: 'music/fitted.wav',
      clips: [
        { kind: 'screen', image: '../shots/01.png' },
        { kind: 'shots', images: ['../store/a.png', '../store/b.png'] },
        { kind: 'logo', logo: 'brand/logo-01.png' },
        { kind: 'logo', icon: '../store/icon.png' },
      ],
    }));
    const named = ['film/brand/brand.json', 'film/music/fitted.wav', 'shots/01.png', 'store/a.png', 'store/b.png', 'film/brand/logo-01.png', 'store/icon.png'].map(file => path.join(folder, file));
    for (const [name, param] of [['render_launch_film', 'film'], ['make_launch_stills', 'source']]) {
      const tool = tools.find(entry => entry.name === name);
      assert.deepEqual([...tool.params[param].reads].sort(), [...new Set(places)].sort(), `${name}.${param}`);
      const { reads } = buildCommand(tool, { [param]: 'film/film.json' }, { baseDir: folder, installed: new Map() });
      assert.deepEqual(reads.slice().sort(), [filmJson, ...named].sort(), name);
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('easybrandkit reads a deeper page of a site, or its blog, docs or help site, from the home page at its root, and a home page in a language, /home or another path of two letters as it is, as the texts say', () => {
  const require = createRequire(import.meta.url);
  const { homePageOf } = require('easybrandkit');
  for (const [page, home] of [
    ['https://linear.app/about', 'https://linear.app/'],
    ['https://linear.app/pricing/teams', 'https://linear.app/'],
    ['https://blog.linear.app/a-post', 'https://linear.app/'],
    ['https://docs.linear.app/', 'https://linear.app/'],
    // An app's sign-in page is read from that app's own home page, not the product's site.
    ['https://app.linear.app/login', 'https://app.linear.app/'],
    // A deeper page under a home page in a language is read from the root, a language chooser on many sites.
    ['https://linear.app/en/about', 'https://linear.app/'],
    ['https://linear.app/pt-br/pricing', 'https://linear.app/'],
  ]) assert.equal(homePageOf(page), home, page);
  // A home page, one in a language of its own or at /home too, is read as it is, and so is any other path of at most two
  // parts of two letters each, like /ai, which may be a deeper page. tests/playbooks.test.mjs holds the sentence that gives
  // these addresses as examples to the same reading.
  for (const page of ['https://linear.app/', 'https://linear.app/tr', 'https://linear.app/en-us/', 'https://linear.app/de', 'https://linear.app/en/', 'https://linear.app/pt-br', 'https://linear.app/home',
    'https://linear.app/en/home', 'https://linear.app/ai', 'https://linear.app/go']) {
    assert.equal(homePageOf(page), null, page);
  }
  const tool = kits.find(kit => kit.kit === 'easybrandkit').tools.find(entry => entry.name === 'make_brand_kit');
  assert.match(tool.description, /a deeper page is read from the home page/);
});

test('what launch-film\'s tools take for a brand kit\'s own files, easybrandkit writes as its own too', () => {
  const require = createRequire(import.meta.url);
  const { prepareDir } = require('easybrandkit');
  // The names easybrandkit writes in a kit, which replace a file of that name there whether the earlier kit listed it or
  // not: its logos, first screen and card, and the pictures of the listings and profiles it reads, one type of
  // SOURCE_ORDER each, as <type>-icon, <type>-profile or <type>-shot-NN, in the format each picture came in.
  const lib = path.dirname(require.resolve('easybrandkit'));
  const code = ['kit.js', 'logos.js', 'stores.js', 'card.js'].map(file => readFileSync(path.join(lib, file), 'utf8')).join('\n');
  for (const form of ['`logo-${String(written.length + 1).padStart(2, "0")}.png`', 'file.replace(/\\.png$/, ".svg")', '"screen-01.png"', '"card.png"',
    '`shot-${String(++shot).padStart(2, "0")}`', '`${link.type}-${suffix}.${info.ext}`', 'ext: "png"', 'ext: "jpg"', 'ext: "webp"']) {
    assert.ok(code.includes(form), `easybrandkit no longer names a file with ${form}: see which files it writes now`);
  }
  const order = /^const SOURCE_ORDER = \[([^\]]*)\];$/m.exec(code);
  assert.ok(order, 'easybrandkit has no SOURCE_ORDER any more: see which listings and profiles it saves pictures of');
  const types = [...order[1].matchAll(/"([a-z]+)"/g)].map(match => match[1]);
  const ownName = new RegExp(`^(?:(?:logo|screen)-\\d+\\.png|logo-\\d+\\.svg|card\\.png|(?:${types.join('|')})-(?:icon|profile|shot-\\d+)\\.(?:png|jpg|webp))$`);
  const tools = kits.find(kit => kit.kit === 'launch-film').tools.filter(tool => tool.out?.replaces?.brand);
  assert.deepEqual(tools.map(tool => tool.name), ['make_launch_film', 'plan_launch_film', 'make_launch_stills']);
  // A kit as easybrandkit writes one: a file at each place its brand.json lists them.
  const marker = {
    version: 1,
    logos: [{ file: 'logo-01.png', svg: 'logo-01.svg' }],
    screenshots: [{ file: 'screen-01.png' }],
    card: { file: 'card.png' },
    stores: [{ type: 'appstore', assets: [{ file: 'appstore-icon.png' }, { file: 'appstore-shot-01.jpg' }] }],
  };
  const listed = ['logo-01.png', 'logo-01.svg', 'screen-01.png', 'card.png', 'appstore-icon.png', 'appstore-shot-01.jpg'];
  const names = [
    ...listed, 'logo-1.png', 'logo-123.png', 'logo-02.svg', 'screen-02.png', 'googleplay-shot-12.webp', 'x-profile.jpg',
    'youtube-icon.png', 'linkedin-profile.webp', 'threads-shot-3.png', 'pinterest-icon.jpg',
    'logo.png', 'logo-01.jpg', 'screen-01.svg', 'card.jpg', 'appstore-icon.gif', 'tiktok-icon.png', 'team-logo.svg', 'our-notes.md',
  ];
  for (const tool of tools) {
    const kind = tool.out.replaces.brand;
    const named = new RegExp(`^(?:${kind.names})$`);
    for (const name of names) assert.equal(named.test(name), ownName.test(name), `${tool.name}: ${name}`);

    const baseDir = mkdtempSync(path.join(os.tmpdir(), 'makersmcp-kit-'));
    try {
      const brand = path.join(baseDir, 'film', 'brand');
      for (const file of ['brand.json', ...kind.files, ...listed]) {
        mkdirSync(path.dirname(path.join(brand, file)), { recursive: true });
        writeFileSync(path.join(brand, file), file === 'brand.json' ? JSON.stringify(marker) : 'x');
      }
      const call = address => () => buildCommand(tool, { url: address, source: address, out_dir: 'film' }, { baseDir, installed: new Map() });
      const store = 'https://apps.apple.com/us/app/acme/id1234567890';
      assert.ok(call(store)().args.includes('--out'), tool.name);
      writeFileSync(path.join(brand, 'our-notes.md'), '# Our notes\n');
      // For an App Store page, launch-film may delete all of brand/.
      assert.throws(call(store), /film\/brand holds our-notes\.md, which its brand\.json does not list/, tool.name);
      // For a website, easybrandkit makes the kit again in it and keeps the note.
      assert.ok(call('https://acme.com')().args.includes('--out'), tool.name);
      // easybrandkit, making a kit again in that folder, deletes every one of the kit's files and keeps the note.
      prepareDir(brand);
      assert.deepEqual(readdirSync(brand), ['our-notes.md'], tool.name);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  }
});

test('check_video on a file that is not a video is an error, not a failed check, and shows no old report', async () => {
  await withLaunchFilm(async (client, outDir) => {
    writeFileSync(path.join(outDir, 'notes.txt'), 'not a video');
    mkdirSync(path.join(outDir, 'check'));
    writeFileSync(path.join(outDir, 'check', 'CHECK.md'), '# film.mp4: PASS\n\nAn earlier run.\n');
    const result = await client.callTool({ name: 'check_video', arguments: { film: 'notes.txt' } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.status, 'failed');
    assert.equal(result.structuredContent.passed, undefined);
    assert.match(text(result), /could not be read as a video/);
    assert.match(text(result), /The check could not run: the kit wrote no CHECK\.md\./);
    assert.doesNotMatch(text(result), /An earlier run/);
  });
});

test('check_video on a real video is a check, passed or failed, with its CHECK.md', { skip: !hasFfmpeg && 'ffmpeg is not installed' }, async () => {
  await withLaunchFilm(async (client, outDir) => {
    tinyVideo(outDir);
    const result = await client.callTool({ name: 'check_video', arguments: { film: 'tiny.mp4', lufs: -14, wait_seconds: 60 } });
    assert.notEqual(result.isError, true, text(result));
    assert.equal(result.structuredContent.status, 'done');
    assert.equal(typeof result.structuredContent.passed, 'boolean');
    assert.match(text(result), /### CHECK\.md/);
    assert.ok(readFileSync(path.join(outDir, 'check', 'CHECK.md'), 'utf8').length > 0);
  });
});

/** A program on PATH, or nothing. */
const onPath = name => (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, name)).find(file => existsSync(file));

/** Programs that fail as a broken build would, for a PATH where they stand in front of the real ones. */
function brokenPrograms(names) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'makersmcp-broken-'));
  for (const name of names) {
    writeFileSync(path.join(dir, name), '#!/bin/sh\necho "not this one" >&2\nexit 1\n');
    chmodSync(path.join(dir, name), 0o755);
  }
  return dir;
}

test('each kit gets the Chrome, the ffmpeg and the ffprobe check_setup reports under every name a kit reads them by, and check_setup names a setting that leads to no program', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'makersmcp-programs-'));
  try {
    const file = (...parts) => {
      mkdirSync(path.join(dir, ...parts.slice(0, -1)), { recursive: true });
      writeFileSync(path.join(dir, ...parts), '');
      return path.join(dir, ...parts);
    };
    const ffmpeg = file('a', 'ffmpeg');
    const ffprobe = file('a', 'ffprobe');
    const other = file('b', 'ffmpeg');
    const otherProbe = file('b', 'ffprobe');
    const apart = file('p', 'ffprobe');
    const chrome = file('c', 'chrome');
    const otherChrome = file('d', 'chromium');
    const placed = file('usr', 'bin', 'ffmpeg');
    const placedProbe = file('usr', 'bin', 'ffprobe');
    // A PATH with a Chrome and an ffmpeg on it, and one with nothing.
    const bin = path.join(dir, 'bin');
    const pathChrome = file('bin', 'google-chrome');
    const pathFfmpeg = file('bin', 'ffmpeg');
    const empty = path.join(dir, 'empty');
    mkdirSync(empty);
    const PATH = empty;
    const gone = path.join(dir, 'gone');
    // No usual places, so a Chrome or an ffmpeg of this machine's stays out of it.
    const none = { chrome: [], ffmpeg: [] };
    const env = (vars, places = none) => kitEnvironment({ PATH, ...vars }, places);

    // FFMPEG_PATH, which check_setup tells the user to set, reaches launch-film with the ffprobe beside it.
    assert.deepEqual(env({ FFMPEG_PATH: ffmpeg }), { PATH, FFMPEG_PATH: ffmpeg, LAUNCH_FILM_FFMPEG: ffmpeg, LAUNCH_FILM_FFPROBE: ffprobe });
    // launch-film's own setting reaches the other kits, and a setting that names no file gives way to it.
    assert.deepEqual(env({ FFMPEG_PATH: gone, LAUNCH_FILM_FFMPEG: other }), { PATH, FFMPEG_PATH: other, LAUNCH_FILM_FFMPEG: other, LAUNCH_FILM_FFPROBE: otherProbe });
    // Two settings that each name a file are the user's choice for each kit, and so is an ffprobe named apart.
    const both = { FFMPEG_PATH: ffmpeg, LAUNCH_FILM_FFMPEG: other };
    assert.deepEqual(env(both), { PATH, ...both, LAUNCH_FILM_FFPROBE: otherProbe });
    assert.deepEqual(env({ FFMPEG_PATH: ffmpeg, LAUNCH_FILM_FFPROBE: apart }), { PATH, FFMPEG_PATH: ffmpeg, LAUNCH_FILM_FFMPEG: ffmpeg, LAUNCH_FILM_FFPROBE: apart });
    assert.deepEqual(env({ CHROME_PATH: chrome, LAUNCH_FILM_CHROME: path.join(dir, 'old-chrome') }), { PATH, CHROME_PATH: chrome, LAUNCH_FILM_CHROME: chrome });
    assert.deepEqual(env({ LAUNCH_FILM_CHROME: chrome }), { PATH, CHROME_PATH: chrome, LAUNCH_FILM_CHROME: chrome });
    // Without a setting, each name gets the program found on PATH, which not every kit looks for under its name...
    assert.deepEqual(env({ PATH: bin }), { PATH: bin, CHROME_PATH: pathChrome, LAUNCH_FILM_CHROME: pathChrome, FFMPEG_PATH: pathFfmpeg, LAUNCH_FILM_FFMPEG: pathFfmpeg });
    // ...or where package managers put ffmpeg, which musicfit and launch-film do not look in, with the ffprobe beside it.
    assert.deepEqual(env({}, { chrome: [], ffmpeg: [path.join(dir, 'nowhere', 'ffmpeg'), placed] }),
      { PATH, FFMPEG_PATH: placed, LAUNCH_FILM_FFMPEG: placed, LAUNCH_FILM_FFPROBE: placedProbe });
    assert.deepEqual(env({}), { PATH });
    // A setting that names no file, a folder or nothing, stays while no setting names a program: the kits that read it stop.
    assert.deepEqual(env({ CHROME_PATH: gone }), { PATH, CHROME_PATH: gone });
    assert.deepEqual(env({ PATH: bin, CHROME_PATH: path.join(dir, 'c') }),
      { PATH: bin, CHROME_PATH: path.join(dir, 'c'), LAUNCH_FILM_CHROME: pathChrome, FFMPEG_PATH: pathFfmpeg, LAUNCH_FILM_FFMPEG: pathFfmpeg });

    const report = (vars, { enabled = new Set(['launch-film']), places = none } = {}) => setupReport({ version: '9.9.9', baseDir: dir, kits: [], enabled, env: { PATH, ...vars }, places })
      .split('\n').filter(line => /^(?:Chrome|ffmpeg|ffprobe): |^launch-film's |^[A-Z][A-Z_]+: /.test(line));
    const noChrome = 'Chrome: not found in the usual places. Install Chrome, Chromium, Edge or Brave, or set CHROME_PATH.';
    const noProgram = (name, value) => `${name}: ${value} is no program file, so the kits that read ${name} cannot run it. Point it at the program, or take it out.`;
    // The ffmpeg line is "ffmpeg: <path>" alone, the last line that starts so: a service's check reads it.
    assert.deepEqual(report({ FFMPEG_PATH: ffmpeg }), [noChrome, `ffmpeg: ${ffmpeg}`, `ffprobe: ${ffprobe}`]);
    assert.deepEqual(report(both), [noChrome, `ffmpeg: ${ffmpeg}`, `launch-film's ffmpeg: ${other} (LAUNCH_FILM_FFMPEG)`, `ffprobe: ${otherProbe}`]);
    // An ffprobe named apart is the one launch-film reads with, beside an ffmpeg a setting names or not.
    assert.deepEqual(report({ FFMPEG_PATH: ffmpeg, LAUNCH_FILM_FFPROBE: apart }), [noChrome, `ffmpeg: ${ffmpeg}`, `ffprobe: ${apart}`]);
    // launch-film's own Chrome, named apart from CHROME_PATH, is the one it runs.
    assert.deepEqual(report({ CHROME_PATH: chrome, LAUNCH_FILM_CHROME: otherChrome }).slice(0, 2), [`Chrome: ${chrome}`, `launch-film's Chrome: ${otherChrome} (LAUNCH_FILM_CHROME)`]);
    assert.deepEqual(report({ CHROME_PATH: chrome, LAUNCH_FILM_CHROME: chrome }).slice(0, 2), [`Chrome: ${chrome}`, 'ffmpeg: not found on PATH. Install ffmpeg or set FFMPEG_PATH.']);
    assert.deepEqual(report({ PATH: bin }), [`Chrome: ${pathChrome}`, `ffmpeg: ${pathFfmpeg}`,
      'ffprobe: not found beside ffmpeg or on PATH. launch-film reads videos and pictures with it: install it with ffmpeg, or set LAUNCH_FILM_FFPROBE.']);
    assert.deepEqual(report({}), [
      noChrome,
      'ffmpeg: not found on PATH. Install ffmpeg or set FFMPEG_PATH.',
      'ffprobe: not found beside ffmpeg or on PATH. launch-film reads videos and pictures with it: install it with ffmpeg, or set LAUNCH_FILM_FFPROBE.',
    ]);
    // A setting that names a folder, like a macOS app bundle, or a file that is not there gets a line of its own.
    const unusable = { PATH: bin, CHROME_PATH: path.join(dir, 'c'), FFMPEG_PATH: gone, LAUNCH_FILM_FFPROBE: path.join(dir, 'old', 'ffprobe') };
    assert.deepEqual(report(unusable), [
      `Chrome: ${pathChrome}`, noProgram('CHROME_PATH', path.join(dir, 'c')),
      `ffmpeg: ${pathFfmpeg}`, noProgram('FFMPEG_PATH', gone),
      'ffprobe: not found beside ffmpeg or on PATH. launch-film reads videos and pictures with it: install it with ffmpeg, or set LAUNCH_FILM_FFPROBE.',
      noProgram('LAUNCH_FILM_FFPROBE', path.join(dir, 'old', 'ffprobe')),
    ]);
    // With launch-film off, nothing reads its settings or ffprobe.
    assert.deepEqual(report(both, { enabled: new Set(['musicfit']) }), [noChrome, `ffmpeg: ${ffmpeg}`]);
    assert.deepEqual(report(unusable, { enabled: new Set(['musicfit']) }), [`Chrome: ${pathChrome}`, noProgram('CHROME_PATH', path.join(dir, 'c')), `ffmpeg: ${pathFfmpeg}`, noProgram('FFMPEG_PATH', gone)]);
    const ownGone = { LAUNCH_FILM_CHROME: gone, LAUNCH_FILM_FFMPEG: gone };
    assert.deepEqual(report(ownGone, { enabled: new Set(['musicfit']) }), [noChrome, 'ffmpeg: not found on PATH. Install ffmpeg or set FFMPEG_PATH.']);
    assert.deepEqual(report(ownGone).filter(line => line.startsWith('LAUNCH_FILM_')), [noProgram('LAUNCH_FILM_CHROME', gone), noProgram('LAUNCH_FILM_FFMPEG', gone)]);
    // A setting that names no file gives way to another name's that does, and is then no fault.
    assert.deepEqual(report({ ...unusable, LAUNCH_FILM_CHROME: otherChrome }).slice(0, 2), [`Chrome: ${otherChrome}`, `ffmpeg: ${pathFfmpeg}`]);

    // A bare command name is the program of that name on PATH, as a kit that spawns it finds it: each kit gets its full path,
    // so easyscreenshotkit, which looks for a file, runs it too, and neither check_setup nor a tool's start finds a fault in it.
    const both2 = { PATH: [bin, path.join(dir, 'a')].join(path.delimiter), FFMPEG_PATH: 'ffmpeg', LAUNCH_FILM_FFPROBE: 'ffprobe', CHROME_PATH: 'google-chrome' };
    const bare = env(both2);
    assert.deepEqual(bare, { ...both2, CHROME_PATH: pathChrome, LAUNCH_FILM_CHROME: pathChrome, FFMPEG_PATH: pathFfmpeg, LAUNCH_FILM_FFMPEG: pathFfmpeg, LAUNCH_FILM_FFPROBE: ffprobe });
    assert.deepEqual(report(both2), [`Chrome: ${pathChrome}`, `ffmpeg: ${pathFfmpeg}`, `ffprobe: ${ffprobe}`]);
    const every = kits.flatMap(kit => kit.tools.map(tool => settingsRead(kit.kit, tool.needs ?? kit.needs))).flat();
    assert.deepEqual(settingProblems(bare, every), []);
    // A bare name names the program of that name, not one PATH has under the usual name: every kit runs ffmpeg-6 here.
    const six = file('bin', 'ffmpeg-6');
    assert.deepEqual(env({ PATH: bin, FFMPEG_PATH: 'ffmpeg-6' }),
      { PATH: bin, CHROME_PATH: pathChrome, LAUNCH_FILM_CHROME: pathChrome, FFMPEG_PATH: six, LAUNCH_FILM_FFMPEG: six });
    assert.deepEqual(report({ PATH: bin, FFMPEG_PATH: 'ffmpeg-6' }), [`Chrome: ${pathChrome}`, `ffmpeg: ${six}`,
      'ffprobe: not found beside ffmpeg or on PATH. launch-film reads videos and pictures with it: install it with ffmpeg, or set LAUNCH_FILM_FFPROBE.']);
    // A bare name that is not on PATH names no program: check_setup's line, and the line a tool that runs it does not start with.
    const nowhere = env({ FFMPEG_PATH: 'ffmpeg7', LAUNCH_FILM_FFPROBE: 'ffprobe' });
    assert.deepEqual(nowhere, { PATH, FFMPEG_PATH: 'ffmpeg7', LAUNCH_FILM_FFPROBE: 'ffprobe' });
    assert.deepEqual(report({ FFMPEG_PATH: 'ffmpeg7', LAUNCH_FILM_FFPROBE: 'ffprobe' }).filter(line => / is no program file/.test(line)),
      [noProgram('FFMPEG_PATH', 'ffmpeg7'), noProgram('LAUNCH_FILM_FFPROBE', 'ffprobe')]);
    assert.deepEqual(settingProblems(nowhere, settingsRead('musicfit', ['ffmpeg'])), [noProgram('FFMPEG_PATH', 'ffmpeg7')]);
    // launch-film reads its own names, CHROME_PATH after LAUNCH_FILM_CHROME: a CHROME_PATH that names a folder stops the kits that
    // read it, while launch-film runs the Chrome found for its own name.
    const folderChrome = env({ PATH: bin, CHROME_PATH: path.join(dir, 'c') });
    assert.deepEqual(settingProblems(folderChrome, settingsRead('easybrandkit', ['chrome'])), [noProgram('CHROME_PATH', path.join(dir, 'c'))]);
    assert.deepEqual(settingProblems(folderChrome, settingsRead('launch-film', ['chrome', 'ffmpeg'])), []);
    assert.deepEqual(settingProblems(env({ CHROME_PATH: gone }), settingsRead('launch-film', ['chrome'])), [noProgram('CHROME_PATH', gone)]);
    assert.deepEqual(settingProblems(env({ LAUNCH_FILM_FFPROBE: gone, FFMPEG_PATH: other }), settingsRead('launch-film', ['ffmpeg'])), []);
    assert.deepEqual(settingProblems(env({ LAUNCH_FILM_FFPROBE: gone }), settingsRead('launch-film', ['ffmpeg'])), [noProgram('LAUNCH_FILM_FFPROBE', gone)]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('with ffmpeg reachable only through the backend\'s FFMPEG_PATH, check_setup names it and check_video reads the video with it and the ffprobe beside it', { skip: (!hasFfmpeg || process.platform === 'win32') && 'needs ffmpeg and ffprobe, and a shell' }, async () => {
  const real = onPath('ffmpeg');
  assert.ok(existsSync(path.join(path.dirname(real), 'ffprobe')), `no ffprobe beside ${real}`);
  // Links to them in a folder no PATH holds, so only the backend's FFMPEG_PATH leads there.
  const linked = mkdtempSync(path.join(os.tmpdir(), 'makersmcp-linked-'));
  const ffmpeg = path.join(linked, 'ffmpeg');
  const ffprobe = path.join(linked, 'ffprobe');
  symlinkSync(real, ffmpeg);
  symlinkSync(path.join(path.dirname(real), 'ffprobe'), ffprobe);
  // An ffmpeg and an ffprobe that fail stand first on PATH, as when a client starts the server with another PATH.
  const broken = brokenPrograms(['ffmpeg', 'ffprobe']);
  const env = { ...process.env, PATH: `${broken}${path.delimiter}${process.env.PATH}`, FFMPEG_PATH: ffmpeg };
  delete env.LAUNCH_FILM_FFMPEG;
  delete env.LAUNCH_FILM_FFPROBE;
  try {
    await withLaunchFilm(async (client, outDir) => {
      tinyVideo(outDir);
      const setup = text(await client.callTool({ name: 'check_setup', arguments: {} }));
      assert.match(setup, new RegExp(`^ffmpeg: ${ffmpeg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
      assert.match(setup, new RegExp(`^ffprobe: ${ffprobe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
      const result = await client.callTool({ name: 'check_video', arguments: { film: 'tiny.mp4', wait_seconds: 60 } });
      assert.equal(result.structuredContent?.status, 'done', text(result));
      assert.equal(typeof result.structuredContent.passed, 'boolean');
      assert.doesNotMatch(text(result), /could not be read as a video/);
    }, { backendEnv: env });
  } finally {
    rmSync(broken, { recursive: true, force: true });
    rmSync(linked, { recursive: true, force: true });
  }
});

test('a tool that reads a program from a setting that names no program file does not start, with check_setup\'s line, and its folder stays as it was', async () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'makersmcp-settings-'));
  const folder = path.join(baseDir, 'apps');
  const gone = path.join(baseDir, 'gone', 'ffprobe');
  mkdirSync(folder);
  const noProgram = (name, value) => `${name}: ${value} is no program file, so the kits that read ${name} cannot run it. Point it at the program, or take it out.`;
  const sessions = [];
  const connect = async vars => {
    const env = { ...process.env, ...vars };
    for (const name of ['CHROME_PATH', 'LAUNCH_FILM_CHROME', 'FFMPEG_PATH', 'LAUNCH_FILM_FFMPEG', 'LAUNCH_FILM_FFPROBE']) if (!(name in vars)) delete env[name];
    const server = createMcpServer({ backend: new LocalBackend({ baseDir, kitPaths, env }) });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    sessions.push({ client, server });
    return client;
  };
  const earlier = (out, files) => {
    for (const [file, body] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(baseDir, out, file)), { recursive: true });
      writeFileSync(path.join(baseDir, out, file), body);
    }
  };
  // A Chrome on PATH, which the kits never get to start here, so each name a kit reads gets one when no setting names it.
  const bin = path.join(baseDir, 'bin');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'google-chrome'), '#!/bin/sh\nexit 1\n');
  chmodSync(path.join(bin, 'google-chrome'), 0o755);
  const PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
  // A tool that starts: its job is there, and it is stopped at once.
  const starts = async (client, tool, args) => {
    const result = await client.callTool({ name: tool, arguments: { ...args, wait_seconds: 0 } });
    assert.ok(result.structuredContent?.job_id, `${tool} started: ${text(result)}`);
    await client.callTool({ name: 'cancel_job', arguments: { job_id: result.structuredContent.job_id } });
  };
  const notStarted = async (client, tool, args, line) => {
    const result = await client.callTool({ name: tool, arguments: { ...args, wait_seconds: 60 } });
    assert.equal(result.isError, true, tool);
    assert.equal(result.structuredContent, undefined, `${tool}: no job started`);
    assert.match(text(result), /: not started\n\n/, tool);
    assert.ok(text(result).endsWith(line), `${tool}: ${text(result)}`);
  };
  try {
    // A folder, like a whole app bundle, as CHROME_PATH: no tool that opens a browser by it starts, and a brand kit there stays.
    const folderChrome = await connect({ CHROME_PATH: folder, PATH });
    earlier('brand', EARLIER.brand);
    earlier('film', EARLIER.film);
    writeFileSync(path.join(baseDir, 'manifest.json'), '{ "screenshots": [] }\n');
    const before = filesIn(path.join(baseDir, 'brand'));
    for (const [tool, args] of [
      ['make_brand_kit', { url: SITE, out_dir: 'brand' }], ['take_screenshots', { url: SITE, out_dir: 'brand' }], ['plan_launch_film', { url: SITE, out_dir: 'brand' }],
      // From an address, the pictures plan a film first, which runs easybrandkit.
      ['make_launch_stills', { source: SITE, for: ['og'], out_dir: 'brand' }],
    ]) {
      await notStarted(folderChrome, tool, args, noProgram('CHROME_PATH', folder));
      assert.deepEqual(filesIn(path.join(baseDir, 'brand')), before, `${tool} left the folder as it was`);
    }
    // launch-film reads its own LAUNCH_FILM_CHROME first, which gets the Chrome found, and runs no easybrandkit given a brand
    // kit or a film.json; check_pwa_screenshots runs no program.
    await starts(folderChrome, 'render_launch_film', { film: 'film/film.json' });
    await starts(folderChrome, 'make_launch_stills', { source: 'film/film.json', for: ['og'] });
    await starts(folderChrome, 'plan_launch_film', { url: SITE, brand: 'brand', out_dir: 'film-b' });
    await starts(folderChrome, 'make_launch_film', { url: SITE, brand: 'brand/brand.json', out_dir: 'film-c' });
    await starts(folderChrome, 'check_pwa_screenshots', { manifest: 'manifest.json' });

    // A folder as LAUNCH_FILM_CHROME stops launch-film's tools that open a browser, while check_video, which runs only
    // ffmpeg, and easybrandkit, which reads CHROME_PATH, start.
    const folderOwn = await connect({ LAUNCH_FILM_CHROME: folder, PATH });
    await notStarted(folderOwn, 'render_launch_film', { film: 'film/film.json' }, noProgram('LAUNCH_FILM_CHROME', folder));
    await notStarted(folderOwn, 'make_launch_stills', { source: 'film/film.json', for: ['og'] }, noProgram('LAUNCH_FILM_CHROME', folder));
    await starts(folderOwn, 'check_video', { film: 'film/film.mp4', out_dir: 'film-check' });
    await starts(folderOwn, 'make_brand_kit', { url: SITE, out_dir: 'brand-b' });

    // ffmpeg and ffprobe settings that name nothing: the tools that run them do not start, and a demo there stays.
    const noFfmpeg = await connect({ FFMPEG_PATH: path.join(baseDir, 'gone', 'ffmpeg'), LAUNCH_FILM_FFPROBE: gone });
    earlier('demo', EARLIER.demo);
    const demo = filesIn(path.join(baseDir, 'demo'));
    writeFileSync(path.join(baseDir, 'film.mp4'), 'mp4');
    for (const [tool, args, name, value] of [
      ['record_demo_video', { url: SITE, out_dir: 'demo' }, 'FFMPEG_PATH', path.join(baseDir, 'gone', 'ffmpeg')],
      ['analyze_music', { track: 'film.mp4', out_dir: 'demo' }, 'FFMPEG_PATH', path.join(baseDir, 'gone', 'ffmpeg')],
      ['check_video', { film: 'film.mp4' }, 'LAUNCH_FILM_FFPROBE', gone],
    ]) {
      const result = await noFfmpeg.callTool({ name: tool, arguments: { ...args, wait_seconds: 60 } });
      assert.equal(result.structuredContent, undefined, `${tool}: no job started: ${text(result)}`);
      assert.ok(text(result).endsWith(noProgram(name, value)), `${tool}: ${text(result)}`);
      assert.deepEqual(filesIn(path.join(baseDir, 'demo')), demo, `${tool} left the folder as it was`);
    }
    assert.ok(!existsSync(path.join(baseDir, 'check')), 'check_video wrote nothing');
    // A tool that runs fewer programs than its kit is not stopped by the others' settings: take_screenshots runs no ffmpeg,
    // and launch_film_guide no program at all.
    const shots = await noFfmpeg.callTool({ name: 'take_screenshots', arguments: { url: 'http://127.0.0.1:9/', out_dir: 'shots', wait_seconds: 0 } });
    assert.ok(shots.structuredContent?.job_id, text(shots));
    await noFfmpeg.callTool({ name: 'cancel_job', arguments: { job_id: shots.structuredContent.job_id } });
    const guide = await noFfmpeg.callTool({ name: 'launch_film_guide', arguments: { topic: 'looks', wait_seconds: 60 } });
    assert.equal(guide.structuredContent?.status, 'done', text(guide));
    // A tool's needs are some of its kit's.
    for (const needs of [['gpu'], 'chrome']) {
      const broken = structuredClone(kits.find(kit => kit.kit === 'musicfit'));
      broken.tools[0].needs = needs;
      assert.throws(() => validateKitDefinition(broken), /needs lists the programs the tool runs, some of its kit's needs \(ffmpeg\)/, JSON.stringify(needs));
    }
    // usesUnless names parameters of the tool that take a file, beside its uses: each of them, not one among others.
    for (const [name, usesUnless, uses] of [
      ['plan_launch_film', ['look'], true], ['plan_launch_film', ['logo'], true], ['plan_launch_film', [], true], ['render_launch_film', ['film'], false],
      ['plan_launch_film', ['brand', 'look'], true],
    ]) {
      const broken = structuredClone(kits.find(kit => kit.kit === 'launch-film'));
      const tool = broken.tools.find(entry => entry.name === name);
      tool.usesUnless = usesUnless;
      if (!uses) delete tool.uses;
      assert.throws(() => validateKitDefinition(broken), new RegExp(`${name}\\.usesUnless names parameters of ${name} that take a file`), JSON.stringify(usesUnless));
    }

    // A bare command name the kits find on PATH is a working setting: check_video reads a video with ffprobe by that name.
    if (hasFfmpeg) {
      const bare = await connect({ FFMPEG_PATH: 'ffmpeg', LAUNCH_FILM_FFMPEG: 'ffmpeg', LAUNCH_FILM_FFPROBE: 'ffprobe' });
      const setup = text(await bare.callTool({ name: 'check_setup', arguments: {} }));
      assert.doesNotMatch(setup, /is no program file/);
      tinyVideo(baseDir);
      const checked = await bare.callTool({ name: 'check_video', arguments: { film: 'tiny.mp4', out_dir: 'tiny-check', wait_seconds: 60 } });
      assert.equal(checked.structuredContent?.status, 'done', text(checked));
    }
  } finally {
    for (const { client, server } of sessions) {
      await client.close();
      await server.close();
    }
    rmSync(baseDir, { recursive: true, force: true });
  }
});

/** The kit's own words, from the code of its installed package: its guides may say what its code no longer does. */
function kitWords(kit) {
  const installed = resolveKit(kit, kitPaths);
  assert.ok(installed.dir, `${kit.kit}: ${installed.reason}`);
  const words = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) walk(full);
      } else if (/\.[cm]?js$/.test(entry.name)) {
        words.push(readFileSync(full, 'utf8'));
      }
    }
  };
  walk(installed.dir);
  return words.join('\n');
}

/** A refuses entry's own words, without the {<param>} and {<param>:name} a call's file fills. */
const literalParts = words => words.split(/\{[a-z][a-z0-9_]*(?::name)?\}/).filter(part => part.trim());

/**
 * What each tool's kit says when it fails once it has begun its work, in the words of its
 * code. None of them may hold a refusal of the tool's, nor be part of one, so a job that ran
 * gets its failed Next line, never the refused one.
 */
const AFTER_THE_FOLDER = {
  make_brand_kit: ['No Chrome, Chromium, Edge or Brave found', 'Could not open', 'answered with a bot check', 'still shows no content'],
  make_font_kit: ['No Chrome, Chromium, Edge or Brave found', 'answered with a bot check', 'showed no text and loaded no fonts'],
  take_screenshots: ['No Chrome, Chromium, Edge or Brave found', 'Could not open', 'answered with a bot check', 'No page could be captured', 'Could not save'],
  record_demo_video: ['No Chrome, Chromium, Edge or Brave found', 'nothing on the page matches', 'answered with a bot check', 'time ran out while recording', 'No frame was recorded'],
  plan_launch_film: ['No Chrome, Chromium, Edge or Brave found', 'Could not open', 'answered with a bot check', 'still shows no content'],
  make_launch_film: ['No Chrome, Chromium, Edge or Brave found', 'Could not open', 'answered with a bot check', 'still shows no content', 'Chrome was not found', 'film.json has problems'],
};

test('each refusal a kit file names is words of that kit\'s code, or of a kit it runs, and none is part of what a kit says once it has begun its work', () => {
  for (const kit of kits) {
    for (const tool of kit.tools) {
      // launch-film passes on easybrandkit's reason when it runs easybrandkit.
      const used = Object.values(tool.uses ?? {}).map(name => kits.find(entry => entry.kit === name)).filter(Boolean);
      const words = [kit, ...used].map(kitWords).join('\n');
      for (const refusal of tool.refuses ?? []) {
        for (const part of literalParts(refusal)) {
          assert.ok(words.includes(part), `${tool.name}.refuses: "${part}" is in no code of ${[kit, ...used].map(entry => entry.package).join(' or ')}`);
        }
        for (const after of AFTER_THE_FOLDER[tool.name] ?? []) {
          for (const part of literalParts(refusal)) {
            assert.ok(!after.includes(part.trim()) && !part.includes(after), `${tool.name}.refuses: "${refusal}" is part of "${after}", which comes once the kit has begun its work`);
          }
        }
      }
      for (const after of AFTER_THE_FOLDER[tool.name] ?? []) assert.ok(words.includes(after), `${tool.name}: "${after}" is in no code of its kit any more`);
    }
  }
});

/** Files as [path, size] pairs, for what a run left in a folder. */
function filesIn(dir) {
  const found = [];
  const walk = (at, rel) => {
    if (!existsSync(at)) return;
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(at, entry.name), name);
      else found.push(name);
    }
  };
  walk(dir, '');
  return found.sort();
}

// An earlier run of each kit as its own folder check takes it, without a browser.
const EARLIER = {
  brand: {
    'brand.json': JSON.stringify({ version: 1, name: 'Acme', logos: [{ file: 'logo-01.png' }], screenshots: [{ file: 'screen-01.png' }], card: { file: 'card.png' } }),
    'BRAND.md': '# Acme\n', '_brand.yml': 'meta:\n  name: Acme\n', 'logo-01.png': 'png', 'screen-01.png': 'png', 'card.png': 'png',
  },
  fonts: { 'fonts.json': JSON.stringify({ version: 1, generator: 'easyfontkit 0.1.1', families: [] }), 'FONTS.md': '# Fonts\n', 'fonts.css': ':root {}\n' },
  shots: {
    'manifest.json': JSON.stringify({ version: 1, tool: 'easyscreenshotkit 0.1.1', pages: [] }),
    'SCREENSHOTS.md': '# Screenshots\n', 'sheet.png': 'png', '01-home-desktop.png': 'png',
  },
  demo: {
    'steps.json': JSON.stringify({ kind: 'demo', tool: 'easyscreenshotkit 0.1.1', steps: [] }),
    'demo.mp4': 'mp4', 'demo.gif': 'gif', 'poster.png': 'png', 'demo.yaml': 'steps:\n  - wait: 1\n',
  },
  film: { 'film.json': '{ "version": 1 }\n', 'words.json': '{}\n', 'film.mp4': 'mp4', 'film.timeline.json': '{}\n' },
};

/**
 * A launcher (LocalBackendOptions.launcher) that runs each kit's supervisor with some of the kit's settings set apart, as a
 * service's run-kit sets them, like a browser that is not there. makersmcp starts no tool whose own setting names no program
 * file, so such a setting can reach a kit only this way. It needs /usr/bin/env.
 */
const SUPERVISOR = fileURLToPath(new URL('../dist/supervise.js', import.meta.url));
const launcherWith = settings => ['/usr/bin/env', ...Object.entries(settings).map(([name, value]) => `${name}=${value}`), process.execPath, SUPERVISOR];
/** The settings of a browser that is not there, so each kit that gets past its own checks fails as it starts one. */
const noBrowser = dir => ({ CHROME_PATH: path.join(dir, 'no-chrome'), LAUNCH_FILM_CHROME: path.join(dir, 'no-chrome') });

// Each refusal a kit file lists, as a call its kit refuses with those words: [tool, refuses entry, arguments, the
// files of the folder it saves in, which hold an earlier run, and the ffmpeg it gets]. @/ is a path in that folder.
const SITE = 'https://acme.example.com/';
const BAD_STEPS = 'steps:\n  - click: { target: "#x", zoom: 9 }\n';
const REFUSALS = [
  ['make_brand_kit', "not the brand's own site", { url: 'https://x.com/acme' }, EARLIER.brand],
  ['make_brand_kit', 'holds no earlier brand kit', { url: SITE }, { 'notes.txt': 'mine' }],
  ['make_brand_kit', 'Not a web address', { url: 'https://[bad]/' }, EARLIER.brand],
  ['make_font_kit', 'holds no earlier font kit', { url: SITE }, { 'notes.txt': 'mine' }],
  ['make_font_kit', 'Not a web address', { url: 'https://[bad]/' }, EARLIER.fonts],
  ['take_screenshots', 'Unknown size: ', { url: SITE, sizes: ['huge'] }, EARLIER.shots],
  ['take_screenshots', 'a scale goes from', { url: SITE, sizes: ['desktop@9'] }, EARLIER.shots],
  ['take_screenshots', 'width and height go from', { url: SITE, sizes: ['100x100'] }, EARLIER.shots],
  ['take_screenshots', 'is given twice in --sizes', { url: SITE, sizes: ['desktop', 'desktop'] }, EARLIER.shots],
  ['take_screenshots', 'needs at least one size', { url: SITE, sizes: [' '] }, EARLIER.shots],
  ['take_screenshots', 'is not a page of', { url: SITE, page: ['https://other.example.com/x'] }, EARLIER.shots],
  ['take_screenshots', 'holds no earlier easyscreenshotkit run', { url: SITE }, { 'notes.txt': 'mine' }],
  ['take_screenshots', 'Not a web address', { url: 'https://[bad]/' }, EARLIER.shots],
  ['record_demo_video', 'The demo needs ffmpeg', { url: SITE }, EARLIER.demo, 'none'],
  ['record_demo_video', 'has no H.264 encoder', { url: SITE }, EARLIER.demo, 'no H.264'],
  ['record_demo_video', 'holds no earlier easyscreenshotkit demo', { url: SITE }, { 'notes.txt': 'mine' }, 'H.264'],
  ['record_demo_video', 'Not a web address', { url: 'https://[bad]/' }, EARLIER.demo],
  ['record_demo_video', 'easyscreenshotkit demo: {steps:name}: ', { url: SITE, steps: '@/bad.yaml' }, { ...EARLIER.demo, 'bad.yaml': BAD_STEPS }],
  ['record_demo_video', 'could not read {steps}: ', { url: SITE, steps: '@/sub' }, { ...EARLIER.demo, 'sub/notes.txt': 'mine' }],
  // A file that is no picture, or a folder, which makersmcp passes on as a file and the kit refuses as no colour either.
  ['record_demo_video', '--background takes a colour', { url: SITE, background: '@/backdrop.bmp' }, { ...EARLIER.demo, 'backdrop.bmp': 'BM' }],
  ['record_demo_video', '--background takes a colour', { url: SITE, background: '@/pictures' }, { ...EARLIER.demo, 'pictures/backdrop.png': 'png' }],
  ['make_launch_film', 'is not a command or an address', { url: 'http://localhost:9/' }, EARLIER.film],
  // launch-film 0.3 looks at the Chrome a film renders with before easybrandkit reads the address, so this one gets a script there.
  ['make_launch_film', "not the brand's own site", { url: 'https://x.com/acme' }, EARLIER.film, 'a Chrome script'],
  ['make_launch_film', 'no brand.json at', { url: SITE, brand: 'kitless' }, EARLIER.film],
  ['make_launch_film', 'holds no earlier brand kit', { url: SITE }, { ...EARLIER.film, 'brand/notes.txt': 'mine' }],
  ['plan_launch_film', "give the site's address", { url: 'http://localhost:9/' }, EARLIER.film],
  ['plan_launch_film', "not the brand's own site", { url: 'https://x.com/acme' }, EARLIER.film],
  ['plan_launch_film', 'no brand.json at', { url: SITE, brand: 'kitless' }, EARLIER.film],
  ['plan_launch_film', 'holds no earlier brand kit', { url: SITE }, { ...EARLIER.film, 'brand/notes.txt': 'mine' }],
];

test('every refusal a kit file lists has a call here that the kit refuses with it', () => {
  const tools = new Map(kits.flatMap(kit => kit.tools.map(tool => [tool.name, tool])));
  for (const [name, tool] of tools) {
    for (const words of tool.refuses ?? []) {
      assert.ok(REFUSALS.some(([which, entry]) => which === name && entry === words), `${name}.refuses: "${words}" has no call in REFUSALS of tests/kits.test.mjs`);
    }
  }
  for (const [name, words] of REFUSALS) assert.ok(tools.get(name)?.refuses?.includes(words), `REFUSALS: "${words}" is not in ${name}.refuses`);
});

test('a call a kit refuses, or a run that fails, leaves an earlier run in its folder as it was, and its Next line says nothing was deleted', { skip: process.platform === 'win32' && 'its launcher needs /usr/bin/env' }, async () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'makersmcp-refused-'));
  // No browser for the kits, which the launcher sets: each kit that gets past its own checks fails as it starts one.
  const env = { ...process.env };
  for (const name of ['CHROME_PATH', 'LAUNCH_FILM_CHROME', 'FFMPEG_PATH', 'LAUNCH_FILM_FFMPEG']) delete env[name];
  // An ffmpeg that lists its encoders, with H.264 or without, for the checks the demo makes before its folder.
  const fake = (name, encoders) => {
    const file = path.join(baseDir, name);
    // It says its version when asked, as easyscreenshotkit asks before anything else, and lists its encoders otherwise.
    writeFileSync(file, `#!/bin/sh\ncase " $* " in *" -version "*) echo 'ffmpeg version 6.1.1 Copyright (c) 2000-2023 the FFmpeg developers' ;; *) printf '%s\\n' '${encoders}' ;; esac\n`);
    chmodSync(file, 0o755);
    return file;
  };
  const ffmpegs = {
    none: path.join(baseDir, 'no-ffmpeg'),
    'no H.264': fake('ffmpeg-without-h264', ' V....D mjpeg  Motion JPEG'),
    'H.264': fake('ffmpeg-with-h264', ' V....D libx264  libx264 H.264'),
  };
  mkdirSync(path.join(baseDir, 'kitless'));
  writeFileSync(path.join(baseDir, 'kitless', 'notes.txt'), 'no brand.json here');
  const sessions = new Map();
  const clientFor = async ffmpeg => {
    if (!sessions.has(ffmpeg)) {
      // A script in launch-film's Chrome's place, which launch-film takes without asking it, as it takes Google Chrome's own launcher.
      const chrome = ffmpeg === 'a Chrome script' ? { LAUNCH_FILM_CHROME: fake('chrome-script', '') } : {};
      const program = ffmpeg && ffmpeg !== 'a Chrome script' ? { FFMPEG_PATH: ffmpegs[ffmpeg] } : {};
      const backend = new LocalBackend({ baseDir, kitPaths, env, launcher: launcherWith({ ...noBrowser(baseDir), ...chrome, ...program }) });
      const server = createMcpServer({ backend });
      const client = new Client({ name: 'test-client', version: '1.0.0' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      sessions.set(ffmpeg, { client, server });
    }
    return sessions.get(ffmpeg).client;
  };
  let n = 0;
  const run = async (tool, args, earlier, ffmpeg) => {
    const out = `case-${++n}`;
    for (const [file, body] of Object.entries(earlier)) {
      mkdirSync(path.dirname(path.join(baseDir, out, file)), { recursive: true });
      writeFileSync(path.join(baseDir, out, file), body);
    }
    mkdirSync(path.join(baseDir, out), { recursive: true });
    const call = Object.fromEntries(Object.entries(args).map(([key, value]) => [key, typeof value === 'string' && value.startsWith('@/') ? `${out}/${value.slice(2)}` : value]));
    const before = filesIn(path.join(baseDir, out));
    const client = await clientFor(ffmpeg);
    const result = await client.callTool({ name: tool, arguments: { ...call, out_dir: out, wait_seconds: 60 } });
    return { result, call, before, after: filesIn(path.join(baseDir, out)), next: result.structuredContent?.next ?? '' };
  };
  try {
    for (const [tool, words, args, earlier, ffmpeg] of REFUSALS) {
      const { result, call, before, after, next } = await run(tool, args, earlier, ffmpeg);
      const label = `${tool} ${JSON.stringify(args)}`;
      assert.equal(result.structuredContent?.status, 'failed', `${label}: ${text(result)}`);
      // The words as the kit wrote them, with the file the call gave in their place, and its flags as the result writes them.
      const kit = kits.find(entry => entry.tools.some(item => item.name === tool));
      const filled = words.replace(/\{([a-z_]+)(:name)?\}/g, (_, param, name) => (name ? path.basename(call[param]) : path.join(baseDir, call[param])));
      const shown = inParameterWords(filled, flagWords(kit, kit.tools.find(item => item.name === tool)));
      assert.ok(text(result).includes(shown), `${label} is not refused with "${shown}": ${text(result)}`);
      assert.deepEqual(after, before, `${label} left the folder as it was`);
      assert.doesNotMatch(next, /gone|deleted|emptied/, label);
      assert.match(next, /lists this tool's errors and their fixes\.$/, label);
    }

    const failures = [
      ['make_brand_kit', { url: SITE }, EARLIER.brand],
      ['make_font_kit', { url: SITE }, EARLIER.fonts],
      ['take_screenshots', { url: SITE }, EARLIER.shots],
    ];
    if (hasFfmpeg) failures.push(['record_demo_video', { url: SITE, pages: 1 }, EARLIER.demo]);
    // Each kit makes a run's files apart and puts them in place only once the run has ended well, so one that fails after it
    // began its work leaves the earlier run as it was too, as its Next line says.
    for (const [tool, args, earlier] of failures) {
      const { result, before, after, next } = await run(tool, args, earlier);
      const label = `${tool} ${JSON.stringify(args)}`;
      assert.equal(result.structuredContent?.status, 'failed', `${label}: ${text(result)}`);
      assert.match(text(result), /No Chrome, Chromium, Edge or Brave found/, label);
      assert.deepEqual(after, before, `${label} left the folder as it was`);
      assert.doesNotMatch(next, /gone|deleted|emptied/, label);
      assert.match(next, / leaves \S+ as it was, [\w' ]+ there too\.$/, label);
    }

    // Given a brand kit and the page's words, make_launch_film plans without a browser and fails at the render: the plan stays
    // in the run's own folder, and the earlier plan and film are as they were, as the Next line says.
    mkdirSync(path.join(baseDir, 'kit'));
    writeFileSync(path.join(baseDir, 'kit', 'brand.json'), JSON.stringify({ version: 1, name: 'Acme', url: SITE, colors: [{ hex: '#1f6f4a', role: 'button' }, { hex: '#f4efe6', role: 'surface' }], logos: [], screenshots: [] }));
    writeFileSync(path.join(baseDir, 'page-words.json'), JSON.stringify({ lang: 'en', title: 'Acme: plants, remembered', description: 'Acme tells you which plant needs water today.', siteName: 'Acme',
      headings: [{ level: 1, text: 'Keep every plant alive', after: 'Acme tells you which plant needs water today.' }, { level: 2, text: 'Every pot, every window', after: 'It learns from each one.' }], ctas: ['Start for free'], paragraphs: [], jsonld: [] }));
    // A script in Chrome's place passes launch-film's look before any work and renders nothing.
    const planned = await run('make_launch_film', { url: SITE, brand: 'kit', words: 'page-words.json' }, EARLIER.film, 'a Chrome script');
    const folder = path.join(baseDir, `case-${n}`);
    assert.equal(planned.result.structuredContent?.status, 'failed', text(planned.result));
    assert.match(text(planned.result), /Planned \d+ clips in the \w+ look/);
    assert.deepEqual(planned.after, planned.before, 'the failed film left its folder as it was');
    for (const file of ['film.json', 'words.json', 'film.mp4', 'film.timeline.json']) assert.equal(readFileSync(path.join(folder, file), 'utf8'), EARLIER.film[file], file);
    assert.ok(planned.next.includes(`A run that fails leaves ${folder} as it was: an earlier plan, brand/ and film there are as they were.`), planned.next);
  } finally {
    for (const { client, server } of sessions.values()) {
      await client.close();
      await server.close();
    }
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test('a file the call gives that a demo run writes over in its folder, like a steps file saved as its steps.json, stops the call before the job starts', async () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'makersmcp-runfiles-'));
  // No browser for the kit, which the launcher sets: a call that starts fails as the kit starts one.
  const posix = process.platform !== 'win32';
  const env = { ...process.env };
  for (const name of ['CHROME_PATH', 'LAUNCH_FILM_CHROME']) delete env[name];
  const server = createMcpServer({ backend: new LocalBackend({ baseDir, kitPaths, env, ...(posix ? { launcher: launcherWith(noBrowser(baseDir)) } : {}) }) });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const steps = `${JSON.stringify({ url: SITE, steps: [{ visit: SITE }, { wait: 1 }] })}\n`;
  const write = (file, body) => {
    mkdirSync(path.dirname(path.join(baseDir, file)), { recursive: true });
    writeFileSync(path.join(baseDir, file), body);
  };
  const call = args => client.callTool({ name: 'record_demo_video', arguments: { url: SITE, wait_seconds: 60, ...args } });
  try {
    const earlierIn = folder => Object.fromEntries(Object.entries(EARLIER.demo).map(([name, body]) => [`${folder}/${name}`, body]));
    // The folder the demo saves in without out_dir.
    const own = 'easyscreenshotkit-demo-acme.example.com';
    const refused = [
      // The user's steps file, saved in the demo's folder as steps.json.
      [{ steps: 'one/steps.json', out_dir: 'one' }, { 'one/steps.json': steps }, 'steps', 'steps.json', 'one'],
      // An earlier demo's poster as the backdrop, which the run deletes before it records.
      [{ background: 'two/poster.png', out_dir: 'two' }, earlierIn('two'), 'background', 'poster.png', 'two'],
      // Its GIF, a picture the backdrop takes too.
      [{ background: 'five/demo.gif', out_dir: 'five' }, earlierIn('five'), 'background', 'demo.gif', 'five'],
      // A steps file saved as steps.json in the folder the demo saves in by default, with no out_dir.
      [{ steps: `${own}/steps.json` }, { [`${own}/steps.json`]: steps }, 'steps', 'steps.json', own],
    ];
    if (posix) refused.push([{ steps: 'mine.json', out_dir: 'three' }, { 'mine.json': steps }, 'steps', 'steps.json', 'three']);
    for (const [args, files, param, name, folder] of refused) {
      for (const [file, body] of Object.entries(files)) write(file, body);
      // The fifth: the folder's steps.json is a link to the steps file the call gives by its own path.
      if (folder === 'three') {
        mkdirSync(path.join(baseDir, 'three'));
        symlinkSync(path.join(baseDir, 'mine.json'), path.join(baseDir, 'three', 'steps.json'));
      }
      const before = filesIn(path.join(baseDir, folder));
      const result = await call(args);
      const label = JSON.stringify(args);
      assert.equal(result.isError, true, label);
      assert.equal(result.structuredContent, undefined, `${label}: no job started`);
      assert.match(text(result), /^## Demo video of a website: not started\n\n/, label);
      const given = path.join(baseDir, args[param]);
      assert.ok(text(result).includes(`${param}: ${given} is the ${name} of ${path.join(baseDir, folder)}, where record_demo_video saves, and a run there writes over that file. Give it another name or folder, or give another out_dir.`), text(result));
      assert.deepEqual(filesIn(path.join(baseDir, folder)), before, `${label} left the folder as it was`);
    }
    // Under any other name the steps file may sit in the demo's folder: the run starts, and fails here for want of a browser, leaving it.
    if (posix) {
      write('four/app.json', steps);
      const started = await call({ steps: 'four/app.json', out_dir: 'four' });
      assert.equal(started.structuredContent?.status, 'failed', text(started));
      assert.match(text(started), /No Chrome, Chromium, Edge or Brave found/);
      assert.deepEqual(filesIn(path.join(baseDir, 'four')), ['app.json']);
      assert.match(started.structuredContent.next, /leaves \S+four as it was, an earlier demo there too\.$/);
    }
    // A kit file whose runFiles names anything but a file in the folder itself is refused when it is read.
    const screenshots = kits.find(kit => kit.kit === 'easyscreenshotkit');
    for (const runFiles of [['frames/demo.mp4'], ['../demo.mp4'], []]) {
      const broken = structuredClone(screenshots);
      broken.tools.find(tool => tool.name === 'record_demo_video').out.runFiles = runFiles;
      assert.throws(() => validateKitDefinition(broken), /record_demo_video: out\.runFiles names the files a run writes in its folder, like demo\.mp4/, JSON.stringify(runFiles));
    }
  } finally {
    await client.close();
    await server.close();
    rmSync(baseDir, { recursive: true, force: true });
  }
});
