// Multiple-choice helpers shared by the exam screen, API and scoring.

// Display order for one student: a permutation of option indexes seeded by the
// attempt and question, so it is stable across reloads but differs per student.
export function optionOrder(count: number, seed: string): number[] {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index++) state = Math.imul(state ^ seed.charCodeAt(index), 16777619);
  const next = () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state ^= state >>> 16;
    return (state >>> 0) / 4294967296;
  };
  const order = Array.from({ length: count }, (_, index) => index);
  for (let index = count - 1; index > 0; index--) {
    const swap = Math.floor(next() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order;
}

// All-or-nothing: the selected set must equal the correct set exactly.
export function mcqCorrect(selected: number[], correct: number[]): boolean {
  const a = [...new Set(selected)].sort((x, y) => x - y);
  const b = [...new Set(correct)].sort((x, y) => x - y);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// A selection is valid when every index exists, there are no duplicates, and a
// single-answer question gets at most one.
export function validSelection(selected: number[], optionCount: number, multiple: boolean): boolean {
  if (new Set(selected).size !== selected.length) return false;
  if (!multiple && selected.length > 1) return false;
  return selected.every((value) => Number.isInteger(value) && value >= 0 && value < optionCount);
}
