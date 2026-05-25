# Avatar Upload

User avatars are uploaded to Railway S3 under the key `avatars/{userId}.jpg` and served through the proxy route `/api/avatar?key=avatars/{userId}.jpg`, which redirects to a fresh presigned S3 download URL (1-hour browser cache).

The full proxy URL is stored in `User.avatarUrl`.

After upload the client calls `useSession().update({ image: url })` to refresh the session token immediately without requiring sign-out.
