#!/usr/bin/env python3
import subprocess
import re
import os

# Paths to the DBC files
SERVER_DBC = "/home/dev/GitPessoal/TelemetriaV2.0/telemetry-server/dbc_data/BMS.dbc"
MOCK_DBC = "/home/dev/GitPessoal/TelemetriaV2.0/telemetry-edge-mock/assets/dbc/BMS.dbc"

def main():
    print("Starting BMS.dbc expansion to 96 cells...")

    # 1. Fetch clean baseline DBC from git HEAD to avoid compounding previous errors
    try:
        clean_dbc = subprocess.check_output(
            ["git", "show", "HEAD:telemetry-server/dbc_data/BMS.dbc"]
        )
        # Decode as latin-1 to preserve the degree symbol character (\xb0)
        dbc_content = clean_dbc.decode("latin-1")
        print("Successfully loaded baseline BMS.dbc from Git HEAD.")
    except Exception as e:
        print(f"Error fetching baseline from git: {e}")
        # Fallback to local file if git command fails
        if os.path.exists(SERVER_DBC):
            with open(SERVER_DBC, "r", encoding="latin-1") as f:
                dbc_content = f.read()
            print("Loaded base file from local server directory (fallback).")
        else:
            print("Base file not found. Aborting.")
            return

    # 2. Identify and filter out existing cell-A messages and comments
    # We will identify messages starting with any of the prefixes for Option A cell data:
    prefixes_to_remove = [
        "Individual_Cells_Volt_Ext_A",
        "Individual_Cells_Voltages_Std_A",
        "Individual_Cell_Temp_Ext_A",
        "Individual_Cell_Temp_Std_A",
        "Indiv_Cell_Mod_Temp_Inter_Ext_A",
        "Individual_Cell_Mod_Temp_Std_A",
        "Indiv_Cell_Balancing_Ext_Extd_A",
        "Individual_Cell_Bal_Rate_Std_A"
    ]

    # Collect IDs of removed messages so we can also filter out their comments (CM_) and value tables (VAL_)
    removed_ids = set()

    # First pass: parse and find message IDs to remove
    lines = dbc_content.splitlines()
    for line in lines:
        if line.startswith("BO_ "):
            parts = line.split()
            if len(parts) >= 3:
                msg_id = parts[1]
                msg_name = parts[2].rstrip(":")
                for prefix in prefixes_to_remove:
                    if msg_name.startswith(prefix):
                        removed_ids.add(msg_id)
                        break

    print(f"Filtering out {len(removed_ids)} old A-series message definitions and their associated comments/attributes.")

    # Second pass: reconstruct the DBC file without the removed messages, comments, etc.
    filtered_lines = []
    skip_signal = False
    for line in lines:
        # Check message line
        if line.startswith("BO_ "):
            parts = line.split()
            msg_id = parts[1]
            if msg_id in removed_ids:
                skip_signal = True
                continue
            else:
                skip_signal = False

        # Skip signals belonging to removed messages
        if skip_signal and line.startswith(" SG_ "):
            continue

        # Filter out comments for removed messages
        if line.startswith("CM_ BO_ "):
            parts = line.split()
            if len(parts) >= 3 and parts[2] in removed_ids:
                continue

        # Filter out value tables or attributes if any (BMS.dbc uses VAL_ and BA_ but let's check)
        if line.startswith("VAL_ "):
            parts = line.split()
            if len(parts) >= 2 and parts[1] in removed_ids:
                continue

        filtered_lines.append(line)

    # 3. Generate the 12 blocks for all 8 categories of cell messages
    # Categories definition:
    # (name_prefix, start_id, signal_name_prefix, scale_offset, unit, comment_name)
    categories = [
        # Voltages
        ("Individual_Cells_Volt_Ext_A", 2578776320, "IndividualCellVoltage_Data_", "(0.01,2) [2|4.55]", "V", "Individual Cells Voltages Extended Option A"),
        ("Individual_Cells_Voltages_Std_A", 469, "IndividualCellVoltage_Data_", "(0.01,2) [2|4.55]", "V", "Individual Cells Voltages Standard Option A"),
        # Temperatures
        ("Individual_Cell_Temp_Ext_A", 2578778112, "IndividualCellTemp_Data_", "(1,-100) [-100|155]", "\xb0C", "Individual Cell Temperatures Extended Option A"),
        ("Individual_Cell_Temp_Std_A", 693, "IndividualCellTemp_Data_", "(1,-100) [-100|155]", "\xb0C", "Individual Cell Temperatures Standard Option A"),
        # Module Temperatures
        ("Indiv_Cell_Mod_Temp_Inter_Ext_A", 2578776576, "IndividualCellModTemp_Data_", "(1,-100) [-100|155]", "\xb0C", "Individual Cell Module Temperatures Extended Option A"),
        ("Individual_Cell_Mod_Temp_Std_A", 501, "IndividualCellModTemp_Data_", "(1,-100) [-100|155]", "\xb0C", "Individual Cell Module Temperature Standard Option A"),
        # Balancing Rates
        ("Indiv_Cell_Balancing_Ext_Extd_A", 2578776832, "IndividualCellBalancRate_Data_", "(0.392156862745098,0) [0|100]", "%", "Individual Cell Balancing Rate Extended Option A"),
        ("Individual_Cell_Bal_Rate_Std_A", 533, "IndividualCellBalancRate_Data_", "(0.392156862745098,0) [0|100]", "%", "Individual Cell Balancing Rates Standard Option A")
    ]

    new_messages_section = []
    new_comments_section = []

    for name_prefix, start_id, sig_prefix, scale_offset, unit, comment_name in categories:
        for block in range(1, 13): # 12 blocks (block 1 to 12)
            msg_id = start_id + (block - 1)
            msg_name = f"{name_prefix}{block}"
            
            # Write message header
            new_messages_section.append(f"BO_ {msg_id} {msg_name}: 8 EMUS_BMS")
            
            # Write 8 signals for this block
            # Layout cells in ascending byte order:
            # cell index (block-1)*8 + signal_num -> Byte signal_num (start bit 7 + signal_num*8)
            for signal_num in range(8):
                cell_index = (block - 1) * 8 + signal_num
                start_bit = 7 + signal_num * 8
                sig_line = f" SG_ {sig_prefix}{cell_index} : {start_bit}|8@0+ {scale_offset} \"{unit}\" Vector__XXX"
                new_messages_section.append(sig_line)
            new_messages_section.append("") # empty line after message definition

            # Write comment line
            comment_line = f"CM_ BO_ {msg_id} \"{comment_name} - Block {block}\";"
            new_comments_section.append(comment_line)

    # 4. Integrate everything back together
    # In a DBC file:
    # - Message definitions (BO_) go before comments (CM_) and attributes
    # We will locate the first CM_ or VAL_ or BA_ line in the filtered file and insert the new messages right before it.
    # We will append the new comments at the end of the comments section.
    
    output_lines = []
    inserted_msgs = False
    
    for line in filtered_lines:
        # Insert new messages before the first non-BO/SG line that starts with CM_, BA_, VAL_ or similar definitions
        if not inserted_msgs and (line.startswith("CM_ ") or line.startswith("BA_") or line.startswith("VAL_") or line.startswith("BO_TX_BU_")):
            output_lines.extend(new_messages_section)
            inserted_msgs = True
        
        output_lines.append(line)
        
        # Insert comments right after the existing comments section (before BA_ or VAL_ if possible, or we can just append them at the end)
    
    # If the file had no comments, append messages at the end
    if not inserted_msgs:
        output_lines.extend(new_messages_section)

    # Append new comments at the end of the file
    output_lines.append("")
    output_lines.extend(new_comments_section)
    output_lines.append("")

    new_dbc_content = "\n".join(output_lines)

    # 5. Write the file to both destinations
    # Ensure folders exist
    os.makedirs(os.path.dirname(SERVER_DBC), exist_ok=True)
    os.makedirs(os.path.dirname(MOCK_DBC), exist_ok=True)

    with open(SERVER_DBC, "w", encoding="latin-1") as f:
        f.write(new_dbc_content)
    print(f"Successfully wrote expanded DBC to: {SERVER_DBC}")

    with open(MOCK_DBC, "w", encoding="latin-1") as f:
        f.write(new_dbc_content)
    print(f"Successfully wrote expanded DBC to: {MOCK_DBC}")
    
    print("DBC expansion complete and correct!")

if __name__ == "__main__":
    main()
