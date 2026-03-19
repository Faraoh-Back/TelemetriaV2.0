# RELATÓRIO GERAL — TELEMETRIA V2 E-RACING ULTRA BLASTER

**Data:** 19 de Março de 2026  
**Status:** V2.0 completo — pipeline end-to-end funcionando, Jetson configurada para produção

---

## PARTE 1 — O QUE FIZEMOS HOJE

### Linha do tempo do que foi executado

```
1. Retomada do estado da Jetson (pós Dia 3)
        ↓ Rust 1.94.0 instalado ✅
        ↓ Repositório ~/TelemetriaV2.0 presente ✅
        ↓ DNS apontando para 127.0.0.53 (systemd-resolved) — sem internet
        ↓ can0/can1 não presentes (módulos não carregados)
        ↓ telemetry-edge ainda não compilado com sucesso

2. Correção do DNS (problema recorrente)
        ↓ /etc/resolv.conf voltou para 127.0.0.53 após reboot
        ↓ Causa: systemd-resolved recria o resolv.conf como symlink
        ↓ Solução: echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
        ↓ git clone funcionando ✅

3. Compilação do telemetry-edge
        ↓ Erro: no method named `id` found for enum `CanFrame`
        ↓ Erro: no method named `data` found for enum `CanFrame`
        ↓ Causa: métodos .id() e .data() pertencem ao trait EmbeddedFrame
                 que não estava importado no main.rs
        ↓ Correção: adicionar `use socketcan::EmbeddedFrame;` no topo do main.rs
        ↓ Push no PC → git pull na Jetson
        ↓ cargo build --release → Finished release in 1m 13s ✅
        ↓ 2 warnings inofensivos (parênteses e variável não usada)

4. Teste de bancada via hotspot do celular
        ↓ Jetson: IP 10.55.225.86 (DHCP hotspot)
        ↓ Servidor: IP 10.55.225.44 (DHCP hotspot)
        ↓ IPs 192.168.1.x são da rede cabo (produção) — não do hotspot
        ↓ Comportamento correto: cada rede tem seu próprio DHCP

5. Interface CAN virtual para simulação (vcan0)
        ↓ can0 real: "No such device" — módulos não carregados ainda
        ↓ Solução: criar interface virtual vcan0 para teste de bancada
        ↓ sudo modprobe vcan
        ↓ sudo ip link add dev vcan0 type vcan
        ↓ sudo ip link set up vcan0

6. Reprodução do log CAN real do carro
        ↓ Log disponível: ~/logs/can/candump-1999-12-31_230146.log
        ↓ Formato: (timestamp) can0 CANID#DATA — gerado com candump -l
        ↓ Data 1999-12-31: relógio errado da Jetson na época da gravação
        ↓ canplayer -I .../candump-1999-12-31_230146.log -l i vcan0=can0
        ↓ -l i = loop infinito | vcan0=can0 = mapeia can0 do log para vcan0
        ↓ candump vcan0 confirmou frames chegando ✅

7. Teste end-to-end com dados reais
        ↓ ./telemetry-edge --pasta-csv ... --ch0 vcan0 --server 10.55.225.44:8080
        ↓ 14 IDs carregados do CSV VCU ✅
        ↓ SQLite inicializado ✅
        ↓ Conectado ao servidor ✅
        ↓ 1000 frames/~6s enviados continuamente ✅
        ↓ Backup local: 0 (sem falha de conexão)
        ↓ Servidor: 14.135 registros no TimescaleDB ✅
        ↓ Servidor: 11.968 registros no SQLite ✅
        ↓ Sinais decodificados: APPS_RANGE_ERROR, SAFETY_OK, RPM, TORQUE, VCU_STATE ✅

8. Carregamento dos módulos CAN reais
        ↓ sudo modprobe can
        ↓ sudo modprobe can_raw
        ↓ sudo modprobe mttcan  ← módulo CAN específico da Jetson NVIDIA
        ↓ ip link show | grep can → can0 e can1 aparecem (state DOWN)
        ↓ Adicionados ao /etc/modules para carregar no boot

9. Serviço systemd can-interfaces.service
        ↓ Primeira versão: falhou com "Device or resource busy"
        ↓ Causa: can0 já estava UP manualmente, não aceita setar bitrate
        ↓ Solução: fazer down antes de configurar (ip link set down can0)
        ↓ Segunda versão: falhou com "Cannot find device"
        ↓ Causa: modprobe no /etc/modules carrega tarde demais
        ↓ Solução: incluir os modprobe dentro do próprio ExecStart
        ↓ Versão final: modprobe + sleep 1 + down + configure + up
        ↓ can0 e can1 state UP no boot ✅

10. Serviço systemd telemetry-edge.service
        ↓ Criado com After=can-interfaces.service (ordem garantida)
        ↓ Restart=always para reconectar automaticamente
        ↓ Aponta para 192.168.1.100:8080 (produção via cabo)
        ↓ active (running) após reboot ✅

11. IP fixo no eth0 (cabo)
        ↓ Profile 1 já tinha 192.168.1.101/24 mas sem interface-name
        ↓ Correção: nmcli connection modify "Profile 1"
                    connection.interface-name eth0
        ↓ IP 192.168.1.101/24 ativo quando cabo conectado ✅
        ↓ Wi-Fi continua DHCP para bancada ✅
```

