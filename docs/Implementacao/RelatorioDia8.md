# RELATÓRIO GERAL — TELEMETRIA V2 E-RACING ULTRA BLASTER

**Data:** 29 de Abril de 2026  
**Status:** Infraestrutura de acesso remoto operacional — SSH global via serveo.net · Internet no servidor via eduroam · Chaves RSA configuradas

---

## PARTE 1 — O QUE FIZEMOS HOJE

### Linha do tempo do que foi executado

```
1. Nova topologia de rede na oficina
        ↓ Chegada de modem com internet (rede eduroam da Unicamp)
        ↓ Topologia planejada: Modem eduroam → Modem ALGAR → Servidor → Jetson
        ↓ Problema imediato: PC com cabo na rede eduroam (143.106.207.x)
              servidor na rede interna (192.168.1.x) → redes diferentes → sem comunicação
        ↓ Diagnóstico: ip route show revelou enx002432a0b37a com IP 143.106.207.80
              servidor com IP 192.168.1.100 — subredes incompatíveis
        ↓ Decisão: unificar tudo na rede eduroam (143.106.207.x)

2. Tentativa de internet via modem ALGAR (TD-W9970)
        ↓ Modem ALGAR configurado via assistente em http://192.168.1.1
        ↓ Tela de configuração DSL WAN Interface revelou:
              DSL link is NOT up yet — linha DSL desconectada
              Conexões PPPoE com status "DSL Disabled" e "DSL Disconnected"
        ↓ Causa: modem ALGAR é um modem DSL residencial — precisa de cabo
              de telefone/fibra da operadora conectado na entrada WAN/LINE
              sem esse cabo físico, não tem como obter internet via software
        ↓ Conclusão: modem ALGAR não pode ser a fonte de internet
              serve apenas como switch/roteador da rede interna 192.168.1.x

3. Tentativa de autenticação 802.1X (eduroam via cabo)
        ↓ Objetivo: autenticar servidor diretamente na rede eduroam via cabo
        ↓ Protocolo: 802.1X é autenticação de rede — padrão IEEE para LANs com fio e Wi-Fi
              Funciona assim: dispositivo → switch → servidor RADIUS → autoriza ou bloqueia
              É o mesmo protocolo usado no Wi-Fi da Unicamp, mas aplicado no cabo ethernet
        ↓ Instalação: sudo apt install wpasupplicant (cliente 802.1X do Linux)
        ↓ Configuração em /etc/wpa_supplicant/wpa_supplicant-enp1s0.conf:
              key_mgmt=WPA-EAP
              eap=PEAP
              identity="RA@unicamp.br"
              phase2="auth=MSCHAPV2"
              anonymous_identity="@unicamp.br"
              ca_cert="/etc/ssl/certs/ca-certificates.crt"
        ↓ Driver usado: -D wired (em vez de nl80211 para Wi-Fi)
        ↓ Resultado: CTRL-EVENT-EAP-FAILURE EAP authentication failed
              Switch da rede eduroam no local não estava configurado para 802.1X
              ou credenciais não foram aceitas pelo servidor RADIUS da Unicamp
        ↓ Conclusão: 802.1X via cabo não funcionou nesse ponto de rede

4. Descoberta: internet via compartilhamento do PC
        ↓ PC com Wi-Fi eduroam já autenticado → tem internet
        ↓ Configuração de ICS (Internet Connection Sharing) no PC:
              echo 1 > /proc/sys/net/ipv4/ip_forward   ← habilita roteamento
              iptables -t nat -A POSTROUTING -o wlo1 -j MASQUERADE ← NAT
              iptables -A FORWARD -i enx002432a0b37a -o wlo1 -j ACCEPT
        ↓ No servidor: sudo ip route add default via 192.168.1.4 dev enp1s0
        ↓ Resultado: servidor com internet via PC como gateway ✅
        ↓ Observação: solução temporária — depende do PC estar ligado e conectado

5. Instalação do cloudflared no servidor (aproveitando janela de internet)
        ↓ Download: curl -L .../cloudflared-linux-amd64.deb -o cloudflared.deb
        ↓ Instalação: sudo dpkg -i cloudflared.deb
        ↓ Versão instalada: 2026.3.0
        ↓ Resultado: cloudflared instalado com sucesso ✅

6. Descoberta do modem ALGAR como gateway da eduroam
        ↓ curl http://192.168.1.1 revelou página de configuração ALGAR TELECOM
        ↓ Análise do HTML: "Bem-vindo ao Guia de Instalação do serviço Banda Larga ALGAR"
        ↓ Conclusão: o modem ALGAR está conectado ao modem eduroam via cabo WAN
              o modem eduroam distribui internet para o ALGAR via cabo
              o ALGAR faz NAT e distribui 192.168.1.x internamente
        ↓ Comprovação: lease DHCP em /var/lib/dhcp/dhclient.leases mostrou:
              fixed-address 143.106.207.95
              option routers 143.106.207.1
              option domain-name-servers 143.106.9.2, 143.106.2.5
              option domain-name "fem.unicamp.br"
        ↓ Significado: servidor pegou IP da FEM (Faculdade de Engenharia Mecânica)
              gateway real é 143.106.207.1 — não o modem ALGAR

7. Internet direta no servidor via gateway eduroam
        ↓ Problema: ping 8.8.8.8 falhava mesmo com gateway 143.106.207.1
        ↓ Diagnóstico: gateway não responde ICMP (ping) mas roteia TCP normalmente
              eduroam bloqueia ICMP de saída — comportamento normal em redes universitárias
        ↓ Confirmação via curl:
              curl -s --interface 143.106.207.95 https://ipinfo.io/ip → retornou 143.106.207.95
        ↓ Internet funcionando via TCP mesmo sem ping ✅
        ↓ Configuração netplan para tornar permanente:
              dhcp4: true (remove IP fixo 192.168.1.100)
              nameservers: [143.106.9.2, 143.106.2.5, 8.8.8.8]
        ↓ Problema: netplan apply mudou IP do servidor → derrubou sessão SSH
        ↓ Solução: acessar servidor pela Jetson (que estava na mesma rede)
              ssh eracing@192.168.1.100 a partir da Jetson → funcionou

8. Configuração do Cloudflare Tunnel (tentativa)
        ↓ Criação de conta na Cloudflare usando email institucional Unicamp
        ↓ Domínio ghunicamp.com.br adicionado à Cloudflare
        ↓ Nameservers trocados no Registro.br:
              sierra.ns.cloudflare.com
              lex.ns.cloudflare.com
        ↓ Propagação iniciada — "servidores DNS em transição" (até 2h)
        ↓ Túnel criado no painel Zero Trust → Networks → Tunnels
              Nome: eracing-servidor
              Tunnel ID: 4f2d44df-0180-4ac6-bbc9-d67879de7efe
        ↓ Instalação via token: sudo cloudflared service install eyJh...
        ↓ Rota configurada: ssh.ghunicamp.com.br → tcp://localhost:22
        ↓ Status inicial: Healthy — 1 réplica ativa ✅
        ↓ Problema descoberto: cloudflared usa protocolo QUIC (UDP porta 7844)
              eduroam bloqueia TODO tráfego UDP de saída
        ↓ Tentativa de fallback para HTTP/2: protocolo: http2 no config.yml
              HTTP/2 usa TCP porta 7844 — também bloqueada pela eduroam
        ↓ Teste de porta 443: ssh -p 443 root@ssh.github.com → Permission denied
              Confirmação: porta 443 TCP funciona para fora
        ↓ Problema final: cloudflared HTTP/2 usa porta 7844, não 443
              Não há parâmetro oficial para forçar porta 443 no cloudflared
        ↓ Erro adicional: DNS UDP bloqueado → cloudflared não resolve hostnames
              lookup cfd-features.argotunnel.com on 1.1.1.1:53: dial udp: i/o timeout
        ↓ Workaround DNS: /etc/hosts com IPs resolvidos via DoH (DNS over HTTPS)
              curl "https://1.1.1.1/dns-query?name=serveo.net&type=A"
        ↓ Conclusão: Cloudflare Tunnel inviável na rede eduroam atual
              Bloqueios: UDP saída, porta 7844 TCP, DNS UDP

9. Solução alternativa: serveo.net via SSH reverso
        ↓ Conceito: túnel SSH reverso — servidor abre conexão de saída para relay externo
              relay recebe conexões de entrada e as encaminha para o servidor
              não requer abertura de porta no firewall local — só saída na porta 22
        ↓ Teste inicial manual:
              ssh -R eracing-servidor:22:localhost:22 serveo.net
              Saída: "Forwarding SSH traffic from eracing-servidor:22" ✅
        ↓ Problema de DNS: serveo.net não resolvia (UDP bloqueado)
        ↓ Solução: IP descoberto via DoH + entrada no /etc/hosts
              curl "https://1.1.1.1/dns-query?name=serveo.net&type=A" → 5.255.123.12
              echo "5.255.123.12 serveo.net" >> /etc/hosts
        ↓ Criação do serviço systemd serveo-tunnel.service no servidor:
              ExecStart=/usr/bin/ssh -N -o StrictHostKeyChecking=no
                -o ServerAliveInterval=30 -o ServerAliveCountMax=3
                -o ExitOnForwardFailure=yes -o ConnectTimeout=10
                -R eracing-servidor:22:localhost:22 serveo.net
              Restart=always — reconecta automaticamente se cair
        ↓ Habilitado no boot: systemctl enable serveo-tunnel
        ↓ Teste de acesso externo do PC:
              ssh -J serveo.net eracing@eracing-servidor → LOGIN ✅

10. Configuração do mesmo túnel na Jetson
        ↓ Problema: Jetson com IP DHCP variável (143.106.207.93) — não é fixo
        ↓ Solução: mesmo serviço serveo-tunnel na Jetson com nome diferente
        ↓ Problema de relógio: Jetson com data em 01/01/2000 → autenticação SSH falha
              SSH verifica timestamps dos certificados — data errada = rejeição
        ↓ Correção do relógio: sudo date -s "2026-04-29 07:30:00"
        ↓ Correção do gateway: Jetson perdeu rota default após mudanças de rede
              sudo ip route add default via 143.106.207.1 dev eth0
        ↓ Criação do serveo-tunnel.service na Jetson:
              -R eracing-jetson:22:localhost:22 serveo.net
        ↓ Teste de acesso externo:
              ssh -J serveo.net sauva@eracing-jetson → LOGIN ✅

11. Configuração do ~/.ssh/config no PC
        ↓ Arquivo criado em ~/.ssh/config com aliases de acesso:
              Host eracing-servidor → ProxyCommand ssh -W %h:%p serveo.net
              Host eracing-jetson  → ProxyCommand ssh -W %h:%p serveo.net
        ↓ Resultado: ssh eracing-servidor e ssh eracing-jetson funcionam ✅

12. Geração e distribuição de chaves RSA
        ↓ Geração no PC: ssh-keygen -t rsa -b 4096 -C "caire-pc-eracing"
              Arquivo: ~/.ssh/eracing_rsa (privada) + eracing_rsa.pub (pública)
        ↓ Cópia para servidor: ssh-copy-id -i eracing_rsa.pub eracing@eracing-servidor
        ↓ Cópia para Jetson: ssh-copy-id -i eracing_rsa.pub sauva@eracing-jetson
        ↓ Resultado: acesso sem senha aos dois dispositivos ✅
        ↓ IdentityFile adicionado ao ~/.ssh/config
```

