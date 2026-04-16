# Plan de Implementación: Selector de Usuarios (User Picker)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the login screen into a visual user selection grid (avatar cards) and rename the default master user to "Admin".

**Architecture:** Add a public API endpoint for providing name/avatar metadata, implement a state-driven UI in vanilla JS to transition between "User Selection" and "Password Entry" modes.

**Tech Stack:** FastAPI (Python), PostgreSQL, Vanilla JS, CSS3.

---

### Task 1: Backend - Rename Maestro to Admin and Update Password

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

---

### Task 2: Backend - Public Users Endpoint

**Files:**
- Modify: `Control reproceso/sku-consolidation-demo/api/endpoints.py`

- [ ] **Step 1: Add public users endpoint**
Create a new GET endpoint in `api/endpoints.py` that returns the list of users (no authentication required).

```python
@router.get("/users-public")
async def get_users_public():
    """Retorna la lista de usuarios para el selector de login (sin auth)."""
    # Usar la función existente que ya excluye hashes
    users = db.get_usuarios()
    return {"users": users}
```

- [ ] **Step 2: Commit**
```bash
git commit -m "api: add public users endpoint for login picker"
```

---

### Task 3: Frontend - CSS for User Picker Grid

**Files:**
- Modify: `Control reproceso/sku-consolidation-demo/static/app.css`

- [ ] **Step 1: Add styles for the grid and cards**
Include responsive grid layout and hover effects for user cards in `static/app.css`.

```css
/* User Picker Styles */
.user-picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 1.5rem;
    padding: 1.5rem 0;
    max-height: 300px;
    overflow-y: auto;
}
.user-card-picker {
    cursor: pointer;
    text-align: center;
    padding: 1rem;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.1);
    transition: all 0.2s ease;
}
.user-card-picker:hover {
    background: rgba(255, 255, 255, 0.08);
    transform: translateY(-5px);
    border-color: var(--primary);
}
.user-card-picker .avatar-lg {
    width: 60px;
    height: 60px;
    margin: 0 auto 0.75rem;
    font-size: 1.4rem;
}
.user-card-picker .user-name {
    font-weight: 500;
    font-size: 0.9rem;
    color: var(--text-muted);
}
.login-back-btn {
    margin-bottom: 1rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
```

- [ ] **Step 2: Commit**
```bash
git commit -m "css: add styles for user picker cards"
```

---

### Task 4: Frontend - JS implementation

**Files:**
- Modify: `Control reproceso/sku-consolidation-demo/static/app.js`

- [ ] **Step 1: Update Store and UI.init**
Update `Store.init` to handle public user fetching for the login screen.

- [ ] **Step 2: Implement UI.renderUserPicker**
Create the function that populates the grid and handles the selection event.

- [ ] **Step 3: Implement transition logic**
When a user is selected:
1. Hide the grid.
2. Show the password form.
3. Update a label "Ingresando como: [Nombre]".
4. Show a "Volver" button.

- [ ] **Step 4: Commit**
```bash
git commit -m "js: implement login picker logic and transitions"
```

---

### Task 5: Testing & Verification (Agente de Pruebas)

- [ ] **Step 1: Verify User Renaming**
Attempt login with `Admin` / `mega123`.

- [ ] **Step 2: Verify Public Endpoint**
Ensure `curl http://localhost:8000/api/users-public` returns the user list.

- [ ] **Step 3: UI Smoke Test**
Click a user, enter password, confirm dashboard access. Use "Volver" and select another.
