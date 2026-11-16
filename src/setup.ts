import { accessSync, constants, existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expandHome } from './args.js';
import { isInstalled, type InstalledKit, type MissingKit } from './kits.js';
import { inWords } from './texts.js';

const CHROME_NAMES = [
  'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
  'microsoft-edge', 'microsoft-edge-stable', 'brave-browser', 'chrome',
];

const CHROME_PLACES = process.platform === 'darwin'
  ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ]
  : process.platform === 'win32'
    ? [
      [process.env['PROGRAMFILES'], 'Google/Chrome/Application/chrome.exe'],
      [process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'],
      [process.env['LOCALAPPDATA'], 'Google/Chrome/Application/chrome.exe'],
      [process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'],
      [process.env['PROGRAMFILES'], 'BraveSoftware/Brave-Browser/Application/brave.exe'],
    ].filter(([base]) => base).map(([base, rest]) => path.join(base!, rest!))
    : [];

const NEED_NAMES: Record<string, string> = { chrome: 'Chrome', ffmpeg: 'ffmpeg' };

/** Where package managers put ffmpeg, for a client whose PATH is short: easyscreenshotkit looks there too. */
const FFMPEG_PLACES = process.platform === 'win32'
  ? []
  : ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', '/snap/bin/ffmpeg'];

/** The places, besides PATH, where a Chrome and an ffmpeg are looked for. A test gives its own. */
export interface ProgramPlaces {
  chrome: string[];
  ffmpeg: string[];
}

export const PROGRAM_PLACES: ProgramPlaces = { chrome: CHROME_PLACES, ffmpeg: FFMPEG_PLACES };

/**
 * The settings the kits read for the programs they run, in the order check_setup reads them:
 * CHROME_PATH, FFMPEG_PATH and FFPROBE_PATH are the names most kits read, and launch-film reads
 * its own names.
 */
const CHROME_SETTINGS = ['CHROME_PATH', 'LAUNCH_FILM_CHROME'];
const FFMPEG_SETTINGS = ['FFMPEG_PATH', 'LAUNCH_FILM_FFMPEG'];
const FFPROBE_SETTINGS = ['FFPROBE_PATH', 'LAUNCH_FILM_FFPROBE'];
/**
 * Each ffprobe setting with the ffmpeg settings of the kits that read it, in their order: the
 * ffprobe beside the ffmpeg a kit runs is the one it comes with.
 */
const FFPROBE_BESIDE: Array<[string, string[]]> = [
  ['FFPROBE_PATH', ['FFMPEG_PATH', 'LAUNCH_FILM_FFMPEG']],
  ['LAUNCH_FILM_FFPROBE', ['LAUNCH_FILM_FFMPEG', 'FFMPEG_PATH']],
];
/**
 * launch-film's own settings, with the kits that read each, which check_setup speaks of while one
 * of them is on: reframekit reads launch-film's ffmpeg and ffprobe after FFMPEG_PATH and FFPROBE_PATH.
 */
const LAUNCH_FILM_SETTINGS: Record<string, string[]> = {
  LAUNCH_FILM_CHROME: ['launch-film'],
  LAUNCH_FILM_FFMPEG: ['launch-film', 'reframekit'],
  LAUNCH_FILM_FFPROBE: ['launch-film', 'reframekit'],
};
/** The ffmpeg settings of the kits that read other names than FFMPEG_PATH, in the order each reads them. */
const FFMPEG_READ: Record<string, string[]> = {
  'launch-film': ['LAUNCH_FILM_FFMPEG'],
  reframekit: ['FFMPEG_PATH', 'LAUNCH_FILM_FFMPEG'],
};
/** The kits that read videos with ffprobe, each with the settings it reads it from, in its order. */
const FFPROBE_READ: Record<string, string[]> = {
  'launch-film': ['LAUNCH_FILM_FFPROBE'],
  reframekit: ['FFPROBE_PATH', 'LAUNCH_FILM_FFPROBE'],
  easycaptionkit: ['FFPROBE_PATH'],
};

type Env = NodeJS.ProcessEnv;

/** Whether a setting names a file, as a program has to be: a folder, like a macOS app bundle, is none. */
function namesFile(value: string | undefined): value is string {
  if (!value) return false;
  try {
    return statSync(value).isFile();
  } catch {
    return false;
  }
}

function onPath(name: string, env: Env): string | undefined {
  const names = process.platform === 'win32' ? [`${name}.exe`, name] : [name];
  for (const dir of (env['PATH'] ?? '').split(path.delimiter).filter(Boolean)) {
    for (const candidate of names) {
      const full = path.join(dir, candidate);
      if (namesFile(full)) return full;
    }
  }
  return undefined;
}

/** A bare command name, like ffmpeg, with no folder in it: a kit that spawns it finds it on PATH. */
function isCommand(value: string): boolean {
  return !value.includes('/') && !(process.platform === 'win32' && value.includes('\\'));
}

/**
 * The program a setting names, the way a kit spawns it: a path when it names a file, and a
 * bare command name, like ffmpeg, as the program of that name on PATH. Nothing when it names
 * no program file: a folder, like a macOS app bundle, a file that is not there, or a command
 * that is not on PATH.
 */
function programOf(value: string | undefined, env: Env): string | undefined {
  if (!value) return undefined;
  if (isCommand(value)) return onPath(value, env);
  return namesFile(value) ? value : undefined;
}

/** The program the first of these settings that names one names. */
function fromEnv(env: Env, names: string[]): string | undefined {
  return names.map(name => programOf(env[name], env)).find(Boolean);
}

/** A browser the kits can use: the one a setting names, else one on PATH, else one in its usual places. */
export function findChrome(env: Env = process.env, places: ProgramPlaces = PROGRAM_PLACES): string | undefined {
  return fromEnv(env, CHROME_SETTINGS)
    ?? CHROME_NAMES.map(name => onPath(name, env)).find(Boolean)
    ?? places.chrome.find(namesFile);
}

/** The ffmpeg a setting names, else the one on PATH, else one where package managers put it: what check_setup reports. */
export function findFfmpeg(env: Env = process.env, places: ProgramPlaces = PROGRAM_PLACES): string | undefined {
  return fromEnv(env, FFMPEG_SETTINGS) ?? onPath('ffmpeg', env) ?? places.ffmpeg.find(namesFile);
}

/** The ffprobe beside an ffmpeg, as it comes with it. */
function besideOf(ffmpeg: string | undefined): string | undefined {
  if (!ffmpeg) return undefined;
  const beside = path.join(path.dirname(ffmpeg), process.platform === 'win32' && /\.exe$/i.test(ffmpeg) ? 'ffprobe.exe' : 'ffprobe');
  return namesFile(beside) ? beside : undefined;
}

/**
 * The ffprobe the kits read videos with, which check_setup reports: the one FFPROBE_PATH or
 * LAUNCH_FILM_FFPROBE names, else the one beside the ffmpeg a setting names, else the one on PATH.
 */
export function findFfprobe(env: Env = process.env): string | undefined {
  return fromEnv(env, FFPROBE_SETTINGS) ?? besideOf(fromEnv(env, FFMPEG_SETTINGS)) ?? onPath('ffprobe', env);
}

/**
 * The environment a kit runs with: the one given, with the Chrome, the ffmpeg and the ffprobe
 * check_setup reports under each name a kit reads them by, so every kit runs the program
 * check_setup names. A name that names a program is kept, as the user's choice for the kits
 * that read it: a path to a file as it is, and a bare command name, like ffmpeg, as the
 * program of that name on PATH, which a kit that spawns it runs, and which a kit that looks
 * for a file, like easyscreenshotkit, then finds too. Any other name gets the program a
 * setting names under another of its names, so
 * FFMPEG_PATH, which check_setup tells the user to set, reaches launch-film as
 * LAUNCH_FILM_FFMPEG, with FFPROBE_PATH and LAUNCH_FILM_FFPROBE the ffprobe beside it, and
 * FFPROBE_PATH reaches launch-film as LAUNCH_FILM_FFPROBE. Without such a setting,
 * a name that is not set gets the program found on PATH or in its usual places, which not
 * every kit looks in, while a setting that names no program file, like a folder, is left as
 * the user set it: check_setup names it, and LocalBackend starts no tool that reads a
 * program from it (settingProblems).
 */
export function kitEnvironment(env: Env = process.env, places: ProgramPlaces = PROGRAM_PLACES): Env {
  const out: Env = { ...env };
  const give = (names: string[], set: string | undefined, found: string | undefined) => {
    for (const name of names) {
      const own = programOf(out[name], env);
      if (own) {
        out[name] = own;
        continue;
      }
      const program = set ?? (out[name] ? undefined : found);
      if (program) out[name] = program;
    }
  };
  give(CHROME_SETTINGS, fromEnv(env, CHROME_SETTINGS), findChrome(env, places));
  give(FFMPEG_SETTINGS, fromEnv(env, FFMPEG_SETTINGS), findFfmpeg(env, places));
  // ffprobe comes with ffmpeg, so a setting for an ffmpeg brings the ffprobe beside it, to each ffprobe name the one
  // beside the ffmpeg its kits run, and a setting for an ffprobe reaches every name.
  const probe = fromEnv(env, FFPROBE_SETTINGS);
  for (const [name, ffmpegs] of FFPROBE_BESIDE) {
    give([name], probe ?? besideOf(fromEnv(env, ffmpegs)), besideOf(fromEnv(out, ffmpegs)) ?? onPath('ffprobe', out));
  }
  return out;
}

/**
 * The settings a kit reads the programs it runs from, one list for each program, in the order
 * the kit reads them, so the first one set is the one it runs: CHROME_PATH and FFMPEG_PATH,
 * and launch-film's own names for launch-film, which reads CHROME_PATH after
 * LAUNCH_FILM_CHROME; reframekit reads LAUNCH_FILM_FFMPEG after FFMPEG_PATH; and ffprobe,
 * which comes with ffmpeg, as each kit that reads videos with it does (FFPROBE_READ). `needs`
 * are the programs the tool runs, chrome and ffmpeg.
 */
export function settingsRead(kit: string, needs: readonly string[]): string[][] {
  const lists: string[][] = [];
  if (needs.includes('chrome')) lists.push(kit === 'launch-film' ? ['LAUNCH_FILM_CHROME', 'CHROME_PATH'] : ['CHROME_PATH']);
  if (needs.includes('ffmpeg')) {
    lists.push(Object.hasOwn(FFMPEG_READ, kit) ? FFMPEG_READ[kit]! : ['FFMPEG_PATH']);
    if (Object.hasOwn(FFPROBE_READ, kit)) lists.push(FFPROBE_READ[kit]!);
  }
  return lists;
}

/** check_setup's line for a setting that names no program file, which the kits that read it cannot run. */
function noProgram(name: string, value: string): string {
  return `${name}: ${value} is no program file, so the kits that read ${name} cannot run it. Point it at the program, or take it out.`;
}

/**
 * Why a tool cannot run here, in check_setup's words: for each program it runs, a list of
 * settingsRead, the setting it reads that program from when that one names no program file.
 * `env` is the environment the kits run with (kitEnvironment). Empty when it can run.
 */
export function settingProblems(env: Env, lists: string[][]): string[] {
  const problems = new Set<string>();
  for (const names of lists) {
    const name = names.find(entry => env[entry]);
    if (name && !programOf(env[name], env)) problems.add(noProgram(name, env[name]!));
  }
  return [...problems];
}

/**
 * Where the kits save: MAKERSMCP_OUT, else the folder makersmcp was started in
 * (an agent's project), else ~/makersmcp when that folder is / or read-only.
 */
export function defaultOutDir(): string {
  const given = process.env['MAKERSMCP_OUT'];
  if (given) return path.resolve(expandHome(given));
  const cwd = process.cwd();
  try {
    if (path.parse(cwd).root !== cwd) {
      accessSync(cwd, constants.W_OK);
      return cwd;
    }
  } catch {
    // Not writable: fall through.
  }
  return path.join(os.homedir(), 'makersmcp');
}

function writable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Whether the kits can save in a folder, in words, or nothing when they can. */
export function folderProblem(dir: string): string | undefined {
  const fix = 'Set --out or MAKERSMCP_OUT to a folder you can write to.';
  if (existsSync(dir)) {
    if (!statSync(dir).isDirectory()) return `It is a file, not a folder, so no kit can save there. ${fix}`;
    return writable(dir) ? undefined : `It cannot be written to, so no kit can save there. ${fix}`;
  }
  let above = path.dirname(dir);
  while (!existsSync(above) && path.dirname(above) !== above) above = path.dirname(above);
  return existsSync(above) && statSync(above).isDirectory() && writable(above)
    ? 'It does not exist yet; the first job makes it.'
    : `It does not exist, and it cannot be made in ${above}. ${fix}`;
}

/**
 * The setup in words: kits, their state, the browser, ffmpeg and, while a kit that reads
 * videos with it is on (FFPROBE_READ), ffprobe, and the folder. `env` is the environment the
 * kits run with, this process's by default, so each line names the program the kits run, and
 * a setting that names no program file, which the kits that read it cannot run, gets a line
 * of its own. The ffmpeg line stays "ffmpeg: <path>" alone, which a service's check reads.
 */
export function setupReport(options: {
  version: string;
  baseDir: string;
  kits: Array<InstalledKit | MissingKit>;
  enabled: Set<string>;
  env?: Env;
  places?: ProgramPlaces;
}): string {
  const places = options.places ?? PROGRAM_PLACES;
  const env = kitEnvironment(options.env ?? process.env, places);
  const launchFilm = options.enabled.has('launch-film');
  const probing = Object.keys(FFPROBE_READ).filter(kit => options.enabled.has(kit));
  const chrome = findChrome(env, places);
  const ffmpeg = findFfmpeg(env, places);
  const problem = folderProblem(options.baseDir);
  const lines = [
    `## makersmcp ${options.version}`,
    '',
    `Node ${process.versions.node}. Files go to ${options.baseDir} (set it with --out or MAKERSMCP_OUT).${problem ? ` ${problem}` : ''}`,
    '',
    'Kits:',
  ];
  for (const kit of options.kits) {
    const { definition } = kit;
    const tools = definition.tools.map(tool => tool.name).join(', ');
    const needs = definition.needs.length
      ? ` Needs ${definition.needs.map(need => NEED_NAMES[need] ?? need).join(' and ')}.`
      : '';
    let state: string;
    if (!isInstalled(kit)) state = `not available: ${kit.reason}.`;
    else if (!options.enabled.has(definition.kit)) state = `${kit.version}, turned off by --kits.`;
    else state = `${kit.version}, on. Tools: ${tools}.${needs}`;
    lines.push(`- ${definition.kit} (${definition.field}): ${state}`);
  }
  // A setting that names no program file, which the kits that read it cannot run; launch-film's own only while a kit
  // that reads it is on.
  const read = (name: string) => !Object.hasOwn(LAUNCH_FILM_SETTINGS, name) || LAUNCH_FILM_SETTINGS[name]!.some(kit => options.enabled.has(kit));
  const unusable = (names: string[]) => names
    .filter(name => read(name) && env[name] && !programOf(env[name], env))
    .map(name => noProgram(name, env[name]!));
  // launch-film runs its own when the user set it apart.
  const own = (name: string, found: string | undefined) => {
    const program = fromEnv(env, [name]);
    return launchFilm && program && found && program !== found ? `${program} (${name})` : undefined;
  };
  const ownChrome = own('LAUNCH_FILM_CHROME', chrome);
  const ownFfmpeg = own('LAUNCH_FILM_FFMPEG', ffmpeg);
  lines.push(
    '',
    `Chrome: ${chrome ?? 'not found in the usual places. Install Chrome, Chromium, Edge or Brave, or set CHROME_PATH.'}`,
    ...(ownChrome ? [`launch-film's Chrome: ${ownChrome}`] : []),
    ...unusable(CHROME_SETTINGS),
    `ffmpeg: ${ffmpeg ?? 'not found on PATH. Install ffmpeg or set FFMPEG_PATH.'}`,
    ...(ownFfmpeg ? [`launch-film's ffmpeg: ${ownFfmpeg}`] : []),
    ...unusable(FFMPEG_SETTINGS),
  );
  // ffprobe, while a kit that reads videos with it is on.
  if (probing.length) {
    const ffprobe = findFfprobe(env);
    const ownFfprobe = own('LAUNCH_FILM_FFPROBE', ffprobe);
    // launch-film reads its logos and screens with it too.
    const others = probing.filter(kit => kit !== 'launch-film');
    const readers = [
      ...(launchFilm ? ['launch-film reads videos and pictures with it'] : []),
      ...(others.length ? [`${inWords(others)} ${others.length > 1 ? 'read' : 'reads'} videos with it`] : []),
    ].join(', and ');
    lines.push(
      `ffprobe: ${ffprobe ?? `not found beside ffmpeg or on PATH. ${readers}: install it with ffmpeg, or set FFPROBE_PATH.`}`,
      ...(ownFfprobe ? [`launch-film's ffprobe: ${ownFfprobe}`] : []),
      ...unusable(FFPROBE_SETTINGS),
    );
  }
  return lines.join('\n');
}
