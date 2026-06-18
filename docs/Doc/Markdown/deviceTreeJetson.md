# CAN — Operação e Recuperação de Erros (Jetson AGX Xavier)

> **Status:** Solução permanente via Device Tree ativa desde [data da resolução].  
> O workaround `devmem` **não é mais necessário** e não deve ser usado.

---

## 1. Como a CAN sobe agora

O pinmux dos pinos CAN é aplicado **automaticamente pelo kernel** durante o boot, via Device Tree (`pinctrl-0` nos nós `mttcan@c310000` e `mttcan@c320000`). Não existe mais dependência de script externo.

O serviço `can-interfaces.service` ainda é responsável por configurar bitrate e subir as interfaces:

```
can0 → 500000 bps
can1 → 250000 bps
```

Se o serviço subir normalmente, as interfaces já estão prontas. Nenhum passo manual é necessário no fluxo normal.

---

## 2. O que era o script `devmem` e por que foi removido

O script abaixo era o workaround utilizado antes da solução via Device Tree:

```bash
sudo busybox devmem 0x0c303000 32 0x0000C400
sudo busybox devmem 0x0c303008 32 0x0000C458
sudo busybox devmem 0x0c303010 32 0x0000C400
sudo busybox devmem 0x0c303018 32 0x0000C458
sudo modprobe can
sudo modprobe can_raw
sudo modprobe mttcan
sudo ip link set can0 down
sudo ip link set can0 type can bitrate 500000
sudo ip link set can0 up
sudo ip link set can1 down
sudo ip link set can1 type can bitrate 250000
sudo ip link set can1 up
```

**O que ele fazia:** escrevia diretamente nos registradores de pinmux do SoC, configurando os pinos fisicamente sem passar pelo kernel.

**Por que era problemático:**

- O kernel não sabia que os pinos tinham sido configurados externamente — havia um desalinhamento entre o estado real do hardware e o que o driver assumia.
- Dependia de ordem de execução: se o serviço rodasse antes dos `modprobe`, ou os `modprobe` antes do `devmem`, o resultado era imprevisível.
- Em `suspend/resume`, os registradores voltavam ao padrão e os pinos perdiam a configuração — o script não rodava novamente.
- Qualquer atualização de kernel ou Device Tree poderia mudar os endereços físicos e quebrar silenciosamente.

**O que a solução atual faz diferente:** o kernel aplica o pinmux durante o `probe` do driver `mttcan`, como parte do ciclo de vida normal do dispositivo. A configuração é gerenciada pelo subsistema `pinctrl` do Linux — que valida conflitos, loga erros no `dmesg`, e reaplicará a configuração automaticamente se necessário.

---

## 3. Estados de erro do protocolo CAN

O protocolo CAN define três estados para o controlador, baseados em contadores internos de erro (TEC para transmissão, REC para recepção):

| Estado | Condição | Comportamento |
|---|---|---|
| **Error-Active** | TEC < 128 e REC < 128 | Normal. Controlador participa ativamente do barramento. |
| **Error-Passive** | TEC ≥ 128 ou REC ≥ 128 | Degradado. Controlador ainda transmite e recebe, mas com menor capacidade de sinalizar erros para outros nós. |
| **Bus-Off** | TEC ≥ 256 | Controlador desconectado do barramento. Não transmite nem recebe até ser resetado. |

### Causas comuns de acúmulo de erros

- Terminação ausente ou incorreta no barramento (resistores de 120 Ω em cada ponta).
- Baud rate incompatível entre nós do barramento.
- Cabo com ruído, comprimento excessivo ou impedância incorreta.
- Nó transmitindo sem nenhum outro nó respondendo (ACK ausente — ocorre em bancada com apenas um nó conectado).

---

## 4. Como identificar o estado atual

```bash
ip -details -statistics link show can0
```

A saída mostra o estado atual (`ERROR-ACTIVE`, `ERROR-PASSIVE` ou `BUS-OFF`) e os contadores de erro:

