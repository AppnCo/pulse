fn main() {
    // Commandes natives autorisées pour le site chargé depuis appnco.app (voir capabilities/default.json)
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["native_info", "native_play", "native_stop", "monitor_start", "monitor_stop", "monitor_gain", "monitor_info", "midi_ports", "midi_start", "pick_folder", "create_project_folder", "project_folder_ok", "save_file", "reveal_project_folder", "take_pending_open", "read_pulse_file", "import_url", "read_import_file", "save_download", "test_log", "test_exit"]),
        ),
    )
    .expect("échec du build Tauri");
}
