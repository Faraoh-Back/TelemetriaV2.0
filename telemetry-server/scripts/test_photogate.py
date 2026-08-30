#!/usr/bin/env python3
import socket
import struct
import time
import sys

def send_lap(sock, sensor_id, timestamp, lap):
    # CAN Payload is 8 bytes. Pack lap as uint32 in the first 4 bytes, and pad the other 4 bytes.
    can_payload = struct.pack('<I4x', lap)
    
    # Payload (20 bytes): 4B sensor_id + 8B timestamp + 8B CAN payload
    payload = struct.pack('<Id8s', sensor_id, timestamp, can_payload)
    
    # Length prefix (4B uint32) = 20
    length_prefix = struct.pack('<I', len(payload))
    
    packet = length_prefix + payload
    sock.sendall(packet)
    print(f"-> Sent: Sensor=0x{sensor_id:X}, Timestamp={timestamp:.3f}, Lap={lap}")

def main():
    host = '127.0.0.1'
    port = 8082
    
    print(f"Connecting to Photogate listener at {host}:{port}...")
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.connect((host, port))
        print("Connected successfully.")
    except Exception as e:
        print(f"Error connecting: {e}")
        print("Make sure the telemetry-server is running.")
        sys.exit(1)
        
    try:
        # 1. Start session (Volta 1)
        t_start = time.time()
        send_lap(sock, 0x7F0, t_start, 1)
        
        # Wait 3 seconds
        print("Waiting 3 seconds (Lap 1 in progress)...")
        time.sleep(3.0)
        
        # 2. Complete Lap 1 (Volta 2)
        t_lap1 = time.time()
        send_lap(sock, 0x7F0, t_lap1, 2)
        
        # Wait 4.5 seconds
        print("Waiting 4.5 seconds (Lap 2 in progress)...")
        time.sleep(4.5)
        
        # 3. Complete Lap 2 (Volta 3)
        t_lap2 = time.time()
        send_lap(sock, 0x7F0, t_lap2, 3)
        
        print("Simulated session complete.")
    finally:
        sock.close()
        print("Disconnected.")

if __name__ == "__main__":
    main()