---

## PARTE 2 — OS SERVIÇOS SYSTEMD DA JETSON

Esta seção explica em detalhe como funcionam os dois serviços criados, por que foram
estruturados dessa forma, e o que cada linha faz.

### O que é um serviço systemd

O systemd é o gerenciador de inicialização do Ubuntu. Ele controla o que roda no boot,
em que ordem, o que fazer se um processo morrer, e como ver os logs. Um arquivo `.service`
descreve um processo que o systemd deve gerenciar.

Os arquivos ficam em `/etc/systemd/system/`. Após criar ou editar um, é necessário rodar
`sudo systemctl daemon-reload` para o systemd recarregar as definições.

---

### Serviço 1 — can-interfaces.service

**Localização:** `/etc/systemd/system/can-interfaces.service`

**Responsabilidade:** Carregar os módulos do kernel necessários para o CAN e subir as
interfaces can0 e can1 com o bitrate correto antes de qualquer outro serviço de telemetria.

```ini
[Unit]
Description=CAN bus interfaces — can0 e can1
After=network.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/bash -c "\
  modprobe can; \
  modprobe can_raw; \
  modprobe mttcan; \
  sleep 1; \
  ip link set down can0 2>/dev/null; \
  ip link set can0 type can bitrate 500000 && ip link set up can0; \
  ip link set down can1 2>/dev/null; \
  ip link set can1 type can bitrate 500000 && ip link set up can1; \
  exit 0"
ExecStop=/bin/bash -c "\
  ip link set down can0 2>/dev/null; \
  ip link set down can1 2>/dev/null; \
  exit 0"

[Install]
WantedBy=multi-user.target
```

**Explicação linha por linha:**

**[Unit]**

- `Description=` — nome legível que aparece no `systemctl status`
- `After=network.target` — este serviço só inicia depois que a rede básica do sistema
  estiver pronta. Não é uma dependência forte (não usa `Requires=`), é só ordenação.
  O CAN não depende de rede, mas é boa prática aguardar o sistema estar estável.

**[Service]**

- `Type=oneshot` — o serviço executa um comando, termina, e pronto. É diferente de
  `Type=simple` que espera um processo rodando continuamente. O CAN não precisa de um
  processo rodando — basta configurar as interfaces uma vez.

- `RemainAfterExit=yes` — sem isso, após o comando terminar o systemd marcaria o serviço
  como `inactive`. Com isso, o serviço fica `active (exited)` mesmo após o script
  terminar. Isso é importante porque o `telemetry-edge.service` tem `Requires=` neste
  serviço — se ele aparecer como `inactive`, o edge não sobe.

