# Runbook — SBG INS → CAN nativo na Jetson

**Escopo:** procedimento completo para ligar a Jetson AGX Xavier + INS SBG Ellipse2-D e ter o pipeline `UART → ROS2 → CAN` rodando de forma nativa (sem terminal manual), publicando no protocolo oficial `sbgCan.dbc` via SocketCAN.

**Hardware:** SBG Ellipse2-D (`ELLIPSE2-D-G4A2-B1-B1VB`, GNSS dual-antena interno, quad-constelação), Jetson AGX Xavier, interfaces `can0`/`can1` físicas.

**Última validação de campo:** ver seção 7 (Histórico de debug).

---

## 1. Visão geral da arquitetura

```
INS (SBG Ellipse2-D)
   │ UART @ 230400 baud (/dev/ttyUSB0)
   ▼
sbg_device (nó ROS2, pacote sbg_driver)
   │ tópicos: /sbg/imu_data, /sbg/ekf_euler, /sbg/ekf_nav,
   │          /sbg/gps_pos, /sbg/gps_hdt, ...
   ▼
sbg_to_can.py (bridge Python, SocketCAN)
   │ frames CAN standard (11-bit), protocolo sbgCan.dbc oficial
   ▼
can1 (barramento físico CAN, bitrate a confirmar — ver §3)
```

O bridge (`sbg_to_can.py`) **não depende** da saída CAN nativa do próprio INS — ele reconstrói o protocolo `sbgCan.dbc` em software a partir dos tópicos ROS2, e envia via SocketCAN da Jetson. Isso significa que a config CAN interna do dispositivo SBG (se ele tiver) é irrelevante para este pipeline; o que importa é a config UART (para o driver ROS2 ler os dados) e a config da interface `can1` da Jetson (para o bridge escrever os frames).

---

## 2. Pré-requisitos de hardware

- [ ] INS conectado via USB-UART, aparecendo como `/dev/ttyUSB0` (confirmar com `ls /dev/ttyUSB*`; se houver mais de uma porta USB-serial no sistema, o número pode variar — não assumir fixo).
- [ ] Cabo CAN do INS/bridge conectado ao barramento físico `can1`, com terminação de 120Ω nas duas pontas do barramento (padrão CAN).
- [ ] Antenas GNSS conectadas (dual-antena, já que o Ellipse2-D é variante D) — necessárias para fix de GPS e para o EKF convergir Yaw de forma confiável. **Sem GNSS, Roll/Pitch podem convergir só com IMU, mas Yaw fica sem referência absoluta estável.**
- [ ] Testes em ambiente fechado/blindado (gaiola de Faraday, laboratório com blindagem) **não terão fix de GPS nem heading GNSS** — isso é esperado, não é bug. Validação de GPS/heading precisa ser feita ao ar livre, céu aberto.

---

## 3. Configuração de rede CAN (`can1`)

> ⚠️ **Importante — dois ambientes distintos:**
> - **Bancada de desenvolvimento (sem Jetson/hardware CAN físico):** use `vcan0` (interface virtual, sem necessidade de hardware). Suficiente para validar encoding, IDs, formato de frame e decode via DBC — que é o que já foi validado nesta sessão. Não precisa nem existe `can0`/`can1` físico numa bancada sem controlador CAN (USB-CAN dongle) ou sem a Jetson real.
> - **Deploy real (Jetson AGX Xavier no carro, ou bancada com a Jetson física conectada ao barramento):** use `can1` físico, que depende do controlador nativo `mttcan` da Xavier estar habilitado via device-tree overlay (`jetson-io` ou `extlinux.conf`) — só testável com a Jetson real, não com uma bancada Ubuntu genérica.

Verificar se a interface já existe e está configurada (só se aplica no ambiente de deploy real, com a Jetson):
```bash
ip -details link show can1
```

Se não existir e você estiver na Jetson real (não bancada genérica), o kernel pode não ter o overlay do segundo canal CAN carregado — checar com:
```bash
ip link show type can        # lista todas interfaces CAN que o kernel enxerga
dmesg | grep -i -E "can|mttcan"
```
Se nem `can0` existir, o overlay de CAN provavelmente não está habilitado no device-tree dessa Jetson — resolver via `jetson-io.py` (Configure 40-pin Header → CAN) e reboot, ou confirmar se o carrier board expõe fisicamente os dois canais.

