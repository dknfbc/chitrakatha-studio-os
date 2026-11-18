-- Migration 0006: Team portraits initialization
-- Note: Portrait payloads are populated via parameterized queries in worker.js ensureTeamPortraits()
-- to prevent exceeding Cloudflare D1 query size limits.
SELECT 1;