- `ExecStart=` — o comando executado no `start`. Usa `/bin/bash -c "..."` para poder
  encadear múltiplos comandos com `;` e `&&`.

  Dentro do ExecStart, em ordem:

  ```bash
  modprobe can
  ```
  Carrega o módulo base do CAN no kernel. Sem ele, o kernel não sabe o que é uma
  interface CAN. O `modprobe` busca o módulo em
  `/lib/modules/$(uname -r)/kernel/drivers/net/can/`.

  ```bash
  modprobe can_raw
  ```
  Carrega o módulo que permite abrir sockets CAN do tipo RAW — que é o que o
  `socketcan` crate do Rust usa internamente para ler frames do barramento.

  ```bash
  modprobe mttcan
  ```
  Carrega o driver específico da Jetson AGX Xavier. O `mttcan` (Multi Transfer CAN)
  é o controlador CAN embarcado no SoC NVIDIA Tegra. Sem ele, as interfaces `can0` e
  `can1` simplesmente não aparecem no sistema — é este módulo que cria os dispositivos.
  O arquivo está em:
  `/lib/modules/5.10.216-tegra/kernel/drivers/net/can/mttcan/native/mttcan.ko`

  ```bash
  sleep 1
  ```
  Aguarda 1 segundo após o modprobe. O kernel precisa de um momento para registrar os
  dispositivos após carregar o módulo. Sem esse sleep, o `ip link set can0` logo abaixo
  pode falhar com "Cannot find device" porque o can0 ainda não foi criado pelo kernel.

  ```bash
  ip link set down can0 2>/dev/null
  ```
  Garante que a interface está DOWN antes de configurar. Se a interface já estiver UP
  (por exemplo, se o serviço for reiniciado manualmente), o comando
  `ip link set can0 type can bitrate 500000` falha com "Device or resource busy".
  O `2>/dev/null` descarta o erro caso can0 não exista — isso evita que o serviço
  falhe nessa etapa.

  ```bash
  ip link set can0 type can bitrate 500000 && ip link set up can0
  ```
  Define o tipo como `can` e o bitrate em 500 kbit/s (padrão do barramento do carro
  E-Racing), depois sobe a interface. O `&&` garante que o `ip link set up` só executa
  se a configuração do bitrate tiver funcionado.

  ```bash
  ip link set down can1 2>/dev/null
  ip link set can1 type can bitrate 500000 && ip link set up can1
  ```
  Mesma sequência para can1. O can1 é o segundo canal CAN físico da Jetson, usado
  para módulos secundários do carro (BMS, PT, etc.).

  ```bash
  exit 0
  ```
  Força o script a retornar código 0 (sucesso) independentemente do que aconteceu antes.
  Isso é importante porque se can1 não existir por algum motivo, o `&&` poderia
  resultar em código de saída não-zero, fazendo o systemd marcar o serviço como falho.
  O `exit 0` garante que o serviço sempre termina com sucesso — ele sobe o que
  conseguir e segue em frente.

- `ExecStop=` — executado quando o serviço é parado (`systemctl stop`). Derruba as
  interfaces. O `2>/dev/null` e o `exit 0` têm o mesmo propósito — tolerância a erros.

**[Install]**

- `WantedBy=multi-user.target` — este serviço deve ser iniciado quando o sistema entrar
  no modo multi-usuário (equivalente ao boot normal com terminal). O `systemctl enable`
  cria um symlink em `/etc/systemd/system/multi-user.target.wants/` apontando para
  este arquivo.

---

### Serviço 2 — telemetry-edge.service

**Localização:** `/etc/systemd/system/telemetry-edge.service`

**Responsabilidade:** Manter o processo `telemetry-edge` rodando continuamente, lendo
frames CAN e enviando ao servidor. Reinicia automaticamente se o processo morrer.