Se a interface existir mas estiver `DOWN`, subir manualmente (bitrate **a confirmar com o time** — deve bater com o resto da rede CAN do carro):
```bash
sudo ip link set can1 down 2>/dev/null
sudo ip link set can1 type can bitrate <BITRATE_A_CONFIRMAR>
sudo ip link set can1 up
```

> ⚠️ **Ação pendente:** preencher `<BITRATE_A_CONFIRMAR>` com o valor real usado pelo resto do barramento de telemetria (TelemetriaV2.0), e validar o §3 inteiro assim que houver acesso à Jetson física conectada ao carro (ou pelo menos com um adaptador USB-CAN na bancada).

---

## 4. Configuração do driver SBG (UART + GNSS)

Arquivo: `~/ros2_ins/sbg_ros2_driver/config/sbg_device_uart_default.yaml`

Pontos já confirmados nesta sessão de debug:

| Parâmetro | Valor atual | Correto para Ellipse2-D | Observação |
|---|---|---|---|
| `uartConf.portName` | `/dev/ttyUSB0` | OK | confirmar antes de cada boot |
| `uartConf.baudRate` | `230400` | OK | |
| `confWithRos` | `false` | ✅ correto — GNSS já configurado via sbgCenter (permanente, na memória não-volátil do device) | não mexer |
| `gnss1ModulePortAssignment` | `255` no yaml (não reflete o device real) | ✅ já habilitado internamente via sbgCenter | o valor `255` no yaml é irrelevante enquanto `confWithRos: false` — o device ignora o yaml e usa a config salva nele |
| `log_gps1_pos` / `log_gps1_hdt` | `10001` (on new data) | OK | correto, só falta o módulo GNSS estar habilitado |
| `log_ekf_euler` | `8` (25Hz) | OK | driver publica certo, mas EKF só converge com aiding (GNSS ou magnetômetro) |

### 4.1 GNSS interno — ✅ confirmado via sbgCenter (screenshots 2026-08-21)

Confirmado visualmente em duas telas do sbgCenter:

**Aiding → Gnss 1:**
- **Selected model: Internal** (Model ID 101) — bate com `gnss_model_id: 101` do yaml.
- **Dual Antenna Mode: Precise lever arm**, secondary lever arm `(1.750, -0.130, 0.080) m` — dual-antena configurada e pronta para heading GNSS assim que as duas antenas tiverem fix.
- **Aiding rejection:** Position e Heading em `Automatic` (default seguro).

**Assignment → Aiding devices:**
- **Gnss 1 → Port: Internal, Sync: Internal** — confirma a atribuição física do módulo, sem ambiguidade.
- RTCM, Odometer, Air Data, DVL: `Disabled` — esperado para este setup (sem RTK, sem odômetro/air data/DVL em uso).
- Botão **Save** acinzentado (sem alterações pendentes) — confirma que a config já estava persistida no device antes desta sessão, não é uma mudança feita agora sem salvar.

**Conclusão: GNSS interno está corretamente configurado e persistido no device.** Não editar o yaml para isso — o campo `gnss1ModulePortAssignment: 255` que aparece no arquivo é só o default de template do driver e não reflete a config real do device enquanto `confWithRos: false`.

**Pendente de verificação física:** os valores de lever arm (1.75m entre antenas) precisam bater com a instalação real das duas antenas no carro. Se a distância/posição física não bater com esses números, o heading pode sair impreciso mesmo com fix válido.

**Ainda pendente de validação em campo:** essa config só é testável de fato ao ar livre (fix de GPS real, com as duas antenas montadas). Dentro de gaiola de Faraday ou ambiente fechado, `/sbg/gps_pos` e `/sbg/ekf_euler` continuam sem publicar mesmo com a config correta — é limitação física do ambiente de teste, não do device.

---

## 5. Subida manual — passo a passo detalhado (bancada, sem hardware CAN físico)

Este é o procedimento exato replicando o que validamos nesta sessão de debug, na ordem certa, com o que esperar em cada passo.

### Terminal 1 — Interface CAN virtual

```bash
sudo modprobe vcan
sudo ip link add dev vcan0 type vcan 2>/dev/null   # ignora erro se já existir
sudo ip link set up vcan0
```
Confirma que subiu:
```bash
ip link show vcan0
```
Esperado: `vcan0: <NOARP,UP,LOWER_UP> ...` (estado `UP`).

### Terminal 2 — Driver SBG (lê UART, publica tópicos ROS2)

