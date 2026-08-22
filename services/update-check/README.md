# Update-check service

This directory owns the server half of the advisory `pmds` update-check
contract. The Worker accepts `POST /check` with exactly four JSON fields:

```json
{ "version": "1.17.3", "os": "linux", "arch": "x86_64", "ci": false }
```

It returns `{ "latestVersion": "1.18.0" }` from the deployment's required
`LATEST_VERSION` variable and writes only `version`, `os`, `arch`, the CI/local
bucket, and a count of one to the `UPDATE_CHECKS` Analytics Engine dataset.
Application code does not access or persist client IP addresses, forwarded
headers, user agents, or other identifying headers. It reads the request URL
path, `Content-Type`, and `Content-Length` only to validate the route, media
type, and body-size limit; none of that protocol metadata is written to
Analytics Engine or application logs. Worker observability is disabled in
`wrangler.jsonc` so request logs are not enabled by this service.

Run the deterministic contract test with:

```bash
node --test services/update-check/worker.test.mjs
```

## Deployment readiness

The repository does not contain Cloudflare credentials and this service is not
currently deployed. Before a release enables the client:

1. configure `version.palamedes.dev` in the `palamedes.dev` Cloudflare zone,
   including a valid TLS certificate;
2. provision the `palamedes_update_checks` Analytics Engine dataset;
3. deploy this checked Worker with `LATEST_VERSION` set to the released CLI
   version and keep that value synchronized with releases;
4. verify the live request/response and confirm no request logging is enabled;
5. build release binaries with the only accepted endpoint value,
   `PALAMEDES_UPDATE_ENDPOINT=https://version.palamedes.dev/check`.

Until all five steps are complete, release builds omit the compile-time endpoint
and make no update-check request. Request counts are a daily rate-limited usage
proxy and support version/OS/architecture/CI distributions. They cannot be
reported as unique weekly installations because the contract deliberately has
no stable identifier.
