# Changelog

## Unreleased

### Features

* add `wp_cli` tool - run WP-CLI against the currently selected Local site, pinned to that site's MySQL socket so commands always hit the correct database. Fixes the trap where a bare `wp --path=<site>` run outside Local resolves DB_HOST=localhost to the wrong site (every Local site uses DB_NAME=local). Runs through Local's bundled PHP (no extension-mismatch noise). Makes the server write-ready for WordPress operations: plugin activate/deactivate, option update, post/user create, eval/eval-file, rewrite flush, etc.

## [1.1.0](https://github.com/vapvarun/mcp-local-wp/compare/v1.1.0...v1.1.0) (2026-06-28)


### ⚠ BREAKING CHANGES

* Requires ESLint 9+ for linting

### Features

* add CI/CD, MCP Registry, and standardization ([3b12ee8](https://github.com/vapvarun/mcp-local-wp/commit/3b12ee8972f855073326abe01ee317987c13f604))
* add mysql_schema tool, ESLint+Prettier, stronger read-only safety, improved Local detection, and docs\n\n- Add mysql_schema tool (tables, columns, indexes)\n- Support params in mysql_query\n- Enforce single read-only statement; block multi-statements\n- Add ESLint + Prettier configs and scripts\n- Improve Local mysqld detection with DEBUG logs\n- Trim publish files; update README; cleanup leftovers ([e964d17](https://github.com/vapvarun/mcp-local-wp/commit/e964d17a5e1f32abea29895ae6d90771aabd6f53))
* add runtime site switching tools ([1426277](https://github.com/vapvarun/mcp-local-wp/commit/14262770215dc1d69f82abbe64a8add562bafbcb))
* add wp_cli tool — write-ready WP-CLI pinned to each site's socket ([8b47e04](https://github.com/vapvarun/mcp-local-wp/commit/8b47e04e4a89f9c536fc6511aa05dd8dbdd01ee5))
* upgrade to ESLint 9 flat config and update all dependencies ([9a2edf9](https://github.com/vapvarun/mcp-local-wp/commit/9a2edf9d25cfd2e37f741136fd3a725e7360b1e6))


### Bug Fixes

* **wp_cli:** derive WP root from sitePath, not configPath ([59fff6c](https://github.com/vapvarun/mcp-local-wp/commit/59fff6cc074056693b610663610866f32bec0b53))


### Miscellaneous Chores

* override release version ([7049bdf](https://github.com/vapvarun/mcp-local-wp/commit/7049bdfe734595c22bf24a4149bf5f937d44af2a))

## [1.1.0](https://github.com/verygoodplugins/mcp-local-wp/compare/v1.0.1...v1.1.0) (2026-01-04)


### ⚠ BREAKING CHANGES

* Requires ESLint 9+ for linting

### Features

* add CI/CD, MCP Registry, and standardization ([3b12ee8](https://github.com/verygoodplugins/mcp-local-wp/commit/3b12ee8972f855073326abe01ee317987c13f604))
* upgrade to ESLint 9 flat config and update all dependencies ([9a2edf9](https://github.com/verygoodplugins/mcp-local-wp/commit/9a2edf9d25cfd2e37f741136fd3a725e7360b1e6))


### Miscellaneous Chores

* override release version ([7049bdf](https://github.com/verygoodplugins/mcp-local-wp/commit/7049bdfe734595c22bf24a4149bf5f937d44af2a))

## 1.1.0 - 2026-01-04

### Site Context Detection
When multiple Local sites are running, the server now reliably connects to the correct database using priority-based site selection:

1. **SITE_ID env var** - Explicit site ID (e.g., `lx97vbzE7`)
2. **SITE_NAME env var** - Human-readable site name (e.g., `dev`)
3. **Working directory detection** - Auto-detects if cwd is within a Local site path
4. **Process detection** - Existing behavior (fallback)
5. **Filesystem fallback** - Most recently modified socket (last resort)

### New Tools
- **mysql_current_site** - Returns which site is connected and how it was selected
- **mysql_list_sites** - Lists all available Local sites with their running status

### New Environment Variables
- `SITE_ID` - Specify site by ID for explicit selection
- `SITE_NAME` - Specify site by human-readable name
- `LOCAL_SITES_JSON` - Override path to Local's sites.json

### Improvements
- Startup logging now shows which site was selected and the selection method
- Better error messages when specified site is not found or not running
- Sites.json parsing for site name/path/domain metadata

### Dependencies & Tooling
- Migrated from ESLint 8 to ESLint 9 flat config
- Updated MCP SDK to 1.25.1 (from 0.5.0)
- Updated TypeScript to 5.9.3
- Updated dotenv to 17.2.3
- Updated @typescript-eslint/* to 8.50.1
- Fixed npm audit vulnerability (qs package)

## 1.0.1 - 2025-11-20
- Added filesystem fallback for Local MySQL detection when `ps`/process scan is blocked
- Added platform-aware Local run directory resolution (uses `LOCAL_RUN_DIR` or OS defaults)
- Improved error messaging that combines process-scan and filesystem-scan failures

## 1.0.0 - 2024-12-15
- Initial release
