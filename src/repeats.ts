import { createHash } from 'node:crypto';
import type { JobView } from './backend.js';

// MCP clients end a tool call after a set time, Zed and others at 60 seconds, and some
// never tell the server. The assistant then sees an error and makes the same call again,
// which would start the same work twice: hosted, a second job; locally, a refusal while
// the first runs and the kit run again once it ended. This ledger keeps the start of each
// kit tool call under a hash of the backend's identity, the tool and its input, for as long
// as an identical call can still be a repeat of it, so that call continues the same job.
//
// It lives in the process, after Wiro-MCP's run ledger, so it covers every server this
// process makes for the same identity: one stdio session, or every request of an HTTP
// server that makes a server for each, as MakersMCP-Server does. A restart, a reload or a
// second process starts with none.

/** What a backend's start gave. It never rejects. */
export type StartOutcome = { ok: true; view: JobView } | { ok: false; error: unknown };

export interface StartRecord {
  readonly key: string;
  readonly startedAt: number;
  readonly started: Promise<StartOutcome>;
  /** The start's outcome, once it came. */
  settled?: StartOutcome;
  /** Calls serving this job right now. */
  active: number;
  /**
   * When a call serving it last ended without the job's result reaching its client: cancelled,
   * cut off, or in an error after the job started.
   */
  unansweredAt?: number;
  /** The record this one took the key from, put back when this one is let go. */
  displaced?: StartRecord;
}

/** How a call serving a job ended. */
export type CallOutcome = 'answered' | 'unanswered' | 'failed';

export interface RepeatTiming {
  /**
   * How long after a call ended unanswered, cancelled, cut off or in an error after its job
   * started, so that its client did not get the job's result, an identical call continues its job.
   */
  unansweredWindowMs: number;
  /**
   * How long after an identical call began, while it still waits, a new call counts as its
   * repeat. Calls an assistant sends side by side arrive together and each start their own;
   * a repeat comes once the client gave up.
   */
  retryAfterMs: number;
}

export const REPEAT_TIMING: Readonly<RepeatTiming> = Object.freeze({ retryAfterMs: 10_000, unansweredWindowMs: 10 * 60_000 });

/**
 * The most calls the ledger keeps, the oldest going first, so a long session cannot grow it
 * without end. A service that keeps answers for the jobs a call may continue needs no more.
 */
export const MAX_REPEAT_RECORDS = 1000;

/** JSON with the keys of every object sorted, so their order does not tell two calls apart. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(name => `${JSON.stringify(name)}:${canonicalJson(object[name])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** The key of one call: whose it is, the tool and the input as the backend gets it. */
export function callKey(identity: string, tool: string, input: Record<string, unknown>): string {
  return createHash('sha256').update(identity).update('\0').update(tool).update('\0').update(canonicalJson(input)).digest('hex');
}

export class StartLedger {
  private readonly records = new Map<string, StartRecord>();

  /**
   * The job an identical call should continue: one whose last call ended without the job's
   * result reaching its client, cancelled, cut off or in an error after the job started, within
   * the window, or one an identical call still waits for, begun at least retryAfterMs before.
   */
  find(key: string, timing: RepeatTiming, now = Date.now()): StartRecord | undefined {
    this.prune(timing, now);
    const record = this.records.get(key);
    if (!record) return undefined;
    if (record.unansweredAt !== undefined && now - record.unansweredAt <= timing.unansweredWindowMs) return record;
    if (record.active > 0 && now - record.startedAt >= timing.retryAfterMs) return record;
    return undefined;
  }

  /** Starts a job and keeps it under `key`. */
  start(key: string, start: () => Promise<JobView>, now = Date.now()): StartRecord {
    let started: Promise<StartOutcome>;
    try {
      started = start().then(view => ({ ok: true as const, view }), error => ({ ok: false as const, error }));
    } catch (error) {
      started = Promise.resolve({ ok: false as const, error });
    }
    const record: StartRecord = { key, startedAt: now, started, active: 0, ...(this.records.has(key) ? { displaced: this.records.get(key)! } : {}) };
    void started.then(settled => {
      record.settled = settled;
      // A start that failed after every call left has no job to continue.
      if (record.active === 0 && !settled.ok) this.forget(record);
    });
    this.records.delete(key);
    this.records.set(key, record);
    this.trim();
    return record;
  }

  /** A call starts serving the job. */
  attach(record: StartRecord): void {
    record.active += 1;
  }

  /** A call serving the job lost its client, so its answer will not arrive. */
  markUnanswered(record: StartRecord, now = Date.now()): void {
    record.unansweredAt = now;
  }

  /**
   * A call stops serving the job. answered: its client got the job, so an identical call
   * after it is a new one. unanswered: its client did not get the job's result, as when the
   * call was cancelled or cut off, or ended in an error after the job started, so an identical
   * call soon after continues it. failed: there is no job to continue.
   */
  release(record: StartRecord, outcome: CallOutcome, now = Date.now()): void {
    record.active = Math.max(0, record.active - 1);
    if (outcome === 'failed') this.forget(record);
    else if (outcome === 'unanswered') record.unansweredAt = now;
    // Once the last call serving it is answered, its client has the job.
    else if (record.active === 0) this.forget(record);
  }

  /**
   * Lets the record go, unless a newer one took its key, and puts back the one it took the key
   * from: a call refused while an identical one still runs, as locally where both would save
   * in one folder, does not take that one's place.
   */
  forget(record: StartRecord): void {
    if (this.records.get(record.key) !== record) return;
    const before = record.displaced;
    record.displaced = undefined;
    if (before) this.records.set(record.key, before);
    else this.records.delete(record.key);
  }

  private prune(timing: RepeatTiming, now: number): void {
    for (const record of this.records.values()) {
      if (record.active > 0) continue;
      if (record.unansweredAt !== undefined && now - record.unansweredAt <= timing.unansweredWindowMs) continue;
      // The one it took the key from comes back, and goes too on a later look when it is as old.
      this.forget(record);
    }
  }

  private trim(): void {
    while (this.records.size > MAX_REPEAT_RECORDS) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) break;
      this.records.delete(oldest);
    }
  }
}

/** The ledger every kit tool of this process shares. */
export const startLedger = new StartLedger();
