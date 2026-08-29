type ClassValue = string | number | null | false | undefined | ClassValue[];

function flatten(input: ClassValue): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.flatMap(flatten);
  return [String(input)];
}

export function cn(...inputs: ClassValue[]): string {
  return inputs.flatMap(flatten).filter(Boolean).join(" ");
}
