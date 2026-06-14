# Base Station Server & Dashboard Context

## Build and Run Commands
* **Infrastructure:** `docker-compose up -d`
* **Server Execution:** `cargo run --release`
* **Database Migration:** `sqlx migrate run`

## Ingestion & Database Rules
* **Time-Series Engine:** Data must be written to TimescaleDB using `sqlx::QueryBuilder` bulk inserts every 500 signals or 2 seconds. Never run sequential single-row SQL queries on the ingestion hot path.
* **CAN Parsing:** In `decoder.rs`, mask out bit 31 of J1939 extended frames (`id_bus = id_dbc & 0x1FFFFFFF`) before cross-referencing signals with the DBC layout.

## Frontend UI Constraint (Vite 8 / Rolldown)
* **Core Code Path:** The frontend lives statically in `static/`.
* **State Mutation:** To avoid scope reassignment errors (`ILLEGAL_REASSIGNMENT`) triggered by Rolldown/Vite 8 compiler checks, the dynamic `CAN_MAP` inside `static/public/worker.js` must be updated using **in-place mutation** (clearing and rebuilding keys), never by direct object reassignment.

## Current Roadmaps
* **V2.2:** Implementing MoTeC `.ld` log generation. Focus on accurate binary header alignment.
* **V2.3:** Blue Team emergency stop route handling active via dual-can broadcast.