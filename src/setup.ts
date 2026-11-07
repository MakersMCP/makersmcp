import { accessSync, constants, existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expandHome } from './args.js';
import { isInstalled, type InstalledKit, type MissingKit } from './kits.js';

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
 * CHROME_PATH and FFMPEG_PATH are makersmcp's own, and launch-film reads its own names.
 */
const CHROME_SETTINGS = ['CHROME_PATH', 'LAUNCH_FILM_CHROME'];
const FFMPEG_SETTINGS = ['FFMPEG_PATH', 'LAUNCH_FILM_FFMPEG'];
const FFPROBE_SETTINGS = ['LAUNCH_FILM_FFPROBE'];
/** The settings only launch-film reads, which check_setup speaks of while launch-film is on. */
const LAUNCH_FILM_SETTINGS = new Set(['LAUNCH_FILM_CHROME', 'LAUNCH_FILM_FFMPEG', 'LAUNCH_FILM_FFPROBE']);

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

function fromEnv(env: Env, names: string[]): string | undefined {
  return names.map(name => env[name]).find(namesFile);
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

/** The ffprobe beside the ffmpeg a setting names for launch-film, LAUNCH_FILM_FFMPEG before FFMPEG_PATH. */
function besideSetting(env: Env): string | undefined {
  return besideOf(fromEnv(env, ['LAUNCH_FILM_FFMPEG']) ?? fromEnv(env, FFMPEG_SETTINGS));
}

/**
 * The ffprobe launch-film reads videos and pictures with: LAUNCH_FILM_FFPROBE, else the one
 * beside the ffmpeg a setting names for it, else the one on PATH.
 */
export function findFfprobe(env: Env = process.env): string | undefined {
  return fromEnv(env, FFPROBE_SETTINGS) ?? besideSetting(env) ?? onPath('ffprobe', env);
}

/**
 * The environment a kit runs with: the one given, with the Chrome, the ffmpeg and the ffprobe
 * check_setup reports under each name a kit reads them by, so every kit runs the program
 * check_setup names. A name that names a file is kept, as the user's choice for the kits that
 * read it. Any other name gets the program a setting names under another of its names, so
 * FFMPEG_PATH, which check_setup tells the user to set, reaches launch-film as
 * LAUNCH_FILM_FFMPEG with LAUNCH_FILM_FFPROBE the ffprobe beside it. Without such a setting,
 * a name that is not set gets the program found on PATH or in its usual places, which not
 * every kit looks in, while a setting that names no file, like a folder, is left as the user
 * set it: the kits that read it then stop, and check_setup names it.
 */
export function kitEnvironment(env: Env = process.env, places: ProgramPlaces = PROGRAM_PLACES): Env {
  const out: Env = { ...env };
  const give = (names: string[], set: string | undefined, found: string | undefined) => {
    for (const name of names) {
      if (namesFile(out[name])) continue;
      const program = set ?? (out[name] ? undefined : found);
      if (program) out[name] = program;
    }
  };
  give(CHROME_SETTINGS, fromEnv(env, CHROME_SETTINGS), findChrome(env, places));
  give(FFMPEG_SETTINGS, fromEnv(env, FFMPEG_SETTINGS), findFfmpeg(env, places));
  // ffprobe comes with ffmpeg, so a setting for an ffmpeg brings the ffprobe beside it.
  give(FFPROBE_SETTINGS, besideSetting(env), findFfprobe(out));
  return out;
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
 * The setup in words: kits, their state, the browser, ffmpeg and, while launch-film is on,
 * ffprobe, and the folder. `env` is the environment the kits run with, this process's by
 * default, so each line names the program the kits run, and a setting that names no
 * program file, which the kits that read it cannot run, gets a line of its own. The ffmpeg
 * line stays "ffmpeg: <path>" alone, which a service's check reads.
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
  // A setting that names no program file, which the kits that read it cannot run; launch-film's own only while it is on.
  const unusable = (names: string[]) => names
    .filter(name => (launchFilm || !LAUNCH_FILM_SETTINGS.has(name)) && env[name] && !namesFile(env[name]))
    .map(name => `${name}: ${env[name]} is no program file, so the kits that read ${name} cannot run it. Point it at the program, or take it out.`);
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
  // Only launch-film reads ffprobe.
  if (launchFilm) {
    lines.push(
      `ffprobe: ${findFfprobe(env) ?? 'not found beside ffmpeg or on PATH. launch-film reads videos and pictures with it: install it with ffmpeg, or set LAUNCH_FILM_FFPROBE.'}`,
      ...unusable(FFPROBE_SETTINGS),
    );
  }
  return lines.join('\n');
}
