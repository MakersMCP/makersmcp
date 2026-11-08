import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, type BigIntStats, type Stats } from 'node:fs';
import path from 'node:path';
import { ArgumentError, MissingFileError, buildCommand, expandHome } from './args.js';
import {
  NotStartedError,
  type AvailableKit,
  type JobDoc,
  type JobFile,
  type JobView,
  type KitBackend,
  type SetupOptions,
  type StartRequest,
  type UnavailableKit,
  type WaitOptions,
} from './backend.js';
import { FolderBusyError, JobManager, launcherProblem, type Job } from './jobs.js';
import { docNames, isInstalled, resolveKit, type DocEntry, type InstalledKit, type KitDefinition, type MissingKit, type ToolDefinition } from './kits.js';
import { kitEnvironment, settingProblems, settingsRead, setupReport } from './setup.js';

/** The most files a job lists in `files`. */
export const MAX_FILES = 200;
// Entries looked at in one listing, so a folder that holds a whole project stays quick.
const MAX_ENTRIES = 20_000;
// Some file systems keep the time a file changed to the second, or to two.
const MTIME_SLACK_MS = 2000;
const MAX_DOC_CHARS = 40_000;
// The most of a doc that is read: more bytes than MAX_DOC_CHARS characters take, so a longer doc is still cut.
const MAX_DOC_BYTES = 4 * MAX_DOC_CHARS;
// Windows has neither: there a doc is checked for a link before it is opened.
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const NONBLOCK = constants.O_NONBLOCK ?? 0;
const HEAD_LINES = 5;
const TAIL_LINES = 30;

/** Never listed: hidden files and folders, like .git and a kit's .work- folders, and node_modules. */
function skipped(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules';
}