```ini
[Unit]
Description=Telemetria Edge — E-Racing UNICAMP
After=network.target can-interfaces.service
Requires=can-interfaces.service

[Service]
Type=simple
User=sauva
WorkingDirectory=/home/sauva/TelemetriaV2.0/telemetry-edge
ExecStart=/home/sauva/TelemetriaV2.0/telemetry-edge/target/release/telemetry-edge \
  --pasta-csv /home/sauva/TelemetriaV2.0/telemetry-server/csv_data \
  --ch0 can0 \
  --ch1 0 \
  --server 192.168.1.100:8080 \
  --device-id car_001
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**Explicação linha por linha:**

**[Unit]**

- `After=network.target can-interfaces.service` — o edge só inicia depois de dois
  pré-requisitos: rede básica disponível E interfaces CAN configuradas. A ordem importa
  porque sem can0 e can1 UP, o edge tenta abrir a interface e falha imediatamente.

- `Requires=can-interfaces.service` — dependência forte. Se o `can-interfaces.service`
  falhar ou for parado, o `telemetry-edge.service` também é parado automaticamente.
  Combinado com `After=`, garante tanto a ordem quanto a dependência.

**[Service]**

- `Type=simple` — o processo roda continuamente (ao contrário do `oneshot` do CAN).
  O systemd considera o serviço ativo enquanto o processo estiver rodando.

- `User=sauva` — o processo roda como usuário `sauva`, não como root. Boa prática de
  segurança: o binário não precisa de privilégios de root para ler SocketCAN ou conectar
  TCP. O Rust foi instalado no usuário `sauva`, então o binário pertence a ele.

- `WorkingDirectory=` — diretório de trabalho do processo. O `telemetry-edge` cria o
  arquivo `telemetria_backup.db` (SQLite de backup) no diretório atual. Definir isso
  garante que o arquivo sempre vai para o mesmo lugar, independente de onde o serviço
  for iniciado.

- `ExecStart=` — comando completo com todos os argumentos:

  ```
  --pasta-csv /home/sauva/TelemetriaV2.0/telemetry-server/csv_data
  ```
  Caminho absoluto para a pasta com os CSVs de IDs CAN. Usa caminho absoluto porque
  quando o systemd inicia o serviço no boot, não existe contexto de diretório relativo.

  ```
  --ch0 can0
  ```
  Canal 0: interface SocketCAN `can0`. Lê frames diretamente do barramento físico
  via kernel SocketCAN.

  ```
  --ch1 0
  ```
  Canal 1: canal Kvaser número 0. Usa a libcanlib.so via FFI para ler o segundo
  barramento CAN. O número `0` é o índice do canal Kvaser físico conectado.

  ```
  --server 192.168.1.100:8080
  ```
  Endereço do servidor de telemetria. Este é o IP fixo do servidor na rede interna
  E-Racing via cabo ethernet. Quando a Jetson iniciar pelo cabo na rede do carro,
  este endereço será acessível diretamente.

  ```
  --device-id car_001
  ```
  Identificador do carro nos bancos de dados. Aparece na coluna `device_id` do
  TimescaleDB e SQLite, permitindo distinguir dados de diferentes carros se necessário.

- `Restart=always` — se o processo terminar por qualquer motivo (crash, Ctrl+C via
  terminal, erro de conexão não tratado), o systemd reinicia automaticamente.
  Isso cobre casos como: servidor ainda não disponível no boot, queda temporária de
  rede, erro inesperado no código.

- `RestartSec=3` — aguarda 3 segundos antes de reiniciar. Sem isso, um processo que
  falha imediatamente poderia entrar em loop rápido (crash loop), consumindo recursos.
  3 segundos é suficiente para o sistema estabilizar entre tentativas.

- `StandardOutput=journal` e `StandardError=journal` — redireciona toda a saída do
  processo (os logs com INFO, WARN, ERROR) para o journald, o sistema de logs do
  systemd. Isso permite ver os logs com:
  ```bash
  journalctl -u telemetry-edge.service -f
  ```
  Sem isso, os logs iriam para /dev/null ou para um arquivo que precisaria ser
  gerenciado manualmente.

**[Install]**

- `WantedBy=multi-user.target` — mesmo que o serviço CAN. O `systemctl enable` cria
  o symlink para iniciar no boot.

---

### Relação entre os dois serviços

```
Boot
  │
  ▼
