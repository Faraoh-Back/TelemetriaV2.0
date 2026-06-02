# RELATÓRIO GERAL — TELEMETRIA V2.1 E-RACING ULTRA BLASTER

**Data:** 24 de Maio de 2026  
**Status:** V2.1 em progresso — Dashboard novo integrado, vídeo parcialmente funcional, dados CAN chegando ao frontend

---

## PARTE 1 — RESUMO EXECUTIVO DO DIA

O Dia 9 foi o dia mais amplo e multidisciplinar do projeto até agora. Foram trabalhadas simultaneamente cinco frentes distintas: infraestrutura de rede (migração para eduroam com IP conflitante), pipeline de vídeo (ZED 2i → GStreamer → servidor → WebRTC → browser), QoS HTB, dashboard SolidJS (integração ao servidor), e dados CAN no frontend (migração de JSON para frames binários). O dia terminou com o dashboard novo rodando em produção, dados CAN chegando ao frontend via WebSocket binário, e o pipeline de vídeo transmitindo com imagem visível no browser — mas ainda com FPS baixo a investigar.

---

## PARTE 2 — LINHA DO TEMPO DETALHADA

### 2.1 — Infraestrutura: A Batalha pelo IP (resolução do problema herdado do Dia 8)

**Problema:** O servidor Ubuntu e um modem TP-Link antigo disputavam o mesmo IP `143.106.207.95` na rede eduroam. O resultado era: às vezes o SSH entrava no Ubuntu, às vezes no modem (que oferecia criptografia obsoleta `diffie-hellman-group1-sha1` e causava erro). O switch da Unicamp sofria MAC Flapping — ficava alternando o destino dos pacotes entre os dois dispositivos, congelando conexões.

**Solução em etapas:**

1. **Mudança da porta SSH de 22 para 2222** — mesmo que o modem "roubasse" o IP, não responderia na porta 2222, deixando o Ubuntu disponível.
2. **IP estático no Netplan** — o servidor deixou de ser passivo (DHCP) e passou a reivindicar ativamente o IP. Corrigimos erros de indentação YAML no processo.
3. **Modo Bridge no modem TP-Link** — o golpe decisivo. O modem parou de fazer NAT e de interceptar portas. Virou um conversor de sinal passivo. Precisou configurar VPI 0 / VCI 35 para sincronizar com a central da Unicamp. Desabilitamos o DHCP do modem.
4. **dnsmasq no servidor** — o Ubuntu passou a distribuir IPs para dispositivos Wi-Fi conectados ao modem.

**Resultado:** servidor com IP `143.106.207.21` estável, sem conflito, Jetson em `143.106.207.93`, notebook em `143.106.207.23`. Todos na mesma rede eduroam.

---

### 2.2 — QoS HTB (Traffic Control)

Implementamos controle de banda em ambos os nodos para garantir que a telemetria CAN nunca seja prejudicada pelo vídeo.

**Arquitetura de filas (3 classes HTB):**

```
Classe 1 — Crítico (5 Mbit/s garantido) → TCP :8080 e WS :8081
Classe 2 — Tempo real (2 Mbit/s garantido) → UDP :5004/:5005 (áudio futuro)
Classe 3 — Bulk (1 Mbit/s garantido, 20 Mbit/s teto) → UDP :5600 e RTSP :8554
```

**Implementação:**
- Script `/etc/eracing/setup_qos.sh` criado em ambos os nodos
- Interface `enp4s0f1` no servidor (novo hardware), `eth0` na Jetson
- Serviço `eracing-qos.service` com `Type=oneshot` sobe no boot

**Validação:** `tc -s class show dev enp4s0f1` mostrou a classe 3 processando tráfego de vídeo (265KB, 636K pacotes) sem drops na telemetria. O QoS estava funcionando corretamente — confirmado que o problema de FPS no vídeo não era o QoS cortando pacotes.

---

