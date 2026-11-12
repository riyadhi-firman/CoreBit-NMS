import Netflow from 'node-netflowv9';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Simple collector on port 2055
const collector = new Netflow(function (flow) {
    const deviceIp = flow.device_ip || 'unknown';
    
    // Aggregation logic
    if (flow.flows && Array.isArray(flow.flows)) {
        flow.flows.forEach(async (f) => {
            try {
                // We only store significant flows to avoid DB bloat
                if (f.in_bytes > 1000) {
                    await pool.query(
                        "INSERT INTO flow_summaries (device_ip, src_ip, dst_ip, protocol, bytes, packets) VALUES ($1, $2, $3, $4, $5, $6)",
                        [deviceIp, f.ipv4_src_addr, f.ipv4_dst_addr, f.protocol.toString(), f.in_bytes, f.in_pkts]
                    );
                }
            } catch (e) {
                // Silently fail or log occasionally
            }
        });
    }
}).listen(2055);

console.log("[Flow Collector] Listening on UDP 2055...");

// Cleanup on exit
process.on('SIGTERM', () => {
    collector.close();
    pool.end();
    process.exit(0);
});
