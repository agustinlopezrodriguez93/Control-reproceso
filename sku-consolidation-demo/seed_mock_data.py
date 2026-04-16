import asyncio
import random
import uuid
from datetime import datetime, timedelta, timezone

from db import init_db, get_conn, get_usuarios

async def seed_data():
    await init_db()
    
    users = await get_usuarios()
    operarios = [u for u in users if u['rol'] == 'Operario']
    
    if not operarios:
        print("No operarios found. Please make sure init_db created the default users.")
        return
        
    skus = [
        "GCMD", "GGAL070", "IMOCA", "IMOCP", "MCCE",
        "SCCA", "SECC090", "SECPI", "SEKOF", "SEKQB",
        "SEKRN", "SEPASP", "SEPC", "SEPEIC", "SEPOD",
        "SEPOF", "SESCD", "SGEP", "SKPXL",
    ]
    
    now = datetime.now(timezone.utc)
    
    # We will generate about 150 processes over the last 30 days
    num_processes = 150
    procesos_creados = 0
    
    async with get_conn() as conn:
        async with conn.transaction():
            for i in range(num_processes):
                operario = random.choice(operarios)
                sku = random.choice(skus)
                
                # Random start date between 30 days ago and today
                days_ago = random.randint(0, 30)
                hours_offset = random.randint(8, 17) # Work hours between 8AM and 5PM
                minutes_offset = random.randint(0, 59)
                
                created_dt = now - timedelta(days=days_ago)
                created_dt = created_dt.replace(hour=hours_offset, minute=minutes_offset, second=0, microsecond=0)
                
                es_urgente = random.random() < 0.2 # 20% urgent
                
                state = random.choices(["CREADO", "INICIADO", "PAUSADO", "FINALIZADO"], weights=[0.05, 0.1, 0.05, 0.8])[0]
                
                proceso_id = str(uuid.uuid4())
                
                started_dt = None
                finished_dt = None
                last_state_change = created_dt
                
                if state != "CREADO":
                    # Started short after creation
                    started_dt = created_dt + timedelta(minutes=random.randint(1, 15))
                    last_state_change = started_dt
                    
                if state == "FINALIZADO":
                    # Finished after 30 to 180 minutes
                    finished_dt = started_dt + timedelta(minutes=random.randint(30, 180))
                    last_state_change = finished_dt
                elif state == "PAUSADO":
                    last_state_change = started_dt + timedelta(minutes=random.randint(10, 60))
                
                await conn.execute("""
                    INSERT INTO reproceso_procesos (id, operario_id, sku_destino, estado, es_urgente, created_at, started_at, finished_at, last_state_change)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """, proceso_id, operario['id'], sku, state, es_urgente, created_dt, started_dt, finished_dt, last_state_change)
                
                # Add some pauses for finished or paused processes
                if state in ["FINALIZADO", "PAUSADO"]:
                    num_pauses = random.randint(0, 2)
                    current_time = started_dt
                    
                    for p in range(num_pauses):
                        if state == "FINALIZADO":
                            # pause starting somewhere between start and finish
                            time_diff = int((finished_dt - current_time).total_seconds() / 60)
                            if time_diff < 10:
                                break
                            pause_start = current_time + timedelta(minutes=random.randint(5, time_diff - 5))
                            pause_end = pause_start + timedelta(minutes=random.randint(5, 30))
                            if pause_end > finished_dt:
                                pause_end = finished_dt
                            await conn.execute("""
                                INSERT INTO reproceso_pausas (proceso_id, inicio, fin)
                                VALUES ($1, $2, $3)
                            """, proceso_id, pause_start, pause_end)
                            current_time = pause_end
                        elif state == "PAUSADO":
                            # Just one active pause
                            pause_start = last_state_change
                            pause_end = None
                            await conn.execute("""
                                INSERT INTO reproceso_pausas (proceso_id, inicio, fin)
                                VALUES ($1, $2, $3)
                            """, proceso_id, pause_start, pause_end)
                            break
                            
                procesos_creados += 1
                
    print(f"Mock data insertion complete: {procesos_creados} procesos created.")

if __name__ == "__main__":
    asyncio.run(seed_data())
