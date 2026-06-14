# Edge Firmware Context (Vehicle Node)

## Build and Test Commands
* **Build Target:** `cargo build --release`
* **Run Test Suite:** `cargo test`
* **Execution:** `cargo run --release`

## Architecture Constraints
* **Ingestion Loop:** Must remain strictly non-blocking. Use `tokio::sync::mpsc` for internal communication between the SocketCAN task and the logger task.
* **Local Storage Fail-safe:** SQLite database must operate in Write-Ahead Logging (**WAL Mode**) to absorb heavy bursts of raw CAN frames without blocking.
* **Data Protocol:** Maintain binary protocol framing format: `[Length: 4B][CAN ID: 4B][Timestamp: 8B][Payload: 8B]`.

## Code Review Check
* Guard against `std::sync::Mutex` guards being held across `.await` boundaries. Always enforce `tokio::sync::Mutex` if a lock must persist across async threads to prevent track-side deadlocks.