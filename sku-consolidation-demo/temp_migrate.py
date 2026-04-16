import psycopg2
from db import get_db
from auth import get_password_hash

def migrate_users():
    conn = get_db()
    cur = conn.cursor()
    try:
        # Check if Admin exists
        cur.execute("SELECT id FROM reproceso_usuarios WHERE nombre = 'Admin'")
        if cur.fetchone():
            print("User 'Admin' already exists.")
        else:
            # Rename Maestro to Admin if it exists
            cur.execute("UPDATE reproceso_usuarios SET nombre='Admin', password_hash=%s, avatar='AD' WHERE nombre='Maestro'", (get_password_hash('mega123'),))
            if cur.rowcount > 0:
                print("Renamed 'Maestro' to 'Admin' and updated password.")
            else:
                # If neither exists (unlikely given seeding), create it
                cur.execute("INSERT INTO reproceso_usuarios (nombre, rol, avatar, password_hash) VALUES (%s, %s, %s, %s)", ('Admin', 'Admin', 'AD', get_password_hash('mega123')))
                print("Created 'Admin' user.")
        conn.commit()
    except Exception as e:
        print(f"Error during migration: {e}")
        conn.rollback()
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    migrate_users()
