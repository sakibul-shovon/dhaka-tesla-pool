// Drivers are shown to passengers by first name only (plan §15.2's pool
// card, "Bullet · Jashim · ...") — never the full name from `users.name`.
export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