### 2.3 — Pipeline de Vídeo: ZED 2i → GStreamer → servidor → WebRTC → browser

Esta foi a frente mais complexa do dia. Foram necessárias múltiplas iterações para encontrar a arquitetura que funciona.

#### 2.3.1 — Validação do NVENC

**Problema inicial:** primeira tentativa falhou com `Cannot identify device '/dev/video0'` — câmera não estava conectada fisicamente.

**Após conectar:** pipeline com NVENC testado:
```
v4l2src → videoconvert → videocrop → nvvidconv → NV12(NVMM) → nvv4l2h264enc → rtph264pay → udpsink
```
O log confirmou `===== NvVideo: NVENC =====` e `H264: Profile = 66` — encoder de hardware ativo.

**Problema de latência:** ao comparar com o pipeline do Dia 7 (x264enc software), a latência ficou muito maior (~3-7 segundos) com o NVENC. Investigação via `tegrastats` revelou que o NVENC ficava em frequência mínima (115 MHz) e sumia do log — o `rtspclientsink` estava bloqueando o encoder por TCP backpressure. Mesmo com `jetson_clocks` e `nvpmodel -m 0` (modo máxima performance), o problema persistia com NVENC + rtspclientsink.

**Decisão:** para o streaming de vídeo ao vivo, mantemos x264enc (software) que provou funcionar a ~200ms de latência no Dia 7. O NVENC fica reservado para testes futuros quando resolvermos o problema de sincronização.

#### 2.3.2 — Criação do zed-stream.service na Jetson

```ini
ExecStart=/bin/bash -c '/usr/bin/gst-launch-1.0 \
  v4l2src device=/dev/video0 io-mode=2 ! \
  "video/x-raw,format=YUY2,width=2560,height=720,framerate=60/1" ! \
  videoconvert ! videocrop right=1280 ! \
  nvvidconv ! "video/x-raw(memory:NVMM),format=NV12,width=1280,height=720" ! \
  nvv4l2h264enc bitrate=5000000 iframeinterval=30 insert-sps-pps=true preset-level=1 ! \
  rtph264pay config-interval=-1 pt=96 ! \
  udpsink host=${SERVER_IP} port=${SERVER_UDP_PORT} sync=false async=false'
```

Variáveis centralizadas em `/etc/eracing/config.env` — quando o IP do servidor mudar, altera só esse arquivo.

#### 2.3.3 — Problema: rtspclientsink vs udpsink com NVENC

Medindo FPS em cada ponto da cadeia:
- **Na Jetson (câmera → fakesink):** 30fps perfeitos ✅
- **Na Jetson com NVENC → rtspclientsink:** ~6fps ❌
- **Na Jetson com NVENC → udpsink:** ~6fps também ❌

O gargalo estava claramente no encoder NVENC travando por causa do sink. O x264enc não tem esse problema pois opera de forma diferente na cadeia GStreamer.

#### 2.3.4 — Arquitetura final: Jetson UDP → ffmpeg → mediamtx → WebRTC

Após muitas iterações (tentativas com SRT, rtspclientsink, e variantes), chegamos à arquitetura funcional:

```
Jetson (NVENC ou x264enc) → UDP :5601 → ffmpeg (cam.sdp) → RTSP :8554/cam → mediamtx → WebRTC :8555 → browser
```

**Componentes:**

1. **`zed-stream.service`** na Jetson: captura via V4L2, encoda com NVENC, manda RTP UDP para porta 5601 do servidor
2. **`udp-to-rtsp.service`** no servidor: ffmpeg com arquivo SDP converte UDP RTP → RTSP publicado no mediamtx
3. **`mediamtx`** no servidor: recebe RTSP e serve WebRTC na porta 8555
4. **Browser**: acessa `http://143.106.207.21:8555/cam` via WebRTC

**Arquivo `/etc/eracing/cam.sdp`:**
```
v=0
m=video 5601 RTP/AVP 96
c=IN IP4 143.106.207.21
a=rtpmap:96 H264/90000
a=fmtp:96 packetization-mode=1
```

