//! Raw ESC/POS transport. All receipt *formatting* (what bytes to send)
//! happens in TypeScript (src/lib/escpos.ts) so the layout logic lives in
//! one place next to the rest of the billing code — this module is just a
//! thin, reliable pipe from "here are some bytes" to "the printer has them",
//! over either a USB/serial (COM) port or a network socket.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

#[derive(Serialize)]
pub struct SerialPortInfo {
    pub path: String,
    pub label: String,
}

/// Most budget ESC/POS thermal printers sold in India show up over USB as a
/// USB-to-serial adapter (CH340/CP210x/PL2303), so they enumerate here as an
/// ordinary COM/tty port rather than a raw USB printer-class device.
#[tauri::command]
pub fn list_serial_ports() -> Result<Vec<SerialPortInfo>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;
    Ok(ports
        .into_iter()
        .map(|p| {
            let label = match p.port_type {
                serialport::SerialPortType::UsbPort(info) => {
                    let product = info.product.clone().unwrap_or_else(|| "USB serial device".into());
                    match (info.vid, info.pid) {
                        (vid, pid) => format!("{product} ({vid:04x}:{pid:04x})"),
                    }
                }
                _ => "Serial port".into(),
            };
            SerialPortInfo { path: p.port_name, label }
        })
        .collect())
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PrinterTarget {
    UsbSerial { path: String, baud: u32 },
    Network { host: String, port: u16 },
}

/// Writes raw bytes straight to the printer — no parsing, no retry, no
/// receipt knowledge. A short timeout on both paths so a misconfigured or
/// powered-off printer fails fast with a clear error instead of hanging the
/// counter.
#[tauri::command]
pub fn print_raw(target: PrinterTarget, data: Vec<u8>) -> Result<(), String> {
    match target {
        PrinterTarget::UsbSerial { path, baud } => {
            let mut port = serialport::new(&path, baud)
                .timeout(Duration::from_secs(5))
                .open()
                .map_err(|e| format!("Could not open printer port {path}: {e}"))?;
            port.write_all(&data).map_err(|e| format!("Print failed: {e}"))?;
            port.flush().map_err(|e| format!("Print failed: {e}"))
        }
        PrinterTarget::Network { host, port } => {
            let addr = (host.as_str(), port)
                .to_socket_addrs()
                .map_err(|e| format!("Could not resolve printer address {host}:{port}: {e}"))?
                .next()
                .ok_or_else(|| format!("Could not resolve printer address {host}:{port}"))?;
            let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(5))
                .map_err(|e| format!("Could not reach printer at {host}:{port}: {e}"))?;
            stream.write_all(&data).map_err(|e| format!("Print failed: {e}"))?;
            stream.flush().map_err(|e| format!("Print failed: {e}"))
        }
    }
}
