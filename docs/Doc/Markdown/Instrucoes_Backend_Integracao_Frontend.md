# Instruções para o Time de Backend - Integração com Frontend Telemetria V2

Este documento descreve os requisitos e contratos de integração necessários da parte do backend para suportar a arquitetura atual do frontend (desenvolvido em SolidJS + Web Worker).

## 1. Role-Based Access Control (RBAC) e Autenticação

Para que o frontend possa diferenciar as permissões entre **Administradores** (que controlam a coleta) e **Membros** (que apenas visualizam), o backend deve implementar o seguinte:

- **JWT Token Payload:**
  O endpoint de login (`POST /login`) deve retornar um token JWT que contenha explicitamente a permissão do usuário.
  Exemplo de payload esperado:
  ```json
  {
    "sub": "user123",
    "role": "admin", // ou "member"
    "exp": 1700000000
  }
  ```
- **Proteção da Coleta:**
  Os endpoints que iniciam ou pausam a gravação de dados (`POST /api/telemetry/start`, `POST /api/telemetry/stop`) devem validar no servidor se o token recebido pertence a um `admin`.
- **WebSocket:**
  O frontend passará o token na URL da conexão WebSocket (ex: `ws://host:8081/ws?token=<JWT>`). O backend deve validar o token antes de começar a disparar os pacotes binários. Se for apenas um "membro", ele recebe os dados em tempo real (read-only), mas não pode invocar comandos de controle.

## 2. Mapa de Pista (GPS)

Para o Cockpit exibir o mapa da pista com a posição do veículo em tempo real:
- O stream binário do CAN precisa incluir sinais designados para **Latitude** e **Longitude**.
- Por favor, definam no `.dbc` ou no `CAN_MAP` quais serão os IDs e posições dos bits (ex: `GPS_Latitude` e `GPS_Longitude`) e nos informem os fatores de escala correspondentes.

## 3. Streaming de Vídeo Onboard e Áudio

O design do Cockpit contempla um player de vídeo em tempo real (RTSP/WebRTC).
- **Endpoint do Stream:** O backend precisa providenciar o URL de conexão do fluxo (seja por um servidor de sinalização WebRTC independente ou um endpoint HTTP-FLV / HLS de baixa latência).
- **Controle via MQTT:** Informar caso a inicialização da câmera dependa de publicações em tópicos MQTT específicos.

## 4. Consulta de Histórico (Coletas Passadas)

Atualmente o frontend gerencia dados em memória (buffers circulares de ~30s). Para visualizarmos o histórico de dias passados:
- Criar rotas na REST API (ex: `GET /api/sessions` e `GET /api/sessions/:id/data`) para carregar a série temporal de uma sessão salva no banco de dados (SQLite/PostgreSQL).
- O retorno deve idealmente ser otimizado ou páginado (ou em formato binário comprimido), pois gráficos densos sobrecarregarão chamadas JSON tradicionais.
