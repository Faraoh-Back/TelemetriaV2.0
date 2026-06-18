# RTK com SBG Ellipse 2 — Unicamp E-Racing
**Equipe:** Unicamp E-Racing  
**Sensor INS:** SBG Systems Ellipse 2  
**Base RTK:** NovAtel SMART-V1-2US-RT20  
**Hub:** Servidor Base Ubuntu (`143.106.207.21`)  
**Edge:** NVIDIA Jetson AGX Xavier (`143.106.207.93`)  
**Objetivo:** Reduzir a incerteza de posição do INS de 1–3 metros para ~20 cm via RTK offline, sem dependência de internet

---

## 1. Contexto e decisão

### Situação atual
O SBG Ellipse 2 operando sem correções diferenciais entrega precisão GNSS de **1 a 3 metros**. Para navegação autônoma e análise de trajetória em competição, esse erro é proibitivo.

### Por que RTK sem internet
Os eventos da Formula SAE não garantem conectividade externa no box. A solução adotada é uma **base RTK local própria**, eliminando qualquer dependência de rede externa. A NovAtel SMART-V1-2US-RT20, que estava ociosa na equipe, assume esse papel.

### Por que o RT-20 (20 cm) é suficiente
O modelo `RT20` no nome da NovAtel indica o algoritmo **RT-20® da NovAtel** — RTK single-frequency (L1 apenas), com precisão nominal de **~20 cm**. Isso representa uma melhora de **10–15x** em relação à situação atual, suficiente para análise de trajetória, calibração inercial e dados de posição para o sistema autônomo.

> **Upgrade futuro:** precisão centimétrica real (1–2 cm) exigiria receptor L1/L2 dual-frequency como u-blox F9P (~R$800). Toda a infraestrutura de software permanece igual — apenas troca o hardware de base.

---

## 2. Decodificação do modelo NovAtel

| Segmento | Significado |
|---|---|
| `SMART-V1` | Enclosure com chip OEMV-1 — receptor L1 GPS single-frequency |
| `2US` | 2 portas seriais RS-232, conector padrão US (DB-9) |
| `RT20` | Algoritmo RT-20® habilitado — RTK rover **e base**, precisão ~20 cm |

A NovAtel SMART-V1-2US-RT20 opera nesse sistema exclusivamente como **base estacionária no box**, transmitindo correções RTCM pela porta COM1.

---

## 3. Arquitetura do sistema

```
╔══════════════════════════════════════════════════════════╗
║                        BOX                              ║
║                                                          ║
║  [NovAtel SMART-V1-2US-RT20]                            ║
║   antena com visada livre do céu                        ║
║   survey-in 15–30 min antes da prova                    ║
║   gera RTCM via COM1 @ 115200 baud                      ║
║         │                                                ║
║    cabo DB-9 → USB-Serial                               ║
║         │                                                ║
║  [Servidor Base — 143.106.207.21]                       ║
║   str2str recebe /dev/ttyUSB_novatel                    ║
║   retransmite como TCP server :2101                     ║
║   latência serial: ~1 ms                                ║
║         │                                                ║
╚═════════╪════════════════════════════════════════════════╝
          │
     rede local (cabo Ethernet ou WiFi dedicado)
     TCP — porta 2101
     latência: < 5 ms
     latência total pipeline: 5–15 ms
     limite aceitável Ellipse: 4000 ms  ✓
          │
╔═════════╪════════════════════════════════════════════════╗
║         │              CARRO                             ║
║  [Jetson AGX Xavier — 143.106.207.93]                   ║
║   str2str conecta TCP 143.106.207.21:2101               ║
║   escreve RTCM em /dev/ttyUSB_ellipse_rtcm              ║
║   latência serial saída: ~1 ms                          ║
║         │                          │                     ║
║    RTCM serial                sbgECom serial             ║
║    Port A (in)                Port B (out)               ║
║         │                          │                     ║
║        [SBG Ellipse 2]             │                     ║
║         aplica RT-20               │                     ║
║         solução ~20 cm             │                     ║
║                                    ▼                     ║
║                          sbg_ros2_driver                 ║
║                          publica /sbg/gps_pos            ║
║                          publica /sbg/ekf_nav            ║
║                          publica /sbg/imu_data           ║
║                                    │                     ║
║                          pipeline Rust existente         ║
║                          telemetry-edge ingestion        ║
╚══════════════════════════════════════════════════════════╝
```

### Latência do pipeline RTCM

| Trecho | Protocolo | Latência estimada |
|---|---|---|
| NovAtel → servidor (serial) | RS-232 115200 baud | ~1 ms |
| Servidor → Jetson (rede local) | TCP local | < 5 ms |
| Jetson → Ellipse (serial) | RS-232 115200 baud | ~1 ms |
| **Total** | | **5–15 ms** |
| Limite máximo aceito pelo Ellipse | | **4000 ms** |

O pipeline opera com margem de **200–800x** abaixo do limite crítico.

---

## 4. Integração física — explicação detalhada

Esta seção descreve cada passo físico de como os componentes se conectam entre si, da antena até o Ellipse 2, passando pelo servidor base e pela Jetson.

### 4.1 Visão geral do fluxo físico

```
[Céu]
  │  sinal GPS L1
  ▼
[Antena NovAtel] ← cabo RF coaxial (SMA ou TNC, depende do modelo)
  │
[Corpo NovAtel SMART-V1] — multicabo saindo do receptor:
  ├── COM1 (DB-9 fêmea) ──────────────────────────────────────────────────────┐
  ├── COM2 (DB-9 fêmea) — livre                                               │
  ├── BATT+ (fio vermelho) → 12V (fusível 5A obrigatório)                     │
  └── BATT- (fio preto)   → GND                                               │
                                                                               │ cabo DB-9 macho → USB-A
                                                                               │ (adaptador serial USB-RS232)
                                                                               ▼
                                                              [Servidor Base — Ubuntu]
                                                              /dev/ttyUSB_novatel (porta identificada via udev)
                                                              processo str2str lendo serial @ 115200
                                                              retransmitindo como TCP server :2101
                                                                               │
                                                              ─────────────────┤ rede local Ethernet ou WiFi
                                                                               │ IP fixo servidor: 143.106.207.21
                                                                               │ porta TCP: 2101
                                                                               ▼
                                                              [Jetson AGX Xavier]
                                                              processo str2str conectado como cliente TCP
                                                              recebe stream RTCM
                                                              escreve em /dev/ttyUSB_ellipse_rtcm @ 115200
                                                                               │
                                                              ─────────────────┤ cabo DB-9 macho → USB-A
                                                                               │ (segundo adaptador serial)
                                                                               ▼
                                                              [SBG Ellipse 2 — Port A]
                                                              recebe RTCM (entrada de correções)
                                                              Port B (saída sbgECom) → terceiro cabo USB-Serial
                                                              → /dev/ttyUSB_ellipse_ecom na Jetson
                                                              → sbg_ros2_driver lê Port B e publica tópicos ROS2
```

### 4.2 Hardware necessário

