# mytools — minimal handoff

- Read README.md → TODO.md → relevant module/tests only. Do not load all ref/.
- Local-first PO/PM tool: code handles collection, dedup, dates, storage, validation and transport; AI handles meaning.
- Main workflows: briefing, meeting, request→JIRA, team daily→weekly.
- Default fresh context; persistent history is opt-in only. No automatic ancestor expansion.
- Graph token: UI input → optional OS Keychain/Credential Manager (default on) → /me verification → memory session. Never .env/SQLite/logs/prompts. LLM/JIRA keys remain memory/env only. Never disable TLS verification.
- Record server-side mutations without payloads or secrets. Repeating history prepares inputs; never auto-charge or replay external writes.
- External writes require reviewed explicit user action. No paid background AI by default.
- Teams defaults OFF; OFF preserves checkpoint; ON catches up. Failure must not advance it.
- Business dates use settings.timezone (Asia/Seoul default), not host timezone.
- Guide versions/execution snapshots immutable. Security/idempotency belong in code, not editable guides.
- Blue design: src/blue.css. Keep accessible labels and mobile layout.
- Verify: npm test; npm run build; npm run test:ui. Tests use no live company APIs/data.
- Update README and TODO accurately. Mock-tested does not mean company-verified.
- Scripts referenced by ref/ are absent; do not claim they were migrated.
