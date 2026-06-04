# RELATÓRIO GERAL — TELEMETRIA V2 E-RACING ULTRA BLASTER

**Data:** 01 de Março de 2026  
**Status:** Em progresso — MVP parcialmente funcional

---

## PARTE 1 — O QUE FIZEMOS HOJE

### Linha do tempo do que foi executado

```
1. Instalação Ubuntu Server (dual boot com Windows)
        ↓ Problema: partição NTFS não aceitável pelo instalador
        ↓ Solução: deletar partição NTFS e recriar como ext4
        ↓ Bloqueio: partição era pequena demais (532MB)

2. Configuração de rede Wi-Fi (hostapd + dnsmasq)
        ↓ Problema: porta 53 ocupada pelo systemd-resolved
        ↓ Solução: desabilitar systemd-resolved
        ↓ Bloqueio: chip Wi-Fi não suporta modo AP (só managed/monitor)
        ↓ Decisão: abandonar Wi-Fi AP, usar cabo ethernet

3. Configuração IP fixo via ethernet
        ↓ Problema: nome da interface errado no netplan (enp1s0 vs enp5s0)
        ↓ Problema: indentação incorreta no YAML
        ↓ Problema: dois gateways conflitando (cabo + Wi-Fi)
        ↓ Solução: reescrever netplan via bash, corrigir DNS

4. Instalação dependências (sqlite3, build-essential, etc.)
        ↓ Problema: sem internet por conflito de gateway/DNS
        ↓ Solução: forçar nameserver 8.8.8.8 no resolv.conf
        ↓ Resultado: instalação bem-sucedida ✅

5. Criação do banco SQLite
        ↓ Problema: mkdir em /telemetry_server (raiz) sem permissão
        ↓ Solução: usar ~/telemetry_server (home do usuário)
        ↓ Resultado: banco criado com sucesso ✅

6. Compilação do servidor Rust
        ↓ Problema: cargo build em pasta sem permissão
        ↓ Problema: sudo cargo não funciona (Rust instalado só para usuário)
        ↓ Solução: compilar sem sudo na pasta home
        ↓ Status: em andamento
```

---

## PARTE 2 — POR QUE HOSTAPD E DNSMASQ NÃO FORAM NECESSÁRIOS

### O que eram para fazer

O plano original do guia era transformar o servidor em um **roteador Wi-Fi privado**:

```
[CARRO] ──Wi-Fi──→ [SERVIDOR como AP]
                   hostapd = cria a rede Wi-Fi
                   dnsmasq = distribui IPs via DHCP
```

### Por que não funcionou

**Motivo técnico:** O chip Wi-Fi do computador servidor (`wlx00e12907f625`) suporta apenas os modos `managed` (cliente Wi-Fi) e `monitor` (escuta passiva). O modo `AP` (Access Point) **não está na lista de modos suportados** pelo driver/hardware. O hostapd precisa do modo AP para funcionar — sem suporte no hardware, sempre vai falhar com `status=1/FAILURE` independente da configuração.

### Por que não é necessário com cabo ethernet

Com cabo ethernet, a topologia muda completamente:

```
[CARRO] ──cabo──→ [SWITCH] ←──cabo──→ [SERVIDOR]
```

Nessa topologia, o próprio cabo garante a conectividade. Não precisa de nenhum software para criar rede — a rede já existe fisicamente. O hostapd e o dnsmasq são ferramentas para **criar redes Wi-Fi virtuais**, que é exatamente o que você não precisa quando tem cabo.

**Resumo:** hostapd e dnsmasq foram um desvio causado pela suposição inicial de que a comunicação seria Wi-Fi. Com ethernet, essas ferramentas são irrelevantes.

---

## PARTE 3 — O QUE MUDOU: WI-FI vs ETHERNET

### Quando pensávamos que era Wi-Fi via roteador

```
Configuração assumida:
- Servidor conectado ao roteador via Wi-Fi
- Carro conectado ao mesmo roteador via Wi-Fi
- IP do servidor: obtido via DHCP do roteador
- Gateway: IP do roteador (ex: 192.168.1.1)

Netplan correto seria:
  wifis:
    wlx...:
      dhcp4: true   ← ou IP fixo com gateway do roteador
```

Nesse cenário, o servidor precisaria só de IP fixo na rede do roteador. Simples.

### O que você disse: "estamos via cabo ethernet"

