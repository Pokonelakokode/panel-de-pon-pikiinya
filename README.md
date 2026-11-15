# Panel de Pon + Pikiinya! Web (Dual SNES Puzzle App)

A unified dual-game web application combining clean-room web re-implementations of **Panel de Pon** (SNES, 1995, Nintendo / Intelligent Systems) and **Pikiinya!** (ピキーニャ！, SNES, 1997, Crea-Tech / ASCII) in one single page with a header tab switcher. Switching tabs pauses the inactive simulation cleanly, preserves both game states, and routes keyboard, Web Gamepad API, and Web Audio synthesis strictly to the active tab.

All simulation logic for both games was rebuilt cleanly in TypeScript; no ROM graphics, tiles, or SPC700 audio data are embedded in this repository—every visual frame is drawn procedurally with Canvas 2D and every SFX/BGM cue is synthesized at runtime with the Web Audio API.

## Dual-Game Tabs & Architecture

- **Header Tab Switcher**: Accessible WAI-ARIA `role="tablist"` (`Panel de Pon` / `Pikiinya!`) managing `aria-selected`, roving `tabindex`, `inert` background containment, and `?game=pdp|pikiinya` URL state.
- **Pikiinya! Modules (`src/pikiinya/`)**:
  - `src/pikiinya/types.ts`: 6×14 board constants (`2` hidden spawn rows + `12` visible rows) and state types.
  - `src/pikiinya/core.ts`: Clean-room rules matching observed 65816 hardware tables (`$00:D3F1` grid, `$00:D54A` 32-entry piece distribution, `$00:E853` row-clear/thaw transitions, `$00:E988` 6-column Ice Row clear, `$00:E9D0` 4-neighbor BFS 6+ awake Pikiinya clear + adjacent Cage shattering, `$00:EC6A` Miracle Bell sweep, VS garbage offsetting/dropping).
  - `src/pikiinya/modes.ts`: 8 Andes Deathmatch rivals + Overlord scaling, 16 Stage Clear levels (8 Omote + 8 Ura), 8 Brain-Teaser puzzles, and 4 interactive Lecture lessons.
  - `src/pikiinya/ai.ts`: 20-placement (`col` × `rot`) cascade-lookahead CPU player with skill/mistake tuning per rival.
  - `src/pikiinya/render.ts`: Procedural Canvas 2D glacier board, next-quad preview, Endurance track, particles, and animated penguins (sleeping, awake, excited at group `>= 4`, shivering in ice, Golden Miracle Bell).
  - `src/pikiinya/ui.ts` & `src/pikiinya/boot.ts`: All 8 game modes, Stage Tsukuru 3-slot `localStorage` custom level editor, 1P/2P keyboard & gamepad input, Help overlay, CRT scanlines, and optional EmulatorJS SNES ROM launcher modal.

## Pikiinya! Game Modes

1. **Andes VS (Story Ladder)**: Battle through 8 rivals (leading up to Dr. Slagger) and endless Overlord rematches using garbage block attacks and counters.
2. **2P VS**: Local 2-player head-to-head on split 6×14 boards with independent 1P & 2P keyboard/gamepad bindings.
3. **Stage Clear**: 8 Omote + 8 Ura preset levels focused on breaking every Target Cage.
4. **Endless**: Classic rising-level score marathon.
5. **Endurance Race**: Distance/km-h survival run.
6. **2-Min Time Attack**: Timed high-score and rescue sprint.
7. **Puzzle / Stage Tsukuru**: 8 constraint puzzles with automatic turn-start Undo (`Backspace` / button) plus a 3-slot custom level editor (`localStorage`).
8. **Lecture (Tutorial)**: 4 guided step-by-step lessons covering 6-penguin clears, Ice Rows, Cage breaking, and Thaw-Into-Chain cascades.

## Gyors inditas (magyar)

```bash
pnpm install      # elso telepites
pnpm dev          # fejlesztoi mod: http://localhost:5173
pnpm build        # eles build a dist/ mappaba
pnpm start        # eles szerver a 8787-es porton
pnpm test         # teljes teszt keszlet
```