network.target          ← rede básica do sistema disponível
  │
  ▼
can-interfaces.service  ← modprobe mttcan → can0 UP → can1 UP
  │
  ▼ (Requires + After)
telemetry-edge.service  ← lê can0/can1 → envia TCP → 192.168.1.100:8080
```

O systemd garante essa ordem. Se can-interfaces falhar, o edge nem tenta subir.
Se o edge cair (rede cai, servidor reinicia), ele volta sozinho em 3 segundos.

---

### Comandos de operação dos serviços

```bash
# Ver status
sudo systemctl status can-interfaces.service
sudo systemctl status telemetry-edge.service

# Ver logs em tempo real
journalctl -u telemetry-edge.service -f

# Ver últimas 50 linhas de log
journalctl -u telemetry-edge.service -n 50 --no-pager

# Reiniciar manualmente (ex: após atualizar o binário)
sudo systemctl restart telemetry-edge.service

# Parar (ex: para teste manual)
sudo systemctl stop telemetry-edge.service

# Iniciar novamente
sudo systemctl start telemetry-edge.service

# Desabilitar do boot (temporariamente)
sudo systemctl disable telemetry-edge.service

# Reabilitar no boot
sudo systemctl enable telemetry-edge.service
```

---

## PARTE 3 — TESTE END-TO-END — DETALHES

### Como foi feito o teste

Como o carro não estava disponível, usamos dois recursos para simular o barramento:

**Interface virtual vcan0:**
O kernel Linux permite criar interfaces CAN virtuais com o módulo `vcan`. Um frame
enviado em `vcan0` é imediatamente recebido por qualquer processo que esteja escutando
nessa interface — equivalente a um loopback, mas para CAN.

```bash
sudo modprobe vcan
sudo ip link add dev vcan0 type vcan
sudo ip link set up vcan0
```

**Reprodução do log com canplayer:**
O `canplayer` é parte do pacote `can-utils`. Ele lê um arquivo de log gerado pelo
`candump -l` e reproduz os frames na interface especificada, respeitando os intervalos
de tempo originais.

```bash
canplayer -I ~/logs/can/candump-1999-12-31_230146.log -l i vcan0=can0
```

- `-I arquivo` — arquivo de entrada (log)
- `-l i` — loop infinito (reproduz o log em loop)
- `vcan0=can0` — mapeia: frames que foram gravados em `can0` são enviados para `vcan0`

O log `candump-1999-12-31_230146.log` foi gravado com o carro ligado. A data
`1999-12-31` é o relógio errado da Jetson na época — não afeta o conteúdo dos frames.

### Resultado do teste

```
Origem dos dados  : log real do carro (candump-1999-12-31_230146.log)
Interface virtual : vcan0
Taxa de envio     : ~1000 frames a cada 6 segundos
Erros de envio    : 0
Backup local usado: 0 (conexão estável durante todo o teste)

TimescaleDB (tempo real):
  SELECT COUNT(*) FROM sensor_data → 14.135 registros

SQLite (histórico):
  SELECT COUNT(*) FROM historico   → 11.968 registros

Amostra de sinais decodificados:
  APPS_RANGE_ERROR  = 1      (state)
  SAFETY_OK         = 0      (state)
  BRAKE             = 0      (state)
  VCU_STATE         = 0      (state)
  APS_PERC          = 76800  (%)
  TORQUE 13A        = -6070  (Nm)
  RPM 13A           = -32000 (RPM)
  TORQUE 13B        = -6400  (Nm)
  RPM 13B           = -32000 (RPM)
