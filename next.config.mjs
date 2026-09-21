/**
 * Content-Security-Policy (SECH-84). Currently shipped REPORT-ONLY: violations are
 * POSTed to /api/csp-report and logged, nothing is blocked. Move to enforcing by
 * renaming the header key below once production shows no unexpected violations.
 *
 * Every allowed source has a reason; anything not listed falls back to default-src 'self'.
 */
function buildCsp(isProd) {
  const directives = {
    "default-src": ["'self'"],
    // 'unsafe-inline': Next.js App Router injects inline <script> tags for RSC
    // streaming/hydration on every page. Replace with a per-request nonce (via
    // middleware) before enforcing if we want script-src strict. 'unsafe-eval'
    // is dev-only (HMR/Turbopack).
    "script-src": ["'self'", "'unsafe-inline'", ...(isProd ? [] : ["'unsafe-eval'"])],
    // 'unsafe-inline': Tailwind/next-font emit inline <style>, and components set
    // inline style={{}} attributes (e.g. doc-type-icon.tsx).
    "style-src": ["'self'", "'unsafe-inline'"],
    // https://*.storageapi.dev: Railway bucket storage. /api/avatar and
    // /api/editor-images 302-redirect <img> requests to presigned bucket URLs, and
    // attachment/doc previews use presigned URLs directly.
    // blob:: AvatarUpload.tsx loads the chosen file via URL.createObjectURL().
    // No data: — TipTap is configured with allowBase64: false.
    "img-src": ["'self'", "blob:", "https://*.storageapi.dev"],
    // next/font/google self-hosts Inter at build time; no runtime font CDN.
    "font-src": ["'self'"],
    // Every browser fetch/XHR is same-origin (uploads POST to /api/attachments/upload,
    // AI chat goes through /api/ai/*; Anthropic is only called server-side).
    // ws:/wss: is dev-only, for Next's HMR socket.
    "connect-src": ["'self'", ...(isProd ? [] : ["ws:", "wss:"])],
    // https://*.storageapi.dev: in-app PDF preview iframe (doc-document-view.tsx)
    // embeds the presigned bucket URL.
    "frame-src": ["'self'", "https://*.storageapi.dev"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    // The app is never legitimately embedded by another site.
    "frame-ancestors": ["'self'"],
    "report-uri": ["/api/csp-report"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // jsdom (pulled in by isomorphic-dompurify) reads its default stylesheet via
  // readFileSync(__dirname + "/../../browser/default-stylesheet.css") at module
  // load time. Webpack-bundling it breaks that path resolution and fails the
  // build during "Collecting page data" for any route that imports
  // sanitizeTipTapHtml. Externalizing keeps it as a native require() instead.
  serverExternalPackages: ["isomorphic-dompurify", "jsdom"],
  // Next.js App Router's file-based routing excludes dot-prefixed directories,
  // so /.well-known/* (RFC 8414 / RFC 9728 OAuth metadata) is implemented under
  // /well-known/* and rewritten here to the literal well-known path.
  async headers() {
    const isProd = process.env.NODE_ENV === "production";
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Sends the origin (no path/query) cross-origin — path and query can carry
          // invite tokens and OAuth params — and the full URL same-origin.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          // Legacy twin of CSP frame-ancestors; enforced now, unlike the report-only CSP.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Production builds only (browsers ignore HSTS over plain http anyway, so a
          // local `next start` can't pin localhost). No includeSubDomains/preload:
          // other jedforge.com subdomains aren't ours to commit to HTTPS-only from here.
          ...(isProd
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
            : []),
          { key: "Content-Security-Policy-Report-Only", value: buildCsp(isProd) },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/.well-known/:path*",
        destination: "/well-known/:path*",
      },
    ];
  },
};

export default nextConfig;
