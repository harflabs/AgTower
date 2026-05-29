export function sanitizeConfiguredEnvVars(envVars: Record<string, unknown> | undefined) {
  if (!envVars) return undefined;

  const entries = Object.entries(envVars).flatMap(([rawKey, rawValue]) => {
    const key = rawKey.trim();
    if (!key) return [];
    if (key.includes("=") || key.includes("\0") || /\s/.test(key)) return [];
    return [[key, typeof rawValue === "string" ? rawValue : String(rawValue ?? "")] as const];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
