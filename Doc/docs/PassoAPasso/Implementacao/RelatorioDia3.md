# RELATÓRIO GERAL — TELEMETRIA V2 E-RACING ULTRA BLASTER

**Data:** 08 de Março de 2026  
**Status:** Jetson com Rust instalado — compilação do edge em progresso

---

## PARTE 1 — O QUE FIZEMOS HOJE

### Linha do tempo do que foi executado

```
1. Retomada do estado da Jetson AGX Xavier
        ↓ Ubuntu 20.04 (aarch64, kernel 5.10.216-tegra)
        ↓ Git instalado — OK
        ↓ Repositório já clonado em ~/TelemetriaV2.0 — OK
        ↓ Rust/Cargo — NÃO instalado
        ↓ Interface CAN — não aparece no ip link show
        ↓ IP atual: 192.168.1.6 (eth0)

2. Tentativa de dar internet à Jetson
        ↓ Problema: Jetson sem internet — curl falha
        ↓ Causa: roteador 192.168.1.1 não tem saída para internet
        ↓ Tentativa: tethering USB do celular Xiaomi C14
        ↓ Conflito: celular criava sub-rede 192.168.1.x — mesma que a interna
        ↓ Solução adotada: servidor Ubuntu como gateway NAT para a Jetson

3. Configuração de NAT no servidor
        ↓ Habilitado ip_forward permanente no /etc/sysctl.conf
        ↓ Regras iptables MASQUERADE aplicadas (enp1s0 → wlx00e12907f625)
        ↓ Salvo permanentemente com netfilter-persistent
        ↓ Arquivo central de configuração: /etc/eracing/network.conf
        ↓ Script reutilizável: /etc/eracing/setup-nat.sh
        ↓ Para trocar interface Wi-Fi: editar só network.conf e rodar o script

4. Rota padrão na Jetson apontando para o servidor
        ↓ Tentativa via nmcli: nmcli connection modify + ipv4.routes
        ↓ Problema: rota sumia após reboot — solução não era permanente
        ↓ Solução definitiva: script de dispatcher do NetworkManager
        ↓ Criado /etc/NetworkManager/dispatcher.d/99-eracing-route.sh
        ↓ Script executa automaticamente toda vez que eth0 sobe (boot ou reconexão)
        ↓ Ping 8.8.8.8 funcionando ✅

5. Diagnóstico de falha no HTTPS (curl porta 443)
        ↓ Ping funcionava mas curl https:// falhava
        ↓ Tcpdump revelou: Jetson tentava conectar em 192.168.1.1:443
        ↓ Causa: /etc/resolv.conf apontava para o roteador (127.0.0.53 → 192.168.1.1)
        ↓ Roteador sem internet resolvia DNS errado / retornava o próprio IP
        ↓ Solução: forçar DNS 8.8.8.8 no resolv.conf + desativar DNSStubListener
        ↓ Curl passou a resolver sh.rustup.rs para 3.162.247.x ✅

6. Erro de certificado SSL (bad certificate 554)
        ↓ Curl conectou no IP correto mas falhou no TLS handshake
        ↓ Mensagem: "certificate is not yet valid"
        ↓ Causa raiz: relógio da Jetson estava em 01/01/2000
        ↓ Certificados emitidos depois de 2000 eram "inválidos no futuro"
        ↓ Solução: sudo ntpdate -u pool.ntp.org (sincronizou data correta)
        ↓ Curl passou sem erros ✅

7. Instalação do Rust na Jetson
        ↓ curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
        ↓ Toolchain: stable-aarch64-unknown-linux-gnu
        ↓ Versão instalada: rustc 1.94.0 (4a4ef493e 2026-03-02)
        ↓ source ~/.cargo/env
        ↓ rustc --version e cargo --version OK ✅

8. Tentativa de compilar telemetry-edge
        ↓ cd ~/TelemetriaV2.0/telemetry-edge && cargo build --release
        ↓ Erro: no matching package named 'canlib' found
        ↓ Causa: crate 'canlib' não existe no crates.io
        ↓ Tentativa 2: renomear para 'kvaser-canlib' — mesmo erro
        ↓ Verificação: ldconfig -p | grep canlib
        ↓ Resultado: libcanlib.so.1 e libcanlib.so presentes em /lib ✅
        ↓ Conclusão: biblioteca existe, mas não tem wrapper Rust oficial

9. Solução via FFI próprio
        ↓ Decisão: criar binding FFI direto para a libcanlib.so instalada
        ↓ Criado build.rs com println!("cargo:rustc-link-lib=canlib")
        ↓ Criado src/kvaser_ffi.rs com extern "C" para as funções da canlib
        ↓ Removida dependência do crate externo do Cargo.toml
        ↓ Problema adicional: Cargo.toml sem [package] — tratado como workspace virtual
        ↓ Erro: "this virtual manifest specifies a features section, which is not allowed"
        ↓ Correção: adicionar [package] completo ao Cargo.toml
        ↓ Compilação em andamento ao final da sessão 🔄
```