/** Whether `target` is `root` or inside it, as both are written. */
function contains(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** A folder with its links resolved, or nothing when it is not there. */
function resolved(folder: string): string | undefined {
  try {
    return realpathSync(folder);
  } catch {
    return undefined;
  }
}

/**
 * Visits each file in a folder, a folder's own files in name order before the files in its
 * subfolders, with its path relative to the folder and what the disk says of it, until
 * `visit` returns false. Hidden files and node_modules are left out, and so are links, and
 * no folder is entered through one. With `within`, for a folder a kit wrote under confine,
 * a folder that leads out of `within`, like one a kit swapped for a link, is not looked
 * in: given such a folder, it visits nothing. Gives whether it looked at every entry,
 * which it does not once it has looked at MAX_ENTRIES.
 */
function eachFile(folder: string, within: string | undefined, visit: (relative: string, stat: Stats) => boolean): boolean {
  const root = within === undefined ? undefined : resolved(within);
  if (within !== undefined && root === undefined) return true;
  const queue = [folder];
  let seen = 0;
  while (queue.length) {
    if (seen >= MAX_ENTRIES) return false;
    const dir = queue.shift()!;
    if (root !== undefined) {
      const real = resolved(dir);
      if (real === undefined || !contains(root, real)) continue;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const sorted = entries.filter(entry => !skipped(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      if (++seen > MAX_ENTRIES) return false;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      let stat;
      try {
        // Not stat: a file swapped for a link since the folder was read is a link here, and left out.
        stat = lstatSync(full);
      } catch {
        // Gone since the folder was read, like a lock file or a kit's work file.
        continue;
      }
      if (stat.isFile() && !visit(path.relative(folder, full), stat)) return true;
    }
  }
  return true;
}

/**
 * What a file is as the disk tells it, its number on the disk, its size and the times it
 * was written and changed, to tell whether a job wrote it.
 */
function stampOf(stat: Stats): string {
  return `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

/** The files a folder holds as a job starts, by their path in it, to tell the files the job saves or changes there. */
export interface FolderStamps {
  stamps: Map<string, string>;
  /** Whether every file was stamped: not when the folder holds more than MAX_ENTRIES entries. */
  complete: boolean;
}

/** What each file in a folder is now, as listFiles looks at them. */
export function folderStamps(folder: string, within?: string): FolderStamps {
  const stamps = new Map<string, string>();
  const complete = eachFile(folder, within, (relative, stat) => {
    stamps.set(relative, stampOf(stat));
    return true;
  });
  return { stamps, complete };
}

/**
 * The files in a folder, relative to it, at most MAX_FILES: a folder's own files in name
 * order before the files in its subfolders. With `before`, the folder's files as a job
 * started (folderStamps), only the files that are new or that changed since, which are the
 * files the job saved, whatever the folder held before; a file with no stamp in a folder
 * too large to stamp whole counts only when it changed after `since`, the job's start.
 * With `since` alone, only the files changed from then on. Links are left out, and no
 * folder is entered through one. With `within`, for a folder a kit wrote under confine, a
 * folder that leads out of `within`, like one a kit swapped for a link, is not looked in:
 * given such a folder, it lists nothing.
 */
export function listFiles(folder: string, since?: number, within?: string, before?: FolderStamps): JobFile[] {
  const files: JobFile[] = [];
  const old = (stat: Stats) => since !== undefined && stat.mtimeMs < since - MTIME_SLACK_MS;
  eachFile(folder, within, (relative, stat) => {
    const was = before?.stamps.get(relative);
    const unchanged = before === undefined ? old(stat) : was !== undefined ? was === stampOf(stat) : !before.complete && old(stat);
    if (!unchanged) files.push({ path: relative, bytes: stat.size });
    return files.length < MAX_FILES;
  });
  return files;
}

/**
 * Whether the file opened, `opened`, is `file` as reached from `within` through folders
 * and no link: each step on the way a folder itself, and the file at the end that very
 * file, which still has one name. A folder on the way swapped for a link fails the first
 * check while it is one, and the second once it is swapped back.
 */
function reachedFrom(within: string, file: string, fd: number, opened: BigIntStats): boolean {
  if (!contains(within, file)) return false;
  const steps = path.relative(within, file).split(path.sep);
  let at = within;
  for (const [i, step] of steps.entries()) {
    at = path.join(at, step);
    const stat = lstatSync(at, { bigint: true });
    if (i < steps.length - 1 ? !stat.isDirectory() : stat.dev !== opened.dev || stat.ino !== opened.ino) return false;
  }
  return fstatSync(fd, { bigint: true }).nlink === 1n;
}

/**
 * A doc's text, or nothing when it is not a file to read. A kit wrote the folder, and it
 * may run as another user than this process: a doc is opened without following a link,
 * which could lead to a file only this process's user may read, and without waiting on a
 * fifo, which would hold this process. It is read only when it is a regular file with one
 * name, since a second name, a hard link, makes it a file of elsewhere too, and with
 * `within` only when it is reached from there through folders and no link.
 */
function readDoc(file: string, within?: string): string | undefined {
  let fd: number;
  try {
    if (!NOFOLLOW && lstatSync(file).isSymbolicLink()) return undefined;
    fd = openSync(file, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
  } catch {
    return undefined;
  }
  try {
    const stat = fstatSync(fd, { bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n) return undefined;
    if (within !== undefined && !reachedFrom(within, file, fd, stat)) return undefined;
    const buffer = Buffer.alloc(Number(stat.size < MAX_DOC_BYTES ? stat.size : MAX_DOC_BYTES));
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, length);
      if (read === 0) break;
      length += read;
    }
    return buffer.subarray(0, length).toString('utf8');
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

/**
 * The kit's notes in a folder, by name or as a tool's docs entries, cut at MAX_DOC_CHARS
 * each, the most one result shows of all its docs together (results.ts shares that among
 * them). A doc that is not a regular file with one name, like a link, a fifo or a hard
 * link, is left out as a missing one is, and so is one not reached from `within` through
 * folders, when that is given (readDoc).
 */
export function readDocs(folder: string, entries: Array<string | DocEntry> = [], within?: string): JobDoc[] {
  const docs: JobDoc[] = [];
  for (const entry of entries) {
    const name = typeof entry === 'string' ? entry : entry.file;
    const file = path.join(folder, name);
    const text = readDoc(file, within);
    if (text === undefined) continue;
    docs.push(text.length > MAX_DOC_CHARS
      ? { name, text: text.slice(0, MAX_DOC_CHARS), more: file }
      : { name, text });
  }
  return docs;
}

function tail(text: string, lines = TAIL_LINES): string {
  return text.trim().split(/\r?\n/).slice(-lines).join('\n');
}

/**
 * What a failed kit said on stderr, for the agent. An argument error (exit code 2) gives
 * its reason first and the kit's usage after it: the reason is kept, the usage is not.
 * A long log keeps its first lines and its last ones, where an error usually is.
 */
export function failureText(stderr: string, exitCode: number | null): string {
  let lines = stderr.split(/\r?\n/);
  if (exitCode === 2) {
    const usage = lines.findIndex(line => /^Usage:/.test(line));
    if (usage > 0 && lines.slice(0, usage).some(line => line.trim())) lines = lines.slice(0, usage);
  }
  while (lines.length && !lines[0]!.trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  if (lines.length > HEAD_LINES + TAIL_LINES + 1) {
    const cut = lines.length - HEAD_LINES - TAIL_LINES;
    lines = [...lines.slice(0, HEAD_LINES), `(${cut} more lines)`, ...lines.slice(-TAIL_LINES)];
  }
  return lines.join('\n');
}

/**
 * The settings a tool's run reads its programs from: those of the programs it runs (its needs,
 * else its kit's), and those of each kit it runs, like easybrandkit for a plan of launch-film,
 * unless the call gives a file by one of the tool's usesUnless, like a plan given brand, which
 * copies that brand kit and runs no easybrandkit. `inputs` are the files the call gives, by
 * parameter (buildCommand).
 */
function toolSettings(kit: KitDefinition, tool: ToolDefinition, installed: Map<string, InstalledKit>, inputs: Record<string, string>): string[][] {
  const lists = settingsRead(kit.kit, tool.needs ?? kit.needs);
  if ((tool.usesUnless ?? []).some(param => Object.hasOwn(inputs, param))) return lists;
  for (const used of Object.values(tool.uses ?? {})) {
    const other = installed.get(used)?.definition;
    if (other) lists.push(...settingsRead(other.kit, other.needs));
  }
  return lists;
}

/**
 * A call refused while a running job writes in a folder it would save in or read from. Another
 * out_dir helps only a call that can take one (`movable`), and only when it reads no file that
 * job may still change: not one whose folder follows a file it gave, nor a check of a film a
 * render is still making.
 */
function busyRefusal(error: FolderBusyError, tool: ToolDefinition, movable: boolean): NotStartedError {
  const then = movable && !error.reads
    ? `Wait for it with wait_for_job (job_id ${error.job.id}), or give another out_dir.`
    : `Wait for it with wait_for_job (job_id ${error.job.id}), then call ${tool.name} again.`;
  return new NotStartedError(`${error.message}. ${then}`, error.job.id);
}

/** What a job that ended done saved in its folder, and its kit's notes there, as they were when it ended. */
interface Saved {
  files: JobFile[];
  docs: JobDoc[];
}

const SAVED = new WeakMap<Job, Saved>();

/**
 * Keeps, as the job ends done, the files it saved or changed in its folder against what the
 * folder held as it started (`before`), and its docs, so every later view of it gives that
 * job's own result, even after a later job saved in that folder or in one inside it.
 */
function keepSaved(job: Job, before: FolderStamps | undefined): void {
  const keep = () => {
    const { spec } = job;
    if (job.status !== 'done' || !spec.folder) return;
    try {
      SAVED.set(job, {
        files: listFiles(spec.folder, job.startedAt, spec.within, before),
        docs: readDocs(spec.folder, spec.docs, spec.within),
      });
    } catch {
      // A view then lists the folder as it is (viewJob).
    }
  };
  if (job.status === 'running') job.once('end', keep);
  else keep();
}

/** A job of this machine as the tools show it. */
export function viewJob(job: Job): JobView {
  const { spec } = job;
  const view: JobView = {
    id: job.id,
    kit: spec.kit,
    tool: spec.tool,
    title: spec.title,
    status: job.status,
    ...(spec.check ? { check: true } : {}),
    exitCode: job.exitCode,
    elapsedSeconds: job.elapsedSeconds,
    ...(spec.folder ? { folder: spec.folder } : {}),
    ...(spec.inputs && Object.keys(spec.inputs).length ? { inputs: spec.inputs } : {}),
    // A failed kit's last line is often the end of its usage text: the failure says what went wrong.
    ...(job.lastLine && job.status !== 'failed' ? { lastLine: job.lastLine } : {}),
  };
  if (job.status === 'failed') {
    view.failure = [failureText(job.stderr, job.exitCode), tail(job.stdout, 10)].filter(Boolean).join('\n\n');
  }
  if (job.status === 'done') {
    // What the kit said at the end: its summary on stdout, or its last lines when it writes only to stderr.
    view.summary = job.stdout.trim() || tail(job.stderr, 12);
    if (spec.folder) {
      // As the job ended, when LocalBackend started it; a job started elsewhere lists its folder as it is.
      const saved = SAVED.get(job);
      view.files = saved ? [...saved.files] : listFiles(spec.folder, job.startedAt, spec.within);
      view.docs = saved ? [...saved.docs] : readDocs(spec.folder, spec.docs, spec.within);
    }
  }
  return view;
}

export interface LocalBackendOptions {
  /** Where kits save, and what relative paths are read from. A leading ~ is the home folder. */
  baseDir: string;
  /** A kit's folder to use instead of its installed package, like { musicfit: '../musicfit' }. A leading ~ is the home folder. */
  kitPaths?: Record<string, string>;
  /**
   * The environment kits run with. Default: this process's. A service can keep its own secrets
   * from them. Each kit gets the Chrome, ffmpeg and ffprobe a setting in it names under every
   * name a kit reads them by (setup.ts kitEnvironment).
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Refuse every file and folder outside baseDir, like an out_dir or a file elsewhere.
   * For a service that brings each job's inputs into the job's own baseDir. A job then
   * also returns only docs and files a kit left inside baseDir (listFiles, readDocs).
   */
  confine?: boolean;
  /**
   * A command that starts each kit's supervisor in place of node, for a service whose
   * kits run as another user, like ['sudo', '-n', '-u', '<kit user>', '--', '<wrapper>', 'run']
   * (JobSpec.launcher). A cancel then ends the supervisor's stdin, since no signal reaches
   * another user's process, and Job.pid is the process group the launcher's own clean-up
   * keeps while the job runs.
   */
  launcher?: string[];
}

/** Runs kits on this machine, each job a process of its own, saving into baseDir. */
export class LocalBackend implements KitBackend {
  readonly where = 'local';
  readonly place = 'on this machine';
  readonly baseDir: string;
  readonly jobs = new JobManager();
  private readonly kitPaths?: Record<string, string>;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly confine: boolean;
  private readonly launcher?: string[];
  private kits: Array<InstalledKit | MissingKit> = [];
  private readonly installed = new Map<string, InstalledKit>();

  constructor(options: LocalBackendOptions) {
    this.baseDir = path.resolve(expandHome(options.baseDir));
    this.kitPaths = options.kitPaths;
    this.env = options.env;
    this.confine = options.confine === true;
    if (options.launcher !== undefined) {
      const problem = launcherProblem(options.launcher);
      if (problem) throw new TypeError(problem);
      this.launcher = [...options.launcher];
    }
  }

  available(definitions: KitDefinition[]): Array<AvailableKit | UnavailableKit> {
    this.kits = definitions.map(definition => resolveKit(definition, this.kitPaths));
    this.installed.clear();
    for (const kit of this.kits) if (isInstalled(kit)) this.installed.set(kit.definition.kit, kit);
    return this.kits;
  }

  async start({ kit, tool, input }: StartRequest): Promise<JobView> {
    const installed = this.installed.get(kit.definition.kit);
    if (!installed) throw new NotStartedError(`${kit.definition.kit} is not installed here.`);

    let command;
    try {
      command = buildCommand(tool, input, { baseDir: this.baseDir, installed: this.installed, confine: this.confine });
    } catch (error) {
      // A file that is not there yet, or no longer, in a running job's folder: that job may still
      // write it, as a render writes its film.mp4, or have cleared it to write it again, as a
      // demo clears its demo.yaml. The call waits for that job, as for a file of it that is there.
      const busy = error instanceof MissingFileError ? this.jobs.writing(error.file) : undefined;
      if (busy) throw busyRefusal(new FolderBusyError(busy, (error as MissingFileError).file, true), tool, false);
      if (error instanceof ArgumentError) throw new NotStartedError(error.message);
      throw error;
    }

    // The Chrome and ffmpeg a setting names, under each name a kit reads them by. A setting this
    // run reads a program from that names no program file, like a folder, would stop the kit, some
    // only after they cleared their folder: the tool does not start, with check_setup's line for it.
    const env = kitEnvironment(this.env ?? process.env);
    const problems = settingProblems(env, toolSettings(installed.definition, tool, this.installed, command.inputs));
    if (problems.length) throw new NotStartedError(problems.join(' '));

    // Every kit runs in baseDir, and on a first run, like ~/makersmcp, it is not there yet.
    try {
      mkdirSync(this.baseDir, { recursive: true });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new NotStartedError(
        `Cannot make ${this.baseDir}, the folder the kits save in: ${reason}. Set --out or MAKERSMCP_OUT to a folder you can write to.`,
      );
    }

    const within = this.confine ? this.baseDir : undefined;
    // What the folder holds before the kit starts, so the job lists only the files it saves or changes.
    const before = command.folder ? folderStamps(command.folder, within) : undefined;
    let job: Job;
    try {
      job = this.jobs.start({
        kit: installed.definition.kit,
        tool: tool.name,
        title: tool.title,
        script: installed.script,
        args: command.args,
        cwd: this.baseDir,
        folder: command.folder,
        docs: docNames(tool),
        check: tool.check,
        report: tool.report,
        env,
        ...(this.launcher ? { launcher: this.launcher } : {}),
        ...(within !== undefined ? { within } : {}),
        inputs: command.inputs,
        reads: command.reads,
      });
    } catch (error) {
      if (error instanceof FolderBusyError) throw busyRefusal(error, tool, command.movable);
      throw error;
    }
    keepSaved(job, before);
    return viewJob(job);
  }

  async wait(id: string, seconds: number, options: WaitOptions = {}): Promise<JobView | undefined> {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const { onLine, signal } = options;
    if (onLine) job.on('line', onLine);
    try {
      await job.wait(seconds * 1000, signal);
    } finally {
      if (onLine) job.off('line', onLine);
    }
    return viewJob(job);
  }

  async cancel(id: string): Promise<JobView | undefined> {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    await job.cancel();
    return viewJob(job);
  }

  async list(): Promise<JobView[]> {
    return this.jobs.list().reverse().map(viewJob);
  }

  setupReport({ version, enabled }: SetupOptions): string {
    return setupReport({ version, baseDir: this.baseDir, kits: this.kits, enabled, ...(this.env ? { env: this.env } : {}) });
  }

  close(): void {
    void this.jobs.closeAll();
  }
}