```
Configuração real:
- Servidor conectado via cabo ethernet (enp1s0)
- Carro conectado na mesma rede via cabo
- Sem roteador como intermediário (ou com switch simples)
- IP fixo manual necessário pois não há DHCP garantido

Netplan correto:
  ethernets:
    enp1s0:
      addresses: [192.168.1.100/24]
      gateway4: 192.168.1.1
      nameservers:
        addresses: [8.8.8.8]
```

### O problema que causou confusão

O computador tinha **dois caminhos de rede ativos ao mesmo tempo**:
- `enp1s0` (cabo) com IP `192.168.1.100` e gateway `192.168.1.1`
- `wlx...` (Wi-Fi) conectado em outra rede com gateway diferente

O Linux ficou confuso sobre qual gateway usar para acessar a internet, gerando dois `default route` conflitantes. A solução foi forçar o DNS direto no `resolv.conf` para pelo menos instalar os pacotes.

---

## PARTE 4 — STATUS ATUAL DO PROJETO V2

### O que está FEITO ✅

| Componente | Status | Observação |
|---|---|---|
| Ubuntu Server instalado | ✅ | Dual boot com Windows |
| IP fixo ethernet configurado | ✅ | 192.168.1.100 via enp1s0 |
| SQLite instalado | ✅ | v3.37.2 |
| Banco de dados criado | ✅ | ~/telemetry_server/data/db/telemetria.db |
| Dependências do sistema | ✅ | build-essential, libssl-dev, git |
| decoder.rs | ✅ | Lê CSV, decodifica bits CAN, aplica fator/offset |
| edge/main.rs (novo) | ✅ | SocketCAN + Kvaser + prioridades CSV + backup SQLite |
| Cargo.toml edge | ✅ | Com feature flag para Kvaser opcional |

### O que está EM ANDAMENTO 🔄

| Componente | Status | Bloqueio atual |
|---|---|---|
| Compilação do servidor Rust | 🔄 | Problema de permissão resolvido, compilando |
| server/main.rs | 🔄 | Precisa implementar listener TCP + decodificação + INSERT |

### O que está FALTANDO ❌

| Componente | Prioridade | Descrição |
|---|---|---|
| server/main.rs completo | 🔴 Alta | Listener TCP, recebe frames, chama decoder, salva no banco |
| Teste end-to-end | 🔴 Alta | Rodar edge + servidor juntos com CAN real |
| App Android | 🟡 Média | Consome dados do servidor via REST/WebSocket |
| WebSocket no servidor | 🟡 Média | Para o app receber dados em tempo real |
| TimescaleDB | 🟢 Baixa | Substituir SQLite por PostgreSQL+Timescale para tempo real |
| WebRTC (comunicação piloto) | 🟢 Baixa | Fase 4 do checklist |
| RTSP (vídeo) | 🟢 Baixa | Fase 3 do checklist |
| Sistema de antenas | 🟢 Baixa | Requer hardware (NanoBeam, Yagi) |
| Adaptador Wi-Fi USB para AP | 🟢 Baixa | Chipset Atheros AR9271 |

### Próximo passo imediato

Terminar e testar o `server/main.rs` com o listener TCP. Sem ele, o edge não tem para onde enviar os dados e o sistema não funciona de ponta a ponta.

---

## PARTE 5 — MONITORAMENTO E GESTÃO DE BANDA DE REDE

Essa é uma pergunta excelente e muito relevante para quando vocês adicionarem vídeo e comunicação com o piloto.

### Como a rede está hoje (só telemetria)

```
Telemetria CAN: ~1000 frames/s × 24 bytes = ~24 KB/s = ~0.2 Mbit/s
Capacidade do cabo ethernet: 100 Mbit/s ou 1000 Mbit/s
Utilização atual: < 0.5% da banda disponível
```

Vocês estão usando quase nada da rede agora.

### Como ficará quando adicionar vídeo e áudio

```
Protocolo        │ Banda típica     │ Latência alvo
─────────────────┼──────────────────┼───────────────
Telemetria MQTT  │ 0.2 Mbit/s       │ < 20ms
Vídeo RTSP 1080p │ 4–8 Mbit/s       │ < 500ms
Áudio WebRTC     │ 0.1 Mbit/s       │ < 50ms
─────────────────┼──────────────────┼───────────────
TOTAL            │ ~8.5 Mbit/s      │ —
DISPONÍVEL       │ 100+ Mbit/s      │ —
MARGEM           │ > 90%            │ —
```

Mesmo com tudo junto, vocês ficam bem abaixo do limite do cabo.

### Como monitorar a rede em tempo real

#### Ferramenta 1 — iftop (monitor por interface, ao vivo)

