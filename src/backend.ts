import type { KitDefinition, ToolDefinition } from './kits.js';

// Where kit jobs run. createMcpServer registers the same tools either way: with the
// LocalBackend (the default) the kits run on this machine and save into its folders;
// a hosted service implements KitBackend to run them on its own machines and hand
// back links to the files.

export type JobStatus = 'running' | 'done' | 'failed' | 'canceled';

/** A file a job saved. */
export interface JobFile {
  /** Relative to the job's folder. */
  path: string;
  bytes: number;
  /** A hosted job's file: where to download it, until JobView.expiresAt. */
  url?: string;
}

/** A note a kit writes for the agent, like BRAND.md, read once the job is done. */
export interface JobDoc {
  name: string;
  text: string;
  /** Set when the text was cut: where the rest is. */
  more?: string;
}

/** A job as the tools show it, wherever it runs. */
export interface JobView {
  id: string;
  kit: string;
  tool: string;
  title: string;
  status: JobStatus;
  /** A check tool: its exit code 1 means the check failed, not the job. */
  check?: boolean;
  exitCode: number | null;
  elapsedSeconds: number;
  /** Where the files are: a folder on this machine, or a hosted job's name for it. */
  folder?: string;
  /** What the kit was doing last. */
  lastLine?: string;
  /** Once done: what the kit said at the end. */
  summary?: string;
  /** Once failed: the tail of what the kit printed. */
  failure?: string;
  /** Once done: the files it saved, and the kit's notes among them. */
  files?: JobFile[];
  /**
   * The files the call gave the kit, by parameter, as the kit got them, like the steps file
   * of record_demo_video, for a reason that names one (ToolDefinition.refuses).
   */
  inputs?: Record<string, string>;
  docs?: JobDoc[];
  /** A hosted job: when its files and links go away, in unix seconds. */
  expiresAt?: number;
}

/** A kit the backend can run, at the version it runs. */
export interface AvailableKit {
  definition: KitDefinition;
  version: string;
  /**
   * The tools of the kit the backend runs now, by name; without it, every tool of the
   * definition. A service whose machines cannot run a tool for now leaves it out: the
   * server does not list it, and its texts leave out what names it.
   */
  tools?: string[];
}

/** A kit the backend cannot run, and why. */
export interface UnavailableKit {
  definition: KitDefinition;
  reason: string;
}

export interface StartRequest {
  kit: AvailableKit;
  tool: ToolDefinition;
  /** The tool's arguments as the client sent them, without wait_seconds. */
  input: Record<string, unknown>;
}

export interface WaitOptions {
  signal?: AbortSignal;
  /** Called with each new progress line while waiting. */
  onLine?: (line: string) => void;
}

/** Thrown by start when a job cannot start, with a message for the agent. */
export class NotStartedError extends Error {
  /** The running job that blocks this one, when that is the reason. */
  readonly jobId?: string;

  constructor(message: string, jobId?: string) {
    super(message);
    this.name = 'NotStartedError';
    this.jobId = jobId;
  }
}

/**
 * What a hosted service allows, for the texts that name its limits, like "each call waits
 * at most 50 seconds". A limit it leaves out is told in words that promise nothing.
 */
export interface HostedLimits {
  /** The longest one tool call waits for a job, whatever wait_seconds asks. */
  maxWaitSeconds?: number;
  /** How long a job may run before it is stopped, downloads included. */
  jobMinutes?: number;
  /** How many jobs a user may have running or waiting at once. */
  jobsAtOnce?: number;
  /** How many jobs a user may start in any 24 hours. */
  jobsPerDay?: number;
  /**
   * How long a finished job's files and their links are kept, in seconds, for this backend's
   * user: a service whose plans keep files for different times gives the user's own, or none.
   * A service that cannot tell the user's own keep time gives none, as an account's own limits
   * can differ from its plan's: the texts then promise no time and point at the one each
   * result gives. The texts say it in its own unit, like 15 minutes or 90 days.
   */
  keepSeconds?: number;
  /** The same in whole days, as services gave it before keepSeconds; keepSeconds counts when both are given. */
  keepDays?: number;
}

/** What check_setup knows when it asks a backend for its report. */
export interface SetupOptions {
  /** makersmcp's version. */
  version: string;
  /** The kits this server turned on. */
  enabled: Set<string>;
}

export interface KitBackend {
  /** local: kits run on this machine and take paths on it. hosted: kits run on a service and take links. */
  readonly where: 'local' | 'hosted';
  /** Where jobs run, for tool descriptions, like "on makersmcp.com". */
  readonly place?: string;
  /** A hosted service's limits, for the playbooks and the descriptions that name them. */
  readonly limits?: HostedLimits;
  /** A local backend's folder, which relative paths are read from: {base_dir} in the playbooks. */
  readonly baseDir?: string;
  /**
   * Whose jobs these are, the same for every backend whose wait and cancel reach the same
   * jobs, like a hosted service's user: a kit tool call identical to an earlier one of the same
   * identity, whose answer did not reach the client, continues that call's job instead of
   * starting another (repeats.ts). A backend without one starts a job for every call.
   */
  readonly identity?: string;
  /** For each definition, the kit as it runs here, or why it cannot. */
  available(definitions: KitDefinition[]): Array<AvailableKit | UnavailableKit>;
  start(request: StartRequest): Promise<JobView>;
  /** Waits until the job ends or `seconds` pass. Undefined when there is no such job. */
  wait(id: string, seconds: number, options?: WaitOptions): Promise<JobView | undefined>;
  cancel(id: string): Promise<JobView | undefined>;
  /** Its jobs, newest first. */
  list(): Promise<JobView[]>;
  /** What check_setup answers. */
  setupReport(options: SetupOptions): string | Promise<string>;
  /** Called when the MCP connection closes. LocalBackend stops its jobs; a hosted one may keep them. */
  close(): void;
}

export function isAvailable(kit: AvailableKit | UnavailableKit): kit is AvailableKit {
  return 'version' in kit;
}