| Item | Status | Detalhe |
|---|---|---|
| NovAtel SMART-V1-2US-RT20 | ✅ disponível | estava ociosa |
| Cabo DB-9 fêmea → USB-A (adaptador serial) | ⚠️ verificar | para COM1 da NovAtel → servidor base |
| Cabo DB-9 fêmea → USB-A (adaptador serial) | ⚠️ verificar | para Port A do Ellipse → Jetson (RTCM in) |
| Cabo DB-9 fêmea → USB-A (adaptador serial) | ⚠️ verificar | para Port B do Ellipse → Jetson (sbgECom out) |
| Cabo Ethernet ou roteador WiFi dedicado | ⚠️ definir | link box ↔ carro |
| Fonte 12V para a NovAtel | ⚠️ verificar | requer 8–36 VDC, fusível 5A |
| Tripé ou suporte para antena NovAtel | ⚠️ providenciar | visada livre do céu no box |

> **Atenção aos adaptadores USB-Serial:** existem modelos baratos com chip CH340 e modelos mais confiáveis com chip FTDI FT232. Para uso em campo com reconexão frequente, prefira FTDI — são mais estáveis e têm suporte melhor no Linux. Verifique se os adaptadores já disponíveis na equipe são do mesmo chip antes de misturá-los, pois a ordem de detecção pelo kernel pode variar.

### 4.3 Conexão física da NovAtel

A NovAtel SMART-V1 tem um multicabo saindo do corpo do receptor com os seguintes conectores:

```
NovAtel SMART-V1 multicabo:
├── COM1 (DB-9 fêmea) → cabo serial USB → /dev/ttyUSB_novatel no servidor base
├── COM2 (DB-9 fêmea) → livre (não utilizado nesse sistema)
├── BATT+ (fio vermelho) → 12V (fusível 5A obrigatório)
└── BATT- (fio preto)  → GND
```

**Pinagem COM1 (DB-9 fêmea — padrão RS-232):**

| Pino | Sinal | Direção |
|---|---|---|
| 2 | RXD | NovAtel recebe |
| 3 | TXD | NovAtel transmite (RTCM sai aqui) |
| 5 | GND | referência |

No adaptador DB-9 → USB, apenas pinos 2, 3 e 5 são necessários. A maioria dos adaptadores USB-Serial já conecta esses três automaticamente.

### 4.4 Conexão física do Ellipse 2

O Ellipse 2 tem duas portas seriais relevantes:

```
SBG Ellipse 2:
├── Port A (RS-232) → cabo serial USB → /dev/ttyUSB_ellipse_rtcm na Jetson
│   configurado como: RTCM Input (recebe correções da NovAtel)
└── Port B (RS-232) → cabo serial USB → /dev/ttyUSB_ellipse_ecom na Jetson
    configurado como: sbgECom Output (envia dados INS ao driver ROS2)
```

**Por que duas portas separadas no Ellipse:** o Ellipse 2 não multiplexa RTCM e sbgECom na mesma porta. Port A é dedicada à entrada de dados externos (RTCM, NTRIP) e Port B à saída de dados INS. Tentar usar uma única porta causaria conflito de protocolo e o sensor ignoraria as correções ou pararia de responder ao driver.

### 4.5 Identificação das portas seriais no Linux

Após conectar os adaptadores USB-Serial, identificar as portas:

```bash
# Listar portas seriais disponíveis
ls /dev/ttyUSB*

# Ver qual dispositivo é qual (pelo fabricante do adaptador)
udevadm info /dev/ttyUSB0 | grep -i "id_vendor\|id_model"

# Criar regras udev para nomes fixos (evitar ttyUSB0/ttyUSB1 trocarem ao religar)
# No servidor base:
echo 'SUBSYSTEM=="tty", ATTRS{idVendor}=="XXXX", ATTRS{idProduct}=="YYYY", SYMLINK+="ttyUSB_novatel"' \
  | sudo tee /etc/udev/rules.d/99-novatel.rules

# Na Jetson:
echo 'SUBSYSTEM=="tty", ATTRS{idVendor}=="XXXX", ATTRS{idProduct}=="YYYY", SYMLINK+="ttyUSB_ellipse_rtcm"' \
  | sudo tee /etc/udev/rules.d/99-ellipse-rtcm.rules
echo 'SUBSYSTEM=="tty", ATTRS{idVendor}=="ZZZZ", ATTRS{idProduct}=="WWWW", SYMLINK+="ttyUSB_ellipse_ecom"' \
  | sudo tee /etc/udev/rules.d/99-ellipse-ecom.rules

sudo udevadm control --reload-rules
```

> Substituir `XXXX`, `YYYY`, `ZZZZ`, `WWWW` pelos valores reais retornados pelo `udevadm info`. Isso garante que as portas sempre tenham o mesmo nome independente da ordem de boot ou reconexão.

**Por que isso importa em campo:** sem regras udev, ao religar um cabo USB a ordem de enumeração pelo kernel é não determinística. O que era `ttyUSB0` pode virar `ttyUSB1` depois de um boot. Os serviços systemd apontam para nomes fixos (`/dev/ttyUSB_novatel`, `/dev/ttyUSB_ellipse_rtcm`), então sem as regras os serviços iniciam mas não encontram o dispositivo correto — falha silenciosa difícil de diagnosticar em campo.

### 4.6 Alimentação da NovAtel

A NovAtel SMART-V1 aceita 8–36 VDC. Em competição, a fonte mais prática é:

- **Opção A:** bateria de 12V do carro via fusível de 5A no fio BATT+
- **Opção B:** fonte DC de bancada 12V/3A no box (mais estável, evita ruído elétrico do alternador)

O fusível de 5A no fio vermelho é obrigatório — o SMART-V1 não tem proteção interna contra curto.

---

## 5. Integração de software — explicação detalhada

### 5.1 Configuração única da NovAtel (pré-evento)

Conectar ao CDU via notebook (Windows) ou minicom (Linux) na COM1, **115200 baud**:

```bash
# Linux — abrir console serial
sudo minicom -D /dev/ttyUSB_novatel -b 115200
```

**Passo 1 — Reconfigurar baud rate (padrão de fábrica é 9600, deve ser feito em 9600 primeiro):**
```
# Conectar primeiro em 9600 baud
SERIALCONFIG COM1 115200
SAVECONFIG
# Reconectar em 115200 baud
```

**Passo 2 — Configurar porta de saída RTCM:**
```
INTERFACEMODE COM1 NONE RTCM
```

**Passo 3 — Configurar posição da base (ver Seção 5.1.A e 5.1.B abaixo):**

Existem duas opções para definir a posição da base. A opção B (IBGE-PPP) é recomendada para o kartódromo fixo da UNICAMP e é detalhada logo abaixo.

**Passo 4 — Ativar logs RTCM na COM1:**
```
LOG COM1 RTCMDATA1 ONTIME 1      # correções pseudorange GPS
LOG COM1 RTCMDATA3 ONTIME 10     # posição e parâmetros da base
LOG COM1 RTCMDATA22 ONTIME 10    # parâmetros de antena
```