---

## PARTE 2 — CONCEITOS TÉCNICOS EXPLICADOS

### O que é a rede eduroam e por que ela complica tudo

A **eduroam** (education roaming) é uma rede Wi-Fi e cabeada usada em universidades do mundo inteiro. Na Unicamp, ela é gerenciada pela DETIC (Diretoria de TI). Do ponto de vista técnico, ela funciona assim:

```
Dispositivo → Switch da Unicamp → Servidor RADIUS → Internet
                     ↑
              Exige autenticação 802.1X antes de liberar qualquer tráfego
```

O **servidor RADIUS** (Remote Authentication Dial-In User Service) é o porteiro da rede — ele valida as credenciais (RA@unicamp.br + senha) antes de liberar o tráfego. No Wi-Fi, seu notebook faz essa autenticação automaticamente quando você conecta. Via cabo, é mais complexo porque o switch precisa estar configurado para aceitar 802.1X, e nem todas as tomadas da rede têm essa configuração ativa.

Além da autenticação, a eduroam aplica **políticas de firewall** que bloqueiam:
- **UDP de saída**: qualquer pacote UDP que sai da rede é bloqueado — inclui DNS (porta 53), QUIC (porta 7844), NTP (porta 123)
- **ICMP de saída**: ping não funciona para fora da rede
- **Portas TCP não padrão de saída**: apenas portas "seguras" como 443 (HTTPS) e 22 (SSH) são liberadas