**Problema com Firefox ESR:** o Firefox ESR não suporta H264 via WebRTC por padrão (restrição de licença). Solução: usar Chromium, que suporta H264 WebRTC nativamente.

**Resultado final:** imagem aparece no Chromium com latência aceitável. FPS ainda baixo — investigação em andamento (ver Parte 4).

#### 2.3.5 — video-backup.service e rtsp-relay.service

- **`video-backup.service`:** recebe RTSP do relay e grava MKV em arquivos de 5 minutos em `/var/eracing/video/`
- **`rtsp-relay.service`:** relay Python GstRTSPServer para compatibilidade com outros clientes
- **`mediamtx.service`:** atualizado para v1.11.3 com `writeQueueSize: 2048`

---

### 2.4 — Crise de Hardware: Troca de HD e Migração para Toshiba

**Problema:** O HD WD 2TB do servidor apresentou setores defeituosos:
```
Current_Pending_Sector: 28
Offline_Uncorrectable: 3
Reallocated_Sector_Ct: 0 (sem reserva disponível)
```

**Sintomas:** boot instável, servidor caindo em initramfs, erros de I/O no log. O HD estava morrendo.

**Solução — migração para Toshiba 1TB:**
1. Criação de partições no Toshiba via `sgdisk` (EFI + ext4)
2. Clone completo via `rsync` excluindo `/proc`, `/sys`, `/dev`, `/run`
3. Atualização do fstab com novos UUIDs (`4cf5fc07...`)
4. Instalação do GRUB no Toshiba via chroot com montagem de `/dev`, `/proc`, `/sys`
5. Resolução de problema com pastas `/run` e `/run/lock` ausentes (criadas manualmente pelo pendrive)

**Dificuldades:**
- WSL no Windows não conseguia montar o HD ext4 do Ubuntu para editar antes da migração
- Tentativas com DiskGenius, Ext2Fsd (versão free não permite escrita), WSL2 (bloqueado por disco em uso pelo Windows)
- Solução: boot por pendrive Ubuntu live, montagem manual e edição dos arquivos
- Interface de rede mudou de `enp1s0` para `enp4s0f1` no novo hardware — netplan precisou ser corrigido
- Relógio voltava ao ano 2000 após reboot (problema de NTP bloqueado pela eduroam)

**Resultado:** servidor rodando estável no Toshiba, `df -h /` mostra 845GB livres, HD saudável (zero setores defeituosos).

---

### 2.5 — Dashboard SolidJS: Integração ao Servidor

#### 2.5.1 — Merge da branch feat/UIDashboard para TelemetriaV2.1

O dashboard novo (criado pelo amigo da equipe) estava na branch `feat/UIDashboard`. Fizemos o merge seletivo apenas da pasta `telemetry-server/static/`:

```bash
git checkout TelemetriaV2.1
git checkout feat/UIDashboard -- telemetry-server/static/
```

Houve conflitos de rebase que foram resolvidos usando `git checkout --theirs` para os arquivos da pasta static.

#### 2.5.2 — Estrutura do dashboard

O dashboard é uma aplicação SolidJS completa com:
- **Web Worker** isolado para receber frames WebSocket sem bloquear a UI
- **CircularBuffer** por sinal (3.900 amostras = ~30s a 130Hz)
- **LTTB** (Largest-Triangle-Three-Buckets) para downsample antes de renderizar
- **uPlot** para gráficos de alta performance em Canvas
- **StatusBar** com cards de sinais fixos (temperaturas, tensões, potências, faults)
- **Cockpit** com gauges Canvas, painel de vídeo e mapa de pista
- **HistoryReferenceChart** para análise pós-corrida
- Estados `idle` / `live` / `stopped`

#### 2.5.3 — Problemas de build e resolução

**Problema 1:** `vite.config.js` referenciava `index.vite.html` inexistente.  
**Solução:** removida a linha `rollupOptions.input` do vite.config.js.

