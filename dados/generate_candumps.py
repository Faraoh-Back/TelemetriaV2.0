import os
import struct
import random
import math

OUTPUT_DIR = "/home/dev/GitPessoal/TelemetriaV2.0/dados/"
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

def generate_log(filename, duration, start_time, profile_fn):
    filepath = os.path.join(OUTPUT_DIR, filename)
    sim = CarSimulation(start_time)
    dt = 0.010  # 10ms steps (100Hz)
    
    last_10ms = 0.0
    last_20ms = 0.0
    last_100ms = 0.0
    last_600ms = 0.0
    
    with open(filepath, 'w') as f:
        while sim.t < duration:
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

# Run the generation
start_epoch = 946688569.0
generate_log("autocross_completo.log", 120.0, start_epoch, autocross_profile)
generate_log("aceleracao.log", 15.0, start_epoch, acceleration_profile)
generate_log("skidpad.log", 45.0, start_epoch, skidpad_profile)
generate_log("enduro.log", 180.0, start_epoch, enduro_profile)
