import snmp from 'net-snmp';
import pg from 'pg';
import { RouterOSAPI } from 'node-routeros';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;
let dbPool = null;

function getDbPool() {
  if (!dbPool) {
    dbPool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return dbPool;
}

// --- Helper Functions ---

async function walkLldpNeighbors(ip, community, version) {
  return new Promise((resolve, reject) => {
    const session = snmp.createSession(ip, community, { version, timeout: 5000 });
    const neighbors = [];
    const oid = "1.0.8802.1.1.2.1.4.1.1.7"; // lldpRemPortId

    session.walk(oid, (varbinds) => {
      for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) continue;
        const index = vb.oid.split('.').slice(-2).join('.');
        if (!neighbors[index]) neighbors[index] = {};
        neighbors[index].portId = vb.value.toString();
      }
    }, (error) => {
      if (error) {
          session.close();
          return resolve([]); // Graceful failure
      }
      // Get SysName
      session.walk("1.0.8802.1.1.2.1.4.1.1.9", (vbs) => {
        for (const vb of vbs) {
          const index = vb.oid.split('.').slice(-2).join('.');
          if (neighbors[index]) neighbors[index].sysName = vb.value.toString();
        }
      }, (error2) => {
        session.close();
        resolve(Object.values(neighbors));
      });
    });
  });
}

async function syncNeighborsToDb(sourceId, neighbors) {
  const pool = getDbPool();
  for (const neighbor of neighbors) {
    if (!neighbor.sysName) continue;
    const res = await pool.query(
      "SELECT id FROM devices WHERE name = $1 OR device_data->>'systemIdentity' = $1 LIMIT 1",
      [neighbor.sysName]
    );
    if (res.rows.length > 0) {
      const targetId = res.rows[0].id;
      const connRes = await pool.query(
        "SELECT id FROM connections WHERE (source_device_id = $1 AND target_device_id = $2) OR (source_device_id = $2 AND target_device_id = $1)",
        [sourceId, targetId]
      );
      if (connRes.rows.length === 0) {
        const mapRes = await pool.query(
          "SELECT p1.map_id FROM device_placements p1 JOIN device_placements p2 ON p1.map_id = p2.map_id WHERE p1.device_id = $1 AND p2.device_id = $2 LIMIT 1",
          [sourceId, targetId]
        );
        if (mapRes.rows.length > 0) {
          await pool.query(
            "INSERT INTO connections (id, map_id, source_device_id, target_device_id, source_port, target_port, is_dynamic, dynamic_type) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, true, 'lldp_discovered')",
            [mapRes.rows[0].map_id, sourceId, targetId, 'discovered', neighbor.portId]
          );
        }
      }
    }
  }
}

async function walkArpTable(ip, community, version) {
  return new Promise((resolve) => {
    const session = snmp.createSession(ip, community, { version, timeout: 5000 });
    const entries = [];
    session.walk("1.3.6.1.2.1.4.22.1.2", (varbinds) => {
      for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) continue;
        let mac = Buffer.isBuffer(vb.value) ? vb.value.toString('hex').match(/.{1,2}/g).join(':').toUpperCase() : vb.value.toString().toUpperCase();
        const ipAddr = vb.oid.split('.').slice(-4).join('.');
        entries.push({ ip: ipAddr, mac });
      }
    }, (error) => {
      session.close();
      resolve(entries);
    });
  });
}

async function auditIpUsage(entries) {
  const pool = getDbPool();
  for (const entry of entries) {
    const res = await pool.query("SELECT id, status, mac_address FROM ipam_addresses WHERE ip_address = $1", [entry.ip]);
    if (res.rows.length > 0) {
      const addr = res.rows[0];
      if (addr.status === 'available') {
        await logEvent(null, 'rogue_detection', 'warning', `Unauthorized usage: IP ${entry.ip} is active but marked available`, { ip: entry.ip, mac: entry.mac });
      } else if (addr.mac_address && addr.mac_address.toUpperCase() !== entry.mac) {
        await logEvent(null, 'rogue_detection', 'warning', `IP Conflict: ${entry.ip} found with MAC ${entry.mac}, expected ${addr.mac_address}`, { ip: entry.ip, mac: entry.mac });
      }
    }
  }
}

async function logEvent(deviceId, type, severity, message, metadata) {
  const pool = getDbPool();
  await pool.query(
    "INSERT INTO logs (id, timestamp, device_id, event_type, severity, message, metadata) VALUES (gen_random_uuid(), NOW(), $1, $2, $3, $4, $5)",
    [deviceId, type, severity, message, JSON.stringify(metadata)]
  );

  // If severity is warning or error, send Telegram & Create Ticket
  if (severity === 'warning' || severity === 'error') {
    await sendTelegramMessage(`<b>[Mi Media Alert]</b>\nType: ${type}\nSeverity: ${severity}\nMessage: ${message}`);
    
    // Auto-create ticket for rogue detection or critical errors
    if (type === 'rogue_detection') {
      await pool.query(
        "INSERT INTO tickets (title, description, severity, device_id) VALUES ($1, $2, $3, $4)",
        [`Rogue Device: ${metadata?.ip}`, message, severity, deviceId]
      );
    }
  }
}

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
  } catch (e) {
    console.error("[Telegram] Error:", e);
  }
}

