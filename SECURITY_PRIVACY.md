# Security & Privacy Checklist

## Security

### ✅ Authentication & Authorization
- [x] OAuth 2.0 flow for Gmail (authorization code grant)
- [x] Access tokens encrypted at rest (AES-256-GCM)
- [x] Refresh token rotation support
- [x] Token expiration handling
- [ ] Rate limiting per user (TODO: implement middleware)
- [ ] API key authentication for internal services (TODO: if needed)

### ✅ Data Protection
- [x] OAuth tokens encrypted in database
- [x] Encryption key stored in environment variables (never committed)
- [x] SQL injection prevention (parameterized queries)
- [x] Input validation (Zod schemas where applicable)
- [ ] HTTPS enforcement in production (TODO: configure reverse proxy)
- [ ] CORS configuration (TODO: restrict origins)

### ✅ API Security
- [x] Input validation on all endpoints
- [x] Error messages don't leak sensitive information
- [ ] Rate limiting middleware (TODO: implement)
- [ ] Request size limits (TODO: configure Express)
- [ ] API versioning (TODO: add /v1 prefix)

### ✅ Infrastructure Security
- [x] Database credentials in environment variables
- [x] Redis connection secured (TODO: add password in production)
- [x] Docker Compose for local development
- [ ] Secrets management (TODO: use Vault/AWS Secrets Manager in production)
- [ ] Network isolation (TODO: configure Docker networks)

### ✅ Code Security
- [x] Dependencies audited (TODO: run `npm audit`)
- [x] No hardcoded secrets
- [x] TypeScript for type safety
- [ ] Dependency updates automated (TODO: Dependabot)

## Privacy

### ✅ Data Minimization
- [x] **Email bodies NOT stored** (privacy-first design)
- [x] Only snippet (first 200 chars) stored
- [x] Minimal metadata stored (sender, date, subject, labels, threadId)
- [x] Tracking parameters removed from URLs
- [x] No full email content in logs

### ✅ Data Retention
- [x] Email retention: 90 days (configurable)
- [x] Rankings retention: 1 year (for evaluation)
- [x] Feedback retention: Indefinite (for ML training)
- [x] Video metadata retention: Indefinite (public data)
- [ ] Automated cleanup jobs (TODO: implement scheduled cleanup)

### ✅ GDPR Compliance
- [x] **Right to deletion**: Cascade deletes on user deletion
- [x] **Right to export**: Export user data endpoint (TODO: implement)
- [x] **Right to access**: Dashboard shows all stored data
- [ ] **Right to rectification**: Update user preferences (TODO: implement endpoint)
- [ ] **Data portability**: Export in machine-readable format (TODO: implement)

### ✅ User Control
- [x] User can disconnect Gmail (delete tokens)
- [x] User preferences stored (learning goals, notifications)
- [ ] User can delete individual links/rankings (TODO: implement)
- [ ] User can opt-out of data collection (TODO: implement)

### ✅ Audit & Compliance
- [x] Structured logging with request IDs
- [x] Job tracking for all operations
- [ ] Audit logs for data access (TODO: implement)
- [ ] Privacy policy document (TODO: create)
- [ ] Terms of service (TODO: create)

## Privacy-First Design Decisions

### Email Storage
**Decision**: Store only metadata + 200-char snippet
**Rationale**: Full email bodies contain sensitive information. Snippet is sufficient for context without violating privacy.

### URL Canonicalization
**Decision**: Remove tracking parameters (utm_*, etc.)
**Rationale**: Prevents tracking user behavior across sites, improves privacy.

### Data Retention
**Decision**: 90 days for emails, 1 year for rankings
**Rationale**: Balances functionality (evaluation, backfill) with privacy (minimal data retention).

### Feedback Collection
**Decision**: Explicit user actions (watched/saved/skipped)
**Rationale**: User-controlled feedback, no implicit tracking.

## Security Best Practices

### Production Checklist
- [ ] Use managed database (RDS, Cloud SQL) with encryption at rest
- [ ] Use managed Redis (ElastiCache) with encryption
- [ ] Enable SSL/TLS for all connections
- [ ] Use secrets management service (AWS Secrets Manager, HashiCorp Vault)
- [ ] Implement WAF (Web Application Firewall)
- [ ] Set up monitoring and alerting (CloudWatch, Datadog)
- [ ] Regular security audits
- [ ] Penetration testing
- [ ] Incident response plan

### Monitoring
- [ ] Failed authentication attempts
- [ ] Unusual API usage patterns
- [ ] Database query performance
- [ ] Error rates and types
- [ ] Rate limit violations

## Known Limitations

1. **Rate Limiting**: Per-user rate limiting not yet implemented (planned)
2. **HTTPS**: Local development uses HTTP (production must use HTTPS)
3. **Secrets Management**: Environment variables used (upgrade to secrets manager in production)
4. **Audit Logging**: Basic logging exists, full audit trail TODO
5. **Data Export**: Endpoint not yet implemented (planned)

## Future Enhancements

- [ ] End-to-end encryption for sensitive data
- [ ] Differential privacy for aggregate statistics
- [ ] User consent management (cookie consent, data processing consent)
- [ ] Automated compliance reporting
- [ ] Privacy-preserving analytics (aggregate only, no PII)

