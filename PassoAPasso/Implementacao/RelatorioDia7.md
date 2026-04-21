# RELATÓRIO GERAL — TELEMETRIA V2 E-RACING ULTRA BLASTER

**Data:** 21 de Abril de 2026  
**Status:** V2.1 em progresso — ZED 2i operacional via GStreamer · Rede do PC de desenvolvimento configurada · IP fixo na Jetson

---

## PARTE 1 — O QUE FIZEMOS HOJE

### Linha do tempo do que foi executado

```
1. Descrição técnica completa do sistema para processo seletivo
        ↓ Documento técnico abrangendo hardware, protocolos, rede, segurança e roadmap
        ↓ Cobertura: Jetson AGX Xavier, CAN bus, TimescaleDB, JWT, NTP, QoS HTB
        ↓ Arquitetura em diagrama estrutural completo (V2.0 → V2.3)

2. Configuração de rotas no PC de desenvolvimento (Debian)
        ↓ Problema: PC com dois caminhos de rede ativos simultâneos
              cable (enx002432a0b37a): IP 192.168.1.4 — gateway 192.168.1.1 — metric 100
              Wi-Fi (wlo1): IP 100.112.171.40 — gateway 100.112.0.1 — metric 600
        ↓ Causa: metric 100 do cabo menor que metric 600 do Wi-Fi
              → Linux prefere a menor metric → todo tráfego internet pelo cabo
              → cabo não tem saída para internet → falha de conectividade
        ↓ Diagnóstico: ip route show revelou dois default routes conflitantes
        ↓ Solução temporária: sudo ip route del default via 192.168.1.1 dev enx002432a0b37a
        ↓ Solução permanente: perfil "oficina" no NetworkManager com ipv4.never-default yes
        ↓ Resultado: internet via Wi-Fi ✅ | SSH servidor e Jetson via cabo ✅

3. Solução para trocar perfis de rede entre casa e oficina
        ↓ Problema: solução permanente never-default quebraria internet a cabo em casa
        ↓ Solução: dois perfis NetworkManager para a mesma interface
              Perfil "oficina": ipv4.never-default yes — cabo só para rede interna
              Perfil original: cabo como rota default — internet em casa
        ↓ Aliases criados no ~/.bashrc: rede-oficina e rede-casa
        ↓ Resultado: troca de contexto com um comando ✅

4. Diagnóstico de travamento no boot do servidor
        ↓ Problema: servidor não iniciava sem tela e teclado conectados
              → conectar tela e teclado fez o servidor iniciar normalmente
        ↓ Diagnóstico: systemd-analyze blame revelou 16s em systemd-networkd-wait-online
        ↓ Causa raiz: arquivo /etc/netplan/00-installer-config.yaml referenciava
              interface wlxa86e842b1c75 (dongle antigo, MAC diferente)
              dongle atual é wlx00e12907f625 — MAC diferente, nome diferente
        ↓ Evidência no log:
              "Timed out waiting for device /sys/subsystem/net/devices/wlxa86e842b1c75"
              "Dependency failed for WPA supplicant for netplan wlxa86e842b1c75"
        ↓ Correção 1: remover completamente bloco Wi-Fi do netplan
              → transferir controle total do Wi-Fi para o NetworkManager
              → adicionar renderer: NetworkManager ao netplan
              → adicionar optional: true ao cabo para não bloquear boot sem cabo
        ↓ Correção 2: tornar setup-nat.sh robusto
              → verificar se WIFI_IFACE existe antes de aplicar MASQUERADE
              → servidor sobe e funciona na rede local mesmo sem dongle Wi-Fi
        ↓ Resultado: servidor sobe sem travar independente de dongle presente ✅

5. Configuração de IP fixo na Jetson (192.168.1.101)
        ↓ Problema: Jetson com IP 192.168.1.6 (DHCP do roteador)
        ↓ Objetivo: IP fixo 192.168.1.101 para endereçamento previsível
        ↓ Solução: nmcli connection modify "Profile 1"
              ipv4.method manual
              ipv4.addresses 192.168.1.101/24
              ipv4.gateway 192.168.1.100  ← servidor como gateway (NAT)
              ipv4.dns 8.8.8.8
              connection.interface-name eth0
        ↓ Observação: gateway apontando para 192.168.1.100 mantém NAT funcionando
        ↓ Resultado: IP fixo 192.168.1.101 ativo e persistente após reboot ✅

6. Instalação do ZED SDK 4.2 na Jetson (headless via SSH)
        ↓ Diagnóstico de compatibilidade:
              cat /etc/nv_tegra_release → R35 (release), REVISION: 6.1 → JetPack 5.x ✅
              lsusb | grep 2b03 → Bus 002 Device 002: ID 2b03:f582 ZED ✅
        ↓ Download via wget sem interface gráfica:
              wget URL do SDK → ZED_SDK_Tegra_L4T35.4_v4.2.run
        ↓ Instalação em modo headless:
              ./ZED_SDK_Tegra_L4T35.4_v4.2.run -- --silent
        ↓ Avisos inofensivos durante instalação:
              "Detected Tegra_L4T35.6, required exact Tegra_L4T35.4" → mesma família R35.x
              onnx-graphsurgeon → dependência de ML não usada no projeto
        ↓ Resultado: ZED SDK 4.2 instalado com CUDA 11.4 ✅

7. Problema com arquivo de calibração da câmera ZED 2i
        ↓ Câmera detectada com sucesso: S/N 2183, firmware 1523, HD720@60fps
        ↓ Problema: SDK rejeita câmera com INVALID CALIBRATION FILE
        ↓ Causa: S/N 2183 muito antigo — servidor da Stereolabs retorna arquivo genérico
              SN2183.conf com 784 bytes — valores idênticos em LEFT e RIGHT — k2=0 em tudo
              SDK detecta valores simétricos/zerados e rejeita como inválido
        ↓ Tentativa de bypass com camera_disable_self_calib = True → SDK ainda rejeita
              pois o arquivo é baixado novamente e re-validado internamente
        ↓ Decisão: contornar o SDK completamente — usar V4L2 direto
        ↓ Resultado: câmera acessível via /dev/video0 sem depender do SDK ✅

8. Diagnóstico do dispositivo V4L2 da ZED 2i
        ↓ Câmera exposta como /dev/video0 (captura) e /dev/video1 (não é captura)
        ↓ v4l2-ctl --list-formats-ext revelou formato real:
              Formato: YUYV (YUY2 no GStreamer)
              Resoluções disponíveis: 2560x720@60fps, 1344x376@100fps,
                                      3840x1080@30fps, 4416x1242@15fps
        ↓ Descoberta crítica: ZED 2i expõe imagem estéreo lado a lado
              2560x720 = 1280x720 esquerda + 1280x720 direita concatenadas horizontalmente
              Não existe resolução 1280x720 individual via V4L2
        ↓ Pipeline GStreamer com formato explícito YUY2 funcionou:
              v4l2src device=/dev/video0 io-mode=2 → negocia automaticamente
              sem io-mode=2 e sem formato explícito → not-negotiated error

9. Pipeline de streaming GStreamer para o PC via UDP
        ↓ Encoder NVENC (nvv4l2h264enc) falhou:
              "could not link videoconvert1 to nvv4l2h264enc0"
              Causa: nvv4l2h264enc aceita apenas NV12/I420 — videoconvert não converte
        ↓ Solução: usar x264enc por software como fallback
              sudo apt install gstreamer1.0-plugins-ugly
        ↓ Pipeline final na Jetson (câmera esquerda apenas):
              v4l2src → YUY2 2560x720@60fps → videoconvert → videocrop right=1280
              → videoconvert → x264enc tune=zerolatency → rtph264pay → udpsink
        ↓ Pipeline no PC para receber:
              udpsrc port=5600 → rtph264depay → h264parse → avdec_h264
              → videoconvert → autovideosink sync=false
        ↓ Resultado: vídeo ao vivo da câmera esquerda chegando no PC ✅

10. Streaming de ambas as câmeras simultâneo
        ↓ Solução: remover videocrop e transmitir 2560x720 completo
              imagem 2560x720 = câmera esquerda (0–1279px) + câmera direita (1280–2559px)
        ↓ Ajuste de bitrate: 4000→6000 kbps para compensar largura dobrada
        ↓ Resultado: ambas as câmeras transmitidas em um único stream ✅
```