**Problema 2:** arquivos soltos `Gauge.jsx`, `MotecChart.jsx`, `StatusBar.jsx` na pasta `components/` com conteúdo errado (código do App.jsx duplicado), sobrescrevendo os componentes reais nas subpastas.  
**Solução:** `rm` dos arquivos soltos — os componentes reais estão em subpastas (`Gauge/`, `MotecChart/`, `StatusBar/`).

**Problema 3:** Node.js 12 no servidor incompatível com Vite 8.  
**Solução:** instalação do nvm + Node 20 via DoH (DNS sobre HTTPS para contornar bloqueio UDP 53 da eduroam).

**Problema 4:** `App.jsx` importava `./components/StatusBar.jsx` (caminho errado).  
**Solução:** atualização dos imports para `./components/StatusBar/StatusBar.jsx` e equivalentes.

**Problema 5:** `serverConfig.js` estava usando `localhost:8081` em desenvolvimento.  
**Solução:** a configuração já usava `window.location.hostname` corretamente — apenas o `App.jsx` antigo tinha o localhost hardcoded.

#### 2.5.4 — Servidor Rust servindo o dashboard

O servidor Rust usava `include_str!("../static/index.legacy.html")` para embutir o HTML no binário. Mudamos para `include_str!("../static/dist/index.html")` e adicionamos uma função `serve_static_file()` para servir os assets (JS, CSS, SVG) da pasta `dist/`.

#### 2.5.5 — LoginScreen integrada

O fluxo de autenticação foi implementado no `App.jsx`:
1. Verifica token JWT válido no localStorage ao montar
2. Se não tiver, exibe `LoginScreen`
3. Login chama `POST /login` no servidor
4. Recebe JWT, conecta WebSocket com `?token=...`
5. Modo UI (sem backend) disponível para trabalho visual

---

### 2.6 — Frames Binários: Migração de JSON para Binário no WebSocket

**Problema descoberto:** o frontend (worker.js) esperava frames binários de 20 bytes exatos no WebSocket, mas o servidor estava mandando JSON.

**Formato correto:**
```
Bytes 0–3:   u32 little-endian → can_id
Bytes 4–11:  f64 little-endian → timestamp (Unix epoch segundos)
Bytes 12–19: u8×8              → payload CAN raw (8 bytes)
```

**Mudanças no main.rs:**
1. Canal broadcast mudado de `broadcast::channel::<String>` para `broadcast::channel::<Vec<u8>>`
2. Todas as assinaturas de funções atualizadas para `Sender<Vec<u8>>`
3. Loop de broadcast substituído — em vez de `serde_json::to_string(signal)`, agora monta frame binário de 20 bytes com `copy_from_slice` das partes `can_id`, `timestamp` e `raw_data_owned`
4. Nova função `send_ws_binary_frame()` adicionada — usa opcode `0x82` (binary) em vez de `0x81` (text)
5. Loop WebSocket atualizado para chamar `send_ws_binary_frame` em vez de `send_ws_text_frame`

**Resultado:** dashboard abre, faz login, clica em "Iniciar coleta" e os cards da StatusBar passam a mostrar valores dos sinais CAN em tempo real. Gráficos funcionando.

---

### 2.7 — Tentativas com ZED SDK

Ao tentar usar o ZED SDK para streaming nativo (que seria mais eficiente), encontramos incompatibilidades:

**ZED 2i (PID f880):** nenhuma versão do SDK 4.x suporta esse Product ID. O SDK 5.x suportaria, mas requer JetPack 6 (L4T 36.x), incompatível com o Xavier AGX que vai até JetPack 5 (L4T 35.x).

**Tentativa SDK 4.0.8 (L4T 35.2):** falhou com `libnvbuf_utils.so.1.0.0: No such file or directory`. A lib foi renomeada para `libnvbufsurface` no L4T 35.6. Tentativa de symlink não funcionou pois as APIs internas também mudaram.