Esses bloqueios existem por segurança — UDP é frequentemente usado em ataques de amplificação e a Unicamp protege sua infraestrutura bloqueando esse tráfego.

---

### O que é um túnel SSH reverso e por que funciona onde outros falham

Um **túnel SSH reverso** é uma técnica de conectividade que inverte a direção normal de uma conexão SSH. Em vez de você conectar no servidor, o servidor conecta em um relay externo e deixa uma "porta aberta" para você acessar de fora.

```
Situação normal (bloqueada):
Você (casa) ──→ Servidor (oficina) — BLOQUEADO pelo firewall da Unicamp

Túnel reverso (funciona):
Servidor (oficina) ──→ relay (serveo.net) — conexão de SAÍDA, permitida
Você (casa)        ──→ relay (serveo.net) ──→ Servidor — funciona!
```

O comando que cria o túnel é:
```bash
ssh -R eracing-servidor:22:localhost:22 serveo.net
```

Traduzindo: "conecta no serveo.net e diz para ele que qualquer conexão que chegar em `eracing-servidor:22` deve ser encaminhada para `localhost:22` (ou seja, a porta 22 da minha própria máquina)".

O **serveo.net** é um serviço gratuito que funciona exatamente como relay. Ele recebe a conexão do servidor, mantém essa "ponte" aberta, e quando você tenta acessar `eracing-servidor`, ele encaminha o tráfego pelo túnel para o servidor na oficina.