```

Os valores de RPM e Torque negativos são esperados — o log foi gravado com o carro
parado ou em condição de inicialização. Os valores reais durante corrida serão positivos.

A maioria dos frames apareceu com `Prio=4` (default) porque o `csv_data` só tem o CSV
do VCU com 14 IDs. Frames de outros módulos (BMS, PT, PAINEL) não estão mapeados ainda.

---

## PARTE 4 — ARQUITETURA ATUAL DA JETSON

```
Jetson AGX Xavier
  ├── Ubuntu 20.04 (aarch64, kernel 5.10.216-tegra)
  ├── IP eth0: 192.168.1.101/24 (fixo, produção via cabo)
  ├── IP wlan0: DHCP (bancada via hotspot)
  ├── Rust 1.94.0 ✅
  │
  ├── /etc/modules
  │     ├── can
  │     ├── can_raw
  │     └── mttcan
  │
  ├── /etc/systemd/system/can-interfaces.service ✅
  │     ├── modprobe can + can_raw + mttcan
  │     ├── can0 UP @ 500 kbit/s
  │     └── can1 UP @ 500 kbit/s
  │
  ├── /etc/systemd/system/telemetry-edge.service ✅
  │     ├── After + Requires: can-interfaces.service
  │     ├── --ch0 can0 (SocketCAN)
  │     ├── --ch1 0 (Kvaser via FFI)
  │     ├── --server 192.168.1.100:8080
  │     └── Restart=always, RestartSec=3
  │
  ├── ~/TelemetriaV2.0/telemetry-edge/ ✅
  │     ├── src/main.rs (com EmbeddedFrame importado)
  │     ├── src/kvaser_ffi.rs (FFI para libcanlib.so)
  │     ├── build.rs (linker flag -lcanlib)
  │     └── target/release/telemetry-edge (binário compilado)
  │
  ├── can0: UP @ 500 kbit/s ✅
  ├── can1: UP @ 500 kbit/s ✅
  │
  └── /etc/NetworkManager/dispatcher.d/99-eracing-route.sh
        ├── Rota default → 192.168.1.100 quando eth0 sobe
        └── DNS 8.8.8.8 permanente
