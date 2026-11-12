// Text that came from outside makersmcp, like what a kit read from a website or a name a
// client sent, shown in a result as data: in a fence or a code span that the text cannot
// end, so a line in it that looks like makersmcp's own, such as a Next line, stays inside.
// makersmcp's own lines (the heading, the Next line, the notes) stay outside them.

/** Backticks longer than any run of backticks in the text, and at least `minimum`, so the text cannot close them. */
export function longerBackticks(text: string, minimum: number): string {
  let longest = 0;
  for (const [run] of text.matchAll(/`+/g)) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(minimum, longest + 1));
}

/** The text on one line, each run of white space one space. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A short value inside a line of makersmcp's own text, like a name a client gave: on one line,
 * at most `most` characters, in a code span that it cannot close.
 */
export function codeSpan(value: string, most = 200): string {
  let line = oneLine(value);
  // Two backticks with nothing between them are no span: a run later on the line would close them.
  if (!line) return '(blank)';
  if (line.length > most) line = `${line.slice(0, most)}...`;
  const ticks = longerBackticks(line, 1);
  // A backtick at either end of the value would join the span's own.
  return /^`|`$/.test(line) ? `${ticks} ${line} ${ticks}` : `${ticks}${line}${ticks}`;
}
