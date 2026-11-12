# Dokumentasi Teknis - Mi Media CoreBit Intelligence Suite

Dokumentasi ini menjelaskan fitur tambahan, struktur plugin, dan cara pengelolaan sistem "Mi Media" yang telah diperbarui.

## 1. Fitur Utama
Sistem telah ditingkatkan dengan **Network Intelligence Suite** yang mencakup:
- **Topology Discovery**: Auto-discovery via LLDP/CDP.
- **Config Backup**: Backup otomatis Mikrotik ke `/backups/configs/`.
- **Smart IPAM**: Deteksi Rogue Device dan IP Conflict.
- **Reporting**: Laporan PDF otomatis di `/public/reports/`.
- **NetFlow Analysis**: Pengumpul trafik UDP port 2055.
- **Admin Dashboard**: Visualisasi data di `/admin.html`.

## 2. Struktur File
- **Plugin Utama**: `/opt/corebit/plugins/network-intelligence/`
- **NetFlow Service**: `/opt/corebit/services/flow-collector.mjs`
- **Dashboard UI**: `/opt/corebit/public/admin.html`
- **Log Files**: `/var/log/syslog` (via journalctl).

## 3. Konfigurasi Bot Telegram
Untuk mengaktifkan notifikasi Telegram, tambahkan baris berikut ke file `/opt/corebit/.env`:
```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
```
Setelah mengubah `.env`, lakukan restart: `systemctl restart corebit`.

## 4. Pengelolaan Database
Data trafik NetFlow dirangkum ke tabel `flow_summaries`. Sistem memiliki tugas pembersihan otomatis:
- **Flow Summaries**: Dihapus setelah 7 hari.
- **Logs**: Dihapus setelah 30 hari.
Ini untuk mencegah database penuh.

## 5. Perintah Berguna
- **Restart Aplikasi**: `systemctl restart corebit`
- **Cek Log Real-time**: `journalctl -u corebit -f`
- **Cek Status NetFlow**: `ps aux | grep flow-collector`
- **Akses Dashboard**: `http://[IP-SERVER]:3000/admin.html`

---
*Dikembangkan oleh Antigravity untuk Mi Media.*