---

## PARTE 2 — GUIAS TÉCNICOS DETALHADOS

### Como acessar a câmera ZED 2i via SSH (sem interface gráfica)

Esta seção documenta como operar a câmera ZED 2i completamente via SSH, sem precisar de display conectado na Jetson.

#### Verificar que a câmera está conectada

```bash
# Confirmar detecção USB (VID 2b03 = Stereolabs)
lsusb | grep -i 2b03
# Saída esperada: Bus 002 Device 002: ID 2b03:f582 Technologies, Inc. ZED

# Confirmar que aparece como dispositivo V4L2
ls /dev/video*
# Saída esperada: /dev/video0  /dev/video1
# video0 = captura (ZED)  |  video1 = saída (não é captura)

# Ver formatos suportados
v4l2-ctl --device=/dev/video0 --list-formats-ext
```

#### Formatos disponíveis na ZED 2i via V4L2

```
Formato: YUYV (YUY2 no GStreamer) — imagem estéreo lado a lado
┌─────────────────┬──────────────┬────────────────────────────────┐
│ Resolução       │ FPS          │ Uso                            │
├─────────────────┼──────────────┼────────────────────────────────┤
│ 2560x720        │ 60, 30, 15   │ HD720 estéreo (RECOMENDADO)    │
│ 1344x376        │ 100, 60, 30  │ VGA estéreo (baixa latência)   │
│ 3840x1080       │ 30, 15       │ FHD estéreo                    │
│ 4416x1242       │ 15           │ 2K estéreo (padrão do driver)  │
└─────────────────┴──────────────┴────────────────────────────────┘

IMPORTANTE: Cada resolução já contém as duas câmeras (esquerda + direita)
concatenadas horizontalmente. Metade esquerda = câmera esquerda.
Metade direita = câmera direita.
```

