// The rule for every new password (the server checks the same): at least 8 characters, with a capital letter, a
// small letter and a number.
const RULES: [string, (p: string) => boolean][] = [
  ['at least 8 characters', (p) => p.length >= 8],
  ['a capital letter', (p) => /[A-Z]/.test(p)],
  ['a small letter', (p) => /[a-z]/.test(p)],
  ['a number', (p) => /\d/.test(p)],
];

export const passwordOk = (p: string) => p.length <= 100 && RULES.every(([, ok]) => ok(p));

/** The hint under a new-password box: the rule while it is empty, then what is still missing as they type. */
export function passwordHint(p: string) {
  if (!p) return 'At least 8 characters, with a capital letter, a small letter and a number';
  const missing = RULES.filter(([, ok]) => !ok(p)).map(([text]) => text);
  return missing.length ? `Still needs: ${missing.join(', ')}` : 'Good password';
}