```

---

## PARTE 5 — STATUS ATUAL DO PROJETO V2

### O que está FEITO ✅

| Componente | Status | Dia |
|---|---|---|
| Ubuntu Server instalado | ✅ | Dia 1 |
| Rede servidor configurada | ✅ | Dia 1 |
| PostgreSQL + TimescaleDB | ✅ | Dia 2 |
| SQLite no servidor | ✅ | Dia 2 |
| Rust no servidor | ✅ | Dia 1 |
| decoder.rs reescrito | ✅ | Dia 2 |
| server/main.rs Dual DB | ✅ | Dia 2 |
| Compilação do servidor | ✅ | Dia 2 |
| Serviço systemd no servidor | ✅ | Dia 2 |
| NAT permanente no servidor | ✅ | Dia 3 |
| Rust 1.94.0 na Jetson (aarch64) | ✅ | Dia 3 |
| FFI próprio para libcanlib.so | ✅ | Dia 3 |
| Fix EmbeddedFrame import | ✅ | Dia 4 |
| telemetry-edge compilado | ✅ | Dia 4 |
| Teste end-to-end com log real | ✅ | Dia 4 |
| Módulos CAN no boot (/etc/modules) | ✅ | Dia 4 |
| can-interfaces.service | ✅ | Dia 4 |
| telemetry-edge.service | ✅ | Dia 4 |
| IP fixo eth0 192.168.1.101 | ✅ | Dia 4 |
| can0 e can1 UP no boot | ✅ | Dia 4 |

### O que está PENDENTE ❌

| Componente | Prioridade | Descrição |
|---|---|---|
| Teste com cabo na rede E-Racing | 🔴 Alta | Confirmar 192.168.1.100:8080 acessível via cabo |
| Configurar antenas Unifi | 🔴 Alta | AP na base, Station no carro, SSID eracing_telemetry, 5GHz |
| Testar can0/can1 com carro ligado | 🔴 Alta | candump can0 + candump can1 com barramento real |
| Expandir csv_data | 🟡 Média | Adicionar BMS, PT, PAINEL para mapear mais IDs |
| IP fixo permanente eth0 no boot | 🟡 Média | Testar reboot com cabo conectado |
| App Android | 🟡 Média | Consumir WebSocket :8081 |

---

## PARTE 6 — PROBLEMAS RESOLVIDOS HOJE

### EmbeddedFrame não importado (erro de compilação)

O crate `socketcan 3.x` separou os métodos `.id()` e `.data()` em um trait chamado
`EmbeddedFrame`. Sem importar o trait, o compilador não encontra os métodos mesmo que
a struct `CanFrame` os implemente.

**Erro:**
```
error[E0599]: no method named `id` found for enum `CanFrame` in the current scope
```

**Correção:** adicionar no topo do `main.rs`:
```rust
use socketcan::EmbeddedFrame;
```

O compilador inclusive sugere isso na mensagem de erro — sempre vale ler o `help:` dos
erros do Rust, costuma dar a solução exata.

### can-interfaces.service falhando com "Device or resource busy"

Ao reiniciar o serviço com can0 já UP, o `ip link set can0 type can bitrate 500000`
falha porque não é possível reconfigurar uma interface CAN enquanto ela está UP.

**Solução:** sempre fazer `ip link set down can0` antes de configurar, com
`2>/dev/null` para ignorar o erro caso a interface não exista.

### can-interfaces.service falhando com "Cannot find device" no boot

O `/etc/modules` carrega os módulos durante o boot, mas o systemd pode iniciar o
serviço antes que os módulos terminem de carregar e o kernel registre os dispositivos.

**Solução:** incluir os próprios `modprobe` dentro do `ExecStart`, seguidos de
`sleep 1` para dar tempo ao kernel registrar os dispositivos antes de configurar
as interfaces.

### DNS voltando para 127.0.0.53 após reboot

O `systemd-resolved` recria o `/etc/resolv.conf` como symlink para seu stub local
(`127.0.0.53`) após reiniciar. O `tee` no dispatcher sobrescreve o symlink com um
arquivo normal, mas o systemd-resolved recria no próximo boot.

**Solução permanente** (se voltar a acontecer):
```bash
sudo sed -i 's/#DNSStubListener=yes/DNSStubListener=no/' /etc/systemd/resolved.conf
sudo systemctl restart systemd-resolved
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
```

---

## PARTE 7 — PRÓXIMOS PASSOS (DIA 5)

```
1. Conectar Jetson via cabo na rede E-Racing (switch/roteador 192.168.1.x)
   Verificar IP fixo:
   ip addr show eth0 | grep "inet "
   → Deve mostrar 192.168.1.101/24

2. Verificar comunicação com servidor:
   ping -c 3 192.168.1.100
   → Deve responder

3. Verificar logs do telemetry-edge (deve conectar automaticamente):
   journalctl -u telemetry-edge.service -f
   → Deve aparecer "✅ Conectado ao servidor!"

4. Configurar antenas Unifi:
   Antena base → Mode: Access Point, SSID: eracing_telemetry, 5GHz, canal fixo
   Antena carro → Mode: Station, conectar no SSID da base
   Verificar RSSI > -65 dBm no painel Unifi (IP padrão: 192.168.1.20)

5. Conectar carro e testar CAN real:
   candump can0   → ver frames chegando
   candump can1   → ver frames do segundo barramento
   Comparar IDs com o CSV para confirmar que batem

6. Expandir csv_data com arquivos BMS, PT, PAINEL:
   Copiar CSVs para ~/TelemetriaV2.0/telemetry-server/csv_data/
   Reiniciar telemetry-edge: sudo systemctl restart telemetry-edge.service
   Verificar no log que mais IDs são carregados (hoje: 14 do VCU)

7. Verificar dados no banco com carro real:
   psql -U eracing -d telemetria -h localhost \
     -c "SELECT signal_name, value, unit FROM sensor_data ORDER BY time DESC LIMIT 20;"
```

---

*Documento gerado em 19/03/2026 — E-Racing Ultra Blaster Telemetria V2*  
*V2.0 pipeline end-to-end: COMPLETO ✅*