#### Testar captura sem display (fakesink)

```bash
# Confirmar que frames chegam — roda indefinidamente, Ctrl+C para parar
gst-launch-1.0 -v v4l2src device=/dev/video0 io-mode=2 ! \
  videoconvert ! fakesink sync=false

# Saída esperada — confirma resolução negociada:
# caps = video/x-raw, width=(int)4416, height=(int)1242, format=(string)YUY2
```

#### Streaming para o PC — câmera esquerda apenas

```bash
# Na Jetson — iniciar servidor de stream
# Substituir 192.168.1.4 pelo IP do seu PC
gst-launch-1.0 -v v4l2src device=/dev/video0 io-mode=2 ! \
  video/x-raw,format=YUY2,width=2560,height=720,framerate=60/1 ! \
  videoconvert ! \
  videocrop right=1280 ! \
  videoconvert ! \
  x264enc tune=zerolatency bitrate=4000 speed-preset=ultrafast ! \
  h264parse ! \
  rtph264pay config-interval=1 pt=96 ! \
  udpsink host=192.168.1.4 port=5600
```

```bash
# No PC — receber e exibir
gst-launch-1.0 udpsrc port=5600 ! \
  application/x-rtp,encoding-name=H264,payload=96 ! \
  rtph264depay ! h264parse ! avdec_h264 ! \
  videoconvert ! autovideosink sync=false
```

#### Streaming para o PC — ambas as câmeras (visão estéreo completa)

```bash
# Na Jetson — transmitir 2560x720 completo (sem videocrop)
gst-launch-1.0 -v v4l2src device=/dev/video0 io-mode=2 ! \
  video/x-raw,format=YUY2,width=2560,height=720,framerate=60/1 ! \
  videoconvert ! \
  x264enc tune=zerolatency bitrate=6000 speed-preset=ultrafast ! \
  h264parse ! \
  rtph264pay config-interval=1 pt=96 ! \
  udpsink host=192.168.1.4 port=5600

# No PC — mesmo pipeline de recepção
gst-launch-1.0 udpsrc port=5600 ! \
  application/x-rtp,encoding-name=H264,payload=96 ! \
  rtph264depay ! h264parse ! avdec_h264 ! \
  videoconvert ! autovideosink sync=false
```

#### Dependências necessárias

```bash
# Na Jetson
sudo apt install -y \
  gstreamer1.0-tools \
  gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad \
  gstreamer1.0-plugins-ugly \   # x264enc
  gstreamer1.0-rtsp \
  v4l-utils

# No PC Debian
sudo apt install -y \
  gstreamer1.0-tools \
  gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad \
  gstreamer1.0-libav \          # avdec_h264
  gstreamer1.0-gtk3             # autovideosink
```

---

### Por que o encoder NVENC (nvv4l2h264enc) não funcionou