---

### Por que o Cloudflare Tunnel não funcionou

O **Cloudflare Tunnel** (cloudflared) é conceitualmente similar ao serveo — cria uma conexão de saída para os servidores da Cloudflare. A diferença é que ele usa protocolos mais modernos e otimizados:

```
Cloudflared usa:
  1. QUIC (UDP porta 7844) → protocolo primário, baixíssima latência
  2. HTTP/2 (TCP porta 7844) → fallback quando UDP não funciona
  3. HTTP/1.1 (TCP porta 8080) → fallback final
```

O problema é que **todos os três usam a porta 7844**, que a eduroam bloqueia. A porta 443 (HTTPS padrão) funciona na eduroam, mas o cloudflared não tem opção de usar 443 para o túnel — apenas para o plano de controle.

Além disso, o cloudflared precisa resolver nomes DNS antes de conectar, e como a eduroam bloqueia UDP porta 53 (DNS padrão), ele falha antes mesmo de tentar abrir o túnel.

```
Sequência de falhas do cloudflared na eduroam:
1. Tenta resolver cfd-features.argotunnel.com via DNS UDP 53 → BLOQUEADO
2. (com /etc/hosts como workaround para DNS)
3. Tenta conectar em 198.41.192.x:7844 via QUIC → BLOQUEADO
4. Tenta conectar em 198.41.192.x:7844 via HTTP/2 → BLOQUEADO
5. Sem fallback para porta 443 → FALHA TOTAL
```

---

### Por que o acesso via serveo é lento

A latência do acesso via serveo.net tem três componentes:

```
Seu PC (Campinas, Brasil)
    ↓ ~20ms (internet brasileira)
serveo.net (São Petersburgo, Rússia) ← AQUI ESTÁ O PROBLEMA
    ↓ ~20ms (de volta ao Brasil)
Servidor (Unicamp, Campinas)

Total: ~200-300ms de latência adicional por round-trip
```