**Passo 5 — Verificar quando o survey-in convergiu (se usado):**
```
log posavea once
```
Aguardar o campo `pos type` mudar para `FIX`. Nesse momento a base está travada e transmitindo RTCM corretamente.

**Passo 6 — Salvar posição para backup:**
```
log refstationa once
```
Anotar lat/lon/alt retornados. Se o sistema reiniciar durante o evento, usar:
```
FIX POSITION <lat> <lon> <alt>
```
para recuperar sem refazer o survey-in.

**Passo 7 — Verificar RTCM saindo:**
```
log com1 rtcmdata3a once
```
Se retornar dados com coordenadas, a base está operacional.

**Passo 8 — Salvar configuração na flash:**
```
SAVECONFIG
```

---

### 5.1.A Opção A — Survey-in automático (dia do evento, qualquer local)

Usado quando a posição do kartódromo não é conhecida com antecedência ou o evento é em local novo.

```
FIX AUTO 0.5 900
```

Parâmetros: desvio padrão máximo de 0,5 m, tempo mínimo de coleta de 900 s (15 min). A NovAtel coleta pseudodistâncias GPS, calcula sua própria posição por mínimos quadrados e trava quando os dois critérios são satisfeitos simultaneamente.

**Limitação:** a posição resultante tem incerteza de ~1–3 m (qualidade GPS autônomo), que propaga como erro sistemático nas correções RTCM enviadas ao Ellipse. O rover (Ellipse) corrige erros relativos com ~20 cm de precisão em relação à base, mas se a base estiver errada por 2 m, o rover também estará errado por 2 m — porém de forma consistente ao longo da prova, o que é tolerável para análise de trajetória relativa.

---

### 5.1.B Opção B — Posição conhecida via IBGE-PPP (recomendada para o kartódromo fixo)

O IBGE disponibiliza o serviço **IBGE-PPP** gratuitamente. Permite determinar a posição da antena NovAtel com precisão de **2–5 cm**, eliminando o erro sistemático da base.

**Quando fazer:** uma única vez, com a antena na posição definitiva de operação no kartódromo. Depois, a coordenada fica salva no repositório e é inserida via `FIX POSITION` em todos os eventos seguintes no mesmo local.

**Fluxo completo:**

```
1. Posicionar a antena NovAtel exatamente onde ficará em competição
        ↓
2. Deixar a NovAtel coletando dados brutos por 1 hora contínua
   (precisa estar em modo ROVER ou modo RAW logging — ver abaixo)
        ↓
3. Exportar arquivo RINEX da NovAtel
        ↓
4. Enviar para https://www.ibge.gov.br/geociencias/ppp
        ↓
5. Receber coordenadas com precisão ~2–5 cm por e-mail (geralmente em minutos)
        ↓
6. Inserir no FIX POSITION — valor fixo para todos os eventos no mesmo local
```

**Passo a passo detalhado para coleta RINEX na NovAtel:**

```bash
# Conectar ao receptor via minicom em 115200 baud
sudo minicom -D /dev/ttyUSB_novatel -b 115200
```

```
# Configurar logging de dados brutos (observações e navegação)
LOG COM1 RANGEB ONTIME 30         # observações brutas a cada 30 s (formato binário NovAtel)
LOG COM1 RAWEPHEMB ONCHANGED      # efemérides quando mudarem

# Alternativamente, se o receptor suportar log direto em RINEX:
LOG COM1 OBSB ONTIME 30
LOG COM1 NAVB ONCHANGED

SAVECONFIG
```

> A NovAtel SMART-V1/OEMV-1 grava os logs na porta serial. Para capturar em arquivo, redirecionar a saída serial para um arquivo no servidor base durante a 1 hora de coleta:

```bash
# No servidor base — capturar dados brutos para arquivo
stty -F /dev/ttyUSB_novatel 115200 raw
cat /dev/ttyUSB_novatel > /home/ubuntu/novatel_raw_$(date +%Y%m%d_%H%M).bin
# Deixar rodando por 1 hora, depois Ctrl+C
```

**Conversão para RINEX com RTKLIB:**

```bash
# Instalar RTKLIB (se não instalado)
sudo apt install rtklib

# Converter binário NovAtel para RINEX
convbin -r novatel -o novatel_obs.obs -n novatel_nav.nav novatel_raw_YYYYMMDD_HHMM.bin

# Verificar se o arquivo gerado tem pelo menos 1h de observações
head -30 novatel_obs.obs
```

**Envio ao IBGE-PPP:**

1. Acessar https://www.ibge.gov.br/geociencias/ppp
2. Fazer upload do arquivo `.obs` (observações RINEX)
3. Informar e-mail para recebimento do resultado
4. Aguardar retorno (normalmente 5–30 minutos)

O relatório retornado contém as coordenadas em SIRGAS2000 (equivalente ao WGS84 para uso prático) com incerteza na casa dos centímetros.

**Inserindo a posição na NovAtel:**

```
# Conectar em 115200 baud
# Substituir pelos valores retornados pelo IBGE-PPP
FIX POSITION -22.XXXXXX -47.YYYYYY ZZZ.ZZ

# Verificar se foi aceito
log posavea once
# pos type deve mostrar FIXED_POS

# Salvar na flash para persistir após desligamento
SAVECONFIG
```

A partir daqui, nos eventos seguintes no mesmo kartódromo basta religar a NovAtel e o `FIX POSITION` já estará ativo — sem survey-in, sem espera de 15 minutos.

**Comparação das opções:**

| | Opção A (survey-in) | Opção B (IBGE-PPP) |
|---|---|---|
| Erro da base | ~1–3 m | ~2–5 cm |
| Erro do rover (Ellipse) | ~20 cm + viés de 1–3 m | ~20 cm (sem viés) |
| Tempo no dia do evento | 15–30 min de espera | 0 min (posição já salva) |
| Esforço único | nenhum | 1h coleta + envio IBGE |
| Ideal para | eventos em locais novos | kartódromo fixo UNICAMP |

---

### 5.2 Configuração única do Ellipse 2 (sbgCenter — laboratório)

Feito uma vez no laboratório antes de embarcar o sensor:

1. Conectar Ellipse ao notebook via USB
2. Abrir sbgCenter → painel **Assignment**
3. Configurar **Port A → RTCM Input**
4. Configurar **Port B → sbgECom Output**
5. Inserir **lever arm**: distância (X, Y, Z) em metros entre centro de fase da antena GNSS e centro do Ellipse — medir com trena, precisão de milímetros
6. Definir **orientação de montagem** do sensor no carro
7. Salvar na flash

**O que é o lever arm e por que importa:** o Ellipse 2 funde dados da IMU (acelerômetros e giroscópios) com posição GNSS. A fusão assume que o ponto de posição GNSS e o centro da IMU são o mesmo ponto. Se não forem, a discrepância aparece como erro de posição proporcional ao ângulo de rotação do veículo. Para um carro em curva fechada, um lever arm não calibrado de 20 cm pode introduzir erro de posição de vários metros. Medir com cuidado.

---

### 5.3 Serviço no servidor base — rtcm-relay