O `nvv4l2h264enc` é o encoder H.264 por hardware da NVIDIA (NVENC) embarcado no Xavier. Ele aceita exclusivamente os formatos de pixel NV12 e I420. O pipeline vinha com YUY2 → videoconvert → nvv4l2h264enc, mas o `videoconvert` nesta versão do GStreamer (1.16, Ubuntu 20.04) não consegue converter YUY2 para NV12 neste contexto de pipeline — a negociação de caps falha antes de iniciar.

A solução definitiva para usar o NVENC é inserir um elemento `nvvidconv` (conversor NVIDIA nativo) entre o videoconvert e o encoder:

```bash
# Pipeline com NVENC (para quando for necessário maximizar eficiência de CPU)
gst-launch-1.0 -v v4l2src device=/dev/video0 io-mode=2 ! \
  video/x-raw,format=YUY2,width=2560,height=720,framerate=60/1 ! \
  videoconvert ! \
  videocrop right=1280 ! \
  nvvidconv ! \
  video/x-raw(memory:NVMM),format=NV12 ! \
  nvv4l2h264enc bitrate=4000000 ! \
  h264parse ! \
  rtph264pay config-interval=1 pt=96 ! \
  udpsink host=192.168.1.4 port=5600
```

Para o estágio atual (desenvolvimento e testes), o `x264enc` por software é suficiente e mais simples de depurar. O NVENC será necessário quando for implementar o serviço systemd de streaming permanente, pois libera CPU para o pipeline de telemetria CAN.

---

### Por que o arquivo de calibração da ZED 2i é inválido

O S/N 2183 indica uma câmera muito antiga — as primeiras unidades do ZED original tinham serial numbers baixos. A Stereolabs não possui o arquivo de calibração individual desta câmera em seu servidor de downloads (`calib.stereolabs.com`), então retorna um arquivo genérico com:

```ini
[LEFT_CAM_2K]
fx=1400  fy=1400  cx=1104  cy=621
k1=-0.165  k2=0  p1=0  p2=0  k3=0
[RIGHT_CAM_2K]
fx=1400  fy=1400  cx=1104  cy=621   ← idêntico ao LEFT — impossível em câmera real
k1=0    k2=0  p1=0  p2=0  k3=0
```

Parâmetros idênticos nas duas câmeras são fisicamente impossíveis — toda câmera estéreo tem lentes com aberrações individuais distintas. O SDK detecta isso e rejeita, mesmo com `camera_disable_self_calib = True`, pois o download e a re-validação acontecem internamente antes da flag ser aplicada.

**Impacto para o projeto:** A calibração é necessária apenas para computação de profundidade (depth maps) e odometria visual. Para streaming de vídeo RGB — que é o objetivo do V2.3 — a calibração não é usada. Por isso, contornar o SDK e usar V4L2 diretamente é a solução correta e mais eficiente para o caso de uso da E-Racing.

---

### Por que usamos V4L2 em vez do ZED SDK para streaming

O ZED SDK é otimizado para aplicações de visão computacional: depth estimation, positional tracking, object detection. Para essas aplicações, o SDK oferece vantagens claras em produtividade.

Para streaming de vídeo simples, o SDK adiciona overhead desnecessário:
- Depende de arquivo de calibração válido
- Inicializa múltiplos pipelines de GPU mesmo quando desabilitados
- Requer versão exata de JetPack (nosso caso: 35.6 vs esperado 35.4)

O V4L2 (Video4Linux2) é a interface padrão do kernel Linux para dispositivos de vídeo. Com GStreamer, oferece pipeline de captura-encode-stream de baixa latência e sem dependências externas além das bibliotecas do sistema. É a abordagem usada em produção em câmeras IP industriais e sistemas de vigilância embarcados.

---

### Configuração de rotas no PC de desenvolvimento

O PC de desenvolvimento tem duas interfaces ativas simultaneamente:

```
wlo1  (Wi-Fi)              100.112.171.40/16   gateway 100.112.0.1   metric 600
enx.. (cabo USB-Ethernet)  192.168.1.4/24      gateway 192.168.1.1   metric 100
```

O Linux usa a menor metric para escolher a rota default. Com metric 100 no cabo e 600 no Wi-Fi, todo tráfego de internet ia pelo cabo — que não tem WAN.

**Perfil de oficina (NetworkManager):**

```bash
sudo nmcli connection add \
  type ethernet \
  ifname enx002432a0b37a \
  con-name "oficina" \
  ipv4.method auto \
  ipv4.never-default yes

# Ativar na oficina
sudo nmcli connection up "oficina"

# Voltar para casa
sudo nmcli connection up "Wired connection 1"
```