Nyisd meg ket bongeszofuletben ugyanazt a cimet. Az egyikben valaszd a **Play online**, majd a
**Create room** opciot, a masikban add meg a szobakodot a **Join room** mezoben, majd mindketten
nyomjatok meg a **Ready** gombot. Egyedul is kiprobalhato: **Vs. CPU**, **Endless** vagy **Time attack**.

## Requirements

- Node.js 24 or newer (the server runs TypeScript directly through native type stripping)
- pnpm 11 (npm works too, but the repository is set up for pnpm)

## Running

```bash
pnpm install
pnpm dev          # game server on :8787 and the Vite dev server on :5173
```

Open http://localhost:5173. Two browser tabs on the same machine, or two devices on the same network
(start the client with `pnpm dev:client -- --host` and use your LAN address).

Production build:

```bash
pnpm build        # typecheck plus a Vite build into dist/
pnpm start        # serves dist/ and the websocket protocol on PORT (default 8787)
```

Other scripts:

| Command | What it does |
| --- | --- |
| `pnpm test` | the whole node:test suite, including an end to end netcode test |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm dev:server` | only the game server |
| `pnpm dev:client` | only the Vite dev server |

## Playing online

1. One player picks **Play online**, then **Create room**. A four character code appears.
2. The other player opens the same address, picks **Play online**, types the code and presses **Join room**.
   The share link in the lobby fills the code in automatically.
3. Both press **Ready**. After a short countdown the match starts.
4. When it ends either player can ask for a **Rematch**; both have to agree.

If a player reloads the page mid-match the tab reconnects with its stored token and the server sends it a
fresh snapshot, so the match continues. If the connection is gone for good, the opponent wins by forfeit.

## Controls

| Action | Keys |
| --- | --- |
| Move the cursor | arrow keys or W A S D |
| Swap the two panels under the cursor | Z, X, Space or Enter |
| Raise your stack by hand | Q and E (or the shift keys) |
| Gamepad | d-pad or left stick, A/B to swap, shoulders to raise |

Raise is the original risk mechanic: it pushes you one row upwards on purpose and cancels whatever stop time
you have banked, so it is a way to speed the game up, not a way to save yourself.

## How the rules were implemented

Everything tunable lives in `src/core/tuning.ts`, and every constant carries a note about how trustworthy it is:

- `[P]` documented in the original game or a reputable reference
- `[C]` reverse engineered by the community
- `[?]` not confirmed anywhere, chosen so the game feels right and meant to be calibrated by playing

The most important mechanics, as implemented:

- **Playfield**: 6 columns by 12 rows. The stack rises in 1/16 row steps, so one row takes 942 frames at level 1.
- **Panels**: six types, exactly like the original (heart, triangle, circle, star, diamond, inverted triangle).
  The sixth only appears from level 9 upward in versus mode.
- **Matching**: three or more in a row or column, and only panels that have come to rest. Everything that
  matches at the same moment is one clear event, and the size of that event is the combo.
- **Chains**: separate clear events caused by falling panels. The counter starts at 2, and input is never
  locked, so a chain can be extended while the previous clear is still animating.
- **Attack**: a combo of four or more sends one row tall pieces whose widths follow the original table
  (4 panels send 3 columns, 8 panels send 3 then 4, 13 panels send three full rows). A chain sends a full
  width block whose thickness is the chain length minus one, capped at twelve rows.
- **Garbage** falls onto the top of your stack. Matching a group next to a block breaks it: a one row block
  turns into panels all at once, a thick chain block loses only its bottom row per match. Metal garbage from
  the shock panels is destroyed without ever becoming panels.
- **Stop time**: combos and chains freeze your stack, and a topped out player earns a much longer freeze.
- **Rise locks**: the stack does not rise while a panel is swapping, clearing or falling, while the board is
  shaking from a garbage landing, or while stop time is left.
- **Speed**: clearing panels pushes you up the speed ladder (9 panels for the first step, then 12, 12, 12...),
  and the rise speed stops increasing at level 50, exactly like the original.
- **Losing**: the stack touching the ceiling starts a short grace timer. It cannot expire while the board is
  shaking, and it refills the moment you get back under the ceiling.

## Architecture

```
src/core/      Panel de Pon deterministic simulation, no DOM and no Node APIs
src/ai/        Panel de Pon CPU opponent, playing through the same input bitmask as a human
src/pikiinya/  Clean-room Pikiinya! simulation, Canvas 2D renderer, modes, AI and dual-tab boot
src/server/    Rooms, matchmaking and the authoritative 60 Hz loop
src/client/    Panel de Pon canvas renderer, input sampling, menus, websocket client
tools/         Pure TypeScript SNES SPC700 / S-DSP audio ripper (65C816 -> .spc / .mp3)
test/          node:test suites for Panel de Pon, Pikiinya!, and SPC700/S-DSP audio core
```

### Netcode

The server is authoritative about one thing only: which input applies to which tick. For each tick it either
has both players inputs or it waits, and after a short stall it decides and broadcasts the decision. Clients
sample their input a few ticks ahead (the input delay, three ticks by default) and then apply the server
decisions in order, so all three simulations see exactly the same thing.

Every client also reports a state fingerprint. The server keeps a fingerprint per simulated tick and compares,
so a divergence is caught within a second and answered with a snapshot instead of a silently broken match.

## Deployment

The server is a single Node process that serves the built client and speaks the protocol on the same port.

```bash
docker build -t panel-de-pon-web .
docker run -p 8787:8787 panel-de-pon-web
```

Or with compose: `docker compose up --build`.

Behind a reverse proxy, forward both the page and the websocket upgrade to the same port:

```
example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Caddy upgrades websockets automatically. With nginx, add the Upgrade and Connection proxy headers to the
/ws location. The client picks wss:// automatically when the page is served over HTTPS.

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | the port the server listens on |
| `HOST` | `0.0.0.0` | the interface to bind |
| `NODE_ENV` | unset | set to `production` when running the built client |