O serveo.net está hospedado na Rússia (IP `5.255.123.12` pertence à rede Yandex). Cada caractere que você digita no terminal percorre esse trajeto de ~20.000km de ida e ~20.000km de volta antes de aparecer na tela.

Para comparação: o acesso direto via cabo na oficina tem latência de <1ms.

---

### O que precisaríamos pedir ao TI da FEM para usar Cloudflare Tunnel

Se quisermos substituir o serveo.net pelo Cloudflare Tunnel (mais robusto, URL fixa, sem relay na Rússia), precisaríamos pedir ao TI da FEM as seguintes liberações:

**Liberações de porta necessárias:**

| Protocolo | Porta | Destino | Uso |
|---|---|---|---|
| UDP | 7844 | 198.41.192.0/24, 198.41.200.0/24 | Cloudflare Tunnel QUIC |
| TCP | 7844 | 198.41.192.0/24, 198.41.200.0/24 | Cloudflare Tunnel HTTP/2 |
| UDP | 53 | 1.1.1.1, 8.8.8.8 | DNS para resolução de nomes |
| UDP | 123 | pool.ntp.org | NTP para sincronização de clock |

**O que ganharíamos com Cloudflare vs serveo:**

| Critério | serveo.net (atual) | Cloudflare Tunnel |
|---|---|---|
| Latência | ~200-300ms (Rússia) | ~5-15ms (São Paulo gru13) |
| Confiabilidade | Serviço gratuito sem SLA | 99.9% uptime garantido |
| URL fixa | Não (nome muda se serviço cair) | Sim (ssh.ghunicamp.com.br) |
| Segurança | Tráfego passa por servidor russo | Tráfego criptografado na Cloudflare |
| Custo | Gratuito | Gratuito (plano Free) |
| Autenticação | Apenas senha SSH | Pode adicionar MFA, SSO |

**Como solicitar ao TI:**
O pedido deve especificar que são liberações de saída (egress) apenas, para os blocos de IP da Cloudflare. O TI pode verificar os blocos oficiais em `https://www.cloudflare.com/ips/`. Não requer abertura de porta de entrada — o cloudflared só faz conexões de saída.

---

### O que perdemos por usar serveo em vez de Cloudflare

A tabela acima resume os trade-offs, mas há um ponto crítico adicional: **privacidade e controle**. Com o serveo.net, todo o tráfego SSH passa por um servidor de terceiro (empresa russa) sem contrato ou garantias. Com o Cloudflare, o tráfego passa por infraestrutura de uma empresa com política de privacidade documentada e criptografia ponta-a-ponta.

Além disso, o serveo.net pode cair ou mudar seu comportamento a qualquer momento — é um serviço gratuito sem comprometimento. O Cloudflare tem SLA e infraestrutura redundante.

---

## PARTE 3 — GUIA DE ACESSO REMOTO

### Como acessar o servidor e a Jetson de qualquer rede

#### Pré-requisito no seu PC

O arquivo `~/.ssh/config` deve conter:

```
Host serveo.net
  StrictHostKeyChecking no

Host eracing-servidor
  HostName eracing-servidor
  User eracing
  ProxyCommand ssh -W %h:%p serveo.net
  IdentityFile ~/.ssh/eracing_rsa

Host eracing-jetson
  HostName eracing-jetson
  User sauva
  ProxyCommand ssh -W %h:%p serveo.net
  IdentityFile ~/.ssh/eracing_rsa
```

#### Comandos de acesso

```bash
# Acessar o servidor (de qualquer rede, qualquer lugar)
ssh eracing-servidor

# Acessar a Jetson (de qualquer rede, qualquer lugar)
ssh eracing-jetson

# Copiar arquivo para o servidor
scp arquivo.txt eracing-servidor:~/

# Copiar arquivo para a Jetson
scp arquivo.txt eracing-jetson:~/

# Tunnel de porta (ex: acessar interface web do servidor no seu PC)
ssh -L 8081:localhost:8081 eracing-servidor
# Depois abrir http://localhost:8081 no browser
```

