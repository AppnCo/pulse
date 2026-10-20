# Ferme seulement le Chrome lancé par les tests (dossier de profil « pulse-chrome-… »), jamais le Chrome de l'utilisateur
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object { $_.CommandLine -like '*pulse-chrome-*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