O `str2str` do RTKLIB lê a porta serial da NovAtel e retransmite o stream RTCM como servidor TCP. Qualquer cliente na rede local que conectar na porta 2101 recebe o stream em tempo real.

Instalar RTKLIB:
```bash
sudo apt install rtklib
```

Criar serviço (padrão `Services/servicosServidor/`):

```ini
# /etc/systemd/system/rtcm-relay.service
[Unit]
Description=RTCM Relay — NovAtel serial to TCP server
After=network.target

[Service]
ExecStart=/usr/bin/str2str \
  -in serial:///dev/ttyUSB_novatel:115200 \
  -out tcpsvr://:2101
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable rtcm-relay
sudo systemctl start rtcm-relay
sudo systemctl status rtcm-relay
```

**Verificar que o stream está chegando (no servidor base):**

```bash
# Ver se o processo está rodando e lendo a serial
sudo journalctl -u rtcm-relay -f

# Testar se o TCP está aberto e transmitindo (em outro terminal)
nc 127.0.0.1 2101 | xxd | head -5
# Deve mostrar bytes RTCM — mensagens começam com D3 (0xD3)
```

---

### 5.4 Serviço na Jetson — rtcm-client

O `str2str` na Jetson conecta ao servidor TCP do box e entrega o stream RTCM via serial para o Port A do Ellipse.

Instalar RTKLIB na Jetson:
```bash
sudo apt install rtklib
```

Criar serviço (padrão `Services/servicosJetson/`):

```ini
# /etc/systemd/system/rtcm-client.service
[Unit]
Description=RTCM Client — TCP box to Ellipse Port A serial
After=network.target

[Service]
ExecStart=/usr/bin/str2str \
  -in tcpcli://143.106.207.21:2101 \
  -out serial:///dev/ttyUSB_ellipse_rtcm:115200
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable rtcm-client
sudo systemctl start rtcm-client
sudo systemctl status rtcm-client
```

**Verificar que o RTCM está chegando no Ellipse:**

```bash
# Ver logs do cliente
sudo journalctl -u rtcm-client -f

# Monitorar bytes saindo pela serial para o Ellipse (deve haver fluxo constante)
sudo cat /dev/ttyUSB_ellipse_rtcm | xxd | head -10
```

---

### 5.5 Integração direta no telemetry-edge — parser sbgECom em Rust

Sem ROS2. O `telemetry-edge` abre `/dev/ttyUSB_ellipse_ecom` diretamente, parseia o protocolo binário sbgECom e ingere os frames no mesmo pipeline que já processa o CAN bus. Zero dependências externas, latência mínima.

#### 5.5.1 Protocolo sbgECom — estrutura do frame

Todo frame sbgECom padrão tem o seguinte layout (little-endian):

```
┌────────┬────────┬─────┬───────┬──────────────┬──────────────┬──────┬─────┐
│ SYNC1  │ SYNC2  │ MSG │ CLASS │   LENGTH (2) │  DATA (var)  │ CRC  │ ETX │
│  0xFF  │  0x5A  │ 1B  │  1B   │   uint16 LE  │  0–4086 B    │  2B  │0x33 │
└────────┴────────┴─────┴───────┴──────────────┴──────────────┴──────┴─────┘
```

- CRC-16 calculado sobre os bytes `MSG..DATA` (inclusive), polinômio `0x8408`, valor inicial `0`.
- Todos os campos multi-byte em little-endian.
- CLASS para mensagens de saída = `0x00` (`SBG_ECOM_CLASS_LOG_ECOM_0`).

#### 5.5.2 Mensagens relevantes para SLAM e telemetria

| Mensagem | MSG ID | Payload | Uso |
|---|---|---|---|
| `SBG_ECOM_LOG_STATUS` | 0x01 | 27 B | Health geral, status das portas, aiding ativo |
| `SBG_ECOM_LOG_UTC_TIME` | 0x02 | 33 B | Conversão timestamp interno → UTC/GPS ToW |
| `SBG_ECOM_LOG_IMU_SHORT` | 0x16 (22) | 32 B | Aceleração + gyro em int32 com escala fixa — **preferir sobre IMU_DATA** |
| `SBG_ECOM_LOG_EKF_EULER` | 0x06 | 32 B | Roll, pitch, yaw + 1σ + solution status |
| `SBG_ECOM_LOG_EKF_QUAT` | 0x07 | 36 B | Quaternion W,X,Y,Z + 1σ + solution status |
| `SBG_ECOM_LOG_EKF_NAV` | 0x08 | 72 B | Posição NED (lat/lon/alt double) + velocidade NED + 1σ + solution status |
| `SBG_ECOM_LOG_EKF_VEL_BODY` | 0x36 (54) | 32 B | Velocidade no frame do veículo (X=frente, Y=direita, Z=baixo) |
| `SBG_ECOM_LOG_EKF_ROT_ACCEL_BODY` | 0x34 (52) | 32 B | Aceleração + rotation rates corrigidos pelo EKF no frame do corpo — **ideal para SLAM** |
| `SBG_ECOM_LOG_GPS1_POS` | 0x0E (14) | 59 B | Posição GNSS bruta com tipo RTK (FLOAT/INT) + DIFF_AGE |
| `SBG_ECOM_LOG_GPS1_VEL` | 0x0D (13) | 44 B | Velocidade GNSS NED + course |

> **Por que `IMU_SHORT` e não `IMU_DATA`:** `IMU_DATA` (ID 0x03) está **deprecated** desde sbgECom 5.x. `IMU_SHORT` usa int32 com escala fixa (1 048 576 LSB/m·s⁻² e 67 108 864 LSB/rad·s⁻¹) que preserva resolução sem ponto flutuante no caminho crítico.

> **Por que `EKF_ROT_ACCEL_BODY` para SLAM:** diferentemente do `IMU_SHORT` que dá aceleração bruta, o `EKF_ROT_ACCEL_BODY` já tem gravidade e rotação terrestre removidas pelo filtro. É a entrada direta para integração de pre-integration IMU em frameworks de SLAM (LIO-SAM, FAST-LIO2).

#### 5.5.3 Conversão IMU_SHORT para unidades físicas

```
# Aceleração
accel_m_s2 = accel_lsb as f32 / 1_048_576.0

# Gyro — verificar flag SBG_ECOM_IMU_GYROS_USE_HIGH_SCALE (bit 10 do IMU_STATUS)
if imu_status & (1 << 10) != 0 {
    rate_rad_s = rate_lsb as f32 / 12_304_174.0   # high range (>1833°/s)
} else {
    rate_rad_s = rate_lsb as f32 / 67_108_864.0   # standard
}

# Temperatura
temp_c = temp_lsb as f32 / 256.0
```

#### 5.5.4 Decodificação do SOLUTION_STATUS (campo compartilhado)

O campo `SOLUTION_STATUS` (uint32) aparece em EKF_EULER, EKF_QUAT, EKF_NAV, EKF_VEL_BODY, EKF_ROT_ACCEL_BODY:

```
bits [0–3]  SOLUTION_MODE:
  0 = UNINITIALIZED   (dados inválidos)
  1 = VERTICAL_GYRO   (só roll/pitch)
  2 = AHRS            (orientação completa, posição deriva)
  4 = NAV_POSITION    (solução completa — estado desejado em prova)

bit 4   ATTITUDE_VALID
bit 5   HEADING_VALID
bit 6   VELOCITY_VALID
bit 7   POSITION_VALID
bit 11  GPS1_POS_USED   (confirmação de que GNSS está na fusão)
bit 27  ALIGN_VALID     (calibração do sensor convergiu)
```

Para SLAM e telemetria, só processar frames onde `SOLUTION_MODE == 4` e `POSITION_VALID` estiver setado.

#### 5.5.5 Decodificação do GPS1_POS — status RTK

O campo `STATUS_TYPE` (uint32) em `GPS1_POS`:

```
bits [0–5]  GPS_POS_STATUS:
  0 = SOL_COMPUTED (solução válida)

bits [6–11] GPS_POS_TYPE:
  2 = SINGLE       (~1–3 m)
  3 = PSRDIFF      (DGPS)
  6 = RTK_FLOAT    (~20 cm, convergindo)
  7 = RTK_INT      (~2 cm, integer fix — com hardware L1/L2)
```

`RTK_FLOAT` (type == 6) é o estado esperado com o RT-20 (L1 only). Logar esse campo para monitorar saúde do pipeline RTCM.

#### 5.5.6 Estrutura do parser em Rust

Organização sugerida dentro do `telemetry-edge`:

```
src/
├── ins/
│   ├── mod.rs           # re-exporta o módulo
│   ├── frame.rs         # parser de frame sbgECom: sync, CRC, dispatch
│   ├── crc.rs           # CRC-16 poly 0x8408
│   ├── messages.rs      # structs de cada mensagem (EkfNav, ImuShort, etc.)
│   └── reader.rs        # task tokio: lê serial, alimenta o parser, emite eventos
└── main.rs              # já existente — integra reader INS ao lado do SocketCAN loop
```

**`crc.rs` — implementação CRC-16:**

```rust
// Polinômio 0x8408, valor inicial 0 — conforme spec sbgECom
pub fn sbg_crc16(data: &[u8]) -> u16 {
    let mut crc: u16 = 0;
    for &byte in data {
        crc ^= byte as u16;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0x8408;
            } else {
                crc >>= 1;
            }
        }
    }
    crc
}
```

**`frame.rs` — parser de frame com buffer de byte por byte:**

```rust
use crate::ins::crc::sbg_crc16;

const SYNC1: u8 = 0xFF;
const SYNC2: u8 = 0x5A;
const ETX:   u8 = 0x33;
const HEADER_SIZE: usize = 6;   // SYNC1 SYNC2 MSG CLASS LENGTH(2)
const FOOTER_SIZE: usize = 3;   // CRC(2) ETX

#[derive(Debug)]
pub struct SbgFrame {
    pub msg_id: u8,
    pub class:  u8,
    pub data:   Vec<u8>,
}

pub struct FrameParser {
    buf: Vec<u8>,
}

impl FrameParser {
    pub fn new() -> Self {
        Self { buf: Vec::with_capacity(512) }
    }

    /// Alimentar bytes brutos da serial. Retorna frames completos e válidos.
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<SbgFrame> {
        self.buf.extend_from_slice(bytes);
        let mut frames = Vec::new();

        loop {
            // Localizar SYNC1 + SYNC2
            let Some(pos) = self.buf.windows(2).position(|w| w == [SYNC1, SYNC2]) else {
                self.buf.clear();
                break;
            };
            if pos > 0 { self.buf.drain(..pos); }

            if self.buf.len() < HEADER_SIZE { break; }

            let length = u16::from_le_bytes([self.buf[4], self.buf[5]]) as usize;
            let total  = HEADER_SIZE + length + FOOTER_SIZE;

            if self.buf.len() < total { break; }

            // Verificar ETX
            if self.buf[total - 1] != ETX {
                self.buf.drain(..2); // sync inválido, tentar próximo
                continue;
            }

            // CRC cobre MSG..DATA (bytes 2 até HEADER+length-1)
            let crc_data  = &self.buf[2..HEADER_SIZE + length];
            let crc_calc  = sbg_crc16(crc_data);
            let crc_recv  = u16::from_le_bytes([
                self.buf[HEADER_SIZE + length],
                self.buf[HEADER_SIZE + length + 1],
            ]);

            if crc_calc == crc_recv {
                frames.push(SbgFrame {
                    msg_id: self.buf[2],
                    class:  self.buf[3],
                    data:   self.buf[HEADER_SIZE..HEADER_SIZE + length].to_vec(),
                });
            }
            // descarta o frame (válido ou não) e continua
            self.buf.drain(..total);
        }
        frames
    }
}
```

**`messages.rs` — structs das mensagens relevantes:**

