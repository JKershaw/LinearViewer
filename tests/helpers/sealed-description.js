/**
 * LIN-4536: the shape a ticket description filed before LIN-4502 carries, the `## As asked` seal, as recorded history.
 * The seal's writer retired in LIN-4502 and the brief's quote of the same shape retired in LIN-4536 (the records brief's
 * part 1 is the task's `asked`), so no production code writes or reads this shape: a description that holds it is plain
 * text to every reader. Tests that pin how a real old description is handled build it here, spelled out once.
 */

/** The seal's heading line, as old descriptions carry it. */
export const SEALED_HEADING = '## As asked';
/** The seal's end line, as old descriptions carry it. */
export const SEALED_END = '*End of what was asked. Steps write below this line; nothing above it changes.*';

/**
 * A description in the sealed shape: heading, blank, the words byte for byte, blank, end line.
 * @param {string|null|undefined} words
 * @returns {string}
 */
export function sealedDescription(words) {
  return `${SEALED_HEADING}\n\n${String(words ?? '')}\n\n${SEALED_END}`;
}
