/** @type {import('next').NextConfig} */
const nextConfig = {
  // jsdom (pulled in by isomorphic-dompurify) reads its default stylesheet via
  // readFileSync(__dirname + "/../../browser/default-stylesheet.css") at module
  // load time. Webpack-bundling it breaks that path resolution and fails the
  // build during "Collecting page data" for any route that imports
  // sanitizeTipTapHtml. Externalizing keeps it as a native require() instead.
  experimental: {
    serverComponentsExternalPackages: ["isomorphic-dompurify", "jsdom"],
  },
  // Next.js App Router's file-based routing excludes dot-prefixed directories,
  // so /.well-known/* (RFC 8414 / RFC 9728 OAuth metadata) is implemented under
  // /well-known/* and rewritten here to the literal well-known path.
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