```rust
/// SBG_ECOM_LOG_IMU_SHORT (ID 22, 0x16) — 32 bytes
#[derive(Debug, Clone)]
pub struct ImuShort {
    pub timestamp_us:   u32,
    pub imu_status:     u16,
    /// raw LSB — converter com imu_short_accel_to_ms2()
    pub accel_x_lsb:   i32,
    pub accel_y_lsb:   i32,
    pub accel_z_lsb:   i32,
    pub rate_x_lsb:    i32,
    pub rate_y_lsb:    i32,
    pub rate_z_lsb:    i32,
    pub temp_lsb:       i16,
}

impl ImuShort {
    pub fn parse(d: &[u8]) -> Option<Self> {
        if d.len() < 32 { return None; }
        Some(Self {
            timestamp_us:  u32::from_le_bytes(d[0..4].try_into().ok()?),
            imu_status:    u16::from_le_bytes(d[4..6].try_into().ok()?),
            accel_x_lsb:  i32::from_le_bytes(d[6..10].try_into().ok()?),
            accel_y_lsb:  i32::from_le_bytes(d[10..14].try_into().ok()?),
            accel_z_lsb:  i32::from_le_bytes(d[14..18].try_into().ok()?),
            rate_x_lsb:   i32::from_le_bytes(d[18..22].try_into().ok()?),
            rate_y_lsb:   i32::from_le_bytes(d[22..26].try_into().ok()?),
            rate_z_lsb:   i32::from_le_bytes(d[26..30].try_into().ok()?),
            temp_lsb:      i16::from_le_bytes(d[30..32].try_into().ok()?),
        })
    }

    pub fn accel_ms2(&self) -> [f32; 3] {
        let s = 1_048_576.0_f32;
        [self.accel_x_lsb as f32 / s,
         self.accel_y_lsb as f32 / s,
         self.accel_z_lsb as f32 / s]
    }

    pub fn rate_rad_s(&self) -> [f32; 3] {
        // bit 10 = SBG_ECOM_IMU_GYROS_USE_HIGH_SCALE
        let s = if self.imu_status & (1 << 10) != 0 {
            12_304_174.0_f32
        } else {
            67_108_864.0_f32
        };
        [self.rate_x_lsb as f32 / s,
         self.rate_y_lsb as f32 / s,
         self.rate_z_lsb as f32 / s]
    }
}

/// SBG_ECOM_LOG_EKF_NAV (ID 8) — 72 bytes
#[derive(Debug, Clone)]
pub struct EkfNav {
    pub timestamp_us:   u32,
    pub vel_n_ms:       f32,
    pub vel_e_ms:       f32,
    pub vel_d_ms:       f32,
    pub vel_n_acc:      f32,
    pub vel_e_acc:      f32,
    pub vel_d_acc:      f32,
    pub latitude_deg:   f64,
    pub longitude_deg:  f64,
    pub altitude_m:     f64,
    pub undulation_m:   f32,
    pub lat_acc_m:      f32,
    pub lon_acc_m:      f32,
    pub alt_acc_m:      f32,
    pub solution_status: u32,
}

impl EkfNav {
    pub fn parse(d: &[u8]) -> Option<Self> {
        if d.len() < 72 { return None; }
        Some(Self {
            timestamp_us:    u32::from_le_bytes(d[0..4].try_into().ok()?),
            vel_n_ms:        f32::from_le_bytes(d[4..8].try_into().ok()?),
            vel_e_ms:        f32::from_le_bytes(d[8..12].try_into().ok()?),
            vel_d_ms:        f32::from_le_bytes(d[12..16].try_into().ok()?),
            vel_n_acc:       f32::from_le_bytes(d[16..20].try_into().ok()?),
            vel_e_acc:       f32::from_le_bytes(d[20..24].try_into().ok()?),
            vel_d_acc:       f32::from_le_bytes(d[24..28].try_into().ok()?),
            latitude_deg:    f64::from_le_bytes(d[28..36].try_into().ok()?),
            longitude_deg:   f64::from_le_bytes(d[36..44].try_into().ok()?),
            altitude_m:      f64::from_le_bytes(d[44..52].try_into().ok()?),
            undulation_m:    f32::from_le_bytes(d[52..56].try_into().ok()?),
            lat_acc_m:       f32::from_le_bytes(d[56..60].try_into().ok()?),
            lon_acc_m:       f32::from_le_bytes(d[60..64].try_into().ok()?),
            alt_acc_m:       f32::from_le_bytes(d[64..68].try_into().ok()?),
            solution_status: u32::from_le_bytes(d[68..72].try_into().ok()?),
        })
    }

    pub fn solution_mode(&self) -> u8 { (self.solution_status & 0xF) as u8 }
    pub fn position_valid(&self) -> bool { self.solution_status & (1 << 7) != 0 }
    pub fn gps1_pos_used(&self) -> bool  { self.solution_status & (1 << 11) != 0 }
}

/// SBG_ECOM_LOG_EKF_EULER (ID 6) — 32 bytes
#[derive(Debug, Clone)]
pub struct EkfEuler {
    pub timestamp_us:    u32,
    pub roll_rad:        f32,
    pub pitch_rad:       f32,
    pub yaw_rad:         f32,
    pub roll_acc_rad:    f32,
    pub pitch_acc_rad:   f32,
    pub yaw_acc_rad:     f32,
    pub solution_status: u32,
}

impl EkfEuler {
    pub fn parse(d: &[u8]) -> Option<Self> {
        if d.len() < 32 { return None; }
        Some(Self {
            timestamp_us:    u32::from_le_bytes(d[0..4].try_into().ok()?),
            roll_rad:        f32::from_le_bytes(d[4..8].try_into().ok()?),
            pitch_rad:       f32::from_le_bytes(d[8..12].try_into().ok()?),
            yaw_rad:         f32::from_le_bytes(d[12..16].try_into().ok()?),
            roll_acc_rad:    f32::from_le_bytes(d[16..20].try_into().ok()?),
            pitch_acc_rad:   f32::from_le_bytes(d[20..24].try_into().ok()?),
            yaw_acc_rad:     f32::from_le_bytes(d[24..28].try_into().ok()?),
            solution_status: u32::from_le_bytes(d[28..32].try_into().ok()?),
        })
    }
}

/// SBG_ECOM_LOG_EKF_QUAT (ID 7) — 36 bytes
#[derive(Debug, Clone)]
pub struct EkfQuat {
    pub timestamp_us:    u32,
    pub q_w: f32, pub q_x: f32, pub q_y: f32, pub q_z: f32,
    pub roll_acc_rad:    f32,
    pub pitch_acc_rad:   f32,
    pub yaw_acc_rad:     f32,
    pub solution_status: u32,
}

impl EkfQuat {
    pub fn parse(d: &[u8]) -> Option<Self> {
        if d.len() < 36 { return None; }
        Some(Self {
            timestamp_us:    u32::from_le_bytes(d[0..4].try_into().ok()?),
            q_w:             f32::from_le_bytes(d[4..8].try_into().ok()?),
            q_x:             f32::from_le_bytes(d[8..12].try_into().ok()?),
            q_y:             f32::from_le_bytes(d[12..16].try_into().ok()?),
            q_z:             f32::from_le_bytes(d[16..20].try_into().ok()?),
            roll_acc_rad:    f32::from_le_bytes(d[20..24].try_into().ok()?),
            pitch_acc_rad:   f32::from_le_bytes(d[24..28].try_into().ok()?),
            yaw_acc_rad:     f32::from_le_bytes(d[28..32].try_into().ok()?),
            solution_status: u32::from_le_bytes(d[32..36].try_into().ok()?),
        })
    }
}

/// SBG_ECOM_LOG_EKF_VEL_BODY (ID 54) — 32 bytes
#[derive(Debug, Clone)]
pub struct EkfVelBody {
    pub timestamp_us:    u32,
    pub solution_status: u32,
    pub vel_x_ms:        f32,   // forward
    pub vel_y_ms:        f32,   // right
    pub vel_z_ms:        f32,   // down
    pub vel_x_acc:       f32,
    pub vel_y_acc:       f32,
    pub vel_z_acc:       f32,
}

impl EkfVelBody {
    pub fn parse(d: &[u8]) -> Option<Self> {
        if d.len() < 32 { return None; }
        Some(Self {
            timestamp_us:    u32::from_le_bytes(d[0..4].try_into().ok()?),
            solution_status: u32::from_le_bytes(d[4..8].try_into().ok()?),
            vel_x_ms:        f32::from_le_bytes(d[8..12].try_into().ok()?),
            vel_y_ms:        f32::from_le_bytes(d[12..16].try_into().ok()?),
            vel_z_ms:        f32::from_le_bytes(d[16..20].try_into().ok()?),
            vel_x_acc:       f32::from_le_bytes(d[20..24].try_into().ok()?),
            vel_y_acc:       f32::from_le_bytes(d[24..28].try_into().ok()?),
            vel_z_acc:       f32::from_le_bytes(d[28..32].try_into().ok()?),
        })
    }
}

/// SBG_ECOM_LOG_EKF_ROT_ACCEL_BODY (ID 52) — 32 bytes
/// Aceleração + rotation rates pós-EKF no frame do corpo (gravidade e rotação terrestre removidas)
#[derive(Debug, Clone)]
pub struct EkfRotAccelBody {
    pub timestamp_us:    u32,
    pub solution_status: u32,
    pub rate_x_rad_s:    f32,
    pub rate_y_rad_s:    f32,
    pub rate_z_rad_s:    f32,
    pub accel_x_ms2:     f32,
    pub accel_y_ms2:     f32,
    pub accel_z_ms2:     f32,
}

impl EkfRotAccelBody {
    pub fn parse(d: &[u8]) -> Option<Self> {
        if d.len() < 32 { return None; }
        Some(Self {
            timestamp_us:    u32::from_le_bytes(d[0..4].try_into().ok()?),
            solution_status: u32::from_le_bytes(d[4..8].try_into().ok()?),
            rate_x_rad_s:    f32::from_le_bytes(d[8..12].try_into().ok()?),
            rate_y_rad_s:    f32::from_le_bytes(d[12..16].try_into().ok()?),
            rate_z_rad_s:    f32::from_le_bytes(d[16..20].try_into().ok()?),
            accel_x_ms2:     f32::from_le_bytes(d[20..24].try_into().ok()?),
            accel_y_ms2:     f32::from_le_bytes(d[24..28].try_into().ok()?),
            accel_z_ms2:     f32::from_le_bytes(d[28..32].try_into().ok()?),
        })
    }
}

/// SBG_ECOM_LOG_GPS1_POS (ID 14) — 59 bytes mínimo
#[derive(Debug, Clone)]
pub struct Gps1Pos {
    pub timestamp_us:   u32,
    pub status_type:    u32,    // [0-5]=status, [6-11]=type (6=RTK_FLOAT, 7=RTK_INT)
    pub tow_ms:         u32,
    pub latitude_deg:   f64,
    pub longitude_deg:  f64,
    pub altitude_m:     f64,
    pub undulation_m:   f32,
    pub lat_acc_m:      f32,
    pub lon_acc_m:      f32,
    pub alt_acc_m:      f32,
    pub num_sv_used:    u8,
    pub base_station_id: u16,
    pub diff_age_cs:    u16,    // em 0.01 s
}

impl Gps1Pos {
    pub fn parse(d: &[u8]) -> Option<Self> {
        if d.len() < 57 { return None; }
        Some(Self {
            timestamp_us:    u32::from_le_bytes(d[0..4].try_into().ok()?),
            status_type:     u32::from_le_bytes(d[4..8].try_into().ok()?),
            tow_ms:          u32::from_le_bytes(d[8..12].try_into().ok()?),
            latitude_deg:    f64::from_le_bytes(d[12..20].try_into().ok()?),
            longitude_deg:   f64::from_le_bytes(d[20..28].try_into().ok()?),
            altitude_m:      f64::from_le_bytes(d[28..36].try_into().ok()?),
            undulation_m:    f32::from_le_bytes(d[36..40].try_into().ok()?),
            lat_acc_m:       f32::from_le_bytes(d[40..44].try_into().ok()?),
            lon_acc_m:       f32::from_le_bytes(d[44..48].try_into().ok()?),
            alt_acc_m:       f32::from_le_bytes(d[48..52].try_into().ok()?),
            num_sv_used:     d[52],
            base_station_id: u16::from_le_bytes(d[53..55].try_into().ok()?),
            diff_age_cs:     u16::from_le_bytes(d[55..57].try_into().ok()?),
        })
    }

    pub fn pos_status(&self) -> u8 { (self.status_type & 0x3F) as u8 }
    pub fn pos_type(&self)   -> u8 { ((self.status_type >> 6) & 0x3F) as u8 }
    pub fn is_rtk_float(&self) -> bool { self.pos_type() == 6 }
    pub fn is_rtk_int(&self)   -> bool { self.pos_type() == 7 }
    /// diff_age em segundos (0xFFFF = não disponível)
    pub fn diff_age_s(&self) -> Option<f32> {
        if self.diff_age_cs == 0xFFFF { None }
        else { Some(self.diff_age_cs as f32 / 100.0) }
    }
}
```

