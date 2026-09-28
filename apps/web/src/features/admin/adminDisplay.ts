// Shared badge-tone mapping across every admin page — kept in one place so
// "cancelled is always danger, completed is always success" can't drift
// between the user directory, the ride browser, and their detail views.
export function roleTone(role: string): "accent" | "electric" | "neutral" {
  if (role === "DRIVER") return "electric";
  if (role === "ADMIN") return "neutral";
  return "accent";
}

export function accountStatusTone(status: string): "danger" | "success" {
  return status === "SUSPENDED" ? "danger" : "success";
}

export function terminalStatusTone(status: string): "danger" | "success" | "neutral" {
  if (status === "CANCELLED") return "danger";
  if (status === "COMPLETED") return "success";
  return "neutral";
}
