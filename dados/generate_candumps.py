import os
import struct
import random
import math

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUTPUT_DIR, exist_ok=True)

def clamp(val, min_val, max_val):
    return max(min_val, min(max_val, val))

# Helper to format a candump line
# Timestamp format: (1234567890.123456) can0 ID#DATA
def format_candump_line(timestamp, can_id, data_bytes):
    hex_id = f"{can_id:08X}" if can_id > 0x7FF else f"{can_id:03X}"
    hex_data = "".join(f"{b:02X}" for b in data_bytes)
    return f"({timestamp:.6f}) can0 {hex_id}#{hex_data}\n"

class CarSimulation:
    def __init__(self, start_time):
        self.t = 0.0
        self.timestamp = start_time
        
        # Physical values
        self.speed = 0.0  # km/h
        self.rpm = 0.0
        self.torque = 0.0  # Nm
        self.steer = 0.0  # degrees
        self.apps = 0.0  # %
        self.brake = 0.0  # %
        
        self.lat_g = 0.0
        self.long_g = 0.0
        
        # Temperatures
        self.motor_temp = 40.0
        self.bms_temp = 32.0
        self.pt_temp1 = 40.0
        self.pt_temp2 = 40.0
        self.pt_pres1 = 100.0
        self.pt_pres2 = 100.0
        
        # Battery state
        self.bms_soc = 95.0
        self.bms_current = 0.0
        self.bms_voltage = 345.0
        
        # Suspension and Brake pressure (PT)
        self.suspaR = 127.0
        self.pt_brake = 0.0

    def step(self, dt, target_apps, target_brake, target_steer):
        self.t += dt
        self.timestamp += dt
        
        # Smoothly interpolate steer, apps, brake
        self.apps += (target_apps - self.apps) * 5.0 * dt
        self.brake += (target_brake - self.brake) * 8.0 * dt
        self.steer += (target_steer - self.steer) * 6.0 * dt
        
        # Speed dynamics
        if self.apps > 0:
            accel_force = (self.apps / 100.0) * 80.0
            drag = 0.05 * (self.speed ** 1.8)
            net_accel = (accel_force - drag) / 10.0
            self.speed = max(0.0, self.speed + net_accel * dt * 3.6)
            self.long_g = net_accel / 9.81
        elif self.brake > 0:
            decel = (self.brake / 100.0) * 12.0
            self.speed = max(0.0, self.speed - decel * dt * 3.6)
            self.long_g = -decel / 9.81
        else:
            drag = 0.05 * (self.speed ** 1.8)
            decel = drag / 10.0
            self.speed = max(0.0, self.speed - decel * dt * 3.6)
            self.long_g = -decel / 9.81
            
        # RPM is proportional to speed
        self.rpm = (self.speed / 100.0) * 5500.0
        
        # Lateral G based on steer and speed
        self.lat_g = (self.steer / 105.0) * (self.speed / 100.0) * 1.5
        
        # PT Suspension travel - compressed on outer side, extended on inner
        self.suspaR = 127.0 - (self.lat_g * 50.0)
        self.suspaR = clamp(self.suspaR, 0.0, 255.0)
        
        # PT Brake pressure
        self.pt_brake = self.brake * 2.5
        
        # Battery state
        power_demand = clamp((self.speed * self.apps * 0.01), 0.0, 80.0)
        self.bms_current = (power_demand * 1000.0) / self.bms_voltage
        if self.brake > 0:
            self.bms_current = - (self.brake * 0.4)  # regen
        
        self.bms_voltage = 345.0 - (self.bms_current * 0.05)
        self.bms_soc -= (abs(self.bms_current) * dt) / 3600.0
        
        # Temperature rises
        self.motor_temp += (self.bms_current ** 2) * 0.00001 * dt - (self.motor_temp - 40.0) * 0.005 * dt
        self.bms_temp += abs(self.bms_current) * 0.0005 * dt - (self.bms_temp - 32.0) * 0.002 * dt
        self.pt_temp1 += (self.rpm * 0.0001) * dt - (self.pt_temp1 - 40.0) * 0.002 * dt
        self.pt_temp2 += (self.rpm * 0.0001) * dt - (self.pt_temp2 - 40.0) * 0.002 * dt
        
        # Pressures
        self.pt_pres1 = 100.0 + (self.rpm / 5500.0) * 50.0 - (self.pt_temp1 - 40.0) * 0.5
        self.pt_pres2 = 100.0 + (self.rpm / 5500.0) * 50.0 - (self.pt_temp2 - 40.0) * 0.5

    def get_inverter_a_payload(self):
        speed_raw = int(clamp(self.rpm + 32000, 0, 65535))
        torque_raw = int(clamp((self.apps * 1.2 + 6400) * 5, 0, 65535))
        power_raw = 32000
        temp_raw = int(clamp(self.motor_temp + 40, 0, 255))
        status = 0x0A
        return struct.pack('<BHHHB', status, speed_raw, torque_raw, power_raw, temp_raw)

    def get_inverter_b_payload(self):
        speed_raw = int(clamp(self.rpm + 32000, 0, 65535))
        torque_raw = int(clamp((self.apps * 1.2 + 6400) * 5, 0, 65535))
        power_raw = 32000
        temp_raw = int(clamp(self.motor_temp + 40, 0, 255))
        status = 0x0A
        return struct.pack('<BHHHB', status, speed_raw, torque_raw, power_raw, temp_raw)

    def get_vcu_payload(self):
        apps_perc_val = int(clamp(self.apps, 0, 100))
        brake_val = 1 if self.brake > 10 else 0
        vcu_state = 3  # OPERANDO
        hv_on = 1
        return struct.pack('BBBBBBBB', 0, 0, brake_val, vcu_state, apps_perc_val, hv_on, 0, apps_perc_val)

    def get_pt_sensores1_payload(self):
        pd = int(clamp((self.rpm / 5500.0) * 200.0 + random.uniform(-2, 2), 0, 255))
        pe = int(clamp((self.rpm / 5500.0) * 200.0 + random.uniform(-2, 2), 0, 255))
        t1 = int(clamp(self.pt_temp1 + random.uniform(-1, 1), 0, 255))
        p1 = int(clamp(self.pt_pres1 + random.uniform(-5, 5), 0, 255))
        t2 = int(clamp(self.pt_temp2 + random.uniform(-1, 1), 0, 255))
        p2 = int(clamp(self.pt_pres2 + random.uniform(-5, 5), 0, 255))
        return struct.pack('BBBBBBBB', pd, pe, t1, p1, t2, p2, 0, 0)

    def get_pt_sensores2_payload(self):
        f = int(clamp(self.pt_brake + random.uniform(-2, 2), 0, 255))
        s = int(clamp(self.suspaR + random.uniform(-1, 1), 0, 255))
        return struct.pack('BBBBBBBB', f, s, 0, 0, 0, 0, 0, 0)

    def get_bms_volt_payload(self):
        min_v = int(clamp((3.4 - 2.0) * 100, 0, 255))
        max_v = int(clamp((3.6 - 2.0) * 100, 0, 255))
        avg_v = int(clamp((3.5 - 2.0) * 100, 0, 255))
        return struct.pack('>BBB', min_v, max_v, avg_v) + b'\x00\x00\x00\x00\x00'

    def get_bms_temp_payload(self):
        min_t = int(clamp(self.bms_temp - 2.0 + 100, 0, 255))
        max_t = int(clamp(self.bms_temp + 2.0 + 100, 0, 255))
        avg_t = int(clamp(self.bms_temp + 100, 0, 255))
        return struct.pack('>BBB', min_t, max_t, avg_t) + b'\x00\x00\x00\x00\x00'

    def get_bms_individual_volts_payload(self):
        v = int(clamp((3.5 - 2.0) * 100, 0, 255))
        return struct.pack('>BBBBBBBB', v, v, v, v, v, v, v, v)

    def get_bms_individual_temps_payload(self):
        t = int(clamp(self.bms_temp + 100, 0, 255))
        return struct.pack('>BBBBBBBB', t, t, t, t, t, t, t, t)

    def get_ins_1_payload(self):
        ax = int(clamp(self.long_g * 9.81 * 100, -32768, 32767))
        wx = int(clamp(self.steer * 0.1 * 100, -32768, 32767))
        ay = int(clamp(self.lat_g * 9.81 * 100, -32768, 32767))
        wy = 0
        return struct.pack('<hhhh', ax, wx, ay, wy)

    def get_ins_2_payload(self):
        az = int(clamp(9.81 * 100, -32768, 32767))
        wz = int(clamp(self.steer * 0.5 * 100, -32768, 32767))
        vx = int(clamp((self.speed / 3.6) * 100, -32768, 32767))
        vy = 0
        return struct.pack('<hhhh', az, wz, vx, vy)

