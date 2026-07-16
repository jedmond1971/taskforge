/** @type {import('next').NextConfig} */
const nextConfig = {
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