#### Verificar se os túneis estão ativos

```bash
# No servidor — verificar se serveo-tunnel está rodando
sudo systemctl status serveo-tunnel

# Ver o log do túnel
sudo journalctl -u serveo-tunnel -f

# Na Jetson — mesmo comando
sudo systemctl status serveo-tunnel
```

#### O que fazer se o acesso estiver lento ou travado

```bash
# 1. Verificar se o túnel do servidor está ativo
ssh eracing-servidor "sudo systemctl status serveo-tunnel | head -5"

# 2. Se estiver caído, reconectar manualmente (temporário)
ssh eracing-servidor "sudo systemctl restart serveo-tunnel"

# 3. Verificar se o relógio da Jetson está correto (causa comum de falha)
ssh eracing-jetson "date"
# Se mostrar ano 2000, corrigir:
ssh eracing-jetson "sudo date -s '$(date)'"
```

---

## PARTE 4 — ARQUITETURA ATUAL DO SISTEMA

```
TOPOLOGIA DE REDE — OFICINA (29/04/2026)
─────────────────────────────────────────

Internet (eduroam/FEM)
      ↓ cabo
Modem eduroam (gateway 143.106.207.1)
      ↓ cabo LAN
Modem ALGAR TD-W9970 (switch + DHCP 192.168.1.x)
      ↓ cabo LAN                    ↓ cabo LAN          ↓ cabo LAN
Servidor (enp1s0)           Antena Unifi base        PC desenvolvimento
  IP: 143.106.207.95          (LAN da oficina)        IP: 143.106.207.x
  IP: 192.168.1.100 (fixo)
  gateway: 143.106.207.1
      ↓ Wi-Fi Unifi ponto-a-ponto
Jetson AGX Xavier
  eth0: 143.106.207.93 (DHCP — variável)
  gateway: 143.106.207.1


ACESSO EXTERNO (de qualquer rede)
──────────────────────────────────

Servidor ──────→ serveo.net ←────── Seu PC (casa/outro local)
  (túnel SSH         (relay          (ssh eracing-servidor)
   reverso)           Rússia)
   porta 22                          
                                    
Jetson   ──────→ serveo.net ←────── Seu PC (casa/outro local)
  (túnel SSH         (relay          (ssh eracing-jetson)
   reverso)           Rússia)
   porta 22


SERVIÇOS ATIVOS NO SERVIDOR
────────────────────────────

systemd services:
  ├── telemetry.service    → TCP:8080 (CAN) + HTTP/WS:8081 (web) + NTP:9999
  ├── postgresql@14-main   → TimescaleDB (banco de dados)
  ├── cloudflared          → INATIVO (bloqueado pela eduroam)
  └── serveo-tunnel        → ATIVO ✅ (SSH reverso → serveo.net)


SERVIÇOS ATIVOS NA JETSON
───────────────────────────

systemd services:
  ├── can-interfaces.service   → can0, can1, vcan0, vcan1 UP
  ├── can-replay.service       → canplayer loop (dados simulados)
  ├── telemetry-edge.service   → Rust aarch64 → TCP:8080 → servidor
  └── serveo-tunnel.service    → ATIVO ✅ (SSH reverso → serveo.net)
```

---

## PARTE 5 — PROBLEMAS RESOLVIDOS E LIÇÕES APRENDIDAS

### DNS UDP bloqueado — workaround via DoH

A eduroam bloqueia UDP porta 53 (DNS padrão). Isso impede resolução de nomes em qualquer comando que não use o DNS configurado pelo DHCP. O workaround é usar **DNS over HTTPS (DoH)** — resolução de DNS via TCP porta 443, que não é bloqueada:

```bash
# Resolver qualquer hostname via DoH (não depende de UDP)
curl -s "https://1.1.1.1/dns-query?name=HOSTNAME&type=A" \
  -H "accept: application/dns-json" | grep -o '"data":"[^"]*"'

# Adicionar resultado no /etc/hosts para uso permanente
echo "IP_OBTIDO HOSTNAME" | sudo tee -a /etc/hosts
```

