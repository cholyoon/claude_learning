import { test, expect, vi, beforeEach } from "vitest";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

const JWT_SECRET = new TextEncoder().encode("development-secret-key");
const COOKIE_NAME = "auth-token";

async function makeToken(payload: object, expiresIn = "7d") {
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .setIssuedAt()
    .sign(JWT_SECRET);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// Imported after mocks are set up
const { createSession, getSession, deleteSession, verifySession } =
  await import("../auth");

test("createSession sets an httpOnly cookie with a signed JWT", async () => {
  await createSession("user-1", "test@example.com");

  expect(mockCookieStore.set).toHaveBeenCalledOnce();
  const [name, , options] = mockCookieStore.set.mock.calls[0];
  expect(name).toBe(COOKIE_NAME);
  expect(options.httpOnly).toBe(true);
  expect(options.path).toBe("/");
});

test("getSession returns null when no cookie is present", async () => {
  mockCookieStore.get.mockReturnValue(undefined);

  const session = await getSession();
  expect(session).toBeNull();
});

test("getSession returns the session payload for a valid token", async () => {
  const payload = {
    userId: "user-1",
    email: "test@example.com",
    expiresAt: new Date().toISOString(),
  };
  const token = await makeToken(payload);
  mockCookieStore.get.mockReturnValue({ value: token });

  const session = await getSession();
  expect(session?.userId).toBe("user-1");
  expect(session?.email).toBe("test@example.com");
});

test("getSession returns null for an expired token", async () => {
  const payload = { userId: "user-1", email: "test@example.com" };
  const token = await makeToken(payload, "-1s");
  mockCookieStore.get.mockReturnValue({ value: token });

  const session = await getSession();
  expect(session).toBeNull();
});

test("getSession returns null for a tampered token", async () => {
  const token = "invalid.token.value";
  mockCookieStore.get.mockReturnValue({ value: token });

  const session = await getSession();
  expect(session).toBeNull();
});

test("deleteSession removes the auth cookie", async () => {
  await deleteSession();

  expect(mockCookieStore.delete).toHaveBeenCalledWith(COOKIE_NAME);
});

test("verifySession returns null when request has no auth cookie", async () => {
  const request = new NextRequest("http://localhost/");

  const session = await verifySession(request);
  expect(session).toBeNull();
});

test("verifySession returns session payload for a valid token in request", async () => {
  const payload = {
    userId: "user-2",
    email: "other@example.com",
    expiresAt: new Date().toISOString(),
  };
  const token = await makeToken(payload);
  const request = new NextRequest("http://localhost/", {
    headers: { cookie: `${COOKIE_NAME}=${token}` },
  });

  const session = await verifySession(request);
  expect(session?.userId).toBe("user-2");
  expect(session?.email).toBe("other@example.com");
});

test("verifySession returns null for an expired token in request", async () => {
  const token = await makeToken({ userId: "user-2", email: "x@y.com" }, "-1s");
  const request = new NextRequest("http://localhost/", {
    headers: { cookie: `${COOKIE_NAME}=${token}` },
  });

  const session = await verifySession(request);
  expect(session).toBeNull();
});
