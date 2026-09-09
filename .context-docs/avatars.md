# Avatar Upload

User avatars are uploaded to Railway S3 under the key `avatars/{userId}.jpg` and served through the proxy route `/api/avatar?key=avatars/{userId}.jpg`, which redirects to a fresh presigned S3 download URL (1-hour browser cache).

The full proxy URL is stored in `User.avatarUrl`.

After upload the client calls `useSession().update({ image: url })` to refresh the session token immediately without requiring sign-out, and `router.refresh()` to invalidate the Next.js Router Cache for `/settings`. Without `router.refresh()`, navigating away and back within ~30 seconds serves the stale server component payload (cached `avatarUrl` from before the upload), causing the avatar to revert to initials on remount.

**Server-side hardening (SECH-87/88/89, 2026-09-09)** — `PUT /api/avatar` (`src/app/api/avatar/route.ts`) no longer trusts the client at all beyond the initial size hint:
- Rejects any body over 5 MB via the `Content-Length` header before reading it (411 if the header is missing, 413 if it's too large).
- Decodes the actual bytes with `sharp` rather than trusting the declared `Content-Type` — anything that isn't a real raster image is rejected with 400, regardless of what Content-Type the client sent.
- Re-encodes to a clean 256×256 JPEG server-side (`sharp(...).resize(256, 256, { fit: "cover" }).jpeg(...)`), which strips embedded EXIF/GPS metadata as a side effect. The client (`AvatarUpload.tsx`) already crops/resizes to 256×256 before upload — the server-side resize is defense in depth against a client that bypasses the browser UI, not the primary resize step.

`sharp` (`^0.35.4`) was added as a dependency for this — first image-decode/re-encode library in the project. It's a native binary but installs and loads fine via plain `npm install` in this environment; no separate build step was needed locally or in CI. Available for reuse by other upload paths that need the same treatment (editor images, doc file uploads — tracked as SECH-90).