def generate_log(filename, duration, start_time, profile_fn, dt_jitter=0.0):
    filepath = os.path.join(OUTPUT_DIR, filename)
    sim = CarSimulation(start_time)
    dt_base = 0.010  # 10ms steps (100Hz)
    
    last_10ms = 0.0
    last_20ms = 0.0
    last_100ms = 0.0
    last_600ms = 0.0
    
    with open(filepath, 'w') as f:
        while sim.t < duration:
            dt = dt_base + random.uniform(-dt_jitter, dt_jitter)
            dt = max(0.008, min(0.013, dt))  # clamp to realistic range
            target_apps, target_brake, target_steer = profile_fn(sim.t)
            sim.step(dt, target_apps, target_brake, target_steer)
            
            # Emit frames based on period
            if sim.t - last_10ms >= 0.010:
                # INS at 100Hz
                f.write(format_candump_line(sim.timestamp, 0x01, sim.get_ins_1_payload()))
                f.write(format_candump_line(sim.timestamp, 0x02, sim.get_ins_2_payload()))
                last_10ms = sim.t
                
            if sim.t - last_20ms >= 0.020:
                # VCU, PT Sensores at 50Hz
                f.write(format_candump_line(sim.timestamp, 0x18FF1515, sim.get_vcu_payload()))
                f.write(format_candump_line(sim.timestamp, 1024, sim.get_pt_sensores1_payload()))
                f.write(format_candump_line(sim.timestamp, 1025, sim.get_pt_sensores2_payload()))
                last_20ms = sim.t
                
            if sim.t - last_100ms >= 0.100:
                # Inverter A/B at 10Hz
                f.write(format_candump_line(sim.timestamp, 0x18FF01EA, sim.get_inverter_a_payload()))
                f.write(format_candump_line(sim.timestamp, 0x18FF02EA, sim.get_inverter_b_payload()))
                # BMS at 10Hz
                f.write(format_candump_line(sim.timestamp, 0x19B50001, sim.get_bms_volt_payload()))
                f.write(format_candump_line(sim.timestamp, 0x19B50008, sim.get_bms_temp_payload()))
                f.write(format_candump_line(sim.timestamp, 0x19B50100, sim.get_bms_individual_volts_payload()))
                f.write(format_candump_line(sim.timestamp, 0x19B50800, sim.get_bms_individual_temps_payload()))
                last_100ms = sim.t

            if sim.t - last_600ms >= 0.600:
                # Setpoint messages at 1.6Hz
                f.write(format_candump_line(sim.timestamp, 0x18FF1080, b'\x00\x00\x00\x00\x00\x00\x00\x00'))
                f.write(format_candump_line(sim.timestamp, 0x18FF1180, b'\x00\x00\x00\x00\x00\x00\x00\x00'))
                f.write(format_candump_line(sim.timestamp, 0x18FF1280, b'\x00\x00\x00\x00\x00\x00\x00\x00'))
                f.write(format_candump_line(sim.timestamp, 0x18FFE180, b'\x00\x00\x00\x00\x00\x00\x00\x00'))
                f.write(format_candump_line(sim.timestamp, 0x18FFE280, b'\x00\x00\x00\x00\x00\x00\x00\x00'))
                last_600ms = sim.t

    print(f"✅ Gerado {filename} ({duration}s)")

