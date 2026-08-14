/** Order-independent set equality, used to grade self-paced quiz answers. */
function sameChoiceSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((choice, i) => choice === sortedB[i]);
}

export function gradeAnswer(selectedChoices: string[], correctChoices: string[]): boolean {
  return sameChoiceSet(selectedChoices, correctChoices);
}
