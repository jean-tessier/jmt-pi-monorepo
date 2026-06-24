declare const SubtaskSequenceBrand: unique symbol
export type SubtaskSequence = number & { readonly [SubtaskSequenceBrand]: void }

export function createSubtaskSequence(n: number): SubtaskSequence {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`SubtaskSequence must be a positive integer, got: ${n}`)
  }
  return n as SubtaskSequence
}