```
can0: <...> mtu 16 ...
    link/can
    can state ERROR-ACTIVE restart-ms 0
        bitrate 500000 ...
    RX: bytes  packets  errors  dropped ...
    TX: bytes  packets  errors  dropped ...
```

Para monitorar ambas as interfaces:

```bash
watch -n 1 'ip -details -statistics link show can0; ip -details -statistics link show can1'
```

---

## 5. Como recuperar sem reiniciar a Jetson

### Antes (workaround `devmem`)

Quando o REC chegava a 127 (limiar do error-passive) ou a interface entrava em bus-off, a única opção era **reiniciar a Jetson inteira**, porque o kernel não tinha conhecimento do estado dos pinos — um simples `ip link set down` seguido de `up` não era suficiente para recuperar o controlador.

### Agora

Como o pinmux é gerenciado pelo kernel, as interfaces podem ser completamente resetadas sem reiniciar o sistema:

```bash
# Recuperar can0
sudo ip link set can0 down
sudo ip link set can0 type can bitrate 500000
sudo ip link set can0 up

# Recuperar can1
sudo ip link set can1 down
sudo ip link set can1 type can bitrate 250000
sudo ip link set can1 up
```

O `ip link set down` força o reset do controlador MTTCAN. O `up` subsequente reinicia o driver do zero, aplicando o pinmux novamente via Device Tree.

### Recuperação automática (bus-off)

Para configurar recuperação automática de bus-off sem intervenção manual, use o parâmetro `restart-ms`:

```bash
sudo ip link set can0 down
sudo ip link set can0 type can bitrate 500000 restart-ms 100
sudo ip link set can0 up
```

`restart-ms 100` instrui o driver a tentar sair do estado bus-off automaticamente após 100 ms. Útil para operação autônoma onde não há operador monitorando.

> **Nota:** `restart-ms` só atua no estado bus-off. Error-passive não dispara o restart automático — o controlador permanece no barramento, só com capacidade reduzida de sinalização de erro.

---

## 6. Checklist de diagnóstico rápido

Se `can0` ou `can1` não aparecer ou não funcionar após o boot:

1. **Verificar se as interfaces existem:**
   ```bash
   ip link show can0
   ip link show can1
   ```
   Se não existirem → problema de probe do driver (ver passo 3).

2. **Verificar o estado:**
   ```bash
   ip -details link show can0
   ```
   Se `BUS-OFF` ou `ERROR-PASSIVE` → seguir seção 5.

3. **Verificar logs do kernel:**
   ```bash
   sudo dmesg | grep -i 'mttcan\|can\|pinctrl'
   ```
   Erros de pinctrl (ex: `pin already requested`) ou de probe (`failed with error -22`) aparecem aqui.

4. **Verificar o serviço:**
   ```bash
   sudo systemctl status can-interfaces.service
   journalctl -u can-interfaces.service
   ```

---

## 7. Referência: arquivos relevantes no sistema

| Arquivo / Caminho | Descrição |
|---|---|
| `/boot/dtb/kernel_tegra194-p2888-0001-p2822-0000.dtb` (em `mmcblk0p1`) | DTB real usado no boot — contém os nós `fsae-can0-pinmux` e `fsae-can1-pinmux` |
| `mmcblk0p1:/boot/extlinux/extlinux.conf` | Configuração de boot real (label `primary`) |
| `can-interfaces.service` | Serviço que configura bitrate e sobe as interfaces no boot |
| `~/boot-dtb-mmcblk0p1-ORIGINAL.dtb` | Backup do DTB original (antes de qualquer edição) |

> **Atenção para novos membros do time:** o rootfs roda no NVMe (`nvme0n1p1`), mas o kernel, initrd e DTB são carregados do eMMC (`mmcblk0p1`). Editar o DTB no NVMe não tem efeito. Ver documentação de boot para detalhes.