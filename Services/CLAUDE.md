# Systemd Services & Deployment Context

## Important Folders
* `servicosJetson/`: Configuration and unit files target for the car (`.service`).
* `servicosServidor/`: Configuration and unit files target for the box (`.service`).

## Common Bash Commands
* **Check Logs:** `journalctl -u telemetry-edge.service -n 50 --no-pager`
* **Service Status:** `systemctl status can-interfaces.service`
* **Reload Daemon:** `sudo systemctl daemon-reload`

## Operational Rules
* **SocketCAN Recovery:** Ensure `can-interfaces.service` maintains the `restart-ms 100` kernel constraint to auto-recover from electromagnetic interference (EMI) drops on the track.
* Never hardcode passwords in shell scripts. Always request environment variable checks.