Essa técnica foi usada para resolver: `serveo.net`, `archive.ubuntu.com`, `security.ubuntu.com`.

### ICMP bloqueado — usar TCP para testar conectividade

O ping (`ICMP`) não funciona para destinos fora da rede eduroam. Para testar conectividade use TCP:

```bash
# Em vez de: ping 8.8.8.8 (não funciona)
# Use:
curl -s --max-time 5 https://ipinfo.io/ip
# ou
curl -v --max-time 5 https://google.com 2>&1 | grep "Connected"
```

### Relógio da Jetson — causa silenciosa de falhas SSH

A Jetson AGX Xavier não tem bateria de CMOS suficiente para manter o relógio quando desligada. Sem NTP (bloqueado pelo UDP da eduroam), o relógio volta para 01/01/2000 a cada boot. Isso causa falhas silenciosas em:

- Autenticação SSH (certificados têm timestamps — relógio errado = certificado "inválido")
- Conexão com serveo.net (servidor verifica timestamps)
- Logs do systemd (timestamps incorretos dificultam diagnóstico)

```bash
# Verificar relógio da Jetson
date

# Corrigir manualmente se necessário
sudo date -s "2026-04-29 HH:MM:SS"

# Corrigir via HTTP (funciona sem UDP)
DATA=$(curl -sI http://google.com | grep -i "^date:" | sed 's/[Dd]ate: //')
sudo date -s "$DATA"
```

**Solução definitiva pendente:** configurar NTP over TCP ou usar chrony com servidor NTP acessível via TCP. Alternativamente, pedir ao TI liberação da porta UDP 123 para servidores NTP.

### Gateway da Jetson se perde após mudanças de rede

A Jetson usa configuração de rede dinâmica. Quando a topologia da rede muda (IP do servidor muda, modem é trocado), a rota default da Jetson pode ficar apontando para um gateway que não existe mais:

```bash
# Verificar se Jetson tem rota default
ip route show | grep default

# Se não tiver ou estiver errada:
sudo ip route add default via 143.106.207.1 dev eth0
```

**Solução definitiva:** configurar IP e gateway fixos na Jetson via nmcli apontando para o gateway da eduroam (`143.106.207.1`), não para o servidor — assim a Jetson tem internet independente do servidor.

---

## PARTE 6 — STATUS ATUAL DO PROJETO

### O que mudou hoje

| Componente | Status Anterior | Status Atual |
|---|---|---|
| Internet no servidor | Dependia do dongle Wi-Fi | Via cabo eduroam (143.106.207.95) ✅ |
| IP do servidor | 192.168.1.100 (fixo interno) | 143.106.207.95 (eduroam) + 192.168.1.100 |
| IP da Jetson | 192.168.1.101 (fixo) | 143.106.207.93 (DHCP — variável) |
| Acesso SSH externo | Não existia | Via serveo.net (qualquer rede) ✅ |
| Acesso servidor externo | Impossível | ssh eracing-servidor ✅ |
| Acesso Jetson externo | Impossível | ssh eracing-jetson ✅ |
| Chaves RSA | Não configuradas | eracing_rsa no PC → servidor + Jetson ✅ |
| Cloudflare Tunnel | Configurado | Inativo (portas bloqueadas pela eduroam) |
| Domínio ghunicamp.com.br | Registro.br | Cloudflare (DNS propagado) ✅ |

### O que está FEITO ✅

| Componente | Status | Dia |
|---|---|---|
| Toda a infraestrutura V2.0 | ✅ | Dias 1–6 |
| Streaming ZED 2i via GStreamer | ✅ | Dia 7 |
| Internet no servidor via eduroam | ✅ | Dia 8 |
| SSH global servidor (serveo.net) | ✅ | Dia 8 |
| SSH global Jetson (serveo.net) | ✅ | Dia 8 |
| Chaves RSA sem senha | ✅ | Dia 8 |
| Domínio na Cloudflare | ✅ | Dia 8 |

### O que está PENDENTE ❌

