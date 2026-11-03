/**
 * Reading an SFZ instrument (INST-55): the open text format most free sample libraries describe
 * themselves in, and the model our sample maps follow. Enough of it for the factory imports: headers
 * and what each inherits, `#define` and `#include`, comments, and `default_path`. Opcodes stay strings;
 * what to make of them is the import's.
 *
 * - **Headers nest:** `<global>` holds for every region after it, `<master>` within that, then
 *   `<group>`, then the `<region>` itself, each one starting a level afresh and clearing the levels
 *   below it. A region's opcodes are all four merged, the nearer winning.
 * - **`#define $NAME value`** takes effect from where it is, so a file included twice can read
 *   different values each time (Salamander includes one region list once per velocity layer).
 * - **`#include "path"`** splices a file in where it stands, even mid-line, relative to the instrument.
 */

/** One region as the instrument has it: every opcode it inherits, and its sample's path. */
export interface SfzRegion {
  opcodes: Record<string, string>;
  /** The sample file, `default_path` applied, relative to the instrument's folder. */
  sample: string;
}

const HEADER_LEVEL: Record<string, number> = { global: 0, master: 1, group: 2, region: 3 };

/** Text with its comments taken out: `//` to the end of the line, and `/* ... *\/` blocks. */
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, "");

/**
 * The instrument at `entry`, as its regions. `read` gives a file's text by its path relative to the
 * instrument's folder (the folder `entry` is in), so a test can hand it files from memory.
 */
export function parseSfz(entry: string, read: (path: string) => string): SfzRegion[] {
  const defines = new Map<string, string>();
  const substitute = (text: string) => text.replace(/\$[A-Za-z0-9_]+/g, (name) => defines.get(name) ?? name);

  /** The file's text with its includes spliced in and its defines applied, read in order. */
  const expand = (path: string): string =>
    withoutComments(read(path))
      .split("\n")
      .map((line) => {
        const define = line.match(/^\s*#define\s+(\$[A-Za-z0-9_]+)\s+(.*?)\s*$/);
        if (define) {
          defines.set(define[1], substitute(define[2]));
          return "";
        }
        // Text and includes in turn: an include's defines hold for the text after it.
        return line
          .split(/(#include\s+"[^"]+")/)
          .map((part) => {
            const include = part.match(/^#include\s+"([^"]+)"$/);
            return include ? expand(substitute(include[1])) : substitute(part);
          })
          .join(" ");
      })
      .join("\n");

  const text = expand(entry);
  // Headers and opcodes in order. An opcode's value runs to the next opcode, header or line end, so a
  // sample's path may hold spaces.
  const tokens = text.match(/<[a-z_]+>|[A-Za-z0-9_]+=[^\n<]*?(?=\s+[A-Za-z0-9_]+=|\s*<|\s*$|\n)/gm) ?? [];

  const levels: Record<string, string>[] = [{}, {}, {}, {}];
  const control: Record<string, string> = {};
  const regions: SfzRegion[] = [];
  let current: Record<string, string> | null = null;
  const finish = () => {
    if (current !== levels[3] || !current.sample) return;
    const opcodes = Object.assign({}, ...levels) as Record<string, string>;
    const sample = `${control.default_path ?? ""}${opcodes.sample}`.replace(/\\/g, "/");
    regions.push({ opcodes, sample });
  };
  tokens.forEach((token) => {
    const header = token.match(/^<([a-z_]+)>$/);
    if (header) {
      finish();
      const level = HEADER_LEVEL[header[1]];
      if (level === undefined) {
        // <control> sets the instrument's own settings; <curve>, <effect> and the rest aren't regions'.
        current = header[1] === "control" ? control : null;
        return;
      }
      // This level starts afresh, and so does each below it.
      levels.forEach((_, index) => {
        if (index >= level) levels[index] = {};
      });
      current = levels[level];
      return;
    }
    const [key, ...value] = token.split("=");
    if (current) current[key] = value.join("=").trim();
  });
  finish();
  return regions;
}
