export const APP_NAME = "sms-gateway";
export const APP_VERSION = "0.1.0";

export function getEnv(name: string): string | undefined {
  const value = Deno.env.get(name);
  return value && value.trim().length > 0 ? value : undefined;
}

export function getPort(): number {
  const rawPort = getEnv("PORT");
  const port = rawPort ? Number(rawPort) : 3020;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: ${rawPort}`);
  }

  return port;
}

export function getDbPath(): string {
  return getEnv("DB_PATH") || "/data/sms-gateway.db";
}

export function getAdminUsername(): string {
  return getEnv("ADMIN_USERNAME") || "admin";
}

export function getAdminPassword(): string | undefined {
  return getEnv("ADMIN_PASSWORD");
}

export function getSessionTtlDays(): number {
  const rawValue = getEnv("SESSION_TTL_DAYS");
  const ttlDays = rawValue ? Number(rawValue) : 7;

  if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 365) {
    throw new Error(`Invalid SESSION_TTL_DAYS value: ${rawValue}`);
  }

  return ttlDays;
}

export function getCookieSecure(): boolean {
  return getEnv("COOKIE_SECURE") === "true";
}

export function getEnvironment(): string {
  return getEnv("DENO_ENV") || getEnv("NODE_ENV") || "production";
}

export function getBuildInfo() {
  return {
    sha: getEnv("GITHUB_SHA") || getEnv("BUILD_SHA") || null,
    date: getEnv("BUILD_DATE") || null,
  };
}

export function isProviderConfigured(): boolean {
  return Boolean(
    getEnv("TWILIO_ACCOUNT_SID") &&
      getEnv("TWILIO_AUTH_TOKEN") &&
      getEnv("TWILIO_FROM") &&
      getEnv("SMS_TO"),
  );
}

export function getSharedSecret(): string | undefined {
  return getEnv("SHARED_SECRET");
}