**ZED original (PID f582, S/N 2183):** SDK 4.2.5 detecta o dispositivo USB mas falha com `INVALID CALIBRATION FILE`. O arquivo `SN2183.conf` disponível no site da Stereolabs contém valores genéricos (distorção zero), não os parâmetros reais de fábrica.

**Tentativa sem calibração (`camera_disable_self_calib = True`):** SDK ignora o parâmetro e ainda valida o arquivo.

**Regras udev ausentes:** o SDK não instala automaticamente regras udev. Adicionado `/etc/udev/rules.d/99-zed.rules` com `SUBSYSTEM=="usb", ATTRS{idVendor}=="2b03", MODE="0666", GROUP="zed"`.

**Conclusão:** para esta Jetson e estas câmeras, o SDK não é viável. O GStreamer V4L2 é a única abordagem funcional para streaming de vídeo agora.

---

### 2.8 — Configuração Central `/etc/eracing/config.env`

Para evitar que IPs hardcoded causem falhas silenciosas quando a rede muda, criamos um arquivo de configuração central em ambos os nodos:

**Na Jetson:**
```bash
SERVER_IP=143.106.207.21
SERVER_UDP_PORT=5600
SERVER_TCP_PORT=8080
SERVER_WS_PORT=8081
```

Todos os serviços (`zed-stream.service`, `telemetry-edge.service`) usam `EnvironmentFile=/etc/eracing/config.env` e referenciam `${SERVER_IP}` nas variáveis de ambiente. Quando o IP do servidor mudar, basta editar um único arquivo.

---

## PARTE 3 — STATUS ATUAL DO PROJETO

### O que está FUNCIONANDO ✅

| Componente | Status | Observação |
|---|---|---|
| Servidor Ubuntu no Toshiba | ✅ | HD saudável, 845GB livres |
| IP estável na eduroam | ✅ | 143.106.207.21 sem conflito |
| telemetry.service | ✅ | TCP :8080 + HTTP+WS :8081 |
| PostgreSQL + TimescaleDB | ✅ | Dados CAN persistidos |
| SQLite histórico | ✅ | Backup permanente |
| Dashboard SolidJS | ✅ | Build em produção no servidor |
| Login JWT no dashboard | ✅ | POST /login + WebSocket autenticado |
| Frames binários WS | ✅ | 20 bytes — frontend decodifica CAN |
| Dados CAN no frontend | ✅ | Cards StatusBar atualizando em tempo real |
| Gráficos uPlot | ✅ | MotecChart funcionando |
| zed-stream.service | ✅ | NVENC ativo na Jetson |
| video-backup.service | ✅ | Grava MKV de 5min no servidor |
| mediamtx.service | ✅ | WebRTC :8555 ativo |
| udp-to-rtsp.service | ✅ | Converte UDP → RTSP → mediamtx |
| QoS HTB | ✅ | 3 classes em ambos os nodos |
| eracing-qos.service | ✅ | Sobe no boot |
| config.env centralizado | ✅ | IPs centralizados |
| can-interfaces.service | ✅ | CAN físico e virtual |
| can-replay.service | ✅ | Playback de log CAN |
| telemetry-edge.service | ✅ | Enviando frames ao servidor |

### O que está EM ANDAMENTO 🔄

| Componente | Status | Bloqueio |
|---|---|---|
| FPS do vídeo | 🔄 | ~6fps chegando ao browser — gargalo a identificar |
| Integração vídeo no dashboard | 🔄 | `RaceVideoPanel` pronto, falta passar URL WebRTC |
| Relógio da Jetson | 🔄 | Volta a 2000 no reboot — NTP UDP bloqueado |

### O que está PENDENTE ❌