```bash
cd ~/ros2_ins/sbg_ros2_driver
source /opt/ros/foxy/setup.bash
source ~/ros2_ins/sbg_ros2_driver/install/setup.bash
ros2 launch sbg_driver sbg_device_launch.py \
  config_file:=/home/sauva/ros2_ins/sbg_ros2_driver/config/sbg_device_uart_default.yaml
```

**Esperado na tela**, nessa ordem:
```
[INFO] [launch]: process started with pid [...]
[sbg_device-1] [INFO] [...] [sbg_device]: SBG DRIVER - Init node, load params and connect to the device.
[sbg_device-1] [INFO] [...] [sbg_device]: SBG_DRIVER - productCode = ELLIPSE2-D-G4A2-B1-B1VB
[sbg_device-1] [INFO] [...] [sbg_device]: SBG_DRIVER - serialNumber = 45000209
[sbg_device-1] [INFO] [...] [sbg_device]: SBG DRIVER - ROS Node frequency : 400 Hz
```
Se `productCode`/`serialNumber` não aparecerem em ~5s, o driver não conseguiu abrir a UART — verificar `/dev/ttyUSB0` (ver §8, "Troubleshooting" abaixo) antes de seguir.

**Deixa esse terminal rodando** — não fechar, não dar Ctrl+C.

### Terminal 3 — Validar que os tópicos estão de pé

```bash
source /opt/ros/foxy/setup.bash
source ~/ros2_ins/sbg_ros2_driver/install/setup.bash

ros2 node list
```
Esperado: `/sbg_device` (e só isso, se nada mais estiver rodando).

```bash
ros2 topic list | grep sbg
```
Esperado (nomes confirmados nesta versão do driver, firmware 2.7.29 — **sem sufixo `1`**):
```
/sbg/ekf_euler
/sbg/ekf_nav
/sbg/ekf_quat
/sbg/gps_hdt
/sbg/gps_pos
/sbg/gps_raw
/sbg/gps_vel
/sbg/imu_data
/sbg/imu_short
/sbg/status
/sbg/utc_time
```

```bash
ros2 topic hz /sbg/imu_data
```
Esperado: `average rate: 25.000` estável, `std dev` baixo (~0.0008s). Deixa rodar uns 5-10s pra confirmar estabilidade, depois Ctrl+C só nesse comando (não no driver do Terminal 2).

```bash
timeout 3 ros2 topic hz /sbg/ekf_euler
```
- **Ao ar livre, com fix de GPS:** deve publicar a ~25Hz também, igual o IMU.
- **Dentro de gaiola de Faraday / ambiente fechado:** não publica nada (comando fica mudo até o timeout) — **isso é esperado**, não é erro. O EKF não converge Yaw sem aiding de GNSS ou magnetômetro.

```bash
timeout 3 ros2 topic hz /sbg/gps_pos
```
Mesma lógica: só publica com fix de GPS real. Mudo dentro de ambiente blindado é esperado.

### Terminal 4 — Bridge CAN (converte tópicos → frames CAN via sbgCan.dbc)

```bash
cd /home/sauva
python3 sbg_to_can.py --iface vcan0 --rate 25
```

**Esperado na tela:**
```
══════════════════════════════════════════════════════════════════════
  SBG ROS2 → CAN Bridge  —  Protocolo Oficial sbgCan.dbc (STANDARD frame)
  Interface : vcan0
  Taxa      : 25.0 Hz
  IDs ativos: 288 289 290 (IMU) | 304 306 308 311 (EKF) | 373 377 (GPS)
══════════════════════════════════════════════════════════════════════
[INFO] Socket aberto em vcan0
[INFO] Aguardando /sbg/imu_data ...
  1/10s...
[INFO] Dados SBG OK — iniciando envio CAN!
[INFO] Enviando a 25 Hz  (Ctrl+C para parar)
```
Depois, a cada ~2s, uma linha de status tipo:
```
[#0000051] Ax= +1.37 Ay= -0.11 Az= +9.68 m/s²  Roll=+0.000 Pitch=+0.000 Yaw=+0.000 rad  Lat=0.000000 Lon=0.000000  [imu:0.00s euler:sem dados gps:0.11s]
```
- **`Az≈+9.7~9.8`** confirma que o sensor está lendo gravidade corretamente (validação física básica de que o dado é real, não zero).
- **`Roll/Pitch/Yaw` zerados e `euler:sem dados`**: esperado dentro de ambiente blindado.
- **`Lat/Lon` zerados**: esperado sem fix de GPS.

