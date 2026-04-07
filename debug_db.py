import db
import auth
import os
from dotenv import load_dotenv

load_dotenv()

def debug():
    try:
        print("--- [DEBUG] Verificando Base de Datos ---")
        conn = db.get_db()
        cur = conn.cursor()
        
        # 1. Verificar tabla y columnas
        print("\n[1] Estructura de la tabla 'reproceso_usuarios':")
        cur.execute("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'reproceso_usuarios'
        """)
        for row in cur.fetchall():
            print(f"    - {row[0]}: {row[1]}")
            
        # 2. Verificar usuario Maestro
        print("\n[2] Usuario 'Maestro':")
        cur.execute("SELECT nombre, rol, password_hash FROM reproceso_usuarios WHERE nombre = 'Maestro'")
        user = cur.fetchone()
        if user:
            nombre, rol, pw_hash = user
            print(f"    - Nombre: {nombre}")
            print(f"    - Rol: {rol}")
            print(f"    - Password Hash (primera parte): {str(pw_hash)[:20]}...")
            
            if not pw_hash:
                print("    - ERROR: password_hash está VACÍO (NULL)")
            else:
                # 3. Probar verificación
                print("\n[3] Probando verificación de clave '1234':")
                try:
                    ok = auth.verify_password("1234", pw_hash)
                    print(f"    - Resultado: {'CORRECTO' if ok else 'FALLIDO'}")
                except Exception as e:
                    print(f"    - ERROR en verify_password: {e}")
        else:
            print("    - ERROR: Usuario 'Maestro' NO existe en la base de datos.")
            
        cur.close()
        conn.close()
        
    except Exception as e:
        print(f"\n--- ERROR CRÍTICO EN EL DIAGNÓSTICO: {e} ---")

if __name__ == "__main__":
    debug()
