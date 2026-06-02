# Planejamento de Features — E-Racing Ultra Blaster UNICAMP
## TelemetriaV2.2 · Exportação MoTeC `.ld` | TelemetriaV2.3 · Dashboard Blue Team

> **Projeto:** Telemetria V2 — E-Racing Ultra Blaster  
> **Instituição:** UNICAMP — Faculdade de Engenharia Mecânica  
> **Competição:** SAE Brasil Formula SAE Elétrico  
> **Stack atual:** Rust (servidor + edge) · SolidJS (frontend) · TimescaleDB + SQLite · Jetson AGX Xavier · Ubuntu 22.04  
> **Data de criação:** Junho de 2026  

---

## Índice

1. [Visão Geral do Projeto](#1-visão-geral-do-projeto)
2. [Arquitetura Atual (V2.1)](#2-arquitetura-atual-v21)
3. [TelemetriaV2.2 — Exportação MoTeC `.ld`](#3-telemetriav22--exportação-motec-ld)
4. [TelemetriaV2.3 — Dashboard Blue Team](#4-telemetriav23--dashboard-blue-team)
5. [Ordem de Implementação Integrada](#5-ordem-de-implementação-integrada)
6. [Riscos e Mitigações](#6-riscos-e-mitigações)

---

## 1. Visão Geral do Projeto

### 1.1 Roadmap completo de versões

```mermaid
timeline
    title Roadmap E-Racing Telemetria
    section V2.0 ✅
        Dias 1–4 : Pipeline CAN end-to-end
                 : TimescaleDB + SQLite
                 : JWT + bcrypt
                 : Serviços systemd
    section V2.1 ✅
        Dias 5–9 : NTP offset ±0.1ms
                 : Latência real 3.77ms
                 : Dashboard SolidJS
                 : ZED 2i GStreamer
                 : QoS HTB 3 classes
                 : SSH reverso (serveo)
    section V2.2 🎯
        Próximo : Exportação .ld MoTeC
                : Auth admin para conversão
                : Aba de Downloads
                : Tabela de sessões
    section V2.3 🔒
        Futuro : Dashboard Blue Team
               : Suricata IDS
               : Wazuh SIEM local
               : fail2ban + UFW
               : Terminais web (Cockpit)
               : Script emergencia.sh
```

### 1.2 Contexto dos dois cenários de operação

```mermaid
flowchart LR
    subgraph OFICINA["🏭 Oficina — Online"]
        direction TB
        I1[Internet eduroam\n143.106.207.x]
        I2[SSH reverso\nserveo.net]
        I3[Cloudflare Zero Trust\npendente aprovação TI]
        I1 --- I2 --- I3
    end

    subgraph CORRIDA["🏁 Competição SAE Brasil — Offline"]
        direction TB
        C1[Rede isolada\nUnifi WPA3]
        C2[Sem internet\n192.168.1.x]
        C3[Todos os serviços\nlocais]
        C1 --- C2 --- C3
    end

    style OFICINA fill:#1a3a2a,stroke:#2d7a4f,color:#e0ffe0
    style CORRIDA fill:#3a1a1a,stroke:#7a2d2d,color:#ffe0e0
```

> **Regra de ouro:** qualquer feature que for para a competição **deve funcionar 100% offline**, ser leve o suficiente para não disputar CPU com a telemetria, e ter valor real contra vetores de ataque locais.

---

## 2. Arquitetura Atual (V2.1)

### 2.1 Topologia de rede

```mermaid
graph TB
    subgraph CARRO["🚗 Carro"]
        CAN["Barramento CAN\n500 kbps"]
        JETSON["Jetson AGX Xavier\n192.168.1.101\ntelemetry-edge.service\ncan0/can1 @ 500kbps"]
        CAN --> JETSON
    end

    subgraph INFRA["📡 Infraestrutura"]
        UNIFI["Antena Unifi UAP-AC-M\nponto-a-ponto 5GHz"]
    end

    subgraph SERVIDOR["🖥️ Servidor Ubuntu 22.04"]
        SRV["192.168.1.100\ntelemetry.service\nTCP :8080 · HTTP+WS :8081 · NTP :9999"]
        DB_TS["TimescaleDB\nPostgreSQL 14\ndados ao vivo / 7 dias"]
        DB_SQ["SQLite\nhistórico permanente\n> 7 dias"]
        SRV --> DB_TS
        SRV --> DB_SQ
    end

    subgraph CLIENTES["💻 Clientes na rede"]
        BROWSER["Browser\nDashboard SolidJS\n:8081"]
        ANDROID["App Android\nfuturo"]
    end

    JETSON -- "TCP frames CAN\n20 bytes / frame" --> UNIFI
    UNIFI -- "Wi-Fi 5GHz\n~3.77ms latência" --> SRV
    SRV -- "WebSocket binário\n:8081" --> BROWSER
```

### 2.2 Fluxo de dados atual

```mermaid
sequenceDiagram
    participant CAN as Barramento CAN
    participant EDGE as telemetry-edge (Jetson)
    participant SRV as telemetry-server
    participant TS as TimescaleDB
    participant SQ as SQLite
    participant WS as WebSocket clients

    CAN->>EDGE: frame raw (can_id + 8 bytes payload)
    Note over EDGE: aplica clock_offset NTP<br/>timestamp corrigido ±0.1ms
    EDGE->>SRV: TCP frame 20 bytes<br/>can_id + timestamp + payload
    SRV->>SRV: decoder.rs<br/>38 IDs mapeados
    SRV->>TS: INSERT sensor_data<br/>(ao vivo, retenção 7 dias)
    SRV->>WS: broadcast binário 20 bytes
    Note over SRV,SQ: Boot: migrate_old_data()<br/>cursor por timestamp O(n log n)
    SRV->>SQ: INSERT historico<br/>(dados > 7 dias)
```

### 2.3 Status dos serviços systemd

| Nodo | Serviço | Função | Status |
|------|---------|--------|--------|
| Servidor | `telemetry.service` | TCP:8080 + HTTP/WS:8081 + NTP:9999 | ✅ |
| Servidor | `postgresql@14-main` | TimescaleDB | ✅ |
| Servidor | `serveo-tunnel.service` | SSH reverso global | ✅ |
| Servidor | `eracing-qos.service` | QoS HTB 3 classes | ✅ |
| Servidor | `mediamtx.service` | WebRTC :8555 | ✅ |
| Servidor | `udp-to-rtsp.service` | ffmpeg UDP→RTSP | ✅ |
| Servidor | `video-backup.service` | Grava MKV 5min | ✅ |
| Jetson | `can-interfaces.service` | can0/can1/vcan0/vcan1 UP | ✅ |
| Jetson | `can-replay.service` | canplayer loop log real | ✅ |
| Jetson | `telemetry-edge.service` | Rust aarch64 → TCP:8080 | ✅ |
| Jetson | `zed-stream.service` | ZED 2i → UDP :5601 | ✅ |
| Jetson | `serveo-tunnel.service` | SSH reverso global | ✅ |

---

## 3. TelemetriaV2.2 — Exportação MoTeC `.ld`

### 3.1 Visão geral e motivação

Os engenheiros da equipe precisam analisar dados de voltas passadas no **MoTeC i2** — software profissional de análise de telemetria automotiva, padrão no motorsport. O MoTeC i2 só aceita arquivos no formato binário `.ld` (com arquivo de metadados `.ldx` em XML).

Hoje todos os dados estão no SQLite (histórico permanente) e no TimescaleDB (últimos 7 dias). A V2.2 adiciona uma pipeline: **banco de dados → encoder binário → arquivo `.ld` para download**.

### 3.2 Arquitetura da feature

```mermaid
flowchart TD
    subgraph FRONTEND["Frontend SolidJS"]
        ADMIN_BTN["Botão 'Terminar sessão'\napenas usuário admin"]
        SPINNER["Spinner\nconversão em andamento"]
        ABA_DL["Aba Downloads\ntabela de sessões"]
        DL_BTN["Botão Download\npor sessão"]
    end

    subgraph BACKEND["Backend Rust"]
        EP_CONVERT["POST /api/telemetry/convert\nRestrito: JWT sub == 'eracing'"]
        TASK_Q["tokio::spawn\nbackground task"]
        EXTRACTOR["Query SQL\nTimescaleDB ou SQLite\npor timestamp início/fim"]
        ENCODER[".ld Encoder\nbyteorder / binrw\nheader + canais + dados"]
        XML_GEN[".ldx Generator\nXML metadados\nnome, unidade, freq"]
        STORAGE["Storage\n/storage/logs/\nsessao_2026_XX_XX.ld"]
        EP_LIST["GET /api/sessions\nlista arquivos disponíveis"]
        EP_DOWNLOAD["GET /api/download/:id\nContent-Disposition: attachment"]
    end

    subgraph DB["Bancos de dados"]
        TS["TimescaleDB\ndados ≤ 7 dias"]
        SQ_H["SQLite historico.db\ndados > 7 dias"]
        SQ_S["SQLite sessions.db\nmetadados de sessão"]
    end

    ADMIN_BTN --> EP_CONVERT
    EP_CONVERT --> TASK_Q
    TASK_Q --> EXTRACTOR
    EXTRACTOR --> TS
    EXTRACTOR --> SQ_H
    EXTRACTOR --> ENCODER
    ENCODER --> XML_GEN
    ENCODER --> STORAGE
    ENCODER --> SQ_S
    SPINNER -.->|polling job_id| EP_CONVERT
    ABA_DL --> EP_LIST
    EP_LIST --> SQ_S
    DL_BTN --> EP_DOWNLOAD
    EP_DOWNLOAD --> STORAGE
```

### 3.3 O formato binário `.ld` do MoTeC

> **Esta é a pesquisa mais crítica da V2.2.** O formato não tem especificação pública oficial. Antes de escrever uma linha de código, pesquise no GitHub por `motec ld format`, `motec-ld`, `python-motec` e `racedatatools`.

#### 3.3.1 Estrutura geral do arquivo

```mermaid
block-beta
    columns 1
    block:HEADER["Header principal (4096 bytes)"]
        H1["Magic bytes + versão"]
        H2["Número de canais"]
        H3["Timestamp de início"]
        H4["Nome do evento / veículo"]
    end
    block:CHANNELS["Channel descriptors (por canal)"]
        C1["Nome do sinal (ex: RPM)"]
        C2["Unidade (ex: rpm)"]
        C3["Frequência de amostragem (Hz)"]
        C4["Offset para dados no arquivo"]
    end
    block:DATA["Data blocks (por canal)"]
        D1["Canal 0: sequência de float32"]
        D2["Canal 1: sequência de float32"]
        D3["Canal N: ..."]
    end
    block:LDX["Arquivo .ldx (XML separado)"]
        X1["<ChannelGroup> por módulo"]
        X2["<Channel name= unit= freq=>"]
    end
```

#### 3.3.2 Crates Rust para pesquisar

| Crate | Uso | Link |
|-------|-----|------|
| `binrw` | Leitura/escrita binária com anotações em struct | docs.rs/binrw |
| `byteorder` | Controle de endianness (little/big endian) | docs.rs/byteorder |
| `quick-xml` | Geração do `.ldx` XML | docs.rs/quick-xml |

> **Dica prática:** O MoTeC espera little-endian em todos os campos numéricos. Se o header estiver desalinhado por **1 byte sequer**, o i2 não reconhece o arquivo — sem mensagem de erro clara.

### 3.4 Plano de implementação por fases

```mermaid
gantt
    title TelemetriaV2.2 — Cronograma de implementação
    dateFormat  YYYY-MM-DD
    axisFormat  Semana %W

    section Pesquisa
    Estudar formato .ld no GitHub          :research1, 2026-06-03, 3d
    Estudar binrw e byteorder              :research2, after research1, 2d

    section Backend Rust
    Tabela sessions no SQLite              :db1, after research2, 1d
    Endpoint /convert com auth admin       :api1, after db1, 2d
    Query SQL extração por timestamp       :sql1, after api1, 2d
    Encoder .ld (header + canais)          :enc1, after sql1, 5d
    Gerador .ldx XML                       :xml1, after enc1, 2d
    Tokio background task + job polling    :task1, after api1, 2d
    Endpoint /sessions e /download         :api2, after enc1, 2d
    Housekeeping de arquivos               :hk1, after api2, 1d

    section Frontend SolidJS
    Lógica condicional botão admin         :fe1, after api1, 1d
    Spinner de conversão                   :fe2, after fe1, 1d
    Aba Downloads com tabela               :fe3, after api2, 3d

    section QA
    Abrir .ld no MoTeC i2                  :qa1, after fe3, 2d
    Validar canais, unidades, frequências  :qa2, after qa1, 2d
```

### 3.5 Fase 1 — Banco de dados: tabela `sessions`

```sql
-- SQLite: nova tabela de metadados de sessão
CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nome_sessao TEXT    NOT NULL,           -- "Treino 1", "Corrida", etc.
    start_time  REAL    NOT NULL,           -- Unix epoch f64
    end_time    REAL,                       -- NULL enquanto em andamento
    file_path   TEXT,                       -- NULL até conversão concluir
    status      TEXT    DEFAULT 'recording',-- recording | converting | done | error
    created_at  TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions (status);
```

### 3.6 Fase 2 — Endpoint `/api/telemetry/convert`

```mermaid
sequenceDiagram
    participant FE as Frontend (admin)
    participant API as POST /api/telemetry/convert
    participant Q as tokio::spawn
    participant DB as TimescaleDB/SQLite
    participant ENC as .ld Encoder
    participant FS as /storage/logs/

    FE->>API: POST {session_id, nome} + JWT
    API->>API: Valida JWT sub == "eracing"<br/>→ 403 se não for admin
    API->>DB: INSERT INTO sessions (status='converting')
    API->>Q: spawn background task(session_id)
    API-->>FE: 202 Accepted {job_id}

    loop Polling (a cada 2s)
        FE->>API: GET /api/sessions/:job_id/status
        API-->>FE: {status: "converting", progress: 42}
    end

    Q->>DB: SELECT * FROM sensor_data<br/>WHERE time > to_timestamp($start)<br/>AND time <= to_timestamp($end)<br/>ORDER BY time ASC LIMIT 5000
    Q->>ENC: encode_ld(rows) → Vec<u8>
    ENC->>FS: write sessao_2026_06_03_treino1.ld
    ENC->>FS: write sessao_2026_06_03_treino1.ldx
    Q->>DB: UPDATE sessions SET status='done',<br/>file_path='...' WHERE id=$job_id
    API-->>FE: {status: "done", download_url: "/api/download/7"}
```

### 3.7 Fase 3 — Motor de conversão `.ld` em Rust

```rust
// Esboço da estrutura do header MoTeC .ld
// Pesquisar valores exatos no GitHub antes de implementar

use binrw::binwrite;
use byteorder::{LittleEndian, WriteBytesExt};

#[binwrite]
#[bw(little)]
struct LdHeader {
    magic:          [u8; 4],      // bytes mágicos do MoTeC
    version:        u32,
    channel_count:  u32,
    start_time:     f64,          // Unix epoch
    event_name:     [u8; 64],     // null-padded UTF-8
    vehicle_id:     [u8; 64],
    // ... outros campos do header
}

#[binwrite]
#[bw(little)]
struct ChannelDescriptor {
    name:           [u8; 32],
    unit:           [u8; 8],
    sample_rate:    f32,          // Hz
    data_offset:    u32,          // offset no arquivo
    data_count:     u32,          // número de amostras
    data_type:      u16,          // 0=float32, 1=int16, etc.
}
```

> **Atenção:** Os valores exatos dos campos mágicos, tamanhos de campo e tipos de dados **devem ser obtidos por engenharia reversa** de arquivos `.ld` reais. Abra um arquivo gerado pelo MoTeC i2 num editor hex (como `xxd`) e compare com implementações de referência no GitHub.

### 3.8 Fase 4 — Frontend: restrições e aba de downloads

```mermaid
stateDiagram-v2
    [*] --> Idle : app carrega
    Idle --> Recording : clica "Iniciar coleta"\n(qualquer usuário)
    Recording --> Converting : clica "Terminar"\n⚠️ SOMENTE admin (sub == eracing)
    Converting --> Done : encoder concluiu\narquivo .ld disponível
    Done --> Idle : nova sessão
    Recording --> Idle : cancela sem salvar

    note right of Converting
        Spinner visível
        Polling /api/sessions/:id/status
        a cada 2 segundos
    end note

    note right of Done
        Aba Downloads atualiza
        Linha nova na tabela
        Botão Download ativo
    end note
```

#### Tabela de downloads — colunas sugeridas

| # | Data/Hora | Nome da Sessão | Duração | Tamanho | Ação |
|---|-----------|----------------|---------|---------|------|
| 7 | 03/06/2026 14:32 | Treino 1 | 8m 42s | 2.1 MB | ⬇ Download |
| 6 | 03/06/2026 11:15 | Aquecimento | 3m 10s | 890 KB | ⬇ Download |

### 3.9 Fase 5 — QA: validação no MoTeC i2

```mermaid
flowchart LR
    A["Gerar .ld\nno servidor"] --> B["Transferir para\nnotebook via download"]
    B --> C["Abrir MoTeC i2"]
    C --> D{".ld reconhecido?"}
    D -- Não --> E["Inspecionar header\ncom xxd ou hex editor\ncomparar com referência"]
    E --> A
    D -- Sim --> F["Verificar canais:\n✓ Nomes corretos\n✓ Unidades corretas\n✓ Frequência correta"]
    F --> G["Verificar dados:\n✓ Valores fazem sentido\n✓ Timestamps corretos\n✓ Não há saltos"]
    G --> H["✅ V2.2 validada"]
```

### 3.10 Checklist completo V2.2

```mermaid
mindmap
  root((V2.2 MoTeC))
    Pesquisa
      Formato .ld no GitHub
      Crate binrw docs.rs
      Arquivo .ld real para referência hex
    Backend Rust
      Tabela sessions no SQLite
      Middleware JWT admin 403
      Endpoint /convert com job_id
      Query cursor por timestamp
      Encoder .ld header + canais
      Gerador .ldx XML
      tokio spawn background
      Endpoint /sessions lista
      Endpoint /download serve arquivo
      Housekeeping expiração arquivos
    Frontend SolidJS
      Esconder botão Terminar para não-admin
      Spinner polling job status
      Nova aba Downloads
      Tabela com colunas nome/data/tamanho
      Botão download por sessão
    QA
      Abrir .ld no MoTeC i2
      Validar canais e unidades
      Validar valores e timestamps
      Teste com dados reais do carro
```

---

## 4. TelemetriaV2.3 — Dashboard Blue Team

### 4.1 Visão geral e motivação

A V2.3 adiciona uma camada completa de monitoramento, segurança e resposta a incidentes ao sistema. O objetivo é duplo: proteger o sistema de telemetria durante a competição (cenário offline) e criar um laboratório de aprendizado real de Blue Team para a equipe (cenário oficina).

### 4.2 Os dois cenários de segurança

```mermaid
flowchart TD
    subgraph COMP["🏁 Competição — Offline"]
        direction TB
        V1["Vetor 1: Equipe adversária\nconecta na rede Unifi"]
        V2["Vetor 2: Notebook rogue\ntenta acessar :8081"]
        V3["Vetor 3: IP não autorizado\nmanda frames na :8080"]
        V4["Vetor 4: Acesso físico\nao servidor no rack"]
        V1 & V2 & V3 & V4 --> PROT_C
        PROT_C["UFW + fail2ban\nSuricata regras customizadas\nUnifi WPA3 + MAC filter\nemergencia.sh"]
    end

    subgraph OFIC["🏭 Oficina — Online"]
        direction TB
        W1["Vetor 1: SSH exposto\nvia serveo.net"]
        W2["Vetor 2: Brute force\nendpoint /login"]
        W3["Vetor 3: JWT vazado"]
        W4["Vetor 4: Tráfego\nanômalo eduroam"]
        W1 & W2 & W3 & W4 --> PROT_O
        PROT_O["Wazuh SIEM local\nSuricata IDS\nfail2ban + UFW\nJWT revogação global"]
    end
```

### 4.3 Stack de segurança por cenário

| Ferramenta | Competição (offline) | Oficina (online) | Aprende |
|------------|---------------------|------------------|---------|
| **UFW** | ✅ Essencial | ✅ Essencial | Firewall Linux |
| **fail2ban** | ✅ Essencial | ✅ Essencial | Proteção brute-force |
| **Suricata** | ✅ Regras customizadas | ✅ Regras + emerging threats | IDS/IPS real |
| **Script Unifi API** | ✅ Essencial | ✅ Útil | Detecção rogue |
| **Wazuh Manager** | ⚠️ Se RAM permitir | ✅ Essencial | SIEM real |
| **Cockpit** | ✅ Terminais web | ✅ Terminais web | Admin Linux |
| **Netdata** | ✅ Leve | ✅ + exporters HTB | Observabilidade |
| **emergencia.sh** | ✅ Crítico | ✅ Útil | Resposta a incidentes |
| **OSSIM** | ❌ Pesado demais | ⚠️ VM separada | Laboratório SOC |
| **pfSense** | ❌ Hardware extra | ⚠️ VM separada | Firewall avançado |
| **Splunk** | ❌ Free tier limitado | ❌ Substituído por Wazuh | — |

> **Nota sobre Wazuh na competição:** mede o consumo de RAM com `free -h` rodando Wazuh Manager + TimescaleDB + telemetry-server juntos. Se sobrar margem (o servidor tem 16–32GB), leva. Se disputar CPU, fica na oficina.

### 4.4 Arquitetura do painel completo

```mermaid
graph TB
    subgraph CAMADA0["Camada 0 — Rede (Unifi)"]
        UNI["WPA3 + SSID oculto\nMAC allowlist\nAPI local: http://192.168.1.20"]
    end

    subgraph CAMADA1["Camada 1 — Firewall"]
        UFW_N["UFW\nPermite: 8080 · 8081 · 9999 · 22 · 2222 · 8555 · 5600"]
        F2B["fail2ban\nBane IP após 5 falhas /login\nJail SSH + Jail HTTP"]
        UNIFI_SCR["Script Unifi API\nalerta MAC desconhecido\npoll a cada 30s"]
    end

    subgraph CAMADA2["Camada 2 — IDS (Suricata)"]
        SUR_RULES["Regras customizadas\nbr.force /login · IP não-autorizado :8080\nframe anômalo :8081"]
        SUR_LOG["fast.log → journald\nconsumido pelo Wazuh"]
    end

    subgraph CAMADA3["Camada 3 — SIEM (Wazuh)"]
        WM["Wazuh Manager\nservidor :55000"]
        WA_J["Wazuh Agent\nJetson"]
        WA_S["Wazuh Agent\nServidor"]
        WD["Wazuh Dashboard\nOpenSearch :5601"]
        WM --> WD
        WA_J --> WM
        WA_S --> WM
    end

    subgraph CAMADA4["Camada 4 — Terminais Web (Cockpit)"]
        CK_S["Cockpit Servidor\n:9090 · terminal + systemd + logs"]
        CK_J["Cockpit Jetson\n:9090 · terminal + can + edge"]
    end

    subgraph CAMADA5["Camada 5 — Métricas (Netdata)"]
        ND_S["Netdata Servidor\nCPU/RAM/disco/HTB"]
        ND_J["Netdata Jetson\nCAN latência/CPU"]
    end

    subgraph CAMADA6["Camada 6 — Resposta Rápida"]
        EMG["emergencia.sh\nbane IP + revoga JWT + reinicia"]
        REV["revoga_jwt.sh\ntroca JWT_SECRET\ninvalida todos os tokens"]
        ISO["isolamento_unifi.sh\nderruba SSID via API"]
    end

    CAMADA0 --> CAMADA1
    CAMADA1 --> CAMADA2
    CAMADA2 --> CAMADA3
    CAMADA3 --> CAMADA4
    CAMADA4 --> CAMADA5
    CAMADA5 --> CAMADA6
```

### 4.5 Tipos de alertas do painel

```mermaid
flowchart LR
    subgraph CRITICO["🔴 Crítico — Ação imediata"]
        A1["MAC desconhecido\ncom RSSI forte na Unifi"]
        A2["Brute force /login\n> 5 tentativas em 60s"]
        A3["IP não autorizado\nmandando frame :8080"]
        A4["Modificação de arquivo\nno binário telemetry-server"]
    end

    subgraph ATENCAO["🟡 Atenção — Monitorar"]
        B1["Latência CAN > 20ms\nmédio em 30s"]
        B2["CPU servidor > 80%\npor > 10s"]
        B3["Wazuh Agent\ndesconectou (Jetson)"]
        B4["fail2ban ban\nIP bloqueado"]
    end

    subgraph INFO["🟢 Info — Registrar"]
        C1["Nova conexão\nWebSocket autenticada"]
        C2["Reinício de serviço\nsystemd"]
        C3["Login bem-sucedido\ncom timestamp + IP"]
        C4["Migração SQLite\nconcluída com N registros"]
    end

    CRITICO --> EMG_BTN["🚨 emergencia.sh"]
    ATENCAO --> MONITOR["👀 Monitorar"]
    INFO --> LOG["📝 Registrar"]
```

### 4.6 Plano de implementação por fases

```mermaid
gantt
    title TelemetriaV2.3 — Cronograma de implementação
    dateFormat  YYYY-MM-DD
    axisFormat  Semana %W

    section Fase 1 - Fundação
    UFW configuração (4 comandos)           :ufw, 2026-06-17, 1d
    fail2ban jail HTTP + SSH                :f2b, after ufw, 2d
    Script monitoramento Unifi API          :unifi, after f2b, 3d

    section Fase 2 - IDS
    Instalar Suricata                       :sur_inst, after unifi, 1d
    Escrever regras customizadas            :sur_rules, after sur_inst, 4d
    Integrar fast.log → journald            :sur_log, after sur_rules, 1d

    section Fase 3 - SIEM
    Instalar Wazuh Manager + Dashboard      :wazuh_m, after sur_log, 3d
    Instalar Wazuh Agent no servidor        :wazuh_as, after wazuh_m, 1d
    Instalar Wazuh Agent na Jetson          :wazuh_aj, after wazuh_as, 1d
    Configurar alertas customizados         :wazuh_al, after wazuh_aj, 3d

    section Fase 4 - Terminais e Métricas
    Instalar Cockpit servidor + Jetson      :cockpit, after wazuh_al, 2d
    Instalar Netdata servidor + Jetson      :netdata, after cockpit, 1d
    Exporters HTB para Netdata              :htb_exp, after netdata, 2d

    section Fase 5 - Resposta a Incidentes
    emergencia.sh                           :emg, after htb_exp, 2d
    revoga_jwt.sh                           :revjwt, after emg, 1d
    isolamento_unifi.sh                     :isounifi, after revjwt, 1d
    Playbooks escritos                      :pb, after isounifi, 2d

    section Fase 6 - Hardening
    Testar stack completa (competição)      :test_comp, after pb, 3d
    Testar stack completa (oficina)         :test_ofic, after test_comp, 3d
    Documentar procedimentos               :doc, after test_ofic, 2d
```

### 4.7 Fase 1 — Fundação: UFW + fail2ban

#### UFW — os 4 comandos pendentes desde o Dia 4

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp    # SSH (ou 2222/tcp se já migrado)
sudo ufw allow 2222/tcp  # SSH alternativo
sudo ufw allow 8080/tcp  # TCP CAN frames (Jetson → servidor)
sudo ufw allow 8081/tcp  # HTTP + WebSocket dashboard
sudo ufw allow 9999/tcp  # NTP server
sudo ufw allow 5600/udp  # RTP vídeo ZED 2i
sudo ufw allow 8554/tcp  # RTSP
sudo ufw allow 8555/tcp  # WebRTC mediamtx
sudo ufw enable
sudo ufw status verbose
```

#### fail2ban — jail customizada para o servidor Rust

```ini
# /etc/fail2ban/jail.local

[telemetry-http]
enabled  = true
port     = 8081
filter   = telemetry-login
logpath  = /home/eracing/logs/server.log
maxretry = 5
findtime = 60
bantime  = 3600

[sshd]
enabled  = true
maxretry = 3
bantime  = 86400
```

```ini
# /etc/fail2ban/filter.d/telemetry-login.conf
[Definition]
failregex = .*LOGIN_FAILED.*ip=<HOST>.*
ignoreregex =
```

> O servidor Rust precisa logar tentativas de login falhas com o IP do cliente no formato acima. Adicionar ao `main.rs`: `warn!("LOGIN_FAILED ip={} user={}", peer_addr, username);`

### 4.8 Fase 2 — Suricata: regras customizadas

```mermaid
flowchart TD
    NET["Tráfego de rede\ninterface enp4s0f1"] --> SUR["Suricata\nmodo af-packet"]
    SUR --> RULES["Engine de regras"]
    RULES --> FAST["fast.log\n/var/log/suricata/"]
    FAST --> WA["Wazuh Agent\nconsume fast.log"]
    WA --> WM["Wazuh Manager\ncorrelação + alerta"]
```

#### Regras customizadas para o protocolo E-Racing

```
# /etc/suricata/rules/eracing.rules

# Regra 1: Brute force no endpoint /login
# Alerta se mais de 5 POST /login em 10 segundos do mesmo IP
alert http any any -> 192.168.1.100 8081 \
  (msg:"ERACING brute force /login detectado"; \
   content:"POST"; http_method; \
   content:"/login"; http_uri; \
   threshold: type threshold, track by_src, count 5, seconds 10; \
   classtype:attempted-user; sid:1000001; rev:1;)

# Regra 2: IP não autorizado mandando frames CAN
# Apenas a Jetson (192.168.1.101) deve enviar frames na porta 8080
alert tcp !192.168.1.101 any -> 192.168.1.100 8080 \
  (msg:"ERACING frame CAN de IP nao autorizado"; \
   classtype:policy-violation; sid:1000002; rev:1;)

# Regra 3: Frame WebSocket com tamanho anômalo
# Frame CAN deve ter exatamente 20 bytes de payload
alert tcp any any -> 192.168.1.100 8081 \
  (msg:"ERACING frame WebSocket com tamanho anomalo"; \
   dsize:!20; \
   content:"|82|"; offset:0; depth:1; \
   classtype:protocol-command-decode; sid:1000003; rev:1;)

# Regra 4: Scan de portas (NMAP ou similar)
alert tcp any any -> 192.168.1.100 any \
  (msg:"ERACING possivel port scan detectado"; \
   flags:S; \
   threshold: type threshold, track by_src, count 15, seconds 5; \
   classtype:network-scan; sid:1000004; rev:1;)
```

### 4.9 Fase 3 — Wazuh SIEM local

```mermaid
graph TB
    subgraph WAZUH["Wazuh Stack (no servidor)"]
        WM["Wazuh Manager\n:55000 API\n:1514 agents"]
        OSD["OpenSearch\n:9200"]
        DASH["Wazuh Dashboard\n:5601"]
        WM --> OSD --> DASH
    end

    subgraph AGENTS["Wazuh Agents"]
        AS["Agent Servidor\n192.168.1.100"]
        AJ["Agent Jetson\n192.168.1.101"]
    end

    subgraph SOURCES["Fontes de log"]
        JD1["journald\ntelemetry.service"]
        JD2["journald\ntelemetry-edge.service"]
        SL["Suricata fast.log"]
        F2["fail2ban.log"]
        AUTH["auth.log\nSSH attempts"]
    end

    JD1 & SL & F2 & AUTH --> AS
    JD2 --> AJ
    AS & AJ --> WM

    style WAZUH fill:#1a2a3a,stroke:#2d5a7a
    style AGENTS fill:#1a3a1a,stroke:#2d7a2d
    style SOURCES fill:#3a1a1a,stroke:#7a2d2d
```

#### O que o Wazuh faz offline que o Grafana não faz

```mermaid
mindmap
  root((Wazuh))
    Correlação de eventos
      Suricata alerta brute force E MESMO TEMPO
      fail2ban bane o mesmo IP
      → incidente correlacionado automaticamente
    Integridade de arquivos
      Detecta se binário telemetry-server foi modificado
      Detecta se .env foi alterado
      Alerta em tempo real
    Compliance MITRE ATT&CK
      Mapeia automaticamente os eventos
      para táticas e técnicas
      do framework MITRE
    Detecção de rootkit
      Verifica módulos do kernel
      suspeitos no servidor e na Jetson
```

### 4.10 Fase 4 — Terminais web (Cockpit) e métricas (Netdata)

#### Cockpit — terminais web para servidor e Jetson

```bash
# Servidor
sudo apt install cockpit cockpit-networkmanager
sudo systemctl enable --now cockpit.socket
# Acesso: https://192.168.1.100:9090

# Jetson
sudo apt install cockpit
sudo systemctl enable --now cockpit.socket
# Acesso: https://192.168.1.101:9090
```

O Cockpit fornece: terminal bash no browser, status de serviços systemd (iniciar/parar/ver logs), gráficos de CPU/RAM/rede básicos, e gestão de usuários. É o substituto direto de abrir dois terminais SSH.

#### Netdata — métricas em tempo real

```bash
# Instalação com um script (funciona offline se baixar antes)
bash <(curl -Ss https://my-netdata.io/kickstart.sh)
# Acesso: http://192.168.1.100:19999
```

Para visualizar as classes HTB no Netdata, habilitar o plugin de rede:

```yaml
# /etc/netdata/go.d/tc.conf
jobs:
  - name: enp4s0f1
    interface: enp4s0f1
```

### 4.11 Fase 5 — Scripts de resposta rápida

```mermaid
flowchart TD
    INC["🚨 Incidente detectado"] --> Q{Tipo?}
    Q -- "IP suspeito\nna rede" --> BAN["emergencia.sh IP\n→ UFW block IP\n→ Unifi deassociate MAC"]
    Q -- "Token JWT\nvazado ou suspeito" --> JWT["revoga_jwt.sh\n→ novo JWT_SECRET no .env\n→ systemctl restart telemetry\n→ todos os tokens inválidos em <1s"]
    Q -- "Situação grave\ntudo offline" --> EMG["emergencia_total.sh\n→ UFW bloqueia tudo\n→ SSID Unifi derrubado\n→ servidor para\n→ alert salvo em log"]
    Q -- "Investigação\nforense" --> FOR["forense.sh\n→ dump logs journald\n→ cópia fast.log Suricata\n→ estado conexões (ss -tnp)\n→ arquivo timestampado"]
```

```bash
#!/bin/bash
# /etc/eracing/emergencia.sh
# Uso: sudo ./emergencia.sh [IP_PARA_BANIR]

IP_ALVO="$1"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG="/var/log/eracing/emergencia_${TIMESTAMP}.log"

echo "=== EMERGÊNCIA E-RACING ${TIMESTAMP} ===" | tee $LOG

# 1. Banir IP no UFW (se fornecido)
if [ -n "$IP_ALVO" ]; then
    sudo ufw insert 1 deny from $IP_ALVO to any
    echo "✅ IP $IP_ALVO banido no UFW" | tee -a $LOG
fi

# 2. Revogar todos os tokens JWT
NEW_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
sudo sed -i "s/JWT_SECRET=.*/JWT_SECRET=$NEW_SECRET/" \
    /home/eracing/TelemetriaV2.0/telemetry-server/.env
echo "✅ JWT_SECRET rotacionado" | tee -a $LOG

# 3. Reiniciar servidor (invalida todos os tokens)
sudo systemctl restart telemetry.service
echo "✅ telemetry.service reiniciado" | tee -a $LOG

echo "=== FIM DA EMERGÊNCIA ===" | tee -a $LOG
```

### 4.12 Fase 6 — Hardening final

#### Checklist de hardening antes da competição

```mermaid
mindmap
  root((Hardening\nV2.3))
    UFW ✅ pendente
      deny incoming default
      allow apenas portas necessárias
      enable no boot
    fail2ban
      jail HTTP /login
      jail SSH
      bantime 3600s
      maxretry 5
    Unifi WPA3
      SSID oculto
      MAC allowlist
      senha forte
    JWT
      expiry 8h
      bcrypt cost 12
      script revogação pronto
    SSH
      porta 2222 em vez de 22
      apenas chaves RSA (sem senha)
      PermitRootLogin no
    Suricata
      regras customizadas ativas
      fast.log sendo consumido
    Wazuh
      agents conectados
      alertas críticos configurados
    Scripts prontos
      emergencia.sh testado
      revoga_jwt.sh testado
      forense.sh testado
```

### 4.13 Checklist completo V2.3

```mermaid
mindmap
  root((V2.3 Blue Team))
    Fundação
      UFW 4 comandos
      fail2ban jails
      Script Unifi API MAC watch
    IDS Suricata
      Instalação af-packet
      Regras customizadas E-Racing
      Integração journald
      Teste das regras
    SIEM Wazuh
      Manager no servidor
      Agent servidor
      Agent Jetson
      Dashboard OpenSearch
      Alertas MITRE ATT&CK
      Correlação Suricata+fail2ban
    Terminais e Métricas
      Cockpit servidor :9090
      Cockpit Jetson :9090
      Netdata servidor :19999
      Netdata Jetson :19999
      Plugin HTB classes
    Resposta a Incidentes
      emergencia.sh
      revoga_jwt.sh
      isolamento_unifi.sh
      forense.sh
      Playbooks escritos e testados
    Hardening
      UFW produção
      SSH porta 2222
      PermitRootLogin no
      bcrypt cost auditado
      Teste simulação de ataque
```

---

## 5. Ordem de Implementação Integrada

```mermaid
flowchart TD
    START(["🚀 Início\napós V2.1 estável"]) --> A

    subgraph V22["📦 TelemetriaV2.2 — Exportação MoTeC"]
        A["Pesquisa formato .ld\nGitHub + hex editor\n(3 dias)"]
        B["Encoder Rust\nbinrw / byteorder\n(5 dias)"]
        C["Tabela sessions\n+ endpoint /convert\n(3 dias)"]
        D["Background task\ntokio::spawn\n(2 dias)"]
        E["Frontend\nbotão admin + downloads\n(3 dias)"]
        F["QA MoTeC i2\n(2 dias)"]
        A --> B --> C --> D --> E --> F
    end

    subgraph V23["🔒 TelemetriaV2.3 — Blue Team"]
        G["UFW + fail2ban\n(2 dias)"]
        H["Script Unifi API\nMAC watch\n(2 dias)"]
        I["Suricata\nregras customizadas\n(4 dias)"]
        J["Wazuh Manager\n+ Agents\n(5 dias)"]
        K["Cockpit + Netdata\n(3 dias)"]
        L["Scripts resposta\nemergencia.sh etc\n(3 dias)"]
        M["Hardening\n+ testes\n(3 dias)"]
        G --> H --> I --> J --> K --> L --> M
    end

    F --> G
    M --> END(["✅ V2.3 completa\nPronta para competição"])

    style V22 fill:#1a3a1a,stroke:#2d7a2d
    style V23 fill:#1a1a3a,stroke:#2d2d7a
```

### Dependências entre as features

| Dependência | Motivo |
|-------------|--------|
| V2.2 precisa de V2.1 estável | O endpoint `/convert` lê do TimescaleDB e SQLite que já existem na V2.1 |
| UFW (V2.3) antes de qualquer coisa | Toda V2.3 sem firewall ativo é insegura por design |
| Suricata antes de Wazuh | O Wazuh consome logs do Suricata — sem Suricata os alertas são incompletos |
| emergencia.sh depende de UFW | O script bane IPs via UFW |

---

## 6. Riscos e Mitigações

```mermaid
quadrantChart
    title Riscos por Impacto × Probabilidade
    x-axis Baixa Probabilidade --> Alta Probabilidade
    y-axis Baixo Impacto --> Alto Impacto
    quadrant-1 Crítico — Mitigar agora
    quadrant-2 Importante — Planejar
    quadrant-3 Baixo — Monitorar
    quadrant-4 Médio — Preparar

    Formato .ld incompatível com MoTeC i2: [0.5, 0.9]
    Wazuh Manager usa RAM demais: [0.6, 0.7]
    HD Toshiba falha (como o WD): [0.2, 0.9]
    Suricata falsos positivos: [0.7, 0.4]
    Jetson sem clock no boot: [0.8, 0.3]
    Serveo.net cai na competição: [0.3, 0.5]
    fail2ban bane IP legítimo: [0.5, 0.5]
```

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| **Formato `.ld` incompatível** | Média | Alto | Pesquisar referências no GitHub antes de implementar. Usar arquivo `.ld` real como referência hex. Testar no MoTeC i2 a cada iteração do encoder. |
| **Wazuh usa RAM demais na competição** | Média | Alto | Medir consumo com `free -h` antes de levar. Se disputar recursos com telemetria, desabilitar Wazuh Manager apenas no systemd e manter só fail2ban + Suricata. |
| **Suricata falsos positivos** | Alta | Médio | Testar todas as regras customizadas antes da corrida. Usar `threshold` nas regras para evitar alertas a cada frame. |
| **fail2ban bane IP legítimo** | Média | Médio | Adicionar IPs da equipe na whitelist. Script para verificar antes da corrida: `fail2ban-client status`. |
| **Jetson perde clock no boot** | Alta | Baixo | Script no dispatcher NetworkManager que pega data via `curl HTTP` (sem UDP). Documentado no Dia 9. |
| **HD falha durante corrida** | Baixa | Alto | Backup SQLite edge na própria Jetson. Verificar SMART do Toshiba antes da competição: `smartctl -a /dev/sda`. |

---

> **Nota final:** Este planejamento é um documento vivo. À medida que as features forem implementadas, atualizar os diagramas de status (✅/🔄/❌) e registrar no relatório do dia correspondente (Dia 10, 11, etc.) seguindo o padrão estabelecido nos Dias 1–9.

---

*Documento criado em Junho de 2026 — E-Racing Ultra Blaster Telemetria V2*  
*UNICAMP — Faculdade de Engenharia Mecânica*  
*TelemetriaV2.2 + V2.3 — Planejamento completo*
