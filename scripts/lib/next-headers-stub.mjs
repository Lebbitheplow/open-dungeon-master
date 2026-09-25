// next/headers for route handlers called from a test script
// (register-routes.mjs): the signed-in caller arrives as the bearer token a
// native app would send, and there is never a cookie.
export async function headers() {
  const token = globalThis.__odmTestToken;
  return new Headers(token ? { authorization: `Bearer ${token}` } : {});
}

export async function cookies() {
  return { get: () => undefined };
}
