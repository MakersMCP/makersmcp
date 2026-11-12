import { z } from 'zod';
import { codeSpan } from './quoted.js';

// A tool's input refuses an argument it does not take, as the additionalProperties false of
// its listed schema says, instead of dropping it: a dropped output_dir started the job in
// the default folder, where a tool that deletes the earlier run as it starts deleted it.

/** Other names assistants give an argument, written as argumentKey writes them. */
const ALIASES: Record<string, string[]> = {
  out_dir: ['out', 'output', 'outputdir', 'outputfolder', 'outfolder', 'outputpath', 'folder', 'dir', 'directory'],
  job_id: ['id', 'job', 'jobid'],
  topics: ['topic'],
  url: ['site', 'website', 'link', 'address', 'uri', 'websiteurl', 'siteurl'],
  wait_seconds: ['wait', 'waittime', 'timeout'],
  timeout_seconds: ['timeout'],
};

/** The most unknown names a refusal lists. */
const MOST_NAMED = 10;

function argumentKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The argument a wrong name most likely means, among those the tool takes: the one written the
 * same but for letter case and punctuation, like outDir, else the one it is a usual other name
 * of. A name that fits two, like timeout on a tool with wait_seconds and timeout_seconds, gets none.
 */
export function rightArgument(name: string, known: string[]): string | undefined {
  const key = argumentKey(name);
  const same = known.filter(candidate => argumentKey(candidate) === key);
  if (same.length) return same.length === 1 ? same[0] : undefined;
  const aliased = known.filter(candidate => ALIASES[candidate]?.includes(key));
  return aliased.length === 1 ? aliased[0] : undefined;
}

export interface StrictInputOptions {
  /** What the refusal says was not done, like "Nothing was started.". */
  nothing?: string;
  /** A sentence for a name the tool here does not take, by that name, like out_dir on a hosted server. */
  hints?: Record<string, string>;
}

/** The refusal of a call with arguments the tool does not take. */
export function unknownArgumentsText(names: string[], known: string[], options: StrictInputOptions = {}): string {
  const named = names.slice(0, MOST_NAMED).map(name => {
    const right = rightArgument(name, known);
    return right ? `${codeSpan(name)} (use \`${right}\`)` : codeSpan(name);
  });
  if (names.length > MOST_NAMED) named.push(`and ${names.length - MOST_NAMED} more`);
  const takes = known.length ? `This tool takes ${known.map(name => `\`${name}\``).join(', ')}.` : 'This tool takes no arguments.';
  const hints = [...new Set(names.flatMap(name => (Object.hasOwn(options.hints ?? {}, name) ? [options.hints![name]!] : [])))];
  return [`Unknown argument${names.length > 1 ? 's' : ''} ${named.join(', ')}.`, takes, ...(options.nothing ? [options.nothing] : []), ...hints].join(' ');
}

/**
 * A tool's input schema that refuses an argument the tool does not take, naming the one it
 * most likely means, instead of dropping it. Any other problem keeps zod's own message. A call
 * that carries toolCallId, which some clients add to the arguments with other keys of their
 * own that the assistant cannot take out, has only the arguments the tool takes read.
 */
export function strictInput<T extends z.ZodRawShape>(shape: T, options: StrictInputOptions = {}) {
  const known = Object.keys(shape);
  const schema = z.strictObject(shape, {
    error: issue => (issue.code === 'unrecognized_keys' ? unknownArgumentsText(issue.keys, known, options) : undefined),
  });
  const run = schema._zod.run;
  schema._zod.run = (payload, context) => {
    const data: unknown = payload.value;
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.hasOwn(data, 'toolCallId') || Object.hasOwn(shape, 'toolCallId')) {
      return run(payload, context);
    }
    return run({ ...payload, value: Object.fromEntries(Object.entries(data).filter(([key]) => Object.hasOwn(shape, key))) }, context);
  };
  return schema;
}