**Deixa esse terminal rodando** também.

### Terminal 5 — Validar decode via DBC oficial

```bash
cd /home/sauva
python3 validate_sbg_can.py --dbc ~/ros2_ins/sbgECom/can/sbgCan.dbc --iface vcan0 --seconds 30
```

Vai imprimir linhas `[OK] ID ... → {...}` conforme decodifica cada frame, e ao final (depois dos 30s, ou Ctrl+C):
```
══════════════════════════════════════════════════════════════════════
RESUMO DE VALIDAÇÃO
══════════════════════════════════════════════════════════════════════
  ID 288  IMU_INFO         — ✅ OK (... frames, todos decodificados)
  ID 289  IMU_ACCEL        — ✅ OK (...)
  ID 290  IMU_GYRO         — ✅ OK (...)
  ID 304  EKF_INFO         — ✅ OK (...)
  ID 306  EKF_EULER        — ✅ OK (...)
  ID 308  EKF_POS          — ✅ OK (...)
  ID 311  EKF_VEL_NED      — ✅ OK (...)
  ID 373  GPS1_POS         — ❌ NUNCA RECEBIDO   (esperado sem GNSS fix)
  ID 377  GPS1_HDT         — ❌ NUNCA RECEBIDO   (esperado sem GNSS fix)
```
`373`/`377` como `❌ NUNCA RECEBIDO` é esperado em bancada/gaiola — o bridge só envia esses frames quando `/sbg/gps_pos`/`/sbg/gps_hdt` publicam algo (watchdog de 2s), e sem fix eles nunca publicam. IMU/EKF_INFO/EKF_EULER/EKF_POS/EKF_VEL_NED todos `✅ OK` é o critério de sucesso pra essa fase de bancada.

### Encerrando

Pra derrubar tudo, na ordem inversa: Ctrl+C no Terminal 5 (validador), depois Terminal 4 (bridge), depois Terminal 2 (driver — vai jogar alguns tracebacks cosméticos do `rclpy` no shutdown do Foxy, pode ignorar). O `vcan0` do Terminal 1 pode ficar de pé pra próxima sessão, ou remover com `sudo ip link delete vcan0`.

**Nota para deploy real (Jetson + `can1` físico):** o mesmo passo a passo vale, só troca `--iface vcan0` por `--iface can1` no Terminal 4 e no Terminal 5, e pula o Terminal 1 (não precisa de `vcan0` se `can1` físico já estiver configurado — ver §3).

---

## 6. Subida nativa no boot (systemd)

Objetivo: ligar a Jetson e o pipeline inteiro sobe sozinho, sem terminal manual.

### 6.1 Serviço de rede CAN

`/etc/systemd/system/can1-up.service`:
```ini
[Unit]
Description=Bring up CAN1 interface
After=network.target
Before=sbg-driver.service

[Service]
Type=oneshot
ExecStart=/usr/sbin/ip link set can1 type can bitrate <BITRATE_A_CONFIRMAR>
ExecStartPost=/usr/sbin/ip link set can1 up
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

### 6.2 Serviço do driver SBG

`/etc/systemd/system/sbg-driver.service`:
```ini
[Unit]
Description=SBG ROS2 driver (INS UART → tópicos)
After=can1-up.service
Requires=can1-up.service

[Service]
Type=simple
User=sauva
Environment=ROS_DOMAIN_ID=0
ExecStart=/bin/bash -c "source /opt/ros/foxy/setup.bash && \
  source /home/sauva/ros2_ins/sbg_ros2_driver/install/setup.bash && \
  ros2 launch sbg_driver sbg_device_launch.py \
  config_file:=/home/sauva/ros2_ins/sbg_ros2_driver/config/sbg_device_uart_default.yaml"
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### 6.3 Serviço do bridge CAN

