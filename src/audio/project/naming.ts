/**
 * A new thing's default name (2026-10-30, Alden): the plain name while nothing has it ("Drum Kit"),
 * and only then a number, the lowest free one from 2 ("Drum Kit 2"). It used to number every new
 * track by how many tracks there were, so a project's first drum kit could be "Drum Kit 3".
 */
export function freeName(base: string, taken: readonly string[]): string {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  let number = 2;
  while (names.has(`${base} ${number}`)) number++;
  return `${base} ${number}`;
}