**`reader.rs` — task assíncrona de leitura:**

```rust
use tokio::io::AsyncReadExt;
use tokio_serial::SerialPortBuilderExt;
use crate::ins::{frame::FrameParser, messages::*};

pub enum InsEvent {
    Imu(ImuShort),
    EkfNav(EkfNav),
    EkfEuler(EkfEuler),
    EkfQuat(EkfQuat),
    EkfVelBody(EkfVelBody),
    EkfRotAccelBody(EkfRotAccelBody),
    Gps1Pos(Gps1Pos),
}

pub async fn ins_reader_task(
    port_path: &str,
    baud: u32,
    tx: tokio::sync::mpsc::Sender<InsEvent>,
) -> anyhow::Result<()> {
    let mut port = tokio_serial::new(port_path, baud)
        .open_native_async()?;

    let mut parser = FrameParser::new();
    let mut buf = [0u8; 512];

    loop {
        let n = port.read(&mut buf).await?;
        for frame in parser.feed(&buf[..n]) {
            // CLASS 0x00 = SBG_ECOM_CLASS_LOG_ECOM_0
            if frame.class != 0x00 { continue; }

            let event = match frame.msg_id {
                0x16 => ImuShort::parse(&frame.data).map(InsEvent::Imu),
                0x08 => EkfNav::parse(&frame.data).map(InsEvent::EkfNav),
                0x06 => EkfEuler::parse(&frame.data).map(InsEvent::EkfEuler),
                0x07 => EkfQuat::parse(&frame.data).map(InsEvent::EkfQuat),
                0x36 => EkfVelBody::parse(&frame.data).map(InsEvent::EkfVelBody),
                0x34 => EkfRotAccelBody::parse(&frame.data).map(InsEvent::EkfRotAccelBody),
                0x0E => Gps1Pos::parse(&frame.data).map(InsEvent::Gps1Pos),
                _    => None,
            };

            if let Some(ev) = event {
                // se o canal estiver cheio, descarta e continua — nunca bloquear a leitura serial
                let _ = tx.try_send(ev);
            }
        }
    }
}
```

**Integração em `main.rs`:**

```rust
let (ins_tx, mut ins_rx) = tokio::sync::mpsc::channel::<InsEvent>(256);

tokio::spawn(async move {
    if let Err(e) = ins_reader_task("/dev/ttyUSB_ellipse_ecom", 115200, ins_tx).await {
        tracing::error!("INS reader error: {e}");
    }
});

// No loop principal, ao lado do SocketCAN:
tokio::select! {
    Some(can_frame) = can_stream.next() => { /* processamento CAN existente */ }
    Some(ins_event) = ins_rx.recv() => {
        match ins_event {
            InsEvent::EkfNav(nav) if nav.position_valid() => {
                // ingerir na pipeline de telemetria
            }
            InsEvent::EkfRotAccelBody(imu) => {
                // alimentar SLAM
            }
            InsEvent::Gps1Pos(pos) => {
                tracing::debug!("RTK type={} acc={:.2}m", pos.pos_type(), pos.lat_acc_m);
            }
            _ => {}
        }
    }
}
```

