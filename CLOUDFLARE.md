# Cloudflare DNS Setup

## Records (Production)

| Type  | Name                  | Target                       | Proxy      |
|-------|-----------------------|------------------------------|------------|
| A     | `masjidmu.id`         | (Cloudflare Pages auto)      | Proxied    |
| A     | `*.masjidmu.id`       | (Cloudflare Pages auto)      | Proxied    |
| CNAME | `api.masjidmu.id`     | `<railway-cname>.up.railway.app` | DNS only |
| CNAME | `admin.masjidmu.id`   | (Cloudflare Pages later)     | Proxied    |

## SSL/TLS

Cloudflare → SSL/TLS → Overview → **Full (strict)**
Universal SSL covers `masjidmu.id` and `*.masjidmu.id` automatically.

## WAF (recommended baseline)

Cloudflare → Security → WAF
- Enable **Managed Rules** (free tier OK)
- Custom rule: rate limit `/api/auth/sign-in` to 5 req/15 min per IP
- Custom rule: block known bot user-agents on `/api/*`

## Page Rules / Configuration Rules

- Cache `*.masjidmu.id/assets/*` aggressively (1 month)
- Bypass cache on `*.masjidmu.id/api/*` and `api.masjidmu.id/*`

## CORS notes

Backend allows origin matching `^https://[a-z0-9-]+\.masjidmu\.id$` plus
localhost in dev. No wildcard CORS — the regex is enforced server-side.

## Test after DNS propagation

```bash
curl -I https://api.masjidmu.id/healthz
# expect: HTTP/2 200, content-type application/json
```
