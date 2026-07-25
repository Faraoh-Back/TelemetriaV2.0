# 🛠️ Guia de Arquitetura e Referência de Serviços: Servidor de Telemetria (Box / E-Racing)

Este documento mapeia todos os serviços do sistema (`systemd`) que estruturam o ecossistema de rede, telemetria veicular em alta frequência, processamento de vídeo, banco de dados e controle de segurança rodando no servidor local do box.

---

## 1. Estrutura de Diretórios do `systemd` no Linux

No sistema operacional do servidor, os arquivos de configuração de serviços (`.service`) estão organizados em dois diretórios principais, seguindo o padrão de separação entre customizações locais e gerenciadores de pacotes:

* **`/etc/systemd/system/`** 
  Destinado aos **serviços customizados** (desenvolvidos internamente para os motores em Rust e scripts de câmera) e também a regras de sobrescrita (*overrides*) de serviços do sistema. É a pasta de maior prioridade.
* **`/lib/systemd/system/`** *(ou `/usr/lib/systemd/system/`)* 
  Destinado aos **serviços padrões de pacotes** instalados no sistema via `apt` ou instaladores oficiais (como PostgreSQL, SSH, DNS e UniFi).

---

## 2. Mapeamento Geral de Serviços e Caminhos

### 🏎️ A. Telemetria e Processamento Veicular (Backend em Rust)
Motores customizados responsáveis pela ingestão de dados veiculares em tempo real via portas seriais/CAN (TCP/UDP), validação de pacotes e processamento de áudio contínuo.

| Serviço (`.service`) | Caminho do Arquivo | Descrição / Função Principal |
| :--- | :--- | :--- |
| `telemetry-edge.service` | `/etc/systemd/system/telemetry-edge.service` | Motor de processamento principal em Rust. Recebe pacotes em alta frequência (130Hz) e grava no banco temporal. |
| `telemetry-audio-edge.service` | `/etc/systemd/system/telemetry-audio-edge.service` | Serviço isolado exclusivo para ingestão, processamento e retransmissão do fluxo de áudio da pista via UDP/RTP. |

---

### 📹 B. Pipeline de Vídeo (Câmera Embarcada)
Serviços dedicados à captura, codificação e streaming de vídeo com baixa latência a partir do veículo.

| Serviço (`.service`) | Caminho do Arquivo | Descrição / Função Principal |
| :--- | :--- | :--- |
| `zed-stream.service` | `/etc/systemd/system/zed-stream.service` | Captura e retransmissão de vídeo da câmera ZED embarcada em tempo real via relé RTSP. |
| `video-backup.service` | `/etc/systemd/system/video-backup.service` | Gravação contínua em segundo plano do stream recebido para redundância e pós-análise de sessão. |

---

### 🗄️ C. Banco de Dados e Persistência
Estrutura de armazenamento temporal para análises complexas, exportação para MoTeC (arquivos `.ld`) e persistência ágil de estados locais via SQLite.

| Serviço (`.service`) | Caminho do Arquivo | Arquivo de Configuração Principal |
| :--- | :--- | :--- |
| `postgresql.service` *(TimescaleDB)* | `/lib/systemd/system/postgresql.service` | `/etc/postgresql/<versao>/main/postgresql.conf` |

> *Nota:* A persistência ultrarrápida para estados locais e cadastros intermediários é operada via arquivos **SQLite** locais gravados em disco pelo próprio motor em Rust.

---

### 🌐 D. Core de Rede, Wi-Fi e Sincronização
Serviços responsáveis por manter a infraestrutura de rádio operando, garantir atribuição ágil de IPs locais sem latência externa e sincronizar os relógios de todos os nódulos da pista com precisão de milissegundos.

| Serviço (`.service`) | Caminho do Arquivo | Arquivo de Configuração Principal |
| :--- | :--- | :--- |
| `unifi.service` | `/lib/systemd/system/unifi.service` | `/usr/lib/unifi/data/system.properties` |
| `dnsmasq.service` | `/lib/systemd/system/dnsmasq.service` | `/etc/dnsmasq.conf` (ou `/etc/dnsmasq.d/`) |
| `systemd-timesyncd.service` | `/lib/systemd/system/systemd-timesyncd.service` | `/etc/systemd/timesyncd.conf` |
| `avahi-daemon.service` | `/lib/systemd/system/avahi-daemon.service` | `/etc/avahi/avahi-daemon.conf` |

---

### 🔐 E. Acesso Remoto, Túneis e Zero Trust
Camada de segurança desenhada para permitir a administração remota do servidor de qualquer localização mundial sem expor portas à internet pública no roteador do box.

| Serviço (`.service`) | Caminho do Arquivo | Arquivo de Configuração Principal |
| :--- | :--- | :--- |
| `ssh.service` *(ou `sshd`)* | `/lib/systemd/system/ssh.service` | `/etc/ssh/sshd_config` *(Configurado na porta `2222`)* |
| `cloudflared.service` | `/etc/systemd/system/cloudflared.service` | `/etc/cloudflared/config.yml` *(ou `~/.cloudflared/`)* |

---

## 3. Comandos de Ouro para Administração (`systemctl`)

### 🔍 Descobrir o Caminho Exato de Qualquer Serviço
Caso não lembre em qual pasta um serviço específico foi instalado, utilize a verificação de status padrão. O caminho aparecerá no campo `Loaded:`:

```bash
systemctl status nome-do-servico.service

Para extrair apenas a string do caminho limpo no terminal (ideal para scripts de automação ou para abrir no editor de texto em um único comando):

systemctl show -p FragmentPath telemetry-edge.service

✏️ Atalho para Edição Rápida

Em vez de digitar o caminho completo com o editor de texto, o systemctl possui um atalho nativo para criar ou editar arquivos de serviço de forma segura:

sudo systemctl edit --full telemetry-edge.service

🔄 Rotina de Atualização e Reinício

Sempre que modificar ou criar um arquivo .service em /etc/systemd/system/, o daemon do Linux deve ser recarregado antes do reinício do serviço:

# 1. Recarregar as configurações na memória do systemd
sudo systemctl daemon-reload

# 2. Reiniciar o motor customizado em Rust
sudo systemctl restart telemetry-edge.service

# 3. Verificar o status e os últimos logs de inicialização
systemctl status telemetry-edge.service

📊 Monitoramento de Logs em Tempo Real (journalctl)

Para inspecionar se os pacotes estão chegando da pista ou acompanhar erros do sistema de vídeo ao vivo no terminal:

# Acompanhar fluxo contínuo dos últimos logs do serviço (modo tail -f)
sudo journalctl -u telemetry-edge.service -f --lines=50