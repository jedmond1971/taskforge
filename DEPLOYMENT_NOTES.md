# TaskForge Deployment Status

- **Railway URL:** https://taskforge-production-099b.up.railway.app
- **GitHub repo:** https://github.com/jedmond1971/taskforge
- **Current deployment status:** In progress — app is deployed to Railway but not yet fully functional.

## Still needs

1. Railway PostgreSQL service provisioned and `DATABASE_URL` set
2. Environment variables set in Railway:
   - `NEXTAUTH_URL` = `https://taskforge-production-099b.up.railway.app`
   - `NEXTAUTH_SECRET` = (generated via `openssl rand -base64 32`)
   - `AUTH_SECRET` = (same value as `NEXTAUTH_SECRET`)
   - `NODE_ENV` = `production`
3. Prisma migrations run against the Railway PostgreSQL database after it's provisioned
4. Verify app loads and auth works on the Railway URL

## Local dev

App runs on `localhost:3000` using local PostgreSQL database.