**Crates necessárias:**

```toml
# Cargo.toml
[dependencies]
tokio        = { version = "1", features = ["full"] }
tokio-serial = "5"
anyhow       = "1"
tracing      = "0.1"
```

#### 5.5.7 Considerações de segurança e latência

**Segurança para o resto do código:**
- O parser é `Send + Sync` — os frames são produzidos em uma task isolada e entregues via `mpsc::channel`. O restante do código nunca acessa a serial diretamente.
- `try_send` em vez de `send` no canal: se o consumidor estiver lento, frames são descartados em vez de travar a leitura serial. Dados de IMU a 200 Hz são tolerantes a perdas ocasionais; nunca travar o loop de leitura.
- Validação CRC obrigatória antes de qualquer parse. Frame com CRC inválido é silenciosamente descartado — nenhum dado parcial ou corrompido chega ao consumidor.
- Todos os `parse()` retornam `Option` — sem panics em dados malformados.

**Latência:**
- Leitura tokio assíncrona: sem blocking, sem thread dedicada, integra naturalmente ao runtime existente.
- Buffer de 512 bytes por leitura: suficiente para vários frames a 115200 baud sem acumular latência.
- A 115200 baud, um frame de 72 bytes (EKF_NAV) leva ~6 ms de transmissão. Com leitura assíncrona, o delay de processamento adicional é da ordem de microssegundos.
- Canal com capacidade 256: headroom suficiente para rajadas sem perda, sem memória ilimitada.

#### 5.5.8 Verificar saúde do parser em campo

```bash
# Monitorar bytes brutos chegando na serial (deve ter fluxo constante de 0xFF 0x5A)
sudo cat /dev/ttyUSB_ellipse_ecom | xxd | grep "ff5a" | head -20

# No log do telemetry-edge (com tracing), verificar:
# - frames de EKF_NAV com solution_mode=4 e position_valid=true
# - GPS1_POS com pos_type=6 (RTK_FLOAT) ou 7 (RTK_INT)
# - diff_age < 5 s (confirmação que RTCM está chegando e sendo usado)
```

---

## 6. Fluxo completo no dia da prova

### Com Opção A (survey-in — local desconhecido)

```
T-40 min  Posicionar antena NovAtel no box com visada livre
T-38 min  Ligar NovAtel, conectar serial ao servidor base
T-37 min  sudo systemctl start rtcm-relay (servidor base)
T-37 min  FIX AUTO 0.5 900 (survey-in 15 min)
T-22 min  Verificar log posavea — aguardar FIX
T-20 min  Verificar rtcmdata3 saindo pela COM1
T-18 min  sudo systemctl start rtcm-client (Jetson)
T-15 min  ros2 run sbg_driver sbg_device (Jetson)
T-12 min  ros2 topic echo /sbg/gps_pos — verificar RTK_FLOAT
T-5 min   Confirmar RTK_FIXED — sistema pronto
T-0       Prova
```

### Com Opção B (FIX POSITION via IBGE-PPP — kartódromo fixo)

```
T-20 min  Posicionar antena NovAtel na marca definitiva no box
T-18 min  Ligar NovAtel — FIX POSITION já ativo da flash, sem espera
T-17 min  sudo systemctl start rtcm-relay (servidor base)
T-17 min  Verificar rtcmdata3 saindo (deve estar imediato, sem survey-in)
T-15 min  sudo systemctl start rtcm-client (Jetson)
T-12 min  ros2 run sbg_driver sbg_device (Jetson)
T-10 min  ros2 topic echo /sbg/gps_pos — verificar RTK_FLOAT
T-5 min   Confirmar RTK_FIXED — sistema pronto
T-0       Prova
```

> A Opção B economiza ~20 minutos de setup e elimina o período de incerteza do survey-in. Para qualquer evento no kartódromo fixo da UNICAMP, é a opção padrão após a calibração inicial.

---

## 7. Checklist de campo (pré-prova)

```
[ ] NovAtel posicionada com antena com visada livre do céu (>10° horizonte)
[ ] NovAtel alimentada (12V, fusível 5A)
[ ] Cabo serial NovAtel COM1 → servidor base conectado (/dev/ttyUSB_novatel)
[ ] baud rate NovAtel configurado em 115200
[ ] Posição da base: FIX POSITION (Opção B) ou FIX AUTO 0.5 900 (Opção A)
[ ] log posavea confirmando FIXED_POS (Opção B) ou FIX convergido (Opção A)
[ ] rtcm-relay ativo no servidor base (systemctl status rtcm-relay)
[ ] Rede local box ↔ carro ativa (ping 143.106.207.93 do servidor)
[ ] rtcm-client ativo na Jetson (systemctl status rtcm-client)
[ ] Ellipse 2 Port A conectada a /dev/ttyUSB_ellipse_rtcm na Jetson
[ ] Ellipse 2 Port B conectada a /dev/ttyUSB_ellipse_ecom na Jetson
[ ] sbg_ros2_driver rodando
[ ] /sbg/gps_pos mostrando RTK_FIXED ou RTK_FLOAT
[ ] Posição da base anotada (log refstationa) para recuperação de emergência
```

---

## 8. Limitações e upgrades futuros

### Precisão ~20 cm (RT-20, L1 only)
O algoritmo RT-20 opera apenas em L1. Upgrade para u-blox F9P (~R$800) mantém todo o software e entrega 1–2 cm.

### Dependência do link TCP box ↔ carro
Se cair, o Ellipse degrada para GPS autônomo (~1–3 m). O `rtcm-client` tem `Restart=always` para reconexão automática. Mitigação futura: rádio serial dedicado como canal de backup.

### Posição da base (Opção A)
A posição via survey-in tem incerteza de ~1–3 m, propagando erro sistemático nas correções. Resolvido com Opção B (IBGE-PPP) para o kartódromo fixo.

### Posição da base (Opção B — kartódromo fixo)
A coordenada IBGE-PPP é válida enquanto a antena for posicionada no mesmo ponto físico. Qualquer realocação da antena exige nova calibração. Marcar o ponto no chão (fita, parafuso, pintura) para garantir repetibilidade.

---

## 9. Referências

- Documentação sbgECom: https://developer.sbg-systems.com/sbgECom/5.1/
- Configuração RTK Ellipse: https://support.sbg-systems.com/sc/el/latest/how-to-articles/configure-rtk
- Driver ROS2 SBG Systems: https://github.com/SBG-Systems/sbg_ros2_driver
- Manual OEMV Family (NovAtel): https://hexagondownloads.blob.core.windows.net/public/Novatel/assets/Documents/Manuals/om-20000093/om-20000093.pdf
- RTKLIB str2str manual: https://rtkexplorer.com/pdfs/rtklib_manual.pdf
- IBGE-PPP (pós-processamento gratuito): https://www.ibge.gov.br/geociencias/ppp

---

*Unicamp E-Racing — Divisão de Telemetria e Sistemas Embarcados 2026*