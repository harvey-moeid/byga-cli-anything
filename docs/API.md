# API

All /api routes require Cloudflare Access JWT in Cf-Access-Jwt-Assertion.
- GET /api/health
- GET /api/dashboard
- GET /api/repositories
- POST /api/repositories {fullName}
- DELETE /api/repositories/:id (soft disable)
- GET /api/repositories/:id/branches
- POST /api/jobs {repositoryId,ref,task:audit|generate}
- GET /api/jobs and GET /api/jobs/:id
- GET /api/integrations and GET /api/activity
Errors: {error:string}; never return secrets.
