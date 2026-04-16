# Railway Skills Installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install the `railway-skills` repository content for Antigravity and Claude Code.

**Architecture:** Copy the `use-railway` skill directory from a temporary git clone to local and global skill directories.

**Tech Stack:** PowerShell, Git

---

### Task 1: Initialize Target Directories

- [ ] **Step 1: Create global skill directories**

Run:
```powershell
if (!(Test-Path "$HOME\.claude\skills")) { New-Item -ItemType Directory -Path "$HOME\.claude\skills" -Force }
if (!(Test-Path "$HOME\.agents\skills")) { New-Item -ItemType Directory -Path "$HOME\.agents\skills" -Force }
```

- [ ] **Step 2: Create local skill directory**

Run:
```powershell
if (!(Test-Path ".agent\skills")) { New-Item -ItemType Directory -Path ".agent\skills" -Force }
```

### Task 2: Install Skill Content

- [ ] **Step 1: Copy skill to Claude Code (Global)**

Run:
```powershell
Copy-Item -Path "tmp_railway_skills\plugins\railway\skills\use-railway" -Destination "$HOME\.claude\skills" -Recurse -Force
```

- [ ] **Step 2: Copy skill to Antigravity (Global)**

Run:
```powershell
Copy-Item -Path "tmp_railway_skills\plugins\railway\skills\use-railway" -Destination "$HOME\.agents\skills" -Recurse -Force
```

- [ ] **Step 3: Copy skill to Antigravity (Local)**

Run:
```powershell
Copy-Item -Path "tmp_railway_skills\plugins\railway\skills\use-railway" -Destination ".agent\skills" -Recurse -Force
```

### Task 3: Verification and Cleanup

- [ ] **Step 1: Verify presence of SKILL.md in all locations**

Run:
```powershell
Test-Path "$HOME\.claude\skills\use-railway\SKILL.md"
Test-Path "$HOME\.agents\skills\use-railway\SKILL.md"
Test-Path ".agent\skills\use-railway\SKILL.md"
```
Expected: All should return `True`.

- [ ] **Step 2: Remove temporary clone**

Run:
```powershell
Remove-Item -Path "tmp_railway_skills" -Recurse -Force
```

- [ ] **Step 3: Commit installation record**

Run:
```bash
git add docs/superpowers/specs/2026-04-09-railway-skills-installation-design.md docs/superpowers/plans/2026-04-09-railway-skills-installation.md
git commit -m "docs: install railway-skills for antigravity and claude code"
```