# ----------------- PROFILES -----------------
def autocross_profile(t):
    steer = 105.0 * math.sin(t * 0.8) * (0.8 + 0.2 * math.cos(t * 0.1))
    if (t % 15) < 10:
        apps = 80.0
        brake = 0.0
    else:
        apps = 0.0
        brake = 40.0
    return apps, brake, steer

def acceleration_profile(t):
    steer = 0.0
    if t < 3.0:
        apps = 0.0
        brake = 0.0
    elif t < 8.0:
        apps = 100.0
        brake = 0.0
    elif t < 12.0:
        apps = 0.0
        brake = 100.0
    else:
        apps = 0.0
        brake = 0.0
    return apps, brake, steer

def skidpad_profile(t):
    if t < 5.0:
        apps = 40.0
        brake = 0.0
        steer = 0.0
    elif t < 20.0:
        apps = 30.0
        brake = 0.0
        steer = -105.0
    elif t < 25.0:
        apps = 30.0
        brake = 0.0
        steer = 0.0
    elif t < 40.0:
        apps = 30.0
        brake = 0.0
        steer = 105.0
    else:
        apps = 0.0
        brake = 60.0
        steer = 0.0
    return apps, brake, steer

def enduro_profile(t):
    steer = 80.0 * math.sin(t * 0.4) * math.cos(t * 0.05)
    cycle = t % 30
    if cycle < 12:
        apps = 70.0
        brake = 0.0
    elif cycle < 18:
        apps = 20.0
        brake = 0.0
    elif cycle < 24:
        apps = 0.0
        brake = 50.0
    else:
        apps = 90.0
        brake = 0.0
    return apps, brake, steer

