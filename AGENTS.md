# AGENTS.md · high-slide

This file applies to the whole repository and defines project-specific work and acceptance requirements. Explicit new user requests take priority over the gameplay baseline recorded here. When the baseline changes, update the relevant documentation and tests.

## Before you start

- Check `git status --short`. Preserve uncommitted work from the user and other tasks; do not reset, overwrite, or commit it as a side effect.
- Read [README.md](README.md) for setup and module guidance, then inspect only the relevant source. [progress.md](progress.md) records recent results; [docs/backlog.md](docs/backlog.md) tracks open work.
- Find the root cause and make the smallest scoped change. Historical logs, old screenshots, and unverified assumptions are not current evidence.
- Make small fixes directly. For multi-step work, update the existing [task_plan.md](task_plan.md) and record evidence in [findings.md](findings.md). Do not create duplicate plans or reports for the same task.
- Delegate only when independent subtasks make it worthwhile. Assign file ownership for code changes and avoid repeating the same investigation. This project has no required external orchestration tool.

## Modules and change boundaries

- `src/track/level.ts` defines the course. `track.ts` generates samples, coordinates, and landing collision. Start with course configuration when changing difficulty.
- `src/physics/` handles on-track and airborne motion. `src/core/config.ts` holds physics constants and the fixed time step. When changing constants, check that simulation, prediction, and runtime behavior remain consistent.
- `src/game/game.ts` handles game state, checkpoints, and fall detection. `cameraRig.ts` handles the rider and camera. Do not change rider pose or camera as a side effect of a prompt fix.
- `src/world/` and `src/fx/` handle the scene and post-processing. `src/sharks/` handles shark models, animation, and hunting.
- Do not edit `node_modules/` or `dist/`. Do not use temporary experiments in `tools/shots/` as the only repeatable acceptance check. Keep long-lived checks in `tools/` and provide a command to run them.

## Current gameplay constraints

- A normal jump across a gap is intended airborne play. The protection window follows physical `airTime` and the authored flight time; pausing must not consume it. A sea prediction for current controls alone is not enough to declare a fall unrecoverable.
- Shortcuts may skip intermediate sections. The normal route should remain playable section by section, but new ordering checks must not block cross-section landings. Checkpoints and respawns must still advance correctly.
- Width changes must use the same `Segment.radius` for the mesh, edge decorations, and landing collision. Narrow sections need smooth transitions, landing clearance, and collision checks at both edges.
- The shark's mouth should face the rider's approach. Correct mouth position after rotation and skeletal animation. Test both the actual GLB and the procedural fallback model.
- The rider baseline is the capsule character with procedural motion. Do not restore the withdrawn realistic-character approach without a new request.
- Current course counts, narrow-section dimensions, and checkpoint locations are design values documented in the README and `level.ts`; they can change and are not permanent constraints.

## Code conventions

- Keep TypeScript strict. Use `import type` for type-only imports, prefer interfaces for object shapes, and use `type` for unions and mapped types. Do not add `any` or suppress checks to hide errors.
- Reuse existing utilities and the standard library. Do not add abstractions for speculative needs. Before adding a dependency, check necessity, compatibility, and vulnerabilities, and update the lockfile.
- Validate new or changed external inputs for range and non-finite values. Handle asynchronous failures; do not leave empty catch blocks or show players stack traces or raw errors.
- Do not leave debug `console.log` calls in `src/`. CLI validation scripts may print their results.
- **All player-facing UI copy must use the localization catalog in `src/i18n.ts`. Keep English and Simplified Chinese entries in sync, with English as the default.** Static HTML uses `data-i18n` attributes. Keep accessible names, dialog focus management, keyboard controls, and clear reporting of whether touch controls have actually been validated.
- Do not put secrets, signed download URLs, or private configuration in source, logs, or commits. Keep existing ignore rules for asset downloads.
- Do not commit unless requested. Use `<type>(<scope>): <description>` for commit messages and `feat/`, `fix/`, or `refactor/` branch prefixes.

## Validation and delivery

Use [README.md](README.md) for commands and PowerShell environment-variable examples. Before browser tests, confirm the page belongs to this project and explicitly set `PORT`; do not assume the default port 5173 is available.

| Change scope | Required validation |
| --- | --- |
| Any change | `git diff --check`; review the diff scope and confirm documented facts |
| Documentation only | Check local links, paths, commands, and source accuracy; no need to rerun the full game suite |
| Source, lint, or workflow configuration | `npm run lint` |
| TypeScript or runtime configuration | `npm run lint` and `npm run build` (includes type checking) |
| Course, collision, physics, fall detection, or shark | lint, build, `npm run sim`, `npm run test:gameplay`, and screenshots for affected routes |
| Width, materials, lighting, or post-processing | lint, build, `npm run sim`, `npm run test:lighting`, and screenshots for changed views, 162 m, backlit sections, and clouds |
| Input, HUD, camera, or localization | build and relevant browser interaction/screenshots; run `npm run test:i18n` for localization changes and add gameplay regression checks as needed. Validate touch changes on a touch device. |

- Run `npm run lint` for TypeScript and tooling scripts (Oxlint). Type correctness is checked separately by `npm run typecheck` / `npm run build`.
- `.github/workflows/ci.yml` runs lint, type checking, build, and simulation on push and pull request. Update the workflow and this table if validation entry points change.
- Do not remove or weaken existing checks to make a change pass.
- When a test fails, distinguish code defects from server-port, browser-path, and environment issues. Do not change expected values or weaken assertions to hide a regression.
- Write meaningful tests around behavior contracts such as a normal finish, failure paths, collision boundaries, pause, and respawn. Avoid tests that only assert implementation details.
- Accelerated browser simulation validates state and visuals, not real-time frame rate. Performance claims require frame-time evidence from the same device, view, and settings.
- Close out in Chinese with the outcome, checks actually run, and anything not validated. Update the README when gameplay, commands, or localization behavior changes; update the backlog when an item is completed; label historical evidence with its original course layout and environment.

## Never

- Do not remove the brightness cap on bloom input or claim overexposure is fixed based on one section. Lighting, material, and post-processing changes must run `npm run test:lighting` (start the dev server and set `PORT` as needed) and check screenshots of the 162 m backlit section, backlit views, and the cloud section.
- Do not hide a full-screen whiteout by loosening the foreground-brightness assertion in the lighting regression.