---

## PARTE 2 — GUIAS DE RESOLUÇÃO DE PROBLEMAS

### Como proceder se trocar a interface Wi-Fi do servidor

O servidor usa o Wi-Fi para ter internet e fazer NAT para a Jetson. Se a interface mudar
(ex: de `wlx00e12907f625` para outro dongle), o procedimento é:

```bash
# 1. Ver qual é a nova interface
ip link show | grep -E "^[0-9]"
# Procurar a interface que começa com "wlx" ou "wlan"

# 2. Atualizar o arquivo de configuração central
sudo nano /etc/eracing/network.conf
# Alterar a linha: WIFI_IFACE="novo_nome_da_interface"

# 3. Verificar se a nova interface está conectada e tem IP
ip addr show nova_interface
# Deve mostrar inet 192.168.x.x ou o IP da rede com internet

# 4. Reaplicar as regras de NAT
sudo /etc/eracing/setup-nat.sh

# 5. Salvar permanentemente
sudo netfilter-persistent save

# 6. Testar da Jetson
ping -c 3 8.8.8.8
```

**Conteúdo atual do /etc/eracing/network.conf:**
```
WIFI_IFACE="wlx00e12907f625"
LAN_IFACE="enp1s0"
JETSON_IP="192.168.1.6"
SERVER_IP="192.168.1.100"
```

---

### O que fazer se o servidor não tiver internet

O servidor precisa de internet apenas para: atualizar pacotes, baixar dependências Rust
e fazer NAT para a Jetson. O sistema de telemetria em si **funciona sem internet** — 
toda comunicação é local (192.168.1.x).

**Diagnóstico:**

```bash
# Verificar qual interface tem internet
ip route show
# Deve ter: default via X.X.X.X dev wlxXXXX (interface Wi-Fi)

# Se a rota default sumir:
ping -c 2 8.8.8.8   # falha
ping -c 2 192.168.1.1  # funciona = problema é na rota, não no cabo

# Verificar se o Wi-Fi está conectado
nmcli connection show --active
iwconfig  # ou iw dev wlxXXX link
```

**Causa mais comum — interface Wi-Fi mudou de nome:**
```bash
# Ver interface Wi-Fi atual
ip link show | grep wl
# Se for diferente do que está no network.conf:
sudo nano /etc/eracing/network.conf   # atualizar WIFI_IFACE
sudo /etc/eracing/setup-nat.sh
sudo netfilter-persistent save
```

**Causa — serviço NetworkManager não reconectou:**
```bash
nmcli connection show
nmcli connection up "nome_da_rede_wifi"
```

**O sistema de telemetria continua funcionando sem internet:**
```bash
# Verificar se servidor Rust está rodando
sudo systemctl status telemetry
# Verificar se bancos estão acessíveis
psql -U eracing -d telemetria -h localhost -c "SELECT COUNT(*) FROM sensor_data;"
sqlite3 ~/TelemetriaV2.0/telemetry-server/data/historico.db "SELECT COUNT(*) FROM historico;"
```

---

### O que fazer se a Jetson não tiver internet

A Jetson precisa de internet apenas para: instalar o Rust e baixar dependências Cargo.
Após compilado o binário, **a Jetson não precisa de internet** para operar.

**Diagnóstico:**

```bash
# Na Jetson — verificar rota
ip route show
# Deve ter: default via 192.168.1.100 dev eth0 metric 50

# Se a rota sumir após reboot (script dispatcher falhou):
cat /etc/NetworkManager/dispatcher.d/99-eracing-route.sh
# Verificar se o arquivo existe e tem permissão de execução

# Verificar se script está executável
ls -la /etc/NetworkManager/dispatcher.d/99-eracing-route.sh
# Deve mostrar: -rwxr-xr-x

# Reaplicar rota manualmente se necessário:
sudo ip route add default via 192.168.1.100 dev eth0 metric 50
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf

# Verificar se o servidor está fazendo NAT:
ping -c 3 192.168.1.100   # servidor acessível?
ping -c 3 8.8.8.8         # internet?
```