# -------- OVAL ZIGZAG PROFILE --------
# Pista oval com chicane (zigue-zague) no lado sul.
# 5 voltas com variação natural entre cada uma.

class OvalZigzagState:
    """Mantém estado entre voltas para variação progressiva."""
    def __init__(self):
        self.lap = 0
        self.lap_start_t = 0.0
        # Duração base de cada fase (s) — varia por volta
        self.phase_durations = [8.0, 5.0, 10.0, 5.0]  # norte, curva_E, sul_zigzag, curva_W
        self.total_lap_time = sum(self.phase_durations)
        # Parâmetros que variam por volta
        self.north_apps = 85.0
        self.zigzag_amp = 50.0
        self.zigzag_freq = 2.2
        self.south_apps = 55.0
        self.curve_steer_E = 80.0
        self.curve_steer_W = -80.0
        self.curve_brake = 45.0
        self.error_this_lap = False
        self.error_phase = -1
        self.error_magnitude = 0.0
        self._regenerate_lap_params()

    def _regenerate_lap_params(self):
        """Gera parâmetros únicos para a volta atual."""
        lap = self.lap
        # Otimização progressiva: voltas posteriores ~3-5% mais rápidas
        speed_factor = 1.0 + lap * 0.012
        fatigue_noise = random.gauss(0, 0.03)  # piloto nem sempre melhora

        self.north_apps = clamp(85.0 * speed_factor + random.gauss(0, 4), 72, 95)
        self.south_apps = clamp(55.0 * speed_factor + random.gauss(0, 3), 45, 68)
        self.zigzag_amp = clamp(50.0 + random.gauss(0, 7), 35, 65)
        self.zigzag_freq = clamp(2.2 + random.gauss(0, 0.3), 1.6, 2.9)
        self.curve_steer_E = clamp(80.0 + random.gauss(0, 6), 68, 95)
        self.curve_steer_W = clamp(-80.0 + random.gauss(0, 6), -95, -68)
        self.curve_brake = clamp(45.0 + random.gauss(0, 5), 35, 60)

        # Variação na duração das fases (±0.5-1.5s)
        self.phase_durations = [
            8.0 + random.uniform(-0.8, 0.8) - lap * 0.15,   # norte — fica mais curto
            5.0 + random.uniform(-0.5, 0.5),
            10.0 + random.uniform(-1.0, 1.0) - lap * 0.1,   # zigzag — fica mais eficiente
            5.0 + random.uniform(-0.5, 0.5),
        ]
        # Garante mínimo
        self.phase_durations = [max(d, 3.0) for d in self.phase_durations]
        self.total_lap_time = sum(self.phase_durations)

        # Erro de pilotagem: ~30% de chance por volta
        self.error_this_lap = random.random() < 0.35
        if self.error_this_lap:
            self.error_phase = random.choice([0, 2, 3])  # erro na reta norte, zigzag ou curva W
            self.error_magnitude = random.uniform(0.6, 1.0)
        else:
            self.error_phase = -1
            self.error_magnitude = 0.0


