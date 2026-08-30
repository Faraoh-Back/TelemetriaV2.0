#!/usr/bin/env python3
import socket
import struct
import time
import sys

def send_lap(sock, addr, sensor_id, timestamp, lap):
    # CAN Payload is 8 bytes. Pack lap as uint32 in the first 4 bytes, and pad the other 4 bytes.
    can_payload = struct.pack('<I4x', lap)
    
    # Payload (20 bytes): 4B sensor_id + 8B timestamp + 8B CAN payload
    payload = struct.pack('<Id8s', sensor_id, timestamp, can_payload)
    
    # Send via UDP
    sock.sendto(payload, addr)
    print(f"-> Sent UDP: Sensor=0x{sensor_id:X}, Timestamp={timestamp:.3f}, Lap={lap}")

def main():
    host = '127.0.0.1'
    port = 8082
    addr = (host, port)
    
    print(f"Preparing UDP socket for Photogate simulator on {host}:{port}...")
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        print("UDP Socket created successfully.")
    except Exception as e:
        print(f"Error creating socket: {e}")
        sys.exit(1)
        
    try:
        # 1. Start session (Volta 18)
        # Using 0.0 to simulate the dummy timestamp sent by the actual sensor
        print("Sending initial lap to start session...")
        send_lap(sock, addr, 0x69, 0.0, 18)
        
        # Wait 3 seconds
        print("Waiting 3 seconds (Lap 18 in progress)...")
        time.sleep(3.0)
        
        # 2. Complete Lap 18 / Start Lap 19
        send_lap(sock, addr, 0x69, 0.0, 19)
        
        # Wait 4.5 seconds
        print("Waiting 4.5 seconds (Lap 19 in progress)...")
        time.sleep(4.5)
        
        # 3. Complete Lap 19 / Start Lap 20
        send_lap(sock, addr, 0x69, 0.0, 20)
        
        print("Simulated session complete.")
    finally:
        sock.close()
        print("Socket closed.")

if __name__ == "__main__":
    main()