**Se o script dispatcher não executar no boot:**
```bash
# Verificar permissões
sudo chmod +x /etc/NetworkManager/dispatcher.d/99-eracing-route.sh
sudo chown root:root /etc/NetworkManager/dispatcher.d/99-eracing-route.sh

# Reiniciar NetworkManager para recarregar scripts
sudo systemctl restart NetworkManager

# Aguardar eth0 subir e testar
sleep 5 && ping -c 3 8.8.8.8
```

**Conteúdo do script /etc/NetworkManager/dispatcher.d/99-eracing-route.sh:**
```bash
#!/bin/bash
IFACE=$1
ACTION=$2

if [ "$IFACE" = "eth0" ] && [ "$ACTION" = "up" ]; then
    ip route add default via 192.168.1.100 dev eth0 metric 50
    echo "nameserver 8.8.8.8" > /etc/resolv.conf
fi
```

**Se o servidor não estiver fazendo NAT (ping 192.168.1.100 OK mas ping 8.8.8.8 falha):**
```bash
# No servidor:
sudo /etc/eracing/setup-nat.sh
sudo netfilter-persistent save
```

**Problema com relógio da Jetson (comum após longa inatividade):**
```bash
# Sintoma: curl falha com "certificate is not yet valid"
date   # se mostrar ano 2000 ou data muito antiga
sudo ntpdate -u pool.ntp.org   # sincronizar data/hora
date   # confirmar data correta
```

---

## PARTE 3 — DECISÕES TÉCNICAS IMPORTANTES

### Por que criamos FFI próprio para a canlib do Kvaser

A `libcanlib.so` do Kvaser está instalada na Jetson em `/lib/libcanlib.so.1`, mas não
existe um crate Rust oficial no crates.io para ela. A solução foi criar um binding FFI
direto usando `extern "C"` no Rust, que linka diretamente com a biblioteca instalada.

Isso é feito em dois arquivos:

**build.rs** (na raiz do projeto):
```rust
fn main() {
    #[cfg(feature = "kvaser")]
    {
        println!("cargo:rustc-link-lib=canlib");
        println!("cargo:rustc-link-search=/lib");
    }
}
```

**src/kvaser_ffi.rs** (assinaturas das funções C que usamos):
```rust
#[cfg(feature = "kvaser")]
pub mod canlib {
    #[link(name = "canlib")]
    extern "C" {
        pub fn canInitializeLibrary();
        pub fn canOpenChannel(channel: c_int, flags: c_int) -> c_int;
        pub fn canSetBusParams(...) -> c_int;
        pub fn canBusOn(handle: c_int) -> c_int;
        pub fn canReadWait(...) -> c_int;
        // ...
    }
}
```

Ao compilar com `--features kvaser`, o Cargo inclui o linker flag `-lcanlib`
automaticamente, conectando o binário Rust com a biblioteca C da Kvaser.

### Por que o DNS da Jetson apontava para o roteador

O Ubuntu 20.04 usa `systemd-resolved` com `DNSStubListener` ativo por padrão.
Isso faz o `/etc/resolv.conf` apontar para `127.0.0.53` (stub local), que por sua vez
usa o DNS recebido via DHCP — que no nosso caso era o roteador `192.168.1.1`.
Como o roteador não tem internet, as resoluções DNS falhavam ou retornavam o próprio IP.

A solução foi forçar o DNS 8.8.8.8 direto no `/etc/resolv.conf` e desativar o
`DNSStubListener`, além de garantir que o script dispatcher da Jetson recrie essa
configuração em todo boot.

### Por que o relógio da Jetson estava errado

A Jetson AGX Xavier usa um RTC (relógio de hardware) que perde a hora quando a bateria
do CMOS descarrega ou quando fica muito tempo sem energia. Sem NTP configurado para
sincronizar no boot, a Jetson iniciava com a data padrão de fábrica (01/01/2000).

Isso quebra qualquer verificação de certificado SSL, pois os certificados têm
data de validade e "ainda não existiam" do ponto de vista da Jetson.

A solução permanente é garantir que o NTP sincronize no boot. O script dispatcher
já corrige o DNS, mas seria ideal adicionar também:
```bash
# Em /etc/NetworkManager/dispatcher.d/99-eracing-route.sh, após a rota:
ntpdate -u pool.ntp.org &
```

---

## PARTE 4 — ARQUITETURA ATUAL DA JETSON

