# AGENTS.md

## Cursor Cloud specific instructions

### Project overview
Next.js 16 personal blog/utility site ("绿桶的小世界") with four pages: flashlight homepage, markdown editor, JSON diff tool, and an after-sales API proxy tool. See `package.json` for available scripts.

### Development
- **Dev server**: `npm run dev` (runs on port 3000 with Turbopack)
- **Build**: `npm run build`
- **Type-check**: `npx tsc --noEmit`
- No ESLint configuration exists in this repo; linting is not available.
- No automated test framework is configured.

### Prisma / Database
- Prisma schema (`prisma/schema.prisma`) is configured for MySQL but has **no models** defined yet. The app runs fully without a database.
- `prisma generate` requires `DATABASE_URL` set (a dummy value works): `DATABASE_URL="mysql://localhost:3306/dummy" npx prisma generate`
- `package-lock.json` is gitignored; `npm install` will resolve fresh each time.
