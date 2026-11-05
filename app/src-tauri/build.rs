fn main() {
    // Declare the shell's own commands so capabilities can grant them to the hosted page.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "shell_state",
            "shell_set",
            "shell_hide",
            "shell_quit",
            "shell_tray",
            "shell_alive",
            "shell_notify",
            "shell_log",
            "shell_logs",
            "shell_open_logs",
        ])),
    )
    .expect("failed to run tauri-build");
}
