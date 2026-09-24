# AI Build Kit (for the human; the AI never reads this)

## Setup
Unzip into an empty repo folder. Open your AI coding agent there. It auto-loads `CLAUDE.md` (about 500 tokens); everything else is read on demand.

## Every session is one line
`Do P0.` then `Do P1a.` then `Do P1b.` ... `Do P2c.` ... (steps listed at the top of each `docs/phases/PX.md`). Start a NEW session per step; the agent re-primes itself from CLAUDE.md + STATUS.md + one phase file.

## Budget map (10 h)
P0 0:30 | P1 1:30 | P2 1:30 | P3 1:00 | P4 1:00 | P5 1:00 | P6 1:00 | P7 0:45 | freeze 8:15 | P8 1:15 | buffer 0:30.
Behind? Cut clipboard paste, then overwrite toast, then persistence. Never cut engine tests, presence, Performance strip, bot sim.

## Save credits
- New session per step; never let one chat run across phases.
- Strongest model for P1a-c, P4, and any step stuck after 2 attempts. Cheaper/faster model for P0, P5, P7.
- When something breaks, paste only the first ~30 lines of the error plus the file path.
- If the agent loops for 15 minutes: `git reset --hard <last-tag>` and re-run the same one-liner. Don't stack fixes on a broken base.
- Review the agent's 5-line summary, not the whole diff, except for: new dependencies, edits to `types.ts` / `protocol.ts`, and `useEffect` creating workers or sockets.
