export const MAX_COMMENT_CHARS = 60_000;
export const MAX_SUMMARY_CHARS = 1_000_000;

export interface Section {
  appName: string;
  body: string;
}

/**
 * Keeps as many whole app sections as fit in `budget` characters, in order.
 * Sections that don't fit are replaced by a one-line pointer to the full output.
 */
export function fitSections(sections: Section[], budget: number, fullOutputUrl: string): string[] {
  const omittedLine = (s: Section): string =>
    `\nApp: \`${s.appName}\`: diff omitted from this comment, see the [job summary](${fullOutputUrl}).\n`;

  const omittedTotal = sections.reduce((n, s) => n + omittedLine(s).length, 0);
  let remaining = budget - omittedTotal;
  const out: string[] = [];
  for (const s of sections) {
    const extra = s.body.length - omittedLine(s).length;
    if (extra <= remaining) {
      out.push(s.body);
      remaining -= extra;
    } else {
      out.push(omittedLine(s));
    }
  }
  return out;
}

export function truncateForSummary(text: string, max = MAX_SUMMARY_CHARS): string {
  if (text.length <= max) {
    return text;
  }
  const note = '\n\n_Output truncated: larger than the job summary limit._\n';
  return text.slice(0, max - note.length) + note;
}
