# Global Telemetry Project Context

## Environment & Hardware Map
* **Current Dev Machine:** Local terminal running on `Oltado` machine.
* **Jetson AGX Xavier (Vehicle Edge):** IP `143.106.207.93`
* **Central Base Station (Ubuntu Server):** IP `143.106.207.21`

## Architecture & Style Rules
* **Language Standards:** Strict Rust 2021 asynchronous standard (using `Tokio`).
* **Tone & Persona:** Act as an expert Embedded and Systems Engineer. Be direct, clear, and prioritize performance and zero-allocation patterns.

## Pre-flight Network Constraint
* **CRITICAL:** Before executing any network script, deployment, or remote SSH command, you MUST ask the user: *"Are you currently connected to the UNICAMP workshop network or active VPN?"* to avoid routing timeouts.

## Pre-Approved Safe Commands
* `git status`, `git diff`, `cargo check`