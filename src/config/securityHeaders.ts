/**
 * Security headers for every way Vintry is served: the local launcher (vite preview),
 * Netlify and Cloudflare Pages (public/_headers), and Vercel (vercel.json).
 * A test keeps the three copies identical. The CSP is the main guard for the
 * Claude API key stored in the browser, so change it with care.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://api.anthropic.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(self), microphone=(self)",
};

/** Port used by the double-click launcher. Kept away from common dev-server defaults. */
export const LAUNCHER_PORT = 47821;
