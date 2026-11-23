# Agent skills

Skill untuk Claude Code (juga dibaca OpenCode, Codex, Cursor yang mendukung format `SKILL.md`).
Setiap folder berisi satu skill dan dimuat otomatis saat bekerja di repo ini.
Diunduh pada 2026-11-23 dari repo sumber di bawah; untuk memperbarui, salin ulang folder dari repo aslinya.

| Kategori | Skill | Sumber | Lisensi |
|---|---|---|---|
| Desain & anti-slop UI | `impeccable` | github.com/pbakaus/impeccable | Apache-2.0 |
| | `frontend-design` | github.com/anthropics/skills | Apache-2.0 (LICENSE.txt) |
| | `ui-ux-pro-max` | github.com/nextlevelbuilder/ui-ux-pro-max-skill | MIT |
| | `deslop-ui` | github.com/kmaida/deslop-skills | tidak dicantumkan |
| UI/UX, a11y, kecepatan, SEO | `web-design-guidelines`, `writing-guidelines` | github.com/vercel-labs/agent-skills | MIT (README) |
| | `accessibility`, `best-practices`, `core-web-vitals`, `performance`, `seo`, `web-quality-audit` | github.com/addyosmani/web-quality-skills | MIT |
| Kode bersih, test, debugging | `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`, `dispatching-parallel-agents`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`, `receiving-code-review`, `using-git-worktrees`, `finishing-a-development-branch`, `using-superpowers`, `writing-skills`, `diagnosing-superpowers` | github.com/obra/superpowers | MIT |
| | `webapp-testing` | github.com/anthropics/skills | Apache-2.0 (LICENSE.txt) |
| Keamanan | `differential-review`, `supply-chain-risk-auditor`, `sharp-edges`, `entry-point-analyzer`, `variant-analysis`, `fp-check`, `audit-context-building`, `property-based-testing`, `semgrep`, `codeql`, `sarif-parsing` | github.com/trailofbits/skills | CC BY-SA 4.0 |
| Tulisan anti-slop | `stop-slop` | github.com/hardikpandya/stop-slop | MIT |
| | `deslop-writing` | github.com/kmaida/deslop-skills | tidak dicantumkan |
| Video dari kode | `remotion-*` (13 skill) | github.com/remotion-dev/skills | tidak dicantumkan |

## Sengaja tidak dipasang

- `theme-factory`, `web-artifacts-builder` (anthropics/skills): sudah aktif di level akun.
- Skill React dari vercel-labs/agent-skills (`react-best-practices`, `composition-patterns`, `react-view-transitions`, `react-native-skills`) dan skill deploy Vercel: frontend MasjidMu memakai Vue 3 dan deploy ke Cloudflare/Render.
- Sisa ~88 skill Trail of Bits (smart contract, C/C++, Rust, binary, dll.): tidak relevan untuk stack TypeScript/Vue/Node.
- sickn33/agentic-awesome-skills (~10.000 skill), VoltAgent/awesome-agent-skills, kodustech/awesome-agent-skills: berupa koleksi/katalog. Pilih skill tertentu dari sana bila perlu.