```
Jetson AGX Xavier (192.168.1.6, aarch64, Ubuntu 20.04)
      │
      ├── eth0 (cabo para roteador/switch)
      │     └── rota default → 192.168.1.100 (servidor) metric 50
      │           └── servidor faz NAT → internet
      │
      ├── Rust 1.94.0 instalado ✅
      ├── ~/TelemetriaV2.0 clonado ✅
      │
      ├── telemetry-edge (compilação em andamento 🔄)
      │     ├── Lê SocketCAN (can0) — interface ainda não aparece
      │     ├── Lê Kvaser SDK via FFI próprio (--features kvaser)
      │     └── Envia TCP → 192.168.1.100:8080
      │
      └── CAN bus (pendente — can0 não aparece ainda)
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
| Script /etc/eracing/setup-nat.sh | ✅ | Dia 3 |
| Rota permanente na Jetson (dispatcher) | ✅ | Dia 3 |
| DNS 8.8.8.8 permanente na Jetson | ✅ | Dia 3 |
| Rust 1.94.0 na Jetson (aarch64) | ✅ | Dia 3 |
| FFI próprio para libcanlib.so | ✅ | Dia 3 |

### O que está PENDENTE ❌

| Componente | Prioridade | Descrição |
|---|---|---|
| Compilar telemetry-edge | 🔴 Alta | cargo build --release --features kvaser |
| Subir interface can0 | 🔴 Alta | ip link set can0 type can bitrate 500000 |
| Testar candump | 🔴 Alta | Confirmar IDs batem com CSV |
| Teste end-to-end | 🔴 Alta | CAN → Jetson → Wi-Fi → Servidor → bancos |
| Configurar antenas Unifi | 🟡 Média | Modo AP + Station |
| IP fixo na Jetson (192.168.1.101) | 🟡 Média | Netplan ou nmcli |
| App Android | 🟡 Média | WebSocket :8081 |
| Acesso SSH remoto (fora da rede local) | 🟡 Média | Ver seção de melhorias |

---

## PARTE 6 — PROBLEMAS RESOLVIDOS E LIÇÕES APRENDIDAS

### Sequência de diagnóstico de rede — do mais simples ao mais complexo

Quando a Jetson não tem internet, seguir sempre esta ordem:

```
1. ping 192.168.1.100  → Se falhar: cabo ou configuração de rede local
2. ping 8.8.8.8        → Se falhar: rota default ou NAT no servidor
3. curl http://...     → Se falhar: regras de FORWARD no iptables
4. curl https://...    → Se falhar: DNS ou certificado SSL
5. date                → Se data errada: ntpdate antes de qualquer curl
```

### Erro "no matching package named X" no Cargo

Quando um crate não existe no crates.io, as opções são:
1. Verificar se a biblioteca nativa (`.so`) já está instalada com `ldconfig -p | grep nome`
2. Se estiver: criar FFI próprio com `extern "C"` + `build.rs`
3. Se não estiver: instalar a biblioteca nativa primeiro, depois criar o FFI

### Virtual manifest vs package manifest no Cargo

Se o `Cargo.toml` não tem `[package]`, o Cargo trata o arquivo como um **workspace
virtual** — que não pode ter `[features]`, `[dependencies]` ou `[profile]`.

Todo subprojeto que compila um binário deve ter:
```toml
[package]
name = "nome-do-projeto"
version = "x.y.z"
edition = "2021"
```

---

## PARTE 7 — PRÓXIMOS PASSOS (DIA 4)

```
1. Confirmar compilação do telemetry-edge com --features kvaser
2. Subir interface CAN:
   sudo ip link set can0 type can bitrate 500000
   sudo ip link set up can0
   candump can0   # ver se chegam frames do barramento

3. Se can0 não aparecer:
   lsmod | grep can          # ver se módulo está carregado
   sudo modprobe can
   sudo modprobe can_raw
   sudo modprobe mttcan      # módulo CAN específico da Jetson NVIDIA

4. Configurar can0 para subir no boot:
   Criar /etc/network/interfaces.d/can0

5. Rodar telemetry-edge apontando para servidor:
   ./target/release/telemetry-edge \
     --pasta_csv ~/TelemetriaV2.0/telemetry-server/csv_data \
     --ch0 can0 --ch1 0 \
     --server 192.168.1.100:8080

6. Verificar dados chegando no servidor:
   psql -U eracing -d telemetria -h localhost \
     -c "SELECT COUNT(*) FROM sensor_data;"
   watch -n 1 'sqlite3 .../historico.db "SELECT COUNT(*) FROM historico;"'

7. Configurar antenas Unifi (se disponíveis):
   Antena base → Mode: Access Point, SSID: eracing_telemetry, 5GHz
   Antena carro → Mode: Station, apontar para SSID da base

8. Configurar IP fixo na Jetson (192.168.1.101) via nmcli:
   sudo nmcli connection modify "Profile 1" ipv4.addresses 192.168.1.101/24
   sudo nmcli connection modify "Profile 1" ipv4.method manual
```

---

*Documento gerado em 08/03/2026 — E-Racing Ultra Blaster Telemetria V2*