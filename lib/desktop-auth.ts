import { createHash, randomBytes } from "node:crypto";
import { Redis } from "@upstash/redis";

export type DesktopProfile = {
  id: string;
  name: string;
  email: string;
  imageUrl: string;
  plan: "Early Access";
};

type DesktopGrant = { state: string; profile: DesktopProfile };
type DesktopSession = { profile: DesktopProfile; createdAt: number };

const GRANT_TTL_SECONDS = 5 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function getRedis() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Хранилище сессий OfficeGhost не настроено");
  return new Redis({ url, token });
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function isValidDesktopState(state: string) {
  return /^[A-Za-z0-9_-]{32,128}$/.test(state);
}

export async function createDesktopGrant(state: string, profile: DesktopProfile) {
  if (!isValidDesktopState(state)) throw new Error("Некорректный запрос приложения");
  const code = randomBytes(32).toString("base64url");
  await getRedis().set(`desktop-grant:${digest(code)}`, { state, profile } satisfies DesktopGrant, { ex: GRANT_TTL_SECONDS });
  return code;
}

export async function exchangeDesktopGrant(code: string, state: string) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(code) || !isValidDesktopState(state)) return null;
  const grant = await getRedis().getdel<DesktopGrant>(`desktop-grant:${digest(code)}`);
  if (!grant || grant.state !== state) return null;

  const token = randomBytes(48).toString("base64url");
  const session: DesktopSession = { profile: grant.profile, createdAt: Date.now() };
  await getRedis().set(`desktop-session:${digest(token)}`, session, { ex: SESSION_TTL_SECONDS });
  return { token, profile: grant.profile, expiresIn: SESSION_TTL_SECONDS };
}

export async function getDesktopSession(token: string) {
  if (!/^[A-Za-z0-9_-]{48,160}$/.test(token)) return null;
  return getRedis().get<DesktopSession>(`desktop-session:${digest(token)}`);
}

export async function revokeDesktopSession(token: string) {
  if (!/^[A-Za-z0-9_-]{48,160}$/.test(token)) return;
  await getRedis().del(`desktop-session:${digest(token)}`);
}
