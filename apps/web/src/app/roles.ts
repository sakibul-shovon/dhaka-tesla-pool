export function homePathForRole(role: "PASSENGER" | "DRIVER" | "ADMIN"): string {
  if (role === "DRIVER") return "/d";
  if (role === "ADMIN") return "/a";
  return "/p";
}
