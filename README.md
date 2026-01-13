# 🏎️ Unicamp E-Racing Telemetry V2.0 (Rust Core)

![Build Status](https://img.shields.io/badge/build-passing-brightgreen)
![Language](https://img.shields.io/badge/language-Rust-orange)
![Database](https://img.shields.io/badge/database-TimescaleDB-blue)
![Platform](https://img.shields.io/badge/platform-NVIDIA%20Jetson%20AGX-green)

## 🚀 Overview

This repository contains the source code for the **V2.0 Telemetry System** of the Unicamp E-Racing Formula Student team.

Designed for the first **Autonomous Electric Vehicle** in South America, this system migrates our legacy Python pipeline to a high-performance, memory-safe architecture built entirely in **Rust**. It addresses critical challenges in high-speed data acquisition, dealing with extreme EMI environments and ensuring zero data loss during competitive racing.

## ⚡ Key Features

- **Rust-Based Core:** rewritten from scratch using `Tokio` for asynchronous I/O, ensuring millisecond latency and memory safety.
- **Hybrid Architecture (Edge + Cloud):**
  - **Edge (Car):** Runs on NVIDIA Jetson Xavier. Performs raw CAN bus capture, local backup (SQLite), and efficient binary streaming.
  - **Base (Server):** Handles complex decoding, real-time WebSocket broadcasting, and historical storage (TimescaleDB).
- **Starlink Ready:** Optimized to handle jitter and high-latency scenarios typical of satellite connections during telemetry handovers.
- **Protocol Buffering:** Custom binary protocol with framing for reliable TCP communication.
- **Hypertable Storage:** Utilizes TimescaleDB (PostgreSQL) for high-frequency time-series data ingestion.

## 🏗️ Architecture

```mermaid
graph LR
    A[NVIDIA Jetson / CAN Bus] -->|SocketCAN| B(Rust Edge Node)
    B -->|Async Write| C[SQLite Backup]
    B -->|TCP Stream / Binary| D{Starlink / Wi-Fi}
    D -->|TCP| E(Rust Base Server)
    E -->|Decode via HashMaps| F[TimescaleDB]
    E -->|WebSockets| G[Real-Time Dashboard]

Tech Stack

    Language: Rust (2021 Edition)

    Async Runtime: Tokio

    Connectivity: SocketCAN, TcpStream (Tokio), Tungstenite (WebSockets)

    Database:

        Edge: SQLite (rusqlite) for failsafe logging.

        Server: TimescaleDB (sqlx) for analytics.

    Hardware: NVIDIA Jetson AGX Xavier, Vector/Ixxat CAN Interfaces.

Installation & Run
Prerequisites

    Rust Toolchain (cargo)

    Docker & Docker Compose

    SocketCAN drivers (Linux)

1. Start Database (Base Station)
Bash

cd telemetry-server
docker-compose up -d

2. Run Server
Bash

cd telemetry-server
cargo run --release

3. Run Edge Node (On the Car/Jetson)
Bash

cd telemetry-edge
cargo run --release

Context: Unicamp E-Racing

Unicamp E-Racing is a student-run engineering team from the University of Campinas, Brazil. We design and build high-performance electric racing cars to compete in Formula Student events worldwide.

    Achievements: World Champions (Lincoln, USA), Top 10 World Ranking.

    Innovation: Developers of the first autonomous racing car in South America.