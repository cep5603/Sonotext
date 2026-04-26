#[cfg(not(debug_assertions))]
use std::{net::TcpStream, time::Duration};
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

#[cfg(not(debug_assertions))]
fn backend_port_is_open() -> bool {
    let address = "127.0.0.1:8000"
        .parse()
        .expect("valid backend socket address");

    TcpStream::connect_timeout(&address, Duration::from_millis(500)).is_ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            {
                if backend_port_is_open() {
                    println!("Backend already running on 127.0.0.1:8000; not starting sidecar.");
                    return Ok(());
                }

                let sidecar_command = app.shell().sidecar("sonotext-backend")?;
                let (mut rx, child) = sidecar_command.spawn()?;

                tauri::async_runtime::spawn(async move {
                    let _child = child;

                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                println!("{}", String::from_utf8_lossy(&line));
                            }
                            CommandEvent::Stderr(line) => {
                                eprintln!("{}", String::from_utf8_lossy(&line));
                            }
                            _ => {}
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
