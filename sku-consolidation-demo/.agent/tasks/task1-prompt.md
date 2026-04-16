You are implementing Task 1: Backend - Rename Maestro to Admin and Update Password

## Task Description

**Files:**
- Modify: `Control reproceso/sku-consolidation-demo/db.py`

- [ ] **Step 1: Modify init_db logic**
Update the default user seeding in `db.py` to use "Admin" instead of "Maestro" and "mega123" instead of "1234".

```python
<<<<
                # (nombre, rol, avatar, password)
                ("Maestro",    "Maestro",  "S",  "1234"),
                ("Usuario 1",  "Operario", "U1", "1234"),
====
                # (nombre, rol, avatar, password)
                ("Admin",      "Maestro",  "AD", "mega123"),
                ("Usuario 1",  "Operario", "U1", "1234"),
>>>>
```

- [ ] **Step 2: Commit**
```bash
git commit -m "db: rename Maestro to Admin and update default password"
```

## Context

We are implementing a new user picker logic on the frontend. The `Maestro` user default role is being renamed to `Admin` and having its password changed. We also ensure that no hardcoded 'Maestro' literal remains where 'Admin' should be for this initial user seeding. Note: the *role* itself may still be called "Maestro" in DB, this specifically renames the initial *user account* "Maestro" to "Admin".

## Your Job

Please execute the implementation following the checklist and commit your work. Report back when done.