The server also exposes two small endpoints: `/api/health` for uptime checks and `/api/hashes?code=ABCD`,
which returns the per-tick state fingerprints of a room and is handy when debugging a suspected desync.

### SNES OST Ripper & In-App Jukebox

Although the repository does not commit copyrighted ROM audio assets (`public/ost/`, `*.sfc`, `*.fig`, and `*.smc` are listed in `.gitignore`), you can extract all original SNES BGM tracks locally from the SNES ROMs using the pure TypeScript `65C816 + Sony SPC700 + Sony S-DSP` hardware audio ripper in `tools/`:

```bash
npm run rip:ost   # runs: node tools/rip-snes-audio.ts
```

This generates:
- `tools/snes-apu.ts`: Clean 32 kHz S-DSP BRR Gaussian decoder, ADSR/GAIN envelopes, 8-tap FIR echo, full 256-opcode SPC700 + IPL core, 65C816 LoROM driver host bridge, and 66,048-byte `.spc` snapshot exporter.
- `tools/rip-snes-audio.ts`: Extracts **30 Pikiinya!** tracks (`public/ost/pikiinya/`) and **28 Panel de Pon** tracks (`public/ost/pdp/`), encodes `192k` stereo `.mp3` files via `ffmpeg`, and writes `public/ost/manifest.json` with stage mappings and normal/danger track pairs.
- **🎧 SNES OST Jukebox** (`index.html`, `src/pikiinya/ui.ts`): Both games automatically play their matching stage BGM and switch between Normal and Critical/Danger variants on stack warning—while seamlessly falling back to the built-in Web Audio synth if `public/ost/` is not present or if you switch to **Web Audio Synth** in the Jukebox modal (which also supports previewing, pinning tracks, and downloading `.mp3` or `.spc` files).

## Notes

This is a fan project for learning and for playing with a friend. Panel de Pon, Tetris Attack and Puzzle
League are trademarks of Nintendo; this repository contains none of their code, art or audio. The
`Panel de Pon (J).fig` file in the working directory is the reference ROM used to identify the target game,
and it is never read by the game at runtime unless you explicitly extract local OST files with `npm run rip:ost`.
