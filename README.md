# MEGALODON DROP

A first-person slide game built with Three.js, TypeScript, and Vite. Race down from high altitude, clear gaps, correct your course in midair, and evade the megalodon when a fall becomes unrecoverable. Checkpoints let you respawn along the way.

The game supports English and Simplified Chinese. English is the default; use the fixed language button in the upper-right corner to switch languages. Your selection is saved in this browser.

## Getting started

Validated with Windows, Node.js **24.18.0**, and npm **11.16.0**. Use a WebGL-capable browser with hardware acceleration enabled. Automated browser checks also require local Chrome. The simulation scripts use Node's `--experimental-strip-types` option.

From the project root:

```powershell
npm ci
npm run dev -- --port 5174 --strictPort
```

Open [http://127.0.0.1:5174/](http://127.0.0.1:5174/). `--strictPort` makes the server fail if the port is occupied instead of silently choosing another one. If you change the port, set the browser-test `PORT` to match. Vite's configured default is 5173.

Build and preview the production bundle:

```powershell
npm run build
npm run preview -- --port 4173 --strictPort
```

Preview serves the built `dist/` directory. The browser regressions below use the development server because some checks import modules from `/src/`.

## Controls and current course

- **A / D** or **Left / Right**: steer. **W / Up**: tuck to accelerate. **S / Down**: spread out to brake.
- **Mouse**: look around. **Esc**: pause. The interface provides mute and respawn controls.
- Gamepad and touch input are implemented, but mobile touch play has not been fully validated.
- The course currently has **9 slide sections, 8 gaps, and 5 narrow sections**. It is about **5,958 m** long, dropping from **1,680 m** to about **25 m**.
- The normal inside width is about **5.29 m**, narrowing to about **1.47 m** at the tightest point. Each narrow section eases in and out over 60 m, and landing areas are wider.
- There are four respawn points: the start and three checkpoints. **Shortcuts that skip intermediate sections are allowed.**

See [level.ts](src/track/level.ts), [track.ts](src/track/track.ts), and [config.ts](src/core/config.ts) for the course and physics values. A normal gap jump does not trigger a fall warning just because the rider has left the track. The shark hunt starts only after a fall is confirmed to be unrecoverable.

## Validation commands

| Command | What it checks | Requirements |
| --- | --- | --- |
| `npm run lint` | Oxlint checks for TypeScript and JavaScript tooling | Dependencies installed |
| `npm run typecheck` | TypeScript static checks | Dependencies installed |
| `npm run build` | Type checking and production build | Dependencies installed |
| `npm run sim` | Full-course runs, shortcuts, failure styles, narrow transitions, and landing-boundary assertions | Node; no browser required |
| `npm run test:gameplay` | Gap jumps, shortcuts, high/mid/low falls, pause, respawn, and shark-mouth alignment for the GLB and fallback model | Project dev server and Chrome |
| `npm run test:lighting` | Bloom limits and foreground readability at six heights; saves screenshots | Project dev server and Chrome |
| `npm run test:i18n` | English default, locale switching, HUD translations, and saved preference | Project dev server and Chrome |
| `git diff --check` | Whitespace errors in the diff | Git worktree |

GitHub Actions runs lint, type checking, the production build, and simulation on each push and pull request. Browser/WebGL checks are not part of CI because they require Chrome and a graphics environment. Run them locally as follows, with the development server still running in another PowerShell window:

```powershell
$env:PORT = '5174'
# Set this to the actual path if Chrome is not installed in the default location:
$env:CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
npm run test:gameplay
npm run test:lighting
npm run test:i18n
```

Screenshots are written to `tools/shots/` and are not committed. Browser regressions advance a fixed-step simulation faster than real time; their timing is not a performance measurement. After course changes, check that screenshot sampling points still cover the intended views.

The older tools `node tools/keys.mjs` and `node tools/shots.mjs <name> "<query>" [maxSeconds]` still connect to **5173** and do not read `PORT`; set `CHROME` to select the browser. Before using them, confirm that port belongs to this project. They do not replace the regression commands above.

## Debug options

Options can be combined. After loading, click Start to begin. Section numbers and checkpoint indexes start at 0.

| Option | Behavior |
| --- | --- |
| `?debug` | Exposes the game instance as `window.__game`; call `debugState()` to inspect it. |
| `?autopilot` | Enables the autopilot. |
| `?autopilot&miss=4` | Slows down on section 4 and steers away from its landing area to create a failure. |
| `?autopilot&cp=2` | Starts the first run at checkpoint 2, which currently corresponds to section 4. |

`cp` is currently limited to 0–3. When adding checkpoints, update the range in `src/main.ts` and the browser-test expectations. `miss` is used by the autopilot.

## Code and documentation map

| Path | Contents |
| --- | --- |
| `src/track/` | Course configuration, track sampling, and landing detection |
| `src/physics/`, `src/core/` | Rider movement, prediction, and physics constants |
| `src/game/` | Game state, input, camera, and autopilot |
| `src/world/`, `src/fx/` | Track mesh, environment, materials, and post-processing |
| `src/sharks/`, `public/models/` | Shark behavior and model assets |
| `src/ui/`, `src/audio/` | HUD, dialogs, localization, and sound |
| `tools/` | Simulation, browser checks, and asset-processing scripts |

- [AGENTS.md](AGENTS.md): contribution rules, gameplay constraints, and validation guidance.
- [docs/backlog.md](docs/backlog.md): current open items and dated historical audits.
- [progress.md](progress.md): recent validation results and work history.
- [task_plan.md](task_plan.md): current task status. [findings.md](findings.md): diagnostic evidence and measurements.

Tripo and Blender tools are for asset creation; running the game does not require a generation service or generation-service credentials. Do not commit raw downloads, signed URLs, or private experimental screenshots. See [.gitignore](.gitignore) for excluded paths.