_oval_state = OvalZigzagState()

def oval_zigzag_profile(t):
    global _oval_state
    st = _oval_state

    # Warm-up: primeiros 5s parado, depois arranca
    WARMUP = 5.0
    COOLDOWN_START = WARMUP  # calculado depois
    NUM_LAPS = 5

    if t < WARMUP:
        # Parado, motor ligado, aquecendo
        progress = t / WARMUP
        apps = 5.0 * progress  # leve toque no acelerador
        return apps, 0.0, 0.0

    # Tempo dentro da corrida (pós warm-up)
    race_t = t - WARMUP

    # Detectar volta atual
    accumulated = 0.0
    current_lap = 0
    for lap_i in range(NUM_LAPS):
        if current_lap != st.lap:
            # Precisa recalcular para essa volta
            pass
        if race_t < accumulated + st.total_lap_time:
            break
        accumulated += st.total_lap_time
        current_lap += 1
        if current_lap >= NUM_LAPS:
            # Cool-down: frenagem final
            cooldown_t = race_t - accumulated
            if cooldown_t < 3.0:
                return 0.0, 60.0 * (1.0 - cooldown_t / 3.0), 0.0
            else:
                return 0.0, 0.0, 0.0

    # Atualizar volta se mudou
    if current_lap != st.lap and current_lap < NUM_LAPS:
        st.lap = current_lap
        st.lap_start_t = accumulated
        st._regenerate_lap_params()

    if current_lap >= NUM_LAPS:
        cooldown_t = race_t - accumulated
        if cooldown_t < 3.0:
            return 0.0, 60.0 * (1.0 - cooldown_t / 3.0), 0.0
        return 0.0, 0.0, 0.0

    # Tempo dentro da volta
    lap_t = race_t - accumulated

    # Determinar fase
    d_norte = st.phase_durations[0]
    d_curva_e = st.phase_durations[1]
    d_zigzag = st.phase_durations[2]
    d_curva_w = st.phase_durations[3]

    if lap_t < d_norte:
        # === RETA NORTE — alta velocidade ===
        phase_progress = lap_t / d_norte
        apps = st.north_apps
        brake = 0.0
        # Leve correção de esterço (pista não é perfeita)
        steer = random.gauss(0, 1.5)

        # Erro: perda momentânea de tração / correção brusca
        if st.error_this_lap and st.error_phase == 0:
            error_window = 0.3 + 0.4 * st.error_magnitude
            error_center = d_norte * 0.6
            if abs(lap_t - error_center) < error_window:
                steer = 15.0 * st.error_magnitude * math.sin((lap_t - error_center) * 8)
                apps *= 0.7  # piloto levanta o pé

        # Frenagem pra entrar na curva no final
        if phase_progress > 0.85:
            brake_progress = (phase_progress - 0.85) / 0.15
            apps = apps * (1.0 - brake_progress)
            brake = st.curve_brake * brake_progress
            steer = st.curve_steer_E * brake_progress * 0.3  # começa a virar

        return apps, brake, steer

    elif lap_t < d_norte + d_curva_e:
        # === CURVA LESTE (180°) ===
        curve_t = lap_t - d_norte
        phase_progress = curve_t / d_curva_e

        # Esterço sustentado com pequena variação
        steer = st.curve_steer_E * (0.9 + 0.1 * math.sin(phase_progress * math.pi))
        steer += random.gauss(0, 2.0)

        # Freia no começo, acelera na saída
        if phase_progress < 0.4:
            apps = 15.0 + 10.0 * phase_progress
            brake = st.curve_brake * (1.0 - phase_progress / 0.4)
        elif phase_progress < 0.7:
            apps = 25.0 + random.gauss(0, 2)
            brake = 0.0
        else:
            exit_ramp = (phase_progress - 0.7) / 0.3
            apps = 25.0 + 30.0 * exit_ramp
            brake = 0.0
            steer = st.curve_steer_E * (1.0 - exit_ramp * 0.7)  # desfaz o esterço

        return apps, brake, steer

    elif lap_t < d_norte + d_curva_e + d_zigzag:
        # === RETA SUL — ZIGUE-ZAGUE (chicane) ===
        zz_t = lap_t - d_norte - d_curva_e
        phase_progress = zz_t / d_zigzag

        apps = st.south_apps
        brake = 0.0

        # Zigue-zague: senóide com amplitude e freq variáveis
        # Piloto entra, faz 3-4 chicanes, e sai
        # Envelope: sobe, sustenta, desce
        if phase_progress < 0.1:
            envelope = phase_progress / 0.1
        elif phase_progress > 0.85:
            envelope = (1.0 - phase_progress) / 0.15
        else:
            envelope = 1.0

        # Frequência do zigue-zague com leve irregularidade
        freq = st.zigzag_freq * (1.0 + 0.08 * math.sin(zz_t * 0.7))
        zigzag_steer = st.zigzag_amp * envelope * math.sin(2 * math.pi * freq * zz_t / d_zigzag * 3.5)

        # Adicionar "imperfeição humana": atraso na reação
        reaction_lag = random.gauss(0, 3.0)
        steer = zigzag_steer + reaction_lag

        # Piloto freia levemente antes de cada inversão de direção
        steer_deriv = abs(math.cos(2 * math.pi * freq * zz_t / d_zigzag * 3.5))
        if steer_deriv > 0.85 and envelope > 0.5:
            apps *= 0.80
            brake = 8.0 + random.uniform(0, 5)

        # Erro: uma chicane mal feita (overshoot)
        if st.error_this_lap and st.error_phase == 2:
            error_center = d_zigzag * 0.45
            if abs(zz_t - error_center) < 0.6:
                steer *= 1.4  # overshoot
                apps *= 0.6   # piloto corrige levantando
                brake = 20.0

        # Frenagem final pra curva oeste
        if phase_progress > 0.88:
            brake_ramp = (phase_progress - 0.88) / 0.12
            apps = apps * (1.0 - brake_ramp * 0.7)
            brake = max(brake, st.curve_brake * brake_ramp)
            steer += st.curve_steer_W * brake_ramp * 0.25

        return apps, brake, steer

    else:
        # === CURVA OESTE (180°) ===
        curve_t = lap_t - d_norte - d_curva_e - d_zigzag
        phase_progress = curve_t / d_curva_w

        steer = st.curve_steer_W * (0.9 + 0.1 * math.sin(phase_progress * math.pi))
        steer += random.gauss(0, 2.0)

        if phase_progress < 0.4:
            apps = 15.0 + 10.0 * phase_progress
            brake = st.curve_brake * (1.0 - phase_progress / 0.4)
        elif phase_progress < 0.7:
            apps = 25.0 + random.gauss(0, 2)
            brake = 0.0
        else:
            exit_ramp = (phase_progress - 0.7) / 0.3
            apps = 25.0 + 40.0 * exit_ramp  # acelera forte pra reta norte
            brake = 0.0
            steer = st.curve_steer_W * (1.0 - exit_ramp * 0.8)

        # Erro: frenagem tardia na saída
        if st.error_this_lap and st.error_phase == 3 and phase_progress > 0.5:
            if phase_progress < 0.65:
                brake = 30.0 * st.error_magnitude
                apps = 10.0
                steer *= 1.2

        return apps, brake, steer


# Run the generation
start_epoch = 946688569.0
# generate_log("autocross_completo.log", 120.0, start_epoch, autocross_profile)
# generate_log("aceleracao.log", 15.0, start_epoch, acceleration_profile)
# generate_log("skidpad.log", 45.0, start_epoch, skidpad_profile)
# generate_log("enduro.log", 180.0, start_epoch, enduro_profile)

# Reset state and generate oval zigzag
_oval_state = OvalZigzagState()
random.seed(42)  # reproducível mas realista
generate_log("oval_zigzag.log", 155.0, start_epoch, oval_zigzag_profile, dt_jitter=0.0004)