O parâmetro `ipv4.never-default yes` instrui o NetworkManager a nunca usar esta conexão como rota default, mesmo que o servidor DHCP envie um gateway — o IP é aceito, o gateway é ignorado.

---

## PARTE 3 — PROBLEMAS RESOLVIDOS E LIÇÕES APRENDIDAS

### Servidor travando no boot sem dongle Wi-Fi

O netplan referenciava um MAC de dongle antigo que não existia mais. O systemd fica aguardando o dispositivo até o timeout de 2 minutos antes de continuar. A lição é:

**Nunca referenciar interfaces pelo nome no netplan se o hardware pode mudar.** A solução correta é remover interfaces opcionais do netplan completamente e deixar o NetworkManager gerenciá-las — ele detecta interfaces dinamicamente sem bloquear o boot.

```
Antes (ruim):                    Depois (correto):
wifis:                           network:
  wlxa86e842b1c75:  ← MAC fixo     version: 2
    optional: true                 renderer: NetworkManager
    dhcp4: true                    ethernets:
                                     enp1s0:
                                       optional: true
                                       addresses: [192.168.1.100/24]
```

### GStreamer — diagnóstico de pipeline em 3 passos

Quando um pipeline GStreamer falha com `not-negotiated` ou `could not link`:

```bash
# Passo 1: ver que caps o source negocia por padrão
gst-launch-1.0 -v v4l2src device=/dev/video0 io-mode=2 ! fakesink

# Passo 2: forçar o formato exato que o source reportou
gst-launch-1.0 -v v4l2src device=/dev/video0 io-mode=2 ! \
  video/x-raw,format=YUY2,width=2560,height=720 ! fakesink

# Passo 3: adicionar elementos um a um até encontrar o que falha
gst-launch-1.0 -v v4l2src ... ! videoconvert ! fakesink        # OK?
gst-launch-1.0 -v v4l2src ... ! videoconvert ! x264enc ! ...   # OK?
```

### ZED 2i via V4L2 — quirks importantes

- `io-mode=2` (userptr) é necessário — sem ele o driver pode falhar na negociação de buffer
- O GStreamer chama o formato `YUYV` como `YUY2` internamente — são o mesmo formato (4:2:2 packed), mas o nome difere
- `video1` é o dispositivo de output (metadata/controles), não captura — sempre usar `video0`
- A resolução padrão negociada pelo driver é a máxima disponível (4416x1242@15fps) — sempre especificar explicitamente para performance previsível

---

## PARTE 4 — ARQUITETURA ATUAL DO SISTEMA

```
PC DE DESENVOLVIMENTO (Debian)
  ├── wlo1: 100.112.171.40 → internet (Wi-Fi, gateway 100.112.0.1)
  └── enx002432a0b37a: 192.168.1.4 → rede interna (cabo, perfil "oficina")
        ├── SSH → 192.168.1.100 (servidor)
        ├── SSH → 192.168.1.101 (Jetson)
        └── udpsrc :5600 → vídeo ZED 2i ao vivo

SERVIDOR (192.168.1.100 · Ubuntu 22.04)
  ├── enp1s0: IP fixo 192.168.1.100 (cabo)
  ├── wlx00e12907f625: DHCP (internet — opcional, boot não bloqueia se ausente)
  ├── NAT: iptables MASQUERADE via /etc/eracing/setup-nat.sh (só se Wi-Fi presente)
  └── systemd:
        ├── telemetry.service → TCP:8080 + HTTP/WS:8081 + NTP:9999
        └── postgresql@14-main.service → TimescaleDB

JETSON AGX XAVIER (192.168.1.101 · Ubuntu 20.04 aarch64)
  ├── eth0: IP fixo 192.168.1.101 (cabo — gateway 192.168.1.100)
  ├── ZED SDK 4.2 instalado (/usr/local/zed/)
  ├── ZED 2i: /dev/video0 — YUY2 — 2560x720@60fps (estéreo lado a lado)
  ├── GStreamer: v4l2src → x264enc → rtph264pay → udpsink
  └── systemd:
        ├── can-interfaces.service → can0, can1, vcan0, vcan1 UP
        ├── can-replay.service → canplayer loop
        └── telemetry-edge.service → Rust aarch64 → TCP :8080
```

---

## PARTE 5 — STATUS ATUAL DO PROJETO

### O que mudou hoje