```bash
sudo apt install iftop
sudo iftop -i enp1s0
```

Mostra quem está consumindo banda em tempo real, por conexão.

#### Ferramenta 2 — nethogs (monitor por processo)

```bash
sudo apt install nethogs
sudo nethogs enp1s0
```

Mostra quanto cada processo (servidor, vídeo, etc.) está usando.

#### Ferramenta 3 — nload (gráfico de banda simples)

```bash
sudo apt install nload
nload enp1s0
```

Mostra entrada/saída em tempo real com gráfico ASCII.

#### Ferramenta 4 — ss (conexões ativas)

```bash
# Ver todas as conexões TCP ativas com o servidor
ss -tnp | grep 8080

# Ver uso de buffer por conexão
ss -tnpi
```

#### Ferramenta 5 — Script de monitoramento contínuo

```bash
# Salva estatísticas de rede a cada segundo em CSV
watch -n 1 "cat /proc/net/dev | grep enp1s0"
```

Ou um script mais completo:

```bash
#!/bin/bash
# monitor_rede.sh — monitora banda usada por protocolo
echo "Timestamp,RX_bytes/s,TX_bytes/s" > rede_log.csv

IFACE="enp1s0"
PREV_RX=0
PREV_TX=0

while true; do
    RX=$(cat /sys/class/net/$IFACE/statistics/rx_bytes)
    TX=$(cat /sys/class/net/$IFACE/statistics/tx_bytes)
    
    if [ $PREV_RX -gt 0 ]; then
        RX_RATE=$((RX - PREV_RX))
        TX_RATE=$((TX - PREV_TX))
        TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
        echo "$TIMESTAMP,$RX_RATE,$TX_RATE"
        echo "$TIMESTAMP,$RX_RATE,$TX_RATE" >> rede_log.csv
    fi
    
    PREV_RX=$RX
    PREV_TX=$TX
    sleep 1
done
```

### Como separar banda por protocolo (QoS)

Quando precisar garantir que a telemetria sempre tem prioridade sobre vídeo, use **tc (Traffic Control)** do Linux:

```bash
# Instalar ferramentas
sudo apt install iproute2

# Criar fila com prioridades na interface
sudo tc qdisc add dev enp1s0 root handle 1: prio bands 3

# Banda 1 (Alta prioridade) → Telemetria porta 8080
sudo tc filter add dev enp1s0 parent 1: protocol ip prio 1 \
    u32 match ip dport 8080 0xffff flowid 1:1

# Banda 2 (Média prioridade) → Áudio WebRTC porta 5004
sudo tc filter add dev enp1s0 parent 1: protocol ip prio 2 \
    u32 match ip dport 5004 0xffff flowid 1:2

# Banda 3 (Baixa prioridade) → Vídeo RTSP porta 8554
sudo tc filter add dev enp1s0 parent 1: protocol ip prio 3 \
    u32 match ip dport 8554 0xffff flowid 1:3
```

Isso garante que **mesmo se o vídeo saturar a rede, a telemetria e o áudio são processados primeiro**.

### Resumo da estratégia de rede para quando tiver tudo

```
PORTA   PROTOCOLO    PRIORIDADE   BANDA RESERVADA
8080  → Telemetria   Alta (1)     5 Mbit/s garantido
5004  → Áudio WebRTC Alta (1)     1 Mbit/s garantido  
8554  → Vídeo RTSP   Média (2)    10 Mbit/s máximo
*     → Resto        Baixa (3)    Sobra da banda
```

Com cabo ethernet de 100 Mbit/s, isso é trivial. Só se torna crítico se migrar para Wi-Fi com sinal fraco (onde a banda disponível pode cair para 10-20 Mbit/s).

---

## PARTE 6 — PRÓXIMOS PASSOS RECOMENDADOS

### Imediato (hoje/amanhã)
1. Terminar compilação do servidor Rust
2. Implementar `server/main.rs` com listener TCP
3. Testar fluxo completo: edge → servidor → banco

### Curto prazo (esta semana)
4. Testar com CAN real no carro
5. Verificar dados chegando no banco do servidor
6. Conectar app Android ao servidor

### Médio prazo (próximas semanas)
7. Adicionar WebSocket no servidor para tempo real
8. Implementar RTSP para vídeo
9. Implementar WebRTC para comunicação com piloto
10. Configurar QoS de rede quando os três protocolos estiverem ativos

---

*Documento gerado em 01/03/2026 — E-Racing Ultra Blaster Telemetria V2*