| Componente | Prioridade | Descrição |
|---|---|---|
| FPS vídeo 30fps | 🔴 Alta | Resolver gargalo no pipeline NVENC/udpsink |
| Vídeo no cockpit do dashboard | 🔴 Alta | Passar `rtsp://...` ou URL WebRTC para RaceVideoPanel |
| Relógio automático Jetson | 🟡 Média | Script curl HTTP no boot |
| IP fixo Jetson | 🟡 Média | Aguarda TI da FEM |
| UFW no servidor | 🟡 Média | Liberar portas oficialmente |
| Netdata monitoramento | 🟢 Baixa | Dashboard de rede/HTB |

---

## PARTE 4 — O PROBLEMA DE FPS E O QUE FALTA PARA O VÍDEO NO DASHBOARD

### Diagnóstico do FPS baixo

A câmera produz 30fps perfeitos (medido com `fpsdisplaysink video-sink=fakesink` na Jetson). O ffmpeg no servidor recebe e encaminha ~6fps. A cadeia tem dois elos suspeitos:

1. **`udpsink` com NVENC:** o NVENC em modo preset UltraFast ainda tem latência de buffer interna que o `udpsink` não drena rápido o suficiente.
2. **ffmpeg lendo o SDP:** possível problema de buffer/jitter no ffmpeg ao receber pacotes UDP RTP.

### O que falta para o vídeo aparecer no dashboard

1. **Resolver o FPS** — investigar com `ffmpeg -progress` e `buffer_size` maior
2. **Passar a URL do WebRTC para o Cockpit** — o componente `RaceVideoPanel.jsx` já recebe uma prop `source`. Basta passar `http://143.106.207.21:8555/cam` (URL WebRTC do mediamtx) para a prop no `Cockpit.jsx`
3. **Testar no Chromium** — Firefox ESR não suporta H264 WebRTC sem configuração manual

---

## PARTE 5 — LIÇÕES APRENDIDAS E DECISÕES TÉCNICAS

### Por que usamos ffmpeg em vez de GStreamer no servidor para receber UDP?
O `rtsp-relay.py` (GstRTSPServer) tem buffer interno que adiciona ~2-3 segundos de latência. O ffmpeg com SDP é mais direto e resultou em latência melhor quando funciona.

### Por que o NVENC trava a 6fps com rtspclientsink?
O `rtspclientsink` usa TCP RTSP com controle de fluxo bidirecional. Quando o servidor não consome rápido o suficiente (setup inicial), envia backpressure para o pipeline GStreamer, que trava o encoder. O `udpsink` não tem esse problema mas com NVENC ainda apresenta FPS baixo — investigação pendente.

### Por que o ZED SDK não funciona?
Incompatibilidade em dois eixos: versão do SDK vs versão do JetPack (4.x vs L4T 35.6 com libs renomeadas), e versão do SDK vs versão do hardware da câmera (4.x não reconhece PID f880 da ZED 2i mais nova).

### Por que migramos o WebSocket de JSON para binário?
O frontend foi projetado para alto desempenho — o Web Worker processa frames binários diretamente via `DataView` sem parsing JSON. Com 130 Hz de dados CAN, o JSON serializava e deserializava centenas de strings por segundo desnecessariamente.

---

## PARTE 6 — PRÓXIMOS PASSOS

### Imediato (Dia 10)
1. Investigar FPS baixo no vídeo — testar com `x264enc` + `rtspclientsink` para isolar o problema
2. Integrar URL WebRTC no `Cockpit.jsx` → `RaceVideoPanel`
3. Corrigir relógio da Jetson no boot via script curl HTTP
4. Configurar UFW no servidor

### Curto prazo
5. Testar com CAN real do carro (can0 físico)
6. Testar antenas Unifi em campo (RSSI > -65dBm)
7. Implementar cockpit completo com gauges funcionais

### Médio prazo
8. Implementar mapa de pista no dashboard
9. Comunicação com piloto (EJEAS Q8 + WebRTC áudio)
10. REST API para histórico de sessões

---

*Documento gerado em 24/05/2026 — E-Racing Ultra Blaster Telemetria V2.1*
