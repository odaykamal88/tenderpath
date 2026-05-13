/**
 * Decode the common HTML entities that show up in scraped page titles and
 * user-pasted company names — `&#8211;`, `&amp;`, `&nbsp;` etc. Keeps the
 * surface narrow so it can be used at boundaries (assessment persistence,
 * email rendering) without dragging in a full HTML parser.
 */

const NAMED: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
  "&hellip;": "…",
  "&mdash;": "—",
  "&ndash;": "–",
  "&lsquo;": "‘",
  "&rsquo;": "’",
  "&ldquo;": "“",
  "&rdquo;": "”",
};

export function decodeHtmlEntities(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const code = parseInt(n, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&[a-zA-Z]+;/g, (m) => NAMED[m] ?? m);
}