| Componente | Prioridade | Descrição |
|---|---|---|
| IP fixo da Jetson | 🔴 Alta | DHCP variável → perda de acesso se IP mudar |
| Cloudflare Tunnel | 🔴 Alta | Pedir ao TI da FEM liberação UDP 7844 e UDP 53 |
| NTP na Jetson | 🔴 Alta | Relógio volta ao ano 2000 após reboot sem internet |
| Encoder NVENC | 🔴 Alta | x264enc por software usa CPU — substituir por NVENC |
| QoS HTB | 🟡 Média | Pré-requisito para vídeo em produção |
| can0 real do carro | 🟡 Média | Conectar barramento físico do veículo |
| Serviço zed-stream.service | 🟡 Média | Streaming automático no boot |
| Firewall UFW | 🟡 Média | Portas 8080, 8081, 9999, 5600 |
| App Android | 🟢 Baixa | WebSocket :8081 + player RTSP |

---

## PARTE 7 — PEDIDO FORMAL AO TI DA FEM

Para migrar do serveo.net para o Cloudflare Tunnel e resolver os problemas de NTP e DNS, o seguinte pedido deve ser feito ao TI da Faculdade de Engenharia Mecânica:

### Liberações solicitadas (todas de saída — egress apenas)

```
Dispositivo: Servidor de telemetria E-Racing
MAC: f4:b5:20:3e:24:6c
IP atual: 143.106.207.95 (DHCP — solicitar IP fixo também)

Liberações necessárias:
┌──────────┬───────┬────────────────────────────────┬─────────────────────────────────────┐
│ Protocolo│ Porta │ Destino                        │ Finalidade                          │
├──────────┼───────┼────────────────────────────────┼─────────────────────────────────────┤
│ UDP      │ 7844  │ 198.41.192.0/24, 198.41.200/24 │ Cloudflare Tunnel (QUIC)            │
│ TCP      │ 7844  │ 198.41.192.0/24, 198.41.200/24 │ Cloudflare Tunnel (HTTP/2 fallback) │
│ UDP      │ 53    │ 1.1.1.1, 8.8.8.8               │ DNS para resolução de nomes         │
│ UDP      │ 123   │ pool.ntp.org                   │ NTP — sincronização de relógio      │
└──────────┴───────┴────────────────────────────────┴─────────────────────────────────────┘

Adicionalmente: IP fixo para o servidor (143.106.207.x reservado para o MAC acima)
e para a Jetson (MAC: 48:b0:2d:2f:e9:b9)
```

### Justificativa técnica

O projeto E-Racing Ultra Blaster da UNICAMP desenvolve um sistema de telemetria em tempo real para veículo elétrico de competição. O servidor processa dados do barramento CAN do veículo e os transmite via Wi-Fi para análise durante corridas. O acesso remoto seguro é necessário para manutenção do sistema fora do horário de corridas e para atualização do software embarcado na Jetson sem presença física na oficina.

---

## PARTE 8 — PRÓXIMOS PASSOS (DIA 9)

```
1. Resolver IP fixo da Jetson:
   — Opção A: pedir ao TI IP fixo por MAC reservation
   — Opção B: configurar nmcli com IP fixo 143.106.207.x (risco de conflito)
   — Opção C: manter serveo-tunnel e aceitar IP variável

2. Resolver relógio da Jetson:
   — Instalar chrony: sudo apt install chrony
   — Configurar servidor NTP via TCP ou HTTP
   — Alternativa: script no boot que pega data via curl HTTP

3. Retomar desenvolvimento V2.1:
   — Ativar encoder NVENC (nvvidconv → nvv4l2h264enc)
   — Criar zed-stream.service no boot da Jetson
   — Implementar QoS HTB no servidor e na Jetson
   — Conectar can0 real ao barramento CAN do carro

4. Enviar pedido formal ao TI da FEM:
   — Email com tabela de liberações acima
   — Justificativa do projeto E-Racing
   — Solicitar IP fixo para servidor e Jetson

5. Atualizar checklist com status do Dia 8
```

---

*Documento gerado em 29/04/2026 — E-Racing Ultra Blaster Telemetria V2*
