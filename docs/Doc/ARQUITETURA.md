# Arquitetura Clean do Telemetry Server

## Visão Geral
O backend foi refatorado de um monólito (`main.rs` com mais de 1800 linhas) para uma arquitetura limpa (Clean Architecture), modularizada em arquivos dedicados por responsabilidade. Isso garante manutenibilidade, separação de conceitos e facilidade em testes.

## Estrutura de Módulos

### 1. `main.rs` (Bootstrap)
Atua exclusivamente como o ponto de entrada e orquestrador do sistema. Carrega as variáveis de ambiente, inicializa as conexões com os bancos de dados (TimescaleDB e SQLite) via `db::init_*`, e instancia os servidores assíncronos (`api::run_http_ws_server`, `ingest::handle_client`).

### 2. `config.rs`
Centraliza as constantes de configuração (portas, caminhos de arquivo, parâmetros de telemetria) e a lógica de recuperação de variáveis de ambiente obrigatórias, como `DB_PASSWORD` e `JWT_SECRET`.

### 3. `models.rs`
Contém todas as definições de estruturas de dados (DTOs) que são serializadas/desserializadas entre o formato binário, JSON e o banco de dados. Exemplo: `ProcessedSignal`, requisições HTTP (`LoginRequest`, `CollectionStartRequest`) e os `Claims` do JWT.

### 4. `auth.rs`
Concentra toda a lógica de segurança e autenticação:
- Definição de roles e permissões (RBAC).
- Geração e validação de tokens JWT (usando `jsonwebtoken`).
- Extração de tokens de cabeçalhos HTTP (`Authorization: Bearer`) e parâmetros de URL (para conexões WebSocket).

### 5. `db.rs`
Camada de abstração de persistência dupla:
- **TimescaleDB:** Ingestão de sinais de alta frequência em tempo real.
- **SQLite:** Histórico persistente, gerenciamento de usuários e rastreio de sessões de log de telemetria.
Possui lógica de migração manual/automática de dados antigos para manter o Timescale leve.

### 6. `track_state.rs`
Lida com a lógica computacional do circuito:
- Mantém a representação na memória (`RealtimeTrackState`) com o mapa atual e o pose do carro.
- Fornece cálculos vetoriais puros (distâncias, normalização, intersecções) abstraindo o hardware.

### 7. `ws.rs`
Abstração do protocolo WebSocket:
- Realiza o Handshake manual (`Sec-WebSocket-Key` + GUID RFC 6455) usando cálculo `SHA1` puro.
- Trata o envio dos pacotes binários (`send_ws_binary_frame`) convertidos e de textos/json.

### 8. `api.rs`
Hospeda o servidor HTTP (porta 8081). Executa o roteamento (parser HTTP minimalista customizado) direcionando requests para autenticação, controle de coleta e download estático do frontend, além do Upgrade de WebSockets.

### 9. `ingest.rs`
Servidor TCP puro (porta 8080) responsável por receber continuamente streams binários diretamente da Jetson/Edge. Desempacota o payload, usa o `decoder` e dispara tanto a persistência para o banco quanto o `broadcast` para todos os WebSockets logados.