| Componente | Status Anterior | Status Atual |
|---|---|---|
| Rotas PC desenvolvimento | Conflito — internet pelo cabo | Correto — internet Wi-Fi, SSH pelo cabo |
| Boot do servidor | Travava 16s esperando dongle antigo | Sobe imediatamente — dongle opcional |
| Script setup-nat.sh | Crashava sem Wi-Fi | Verifica presença do dongle antes de aplicar |
| IP da Jetson | 192.168.1.6 (DHCP) | 192.168.1.101 (fixo permanente) |
| ZED SDK | Não instalado | 4.2 instalado (CUDA 11.4) |
| ZED 2i acesso | Não testado | V4L2 funcional — /dev/video0 |
| Streaming de vídeo | Não existia | GStreamer → UDP → PC funcionando ✅ |
| Câmera esquerda | — | Streaming 1280x720@60fps ✅ |
| Ambas câmeras | — | Streaming 2560x720@60fps ✅ |

### O que está FEITO ✅

| Componente | Status | Dia |
|---|---|---|
| Toda a infraestrutura V2.0 | ✅ | Dias 1–6 |
| Latência real 3.77ms medida | ✅ | Dia 6 |
| NTP offset ±0.1ms | ✅ | Dia 6 |
| Arquitetura DB corrigida | ✅ | Dia 6 |
| Rotas PC desenvolvimento | ✅ | Dia 7 |
| Boot servidor sem dongle | ✅ | Dia 7 |
| IP fixo Jetson 192.168.1.101 | ✅ | Dia 7 |
| ZED SDK 4.2 na Jetson | ✅ | Dia 7 |
| ZED 2i via V4L2 | ✅ | Dia 7 |
| Streaming GStreamer → PC | ✅ | Dia 7 |

### O que está PENDENTE ❌

| Componente | Prioridade | Descrição |
|---|---|---|
| Encoder NVENC (nvv4l2h264enc) | 🔴 Alta | Substituir x264enc por software — necessário para produção |
| Serviço systemd de streaming | 🔴 Alta | zed-stream.service no boot automático |
| can0 real do carro | 🔴 Alta | Conectar barramento físico do veículo |
| QoS HTB (tc) | 🟡 Média | 3 classes — pré-requisito antes de colocar vídeo em produção |
| CSVs BMS, PT, PAINEL | 🟡 Média | Maioria dos IDs ainda com Prio=4 |
| Teste RSSI Unifi em campo | 🟡 Média | Verificar link > -65dBm na pista |
| Firewall UFW | 🟡 Média | Portas 8080, 8081, 9999, 5600 |
| App Android | 🟢 Baixa | WebSocket :8081 + RTSP player |

---

## PARTE 6 — PRÓXIMOS PASSOS (DIA 8)

```
1. Ativar encoder NVENC no pipeline GStreamer:
   — Testar pipeline com nvvidconv antes do nvv4l2h264enc
   — Pipeline: v4l2src → videoconvert → videocrop → nvvidconv
     → video/x-raw(memory:NVMM),format=NV12 → nvv4l2h264enc → udpsink

2. Criar serviço systemd para streaming automático no boot:
   — /etc/systemd/system/zed-stream.service
   — After=network.target
   — ExecStart=gst-launch-1.0 ... (pipeline completo)
   — Restart=always

3. Implementar QoS HTB (pré-requisito para colocar vídeo em produção):
   — Criar /etc/eracing/setup_qos.sh na Jetson e no servidor
   — Classe 1 (crítico): TCP :8080 + WS :8081 — 5 Mbit/s garantido
   — Classe 2 (tempo real): UDP :5004/:5005 — 2 Mbit/s garantido
   — Classe 3 (bulk): UDP :5600 / RTSP :8554 — 1 Mbit/s, teto 20 Mbit/s
   — Aplicar no boot via systemd

4. Conectar can0 real ao barramento CAN do carro:
   — Atualizar telemetry-edge.service: --ch0 can0 (em vez de vcan0)
   — candump can0 para verificar frames chegando
   — Comparar IDs com CSV para confirmar mapeamento

5. Expandir csv_data com BMS, PT e PAINEL:
   — Copiar CSVs para ~/TelemetriaV2.0/telemetry-server/csv_data/
   — Reiniciar telemetry-edge e verificar que mais IDs são carregados
```

---

*Documento gerado em 21/04/2026 — E-Racing Ultra Blaster Telemetria V2*