`/etc/systemd/system/sbg-can-bridge.service`:
```ini
[Unit]
Description=SBG ROS2 → CAN bridge (protocolo sbgCan.dbc)
After=sbg-driver.service
Requires=sbg-driver.service

[Service]
Type=simple
User=sauva
Environment=ROS_DOMAIN_ID=0
WorkingDirectory=/home/sauva
ExecStartPre=/bin/sleep 5
ExecStart=/bin/bash -c "source /opt/ros/foxy/setup.bash && \
  source /home/sauva/ros2_ins/sbg_ros2_driver/install/setup.bash && \
  python3 /home/sauva/sbg_to_can.py --iface can1 --rate 25"
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

> `ExecStartPre=/bin/sleep 5` dá uma folga para o driver SBG conectar ao dispositivo e começar a publicar antes do bridge tentar assinar os tópicos. Ajustar se o boot do INS demorar mais.

### 6.4 Ativar tudo

```bash
sudo systemctl daemon-reload
sudo systemctl enable can1-up.service sbg-driver.service sbg-can-bridge.service
sudo systemctl start can1-up.service sbg-driver.service sbg-can-bridge.service
```

### 6.5 Verificar depois do boot

```bash
systemctl status can1-up.service sbg-driver.service sbg-can-bridge.service
journalctl -u sbg-driver.service -f       # logs em tempo real do driver
journalctl -u sbg-can-bridge.service -f   # logs em tempo real do bridge
candump can1                              # tráfego real no barramento
```

---

## 7. Checklist de validação pós-boot

- [ ] `systemctl is-active can1-up sbg-driver sbg-can-bridge` → todos `active`
- [ ] `ros2 topic hz /sbg/imu_data` → ~25Hz estável
- [ ] `candump can1` → frames aparecendo nos IDs 288/289/290/304/306/308/311 continuamente
- [ ] Ao ar livre, com fix de GPS: `ros2 topic hz /sbg/gps_pos` publicando, e frames CAN 373/377 aparecendo
- [ ] `ros2 topic hz /sbg/ekf_euler` publicando (não trava) — se travar mesmo ao ar livre, suspeitar de aiding insuficiente (GNSS ainda sem fix, ou magnetômetro desabilitado)
- [ ] Validar decode via `cantools` (script `validate_sbg_can.py`, ver §8)

---

## 8. Histórico de debug desta sessão (para referência futura)

| Sintoma | Causa | Fix |
|---|---|---|
| `ros2 node list` vazio mesmo com INS ligado | Driver nunca foi iniciado — conectar o cabo não sobe o node sozinho | `ros2 launch sbg_driver sbg_device_launch.py ...` |
| Bridge não recebia nenhum dado | Script assinava `/sbg/gps1_pos`/`/sbg/gps1_hdt`, tópicos reais são `/sbg/gps_pos`/`/sbg/gps_hdt` (sem sufixo `1` nesta versão do driver) | Corrigido no `sbg_to_can.py` |
| `cantools` não decodificava nenhum frame | Bridge mandava frame **extended** (`CAN_EFF_FLAG`), mas `sbgCan.dbc` define tudo como **standard** (11-bit) — confirmado via `grep "^BO_" sbgCan.dbc` (todos os IDs < 2048, sem bit alto somado) | Removido `CAN_EFF_FLAG` do `build_frame()` |
| `frame vcan0 00000002 ...` estranho aparecendo no candump | Sobra de um script antigo (protocolo customizado pré-DBC) ainda rodando em background | Matar processo zumbi (`ps aux \| grep python3`) |
| Lat/Lon sempre zero | Sem fix de GPS — device dentro de gaiola de Faraday (blindagem impede sinal de satélite) | Esperado; testar ao ar livre |
| `/sbg/ekf_euler` nunca publica | Sem aiding suficiente pra convergir Yaw dentro da gaiola (GNSS sem sinal ali dentro mesmo já habilitado no device) | Esperado dentro da gaiola; GNSS já habilitado via sbgCenter (§4.1) — validar ao ar livre |
| `can1` não existe (`Device "can1" does not exist`) — nem `can0` | Testando numa bancada Ubuntu genérica, sem Jetson física nem adaptador USB-CAN conectado — não há controlador CAN nenhum no sistema | Usar `vcan0` pra validação de software nesta fase; testar `can1` físico só na Jetson real (controlador `mttcan`) ou com adaptador USB-CAN na bancada |

---

## 9. Scripts de referência

- `sbg_to_can.py` — bridge ROS2 → CAN, protocolo oficial `sbgCan.dbc`, frame standard 11-bit.
- `validate_sbg_can.py` — escuta a interface CAN e decodifica cada frame via `cantools` + `sbgCan.dbc`, imprime resumo de validação por ID.

Uso do validador contra `can1` real (não só `vcan0` de teste):
```bash
pip install cantools --break-system-packages   # se ainda não tiver
python3 validate_sbg_can.py --dbc /home/sauva/ros2_ins/sbgECom/can/sbgCan.dbc --iface can1 --seconds 30
```