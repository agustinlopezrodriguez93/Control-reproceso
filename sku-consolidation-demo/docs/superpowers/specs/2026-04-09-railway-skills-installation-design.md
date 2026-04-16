# Railway Skills Installation Design

## Goal
Install the `railway-skills` repository content to enable CLI-based deployment control for both Antigravity and Claude Code.

## Scope
The installation will be both global (for general use) and local (for the current project).

## Target Directories
1. **Claude Code (Global):** `%USERPROFILE%\.claude\skills\use-railway`
2. **Antigravity (Global):** `%USERPROFILE%\.agents\skills\use-railway`
3. **Antigravity (Local Project):** `.agent\skills\use-railway`

## Installation Contents
From the repository `https://github.com/railwayapp/railway-skills.git`, specifically the `plugins/railway/skills/use-railway` directory:
- `SKILL.md`: Main instruction set.
- `references/`: Detailed operational guides.
- `scripts/`: Supporting analysis and API scripts.

## Success Criteria
- [ ] `SKILL.md` exists in all three target locations.
- [ ] `references/` directory and its files exist in all three target locations.
- [ ] `scripts/` directory and its files exist in all three target locations.
- [ ] Temporary clone is removed.