async function doMikrotikBackup(device, credentials) {
  const host = device.ipAddress;
  const user = credentials.credentials?.username || credentials.username;
  const password = credentials.credentials?.password || credentials.password;
  const port = credentials.credentials?.apiPort || 8728;
  if (!user || !password) return;

  const conn = new RouterOSAPI({ host, user, password, port, timeout: 30, keepalive: false });
  await conn.connect();
  const result = await conn.write('/export');
  await conn.close();

  const configText = result.map(r => r.text || r.data || JSON.stringify(r)).join('\n');
  const backupDir = path.join(process.cwd(), 'backups', 'configs', device.id);
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  
  const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}.rsc`;
  fs.writeFileSync(path.join(backupDir, filename), configText);

  const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.rsc')).sort().reverse();
  if (files.length > 10) files.slice(10).forEach(f => fs.unlinkSync(path.join(backupDir, f)));
}

async function checkAndGenerateReport(device) {
  const reportPath = path.join(process.cwd(), 'public', 'reports', `${device.id}.pdf`);
  if (fs.existsSync(reportPath)) {
    const age = (new Date() - fs.statSync(reportPath).mtime) / (1000 * 60 * 60);
    if (age < 24) return;
  }
  
  const pool = getDbPool();
  const doc = new PDFDocument();
  if (!fs.existsSync(path.dirname(reportPath))) fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const stream = fs.createWriteStream(reportPath);
  doc.pipe(stream);

  doc.fontSize(20).fillColor('#2563eb').text('Mi Media Health Report', { align: 'center' });
  doc.fontSize(12).fillColor('black').text(`Device: ${device.name} (${device.ipAddress})`, { align: 'center' });
  doc.text(`Status: ${device.status.toUpperCase()}`, { align: 'center' });
  doc.moveDown();

  const logsRes = await pool.query("SELECT timestamp, severity, message FROM logs WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 10", [device.id]);
  doc.fontSize(14).text('Recent Events:');
  logsRes.rows.forEach(l => doc.fontSize(9).text(`${new Date(l.timestamp).toLocaleString()} [${l.severity}] ${l.message}`));

  doc.end();
  return new Promise(r => stream.on('finish', r));
}

import express from 'express';

const apiApp = express();
apiApp.use(express.json());

// Enable CORS for the dashboard
apiApp.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

apiApp.get('/api/admin/stats', async (req, res) => {
  const pool = getDbPool();
  try {
    const flows = await pool.query("SELECT src_ip, SUM(bytes) as total_bytes FROM flow_summaries GROUP BY src_ip ORDER BY total_bytes DESC LIMIT 10");
    const tickets = await pool.query("SELECT COUNT(*) as count FROM tickets WHERE status = 'open'");
    const devices = await pool.query("SELECT COUNT(*) as count FROM devices WHERE status = 'offline'");
    res.json({ flows: flows.rows, openTickets: tickets.rows[0].count, offlineDevices: devices.rows[0].count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

apiApp.get('/api/admin/tickets', async (req, res) => {
  const pool = getDbPool();
  try {
    const result = await pool.query("SELECT * FROM tickets ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

apiApp.listen(3001, () => console.log("[Plugin] Internal Admin API listening on port 3001"));

async function runMaintenance() {
  const pool = getDbPool();
  console.log("[Maintenance] Running daily data retention task...");
  try {
    // Keep 7 days of flows
    await pool.query("DELETE FROM flow_summaries WHERE timestamp < NOW() - INTERVAL '7 days'");
    // Keep 30 days of logs
    await pool.query("DELETE FROM logs WHERE timestamp < NOW() - INTERVAL '30 days'");
    console.log("[Maintenance] Data pruned successfully.");
  } catch (e) {
    console.error("[Maintenance] Error pruning data:", e);
  }
}

// Run maintenance every 24 hours
setInterval(runMaintenance, 24 * 60 * 60 * 1000);

// --- Main Plugin Definition ---

export const plugin = {
  name: "Network Intelligence Suite",
  type: "network-intelligence",
  
  identifyCredentials(credentials) {
    const creds = credentials?.credentials || credentials;
    const isSnmp = !!(creds?.snmpCommunity || creds?.snmpUsername);
    const isMikrotik = !!(creds?.username && creds?.password && !creds?.proxmoxApiTokenId && !creds?.vmwareUsername);
    return isSnmp || isMikrotik;
  },

  poll: async (device, credentials) => {
    const results = { status: "up", deviceData: {}, metrics: {} };
    const creds = credentials?.credentials || credentials;

    try {
      // 1. Mikrotik Logic
      if (device.type === 'mikrotik' || (creds?.username && !creds?.proxmoxApiTokenId)) {
        await doMikrotikBackup(device, credentials);
        results.deviceData.backupStatus = "success";
      }

      // 2. SNMP Logic
      if (creds?.snmpCommunity || creds?.snmpUsername) {
        const community = creds.snmpCommunity || 'public';
        const version = creds.snmpVersion === '1' ? snmp.Version1 : snmp.Version2c;
        
        const neighbors = await walkLldpNeighbors(device.ipAddress, community, version);
        await syncNeighborsToDb(device.id, neighbors);
        results.deviceData.neighborCount = neighbors.length;

        const arp = await walkArpTable(device.ipAddress, community, version);
        await auditIpUsage(arp);
        results.deviceData.arpEntryCount = arp.length;

        await checkAndGenerateReport(device);
      }
    } catch (e) {
      results.status = "down";
      results.error = e.message;
      results.deviceData.intelligenceError = e.message;
    }

    results.deviceData.lastIntelligenceRun = new Date().toISOString();
    return results;
  }
};

export default plugin;
