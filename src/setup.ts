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

/**
 * The settings the kits read for the programs they run, in the order check_setup reads them:
 * CHROME_PATH and FFMPEG_PATH are makersmcp's own, and launch-film reads its own names.
 */
const CHROME_SETTINGS = ['CHROME_PATH', 'LAUNCH_FILM_CHROME'];
const FFMPEG_SETTINGS = ['FFMPEG_PATH', 'LAUNCH_FILM_FFMPEG'];
const FFPROBE_SETTINGS = ['LAUNCH_FILM_FFPROBE'];

type Env = NodeJS.ProcessEnv;

/** Whether a setting names a file, as a program has to be. */
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

/** A browser the kits can use, looked for the way they look. */
export function findChrome(env: Env = process.env): string | undefined {
  return fromEnv(env, CHROME_SETTINGS)
    ?? CHROME_NAMES.map(name => onPath(name, env)).find(Boolean)
    ?? CHROME_PLACES.find(place => existsSync(place));
}

/** The ffmpeg a setting names, else the one on PATH: what check_setup reports. */
export function findFfmpeg(env: Env = process.env): string | undefined {
  return fromEnv(env, FFMPEG_SETTINGS) ?? onPath('ffmpeg', env);
}

/** The ffprobe beside an ffmpeg, as it comes with it. */
function besideOf(ffmpeg: string | undefined): string | undefined {
  if (!ffmpeg) return undefined;
  const beside = path.join(path.dirname(ffmpeg), process.platform === 'win32' && /\.exe$/i.test(ffmpeg) ? 'ffprobe.exe' : 'ffprobe');
  return namesFile(beside) ? beside : undefined;
}

/**
 * The ffprobe launch-film reads videos and pictures with: LAUNCH_FILM_FFPROBE, else the one
 * beside the ffmpeg a setting names for it, else the one on PATH.
 */
export function findFfprobe(env: Env = process.env): string | undefined {
  return fromEnv(env, FFPROBE_SETTINGS)
    ?? besideOf(fromEnv(env, ['LAUNCH_FILM_FFMPEG']) ?? fromEnv(env, FFMPEG_SETTINGS))
    ?? onPath('ffprobe', env);
}

/**
 * The environment a kit runs with: the one given, with the Chrome and the ffmpeg a setting
 * names under each name a kit reads them by, and the ffprobe beside that ffmpeg. So
 * FFMPEG_PATH, which check_setup tells the user to set, reaches launch-film as
 * LAUNCH_FILM_FFMPEG, with LAUNCH_FILM_FFPROBE the ffprobe beside it, and LAUNCH_FILM_FFMPEG
 * reaches the kits that read FFMPEG_PATH. A name that names a file is kept, and a program
 * found on PATH is left for each kit to find itself.
 */
export function kitEnvironment(env: Env = process.env): Env {
  const out: Env = { ...env };
  const give = (names: string[], found: string | undefined) => {
    if (found) for (const name of names) if (!namesFile(out[name])) out[name] = found;
  };
  give(CHROME_SETTINGS, fromEnv(env, CHROME_SETTINGS));
  give(FFMPEG_SETTINGS, fromEnv(env, FFMPEG_SETTINGS));
  // ffprobe comes with ffmpeg, so a setting for an ffmpeg brings the ffprobe beside it.
  give(FFPROBE_SETTINGS, besideOf(fromEnv(out, ['LAUNCH_FILM_FFMPEG'])));
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
 * The setup in words: kits, their state, the browser, ffmpeg and ffprobe, and the folder.
 * `env` is the environment the kits run with, this process's by default. The ffmpeg line
 * stays "ffmpeg: <path>" alone, which a service's check reads.
 */
export function setupReport(options: {
  version: string;
  baseDir: string;
  kits: Array<InstalledKit | MissingKit>;
  enabled: Set<string>;
  env?: Env;
}): string {
  const env = kitEnvironment(options.env ?? process.env);
  const chrome = findChrome(env);
  const ffmpeg = findFfmpeg(env);
  const ffprobe = findFfprobe(env);
  // launch-film runs its own when the user set it apart.
  const own = fromEnv(env, ['LAUNCH_FILM_FFMPEG']);
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
  lines.push(
    '',
    `Chrome: ${chrome ?? 'not found in the usual places. Install Chrome, Chromium, Edge or Brave, or set CHROME_PATH.'}`,
    `ffmpeg: ${ffmpeg ?? 'not found on PATH. Install ffmpeg or set FFMPEG_PATH.'}`,
  );
  // Only launch-film reads its own ffmpeg setting, and ffprobe.
  if (options.enabled.has('launch-film')) {
    if (own && ffmpeg && own !== ffmpeg) lines.push(`launch-film's ffmpeg: ${own} (LAUNCH_FILM_FFMPEG)`);
    lines.push(`ffprobe: ${ffprobe ?? 'not found beside ffmpeg or on PATH. launch-film reads videos and pictures with it: install it with ffmpeg, or set LAUNCH_FILM_FFPROBE.'}`);
  }
  return lines.join('\n');
}
