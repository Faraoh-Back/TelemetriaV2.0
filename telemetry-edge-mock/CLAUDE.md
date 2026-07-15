# Telemetry Edge Mock Context

## Objetivo
Mock standalone da Jetson para alimentar o `telemetry-server` com o mesmo
protocolo binario usado em pista.

## Regras de arquitetura
* O mock nao roda na Jetson e nao precisa de systemd service na pasta
  `Services/servicosJetson/`.
* O mock deve falar com o servidor por TCP usando o mesmo frame de 20 bytes:
  `[Length: 4B][CAN ID: 4B][Timestamp: 8B][Payload: 8B]`.
* O mock deve ser deterministico por cenario.
* Os DBCs copiados em `assets/dbc/` sao fonte de referencia para os IDs.

## Fluxo esperado
* `runtime` gera frames por familia de sinal.
* `transport` faz reconexao e envio TCP.
* `scenarios` define o comportamento temporal.
* `generators` convertem o estado do cenario em payload CAN.

## Comandos
* `cargo run -- --help`
* `cargo build`
* `cargo test`

