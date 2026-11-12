import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, serial, bigint, timestamp, jsonb, boolean, index, uniqueIndex, doublePrecision, type AnyPgColumn } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Prometheus metric configuration type - used in credential profiles (defaults) and devices (overrides)
export type PrometheusMetricConfig = {
  id: string; // Unique identifier for this metric config
  metricName: string; // Prometheus metric name (e.g., 'node_filesystem_avail_bytes')
  label: string; // Display label (e.g., 'Disk Available')
  displayType: 'bar' | 'gauge' | 'number' | 'text' | 'bytes' | 'percentage' | 'boolean' | 'rate'; // How to visualize ('rate' for counter metrics - shows change/second)
  unit?: string; // Optional unit suffix (e.g., 'GB', '%', 'ms')
  labelFilter?: Record<string, string>; // Optional label filter (e.g., {device: '/dev/sda1'})
  labelSelector?: string; // Full label selector string (e.g., '{chip="platform_coretemp_0",sensor="temp1"}')
  transform?: 'toGB' | 'toMB' | 'toPercent' | 'divide1000' | 'none'; // Value transformation
  maxValue?: number; // For bar/gauge - the max value for percentage calculation
  warningThreshold?: number; // Optional warning threshold
  criticalThreshold?: number; // Optional critical threshold
};

// Status value mapping for SNMP status metrics
export type SNMPStatusConfig = {
  okValues?: string; // Comma-separated values for OK status (e.g., "0" or "0,1")
  warningValues?: string; // Comma-separated values for Warning status (e.g., "1,2")
  errorValues?: string; // Comma-separated values for Error status (e.g., "3,4,5") - blank means any other value
};

// SNMP metric configuration type - used for custom SNMP OID monitoring
export type SNMPMetricConfig = {
  id: string; // Unique identifier for this metric config (hash of OID)
  oid: string; // SNMP OID to query (e.g., '1.3.6.1.2.1.1.3.0' for sysUpTime)
  label: string; // Display label (e.g., 'System Uptime')
  displayType: 'number' | 'bytes' | 'percentage' | 'bar' | 'text' | 'boolean' | 'rate' | 'status'; // How to visualize
  unit?: string; // Optional unit suffix (e.g., 'ms', 'packets')
  valueType?: 'counter' | 'gauge' | 'integer' | 'string'; // SNMP value type hint
  transform?: 'divide100' | 'divide1000' | 'toSeconds' | 'none'; // Value transformation (e.g., timeticks to seconds)
  warningThreshold?: number; // Optional warning threshold
  criticalThreshold?: number; // Optional critical threshold
  displayHint?: string; // MIB DISPLAY-HINT for value formatting (e.g., 'd-1' for 1 decimal place)
  mibName?: string; // OID name from MIB (e.g., 'sysUpTime')
  mibDescription?: string; // Description from MIB
  statusConfig?: SNMPStatusConfig; // Configuration for status display type
};

// Common Prometheus metrics available for selection
export const PROMETHEUS_METRIC_PRESETS: PrometheusMetricConfig[] = [
  // Load averages (gauge metrics - show current value)
  { id: 'load1', metricName: 'node_load1', label: 'Load (1m)', displayType: 'number' },
  { id: 'load5', metricName: 'node_load5', label: 'Load (5m)', displayType: 'number' },
  { id: 'load15', metricName: 'node_load15', label: 'Load (15m)', displayType: 'number' },
  // Filesystem - available space on root
  { id: 'fs_root_avail', metricName: 'node_filesystem_avail_bytes', label: 'Root FS Free', displayType: 'bytes', labelFilter: { mountpoint: '/' }, transform: 'toGB' },
  // Swap - available swap space  
  { id: 'swap_free', metricName: 'node_memory_SwapFree_bytes', label: 'Swap Free', displayType: 'bytes', transform: 'toGB' },
  // File descriptors (gauge - currently allocated)
  { id: 'open_fds', metricName: 'node_filefd_allocated', label: 'Open File Descriptors', displayType: 'number' },
  // Entropy (gauge - current available)
  { id: 'entropy', metricName: 'node_entropy_available_bits', label: 'Entropy Available', displayType: 'number' },
  // TCP connections (gauge - current established)
  { id: 'tcp_conns', metricName: 'node_netstat_Tcp_CurrEstab', label: 'TCP Connections', displayType: 'number' },
  // Process counts (gauge - current running/blocked)
  { id: 'procs_running', metricName: 'node_procs_running', label: 'Running Processes', displayType: 'number' },
  { id: 'procs_blocked', metricName: 'node_procs_blocked', label: 'Blocked Processes', displayType: 'number' },
  // Memory pressure indicator  
  { id: 'mem_available', metricName: 'node_memory_MemAvailable_bytes', label: 'Memory Available', displayType: 'bytes', transform: 'toGB' },
];

export const userSessions = pgTable("user_sessions", {
  sid: varchar("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { precision: 6, withTimezone: true }).notNull(),
}, (table) => [
  index("IDX_session_expire").on(table.expire),
]);

// Map layout kinds - determines how the map is rendered
export const mapLayoutKinds = ['canvas', 'geo'] as const;
export type MapLayoutKind = typeof mapLayoutKinds[number];

// Map style options for geo maps
export const mapStyleOptions = ['auto', 'light', 'dark', 'satellite'] as const;
export type MapStyleOption = typeof mapStyleOptions[number];

// Geo marker style options - simple (colored pins), detailed (card with info), or hybrid (auto-switch based on zoom)
export const geoMarkerStyleOptions = ['simple', 'detailed', 'hybrid'] as const;
export type GeoMarkerStyleOption = typeof geoMarkerStyleOptions[number];

// Hybrid marker zoom thresholds (when to switch between simple and detailed)
export type GeoMarkerThresholds = {
  detailedZoom: number; // Switch to detailed at this zoom level or higher (default: 14)
  simpleZoom: number; // Switch back to simple at this zoom level or lower (default: 12)
};

export const maps = pgTable("maps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").default(false).notNull(),
  backgroundColor: text("background_color"),
  gridVisible: boolean("grid_visible").default(true).notNull(),
  isLocked: boolean("is_locked").default(false).notNull(),
  layoutKind: text("layout_kind").default("canvas").$type<MapLayoutKind>(), // 'canvas' for traditional drag/drop, 'geo' for OSM map
  mapStyle: text("map_style").default("auto").$type<MapStyleOption>(), // For geo maps: 'auto' follows theme, or override to 'light'/'dark'/'satellite'
  geoMarkerStyle: text("geo_marker_style").default("detailed").$type<GeoMarkerStyleOption>(), // For geo maps: 'simple', 'detailed', or 'hybrid' (auto-switch based on zoom)
  geoMarkerThresholds: jsonb("geo_marker_thresholds").$type<GeoMarkerThresholds>(), // For hybrid mode: zoom thresholds for switching styles
  defaultCenter: jsonb("default_center").$type<{ lat: number; lng: number }>(), // Default map center for geo maps
  defaultZoom: integer("default_zoom"), // Default zoom level for geo maps (1-20)
  publicShareEnabled: boolean("public_share_enabled").default(false).notNull(), // Allow public access via share token
  publicShareToken: text("public_share_token"), // Unique token for public access URL
  autoCreateConnections: boolean("auto_create_connections").default(false).notNull(), // Auto-create connections when devices are added based on MAC table matching
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const credentialProfiles = pgTable("credential_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull(), // mikrotik, snmp, prometheus, proxmox, ilo, vmware
  credentials: jsonb("credentials").notNull().$type<{
    username?: string;
    password?: string;
    apiPort?: number;
    snmpVersion?: '1' | '2c' | '3';
    snmpCommunity?: string;
    snmpUsername?: string;
    snmpAuthProtocol?: 'MD5' | 'SHA';
    snmpAuthKey?: string;
    snmpPrivProtocol?: 'DES' | 'AES';
    snmpPrivKey?: string;
    // Prometheus node_exporter settings
    usePrometheus?: boolean; // Explicitly enable Prometheus probing for this profile
    prometheusPort?: number; // Default 9100
    prometheusPath?: string; // Default /metrics
    prometheusScheme?: 'http' | 'https';
    prometheusMetrics?: PrometheusMetricConfig[]; // Extra metrics to collect (profile defaults)
    // Proxmox VE API settings
    proxmoxPort?: number; // Default 8006
    proxmoxApiTokenId?: string; // API token ID (user@realm!tokenid)
    proxmoxApiTokenSecret?: string; // API token secret
    proxmoxVerifySsl?: boolean; // Default false (self-signed certs common)
    proxmoxRealm?: string; // Default 'pam'
    // Proxmox node_exporter settings (secondary method for OS metrics & MAC addresses)
    proxmoxUseNodeExporter?: boolean; // Enable node_exporter probing
    proxmoxNodeExporterPort?: number; // Default 9100
    proxmoxNodeExporterPath?: string; // Default /metrics
    proxmoxNodeExporterScheme?: 'http' | 'https'; // Default http
    // SNMP custom metrics
    snmpMetrics?: SNMPMetricConfig[]; // Custom SNMP OIDs to monitor (profile defaults)
    // MIB files for SNMP OID name resolution
    mibFiles?: string[]; // Array of MIB filenames to use for OID resolution (legacy - prefer mibVendor)
    mibVendor?: string; // Vendor identifier for automatic MIB loading (e.g., 'mikrotik', 'brocade', 'cisco')
    // HP iLO Redfish API settings
    iloPort?: number; // Default 443
    iloVerifySsl?: boolean; // Default false (self-signed certs common)
    iloKeepSession?: boolean; // Keep Redfish session open to avoid login events in iLO event log
    iloDataInterval?: number; // Only extract data every N polls (e.g. 2 = every other poll)
    // VMware vSphere settings
    vmwareHost?: string; // vCenter/ESXi hostname or IP (overrides device IP when set)
    vmwareUsername?: string; // vSphere username (e.g. administrator@vsphere.local)
    vmwarePassword?: string; // vSphere password
    vmwarePort?: number; // Default 443
    vmwareVerifySsl?: boolean; // Default false (self-signed certs common)
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Data Sources — Prometheus (and future) endpoints used by Gauge/SingleStat/Chart elements
export type DataSourceConfig = {
  authType?: 'none' | 'basic' | 'bearer'; // default 'none'
  username?: string;
  password?: string;
  bearerToken?: string;
  skipTlsVerify?: boolean;
  timeoutSeconds?: number;
};

export const dataSources = pgTable('data_sources', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).notNull().default('prometheus'), // extensible: 'prometheus' | future types
  url: varchar('url', { length: 1000 }).notNull(),
  config: jsonb('config').default('{}').$type<DataSourceConfig>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const insertDataSourceSchema = createInsertSchema(dataSources).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type DataSource = typeof dataSources.$inferSelect;
export type InsertDataSource = z.infer<typeof insertDataSourceSchema>;

export const settings = pgTable("settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull().default("webhook").$type<'webhook' | 'telegram' | 'slack' | 'pushover' | 'email'>(),
  // Legacy webhook fields (kept for backward compatibility)
  url: text("url"),
  method: text("method").default("POST"),
  // Type-specific config stored as JSON
  config: jsonb("config").$type<{
    // Webhook config
    url?: string;
    method?: string;
    // Telegram config
    botToken?: string;
    chatId?: string;
    // Slack config
    webhookUrl?: string;
    channel?: string; // Optional channel override
    username?: string; // Optional username override
    iconEmoji?: string; // Optional icon emoji
    // Pushover config
    pushoverUserKey?: string;
    pushoverAppToken?: string;
    pushoverDevice?: string;
    pushoverSound?: string;
    pushoverPriority?: number;
    // Email config
    emailAddress?: string;
    emailSubject?: string;
  }>(),
  messageTemplate: text("message_template").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  ignoreStaleToOnline: boolean("ignore_stale_to_online").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const deviceNotifications = pgTable("device_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  notificationId: varchar("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const notificationHistory = pgTable("notification_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  notificationId: varchar("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
  oldStatus: text("old_status"),
  newStatus: text("new_status").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
});

export const logs = pgTable("logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  deviceId: varchar("device_id").references(() => devices.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  severity: text("severity").notNull().default("info"),
  message: text("message").notNull(),
  oldStatus: text("old_status"),
  newStatus: text("new_status"),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
});

// ─── TIA-606-B Infrastructure Registry ────────────────────────────────────────
// Sites, Locations (rooms/spaces), and Racks as managed lists for standardized labeling.
// Use is optional - devices/connections work without these.
export const tiaSites = pgTable("tia_sites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: varchar("code", { length: 20 }).notNull(),          // e.g. "AA", "NYC1"
  name: text("name").notNull(),
  address: text("address"),
  city: text("city"),
  country: text("country"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tiaLocations = pgTable("tia_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siteId: varchar("site_id").references(() => tiaSites.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 20 }).notNull(),          // e.g. "MDF", "IDF1"
  name: text("name").notNull(),
  building: text("building"),
  floor: text("floor"),
  room: text("room"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tiaRacks = pgTable("tia_racks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  locationId: varchar("location_id").references(() => tiaLocations.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 20 }).notNull(),          // e.g. "01", "02"
  name: text("name").notNull(),
  totalUnits: integer("total_units").default(42),
  rackType: text("rack_type").$type<'open-frame' | 'enclosed' | 'wall-mount' | 'other'>().default("enclosed"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Rack Placements — places a TIA rack on a map as a live elevation node
export type RackPlacementSettings = {
  view: 'front' | 'rear' | 'both';
  size: 'compact' | 'full';
};

export const rackPlacements = pgTable("rack_placements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mapId: varchar("map_id").notNull().references(() => maps.id, { onDelete: "cascade" }),
  rackId: varchar("rack_id").notNull().references(() => tiaRacks.id, { onDelete: "cascade" }),
  position: jsonb("position").notNull().$type<{ x: number; y: number }>(),
  settings: jsonb("settings").notNull().$type<RackPlacementSettings>().default({ view: 'front', size: 'compact' } as RackPlacementSettings),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertRackPlacementSchema = createInsertSchema(rackPlacements).omit({ id: true, createdAt: true });
export type RackPlacement = typeof rackPlacements.$inferSelect;
export type InsertRackPlacement = z.infer<typeof insertRackPlacementSchema>;

// Rack Installation Images — cabinet photos; one can be marked as primary for the canvas thumbnail
export const rackInstallationImages = pgTable("rack_installation_images", {
  id: serial("id").primaryKey(),
  rackId: varchar("rack_id").notNull().references(() => tiaRacks.id, { onDelete: "cascade" }),
  imageData: text("image_data").notNull(),
  isPrimary: boolean("is_primary").default(false),
  caption: varchar("caption", { length: 200 }),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const insertRackInstallationImageSchema = createInsertSchema(rackInstallationImages).omit({ id: true, createdAt: true });
export type RackInstallationImage = typeof rackInstallationImages.$inferSelect;
export type InsertRackInstallationImage = z.infer<typeof insertRackInstallationImageSchema>;

export const rackPassiveItems = pgTable("rack_passive_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rackId: varchar("rack_id").notNull().references(() => tiaRacks.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  type: varchar("type", { length: 50 }).notNull().default("other"),
  rackUnit: integer("rack_unit").notNull(),
  rackHeight: integer("rack_height").notNull().default(1),
  rackSide: varchar("rack_side", { length: 10 }).notNull().default("front"),
  notes: text("notes"),
});
export const insertRackPassiveItemSchema = createInsertSchema(rackPassiveItems).omit({ id: true });
export type RackPassiveItem = typeof rackPassiveItems.$inferSelect;
export type InsertRackPassiveItem = z.infer<typeof insertRackPassiveItemSchema>;

// ───────────────────────────────────────────────────────────────────────────────

export const devices = pgTable("devices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull(),
  ipAddress: text("ip_address"),
  status: text("status").notNull().default("unknown"),
  lastSeen: timestamp("last_seen", { withTimezone: true }), // Timestamp of last successful probe response
  probeTimeout: integer("probe_timeout"), // Custom probe timeout in seconds (null = use default 6s)
  offlineThreshold: integer("offline_threshold"), // Number of consecutive failed probe cycles before marking offline (null = immediate)
  probeDisabled: boolean("probe_disabled").default(false), // When true, skip all probing for this device
  probeIpv6Disabled: boolean("probe_ipv6_disabled").default(false), // When true, skip /ipv6/address/print during probing
  probeVlanDisabled: boolean("probe_vlan_disabled").default(false), // When true, skip bridge VLAN extraction during probing
  failureCount: integer("failure_count").default(0), // Current consecutive failure count
  deviceData: jsonb("device_data").$type<{
    pollDurationMs?: number;
    uptime?: string;
    model?: string;
    version?: string;
    build?: string; // Firmware/build string (e.g. VMware ESXi build number)
    vendor?: string; // Hardware vendor name
    systemIdentity?: string;
    ports?: Array<{ 
      name: string; 
      defaultName?: string;
      status: string; 
      adminStatus?: 'up' | 'down' | 'unknown'; // Administrative state (node_network_up / ifAdminStatus)
      linkState?: 'up' | 'down' | 'unknown'; // Physical link/carrier state (node_network_carrier / ifOperStatus for physical)
      speed?: string; 
      description?: string;
      snmpIndex?: number; // SNMP ifIndex for this interface - allows direct OID construction for traffic monitoring
    }>;
    cpuUsagePct?: number;
    memoryUsagePct?: number;
    diskUsagePct?: number;
    uptimeSeconds?: number; // Raw uptime in seconds (used by plugin hosts when string uptime is unavailable)
    pingRtt?: number; // Last ICMP ping round-trip time in ms
    customMetrics?: Record<string, number | string>; // Collected custom Prometheus metrics (id -> value)
    availableMetrics?: string[]; // List of available Prometheus metric names discovered from device
    cpuInfo?: string; // Static CPU info (model, cores, speed) for hardware servers
    memoryTotalGB?: number; // Total installed memory in GB for hardware servers
    serialNumber?: string; // Hardware serial number
    webHttps?: boolean; // Whether web management UI uses HTTPS (default: false → http)
    webPort?: number; // Web management UI port override (default: 80 for http, 443 for https)
    // Plugin host fields
    pluginType?: string; // Plugin type identifier (e.g. 'vmware', 'proxmox')
    pluginItemCount?: number; // Count of persisted plugin items (set after upsert/prune)
    lastPluginPollAt?: string; // ISO timestamp of last plugin poll
  }>(),
  credentialProfileId: varchar("credential_profile_id").references(() => credentialProfiles.id, { onDelete: "set null" }),
  linkedMapId: varchar("linked_map_id").references(() => maps.id, { onDelete: "set null" }), // Link to navigate to another map
  customCredentials: jsonb("custom_credentials").$type<{
    username?: string;
    password?: string;
    apiPort?: number;
    snmpVersion?: '1' | '2c' | '3';
    snmpCommunity?: string;
    snmpUsername?: string;
    snmpAuthProtocol?: 'MD5' | 'SHA';
    snmpAuthKey?: string;
    snmpPrivProtocol?: 'DES' | 'AES';
    snmpPrivKey?: string;
    // Prometheus node_exporter settings
    usePrometheus?: boolean;
    prometheusPort?: number;
    prometheusPath?: string;
    prometheusScheme?: 'http' | 'https';
    prometheusMetrics?: PrometheusMetricConfig[]; // Extra metrics to collect (device-specific overrides)
    // Proxmox VE API settings
    proxmoxPort?: number;
    proxmoxApiTokenId?: string;
    proxmoxApiTokenSecret?: string;
    proxmoxVerifySsl?: boolean;
    proxmoxRealm?: string;
    // Proxmox node_exporter settings (secondary method for OS metrics & MAC addresses)
    proxmoxUseNodeExporter?: boolean;
    proxmoxNodeExporterPort?: number;
    proxmoxNodeExporterPath?: string;
    proxmoxNodeExporterScheme?: 'http' | 'https';
    // SNMP custom metrics
    snmpMetrics?: SNMPMetricConfig[]; // Custom SNMP OIDs to monitor (device-specific overrides)
    // MIB files for SNMP OID name resolution
    mibFiles?: string[]; // Array of MIB filenames to use for OID resolution (legacy - prefer mibVendor)
    mibVendor?: string; // Vendor identifier for automatic MIB loading (e.g., 'mikrotik', 'brocade', 'cisco')
    // HP iLO Redfish API settings
    iloPort?: number;
    iloVerifySsl?: boolean;
    iloKeepSession?: boolean;
    iloDataInterval?: number;
    // VMware vSphere settings
    vmwareHost?: string;
    vmwareUsername?: string;
    vmwarePassword?: string;
    vmwarePort?: number;
    vmwareVerifySsl?: boolean;
  }>(),
  useOnDuty: boolean("use_on_duty").default(false).notNull(), // Also send alerts to on-duty operators (in addition to global channels)
  mutedUntil: timestamp("muted_until", { withTimezone: true }), // Device notifications muted until this time (null = not muted)
  submapShape: text("submap_shape").$type<'circle' | 'square' | 'hexagon' | 'diamond' | 'pentagon' | 'octagon'>(), // Shape for submap_link device type
  submapSize: text("submap_size").$type<'sm' | 'md' | 'lg' | 'xl'>(), // Size for submap_link device type
  submapBgColor: text("submap_bg_color"), // Custom background color for submap_link device type
  placeholderKind: text("placeholder_kind").$type<'internet' | 'cloud' | 'external' | 'datacenter' | 'building' | 'site' | 'custom'>(), // Visual icon/type for placeholder devices
  placeholderContent: text("placeholder_content"), // Template text with [[variables]] for "At a glance" display on placeholder devices
  placeholderDateFormat: text("placeholder_date_format"), // Custom date format for [[system.datetime]] in placeholderContent
  placeholderDateTimezone: text("placeholder_date_timezone"), // IANA timezone for [[system.datetime]] in placeholderContent
  atAGlanceContent: text("at_a_glance_content"), // Template text with [[variables]] for "At a glance" display on regular devices (replaces subtitle when set)
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }), // Timestamp when status last changed (for offline duration display)
  staleNotifiedAt: timestamp("stale_notified_at", { withTimezone: true }), // When stuck-stale notification was last sent. Considered "current episode" only if >= statusChangedAt
  metricsRetentionHours: integer("metrics_retention_hours"), // Override global retention for this device (null = use global default)
  lastProbeError: text("last_probe_error"), // Last error message from failed probe (for diagnostics)
  pollingInterfaceId: varchar("polling_interface_id"), // FK to deviceInterfaces - which interface to use for polling (added later via ALTER)
  pollingAddressId: varchar("polling_address_id"), // FK to ipamAddresses - which IP address to use for polling (added later via ALTER)
  parentDeviceId: varchar("parent_device_id"), // Self-reference for device stacking - child devices link to parent
  macTableRefreshInterval: integer("mac_table_refresh_interval"), // Minutes between MAC table refreshes (null = disabled)
  macTableLastRefresh: timestamp("mac_table_last_refresh", { withTimezone: true }), // When MAC table was last refreshed
  manufacturer: text("manufacturer"), // Device manufacturer (e.g., 'Mikrotik', 'Cisco', 'HP')
  deviceModel: text("device_model"), // Device model name (e.g., 'CRS326-24G-2S+', 'Catalyst 9300')
  serialNumber: text("serial_number"), // Hardware serial number (top-level for easy querying)
  assetTag: text("asset_tag"), // Asset management tag
  site: text("site"), // Physical site/location name (e.g., 'DC1', 'Office NYC')
  location: text("location"), // Specific location within site (e.g., 'Room 3, Floor 2')
  latitude: doublePrecision("latitude"), // GPS latitude for inventory/auto-placement on geo maps
  longitude: doublePrecision("longitude"), // GPS longitude for inventory/auto-placement on geo maps
  rackName: text("rack_name"), // Rack identifier (e.g., 'Rack A1', 'Cabinet-12')
  rackUnit: integer("rack_unit"), // Rack unit position (1-48, bottom-up typically)
  rackSide: text("rack_side").$type<'front' | 'rear'>(), // Which side of the rack
  rackHeight: integer("rack_height"), // Height in rack units (U)
  rackDepth: text("rack_depth").$type<'full' | 'half'>(), // Depth: full or half
  imageUrl: text("image_url"), // Custom device image URL (overrides hardware library)
  imageData: text("image_data"), // Compressed image stored as data URI (data:image/webp;base64,...)
  hardwareLibraryId: varchar("hardware_library_id"), // FK to hardware_library for auto-resolved image/metadata
  deviceNotes: text("device_notes"), // Free-form notes about this device
  // TIA-606-B infrastructure references (optional - for managed site/location/rack lists)
  siteId: varchar("site_id").references(() => tiaSites.id, { onDelete: "set null" }),
  locationId: varchar("location_id").references(() => tiaLocations.id, { onDelete: "set null" }),
  rackId: varchar("rack_id").references(() => tiaRacks.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Device Installation Images — real photos of device installation (separate from hardware library icon)
export const deviceInstallationImages = pgTable("device_installation_images", {
  id: serial("id").primaryKey(),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  imageData: text("image_data").notNull(),
  caption: varchar("caption", { length: 200 }),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const insertDeviceInstallationImageSchema = createInsertSchema(deviceInstallationImages).omit({ id: true, createdAt: true });
export type DeviceInstallationImage = typeof deviceInstallationImages.$inferSelect;
export type InsertDeviceInstallationImage = z.infer<typeof insertDeviceInstallationImageSchema>;

// Device Management Connections — per-device configurable connection entries (SSH, Winbox, Web, RDP)
export const deviceManagementConnections = pgTable("device_management_connections", {
  id: serial("id").primaryKey(),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 100 }).notNull(),
  type: text("type").notNull(), // 'ssh' | 'winbox' | 'winbox_legacy' | 'web' | 'rdp'
  addressOverride: varchar("address_override", { length: 255 }),
  port: integer("port"),
  username: varchar("username", { length: 100 }),
  webHttps: boolean("web_https").default(false),
  useTunnel: boolean("use_tunnel").default(false),
  routeMode: text("route_mode").notNull().default("direct"), // 'direct' | 'tunnel' | 'both'
  sortOrder: integer("sort_order").default(0),
});
export const insertDeviceManagementConnectionSchema = createInsertSchema(deviceManagementConnections).omit({ id: true });
export type DeviceManagementConnection = typeof deviceManagementConnections.$inferSelect;
export type InsertDeviceManagementConnection = z.infer<typeof insertDeviceManagementConnectionSchema>;

// Hardware Library - stores device model images and metadata for auto-resolution
export const hardwareLibrary = pgTable("hardware_library", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  manufacturer: text("manufacturer").notNull(),
  model: text("model").notNull(),
  hardwareVersion: text("hardware_version"), // Optional hardware revision
  deviceType: text("device_type"), // Category: router, switch, server, access_point, firewall, etc.
  imageUrl: text("image_url"), // URL or path to device image
  imageData: text("image_data"), // Compressed image stored as data URI (data:image/webp;base64,...)
  rackMountable: boolean("rack_mountable").default(true).notNull(), // Whether device is rack mountable
  defaultRackHeight: integer("default_rack_height"), // Default height in rack units (only if rack mountable)
  defaultRackDepth: text("default_rack_depth"), // full, half (only if rack mountable)
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_hardware_library_manufacturer_model").on(table.manufacturer, table.model),
]);

export const insertHardwareLibrarySchema = createInsertSchema(hardwareLibrary).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type HardwareLibraryEntry = typeof hardwareLibrary.$inferSelect;
export type InsertHardwareLibraryEntry = z.infer<typeof insertHardwareLibrarySchema>;

export const devicePlacements = pgTable("device_placements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  mapId: varchar("map_id").notNull().references(() => maps.id, { onDelete: "cascade" }),
  position: jsonb("position").notNull().$type<{ x: number; y: number }>(),
  // Geographic coordinates for geo maps (OSM)
  latitude: doublePrecision("latitude"), // null for canvas maps
  longitude: doublePrecision("longitude"), // null for canvas maps
  linkedMapId: varchar("linked_map_id").references(() => maps.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_device_placements_geo").on(table.mapId, table.latitude, table.longitude),
]);

// Map draw elements - custom text and box annotations on maps
export type TextElementProps = {
  content: string;
  fontSize: number; // e.g., 12, 14, 16, 24
  fontWeight?: 'normal' | 'bold';
  textColor?: string; // Hex color e.g., '#000000'. If not set, uses theme foreground color
  backgroundColor?: string; // Optional hex color with alpha e.g., 'rgba(255,255,255,0.8)'
  textAlign?: 'left' | 'center' | 'right';
  padding?: number; // Padding around text in pixels
  borderRadius?: number; // Border radius for background
  borderColor?: string; // Border color
  borderWidth?: number; // Border width in pixels
  maxWidth?: number; // Maximum width before text wraps
  elevation?: boolean; // Enable elevated shadow effect
  // Per-element datetime formatting for [[system.datetime]] variable
  dateFormat?: string; // Custom date format pattern e.g., 'dd/MM/yyyy HH:mm'
  dateTimezone?: string; // IANA timezone e.g., 'Europe/London' for world clock functionality
};

export type BoxElementProps = {
  width: number;
  height: number;
  backgroundColor: string; // Hex color or rgba e.g., 'rgba(0,0,255,0.2)'
  borderColor?: string; // Hex color
  borderWidth?: number; // Border thickness in pixels
  borderRadius?: number; // Corner radius
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  elevation?: boolean; // Enable elevated shadow effect
  // For geo maps: store geographic bounds (overrides width/height for rendering)
  geoBounds?: {
    north: number; // latitude (top)
    south: number; // latitude (bottom)
    east: number;  // longitude (right)
    west: number;  // longitude (left)
  };
};

export type GaugeThreshold = {
  value: number; // Threshold boundary value
  color: string; // Color for the zone starting at this threshold
  // Severity for notifications (independent of color). When set, crossing into
  // this zone fires a widget alert event at this severity level.
  // null/undefined = visual only (no notification).
  severity?: 'warning' | 'critical' | null;
};

// Per-widget notification routing config (Task #27)
export type WidgetNotificationConfig = {
  enabled?: boolean;
  targetIds?: string[];   // notification.id list
  groupIds?: string[];    // deviceGroup.id list (channels + on-duty users)
  messageTemplate?: string; // optional template override
};

export type GaugeElementProps = {
  variable: string; // Variable template e.g., '[[device.cpu]]'
  title?: string; // Label shown above the gauge
  min: number; // Minimum value (left end of arc)
  max: number; // Maximum value (right end of arc)
  thresholds: GaugeThreshold[]; // Up to 3 color zone boundaries (sorted ascending by value)
  color1: string; // Color for zone below first threshold (e.g. green)
  // Severity for the "below first threshold" base zone. When set, the base
  // zone fires Warning/Critical notifications too — needed for datasets where
  // a low value is the bad case (e.g. inverse health metrics).
  baseSeverity?: 'warning' | 'critical' | null;
  width: number; // Width of the gauge widget in pixels
  backgroundColor?: string; // Background fill (hex or rgba)
  borderColor?: string; // Border color
  borderWidth?: number; // Border thickness in pixels
  borderRadius?: number; // Corner radius
  elevation?: boolean; // Enable drop shadow
  padding?: number; // Inner spacing between border and gauge content (px)
  titleFontSize?: number; // Override for title font size in px
  // Guided data source (alternative to variable template string)
  sourceMode?: 'variable' | 'device' | 'bandwidth' | 'prometheus'; // default 'variable'
  deviceId?: string;           // Device to pull from in 'device' mode
  deviceMetric?: string;       // 'cpu'|'memory'|'disk'|'ping.latency'|'ping.loss'|'metric.XXX'
  connectionId?: string;       // Connection for bandwidth mode
  bandwidthDirection?: 'in' | 'out'; // Which direction in bandwidth mode
  // Prometheus data source
  prometheusSourceId?: number; // dataSources.id
  prometheusQuery?: string;    // PromQL expression
  decimals?: number;           // Number of decimal places to show (default 1)
  // Task #27: notification routing
  notifications?: WidgetNotificationConfig;
};

export type ChartSourceType = 'device-vitals' | 'bandwidth' | 'ping-monitoring' | 'custom-metric' | 'prometheus';
export type ChartVitalMetric = 'cpu' | 'memory' | 'disk' | 'ping';

export type ChartSeriesStyle = {
  color?: string;      // Override the primary series line color (hex)
  lineWidth?: number;  // Stroke width in px, 1–8 (default 1.5)
  filled?: boolean;    // true = gradient area fill (default), false = line only
};

export type ChartElementProps = {
  sourceType: ChartSourceType;
  // For device-vitals:
  deviceId?: string;
  metricKey?: ChartVitalMetric;
  // For bandwidth:
  connectionId?: string;
  // For ping-monitoring:
  pingTargetId?: string;  // Specific ping target ID (uses first target if unset)
  pingMetric?: 'latency' | 'loss' | 'both';  // Which metric to graph (default: latency)
  // For custom-metric:
  customMetricId?: string; // Prometheus/SNMP metric ID
  // For prometheus:
  prometheusSourceId?: number; // dataSources.id
  prometheusQuery?: string;    // PromQL expression
  // Shared:
  title?: string;
  titleFontSize?: number; // Title font size in px (default 11)
  timeRange: string; // '15m', '1h', '6h', '12h', '24h', etc.
  width: number;
  height: number;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  padding?: number;
  elevation?: boolean; // Drop shadow
  // Series styling
  seriesStyle?: ChartSeriesStyle;
  showLegend?: boolean; // Show series name legend below chart
  legendTemplate?: string; // e.g. "{{job}} - {{instance}}" — Prometheus label substitution for legend name
};

export type SingleStatThreshold = {
  value: number;    // Zone starts at this value (ascending)
  color: string;    // Background color for this zone
  label?: string;   // Optional text override (e.g., "Warning")
  icon?: string;    // Optional icon name (e.g., 'alert-triangle', 'check-circle')
  enabled?: boolean; // When false this threshold is ignored (defaults to true)
  // Task #27: severity for notification (independent of color/label).
  // null/undefined = visual only.
  severity?: 'warning' | 'critical' | null;
};

export type SingleStatElementProps = {
  title?: string;
  width: number;
  height: number;
  // Base zone (when value is below the first threshold)
  baseColor: string;
  baseLabel?: string;
  baseIcon?: string;
  // Severity for the Base zone — independent of color/label/icon. When set,
  // the Base zone fires Warning/Critical notifications too. Required for
  // "low value = bad" datasets (e.g. 0=Critical, 1=Warning, 2=OK) where the
  // critical case naturally falls below all thresholds.
  baseSeverity?: 'warning' | 'critical' | null;
  // Threshold zones (sorted ascending by value)
  thresholds: SingleStatThreshold[];
  // Display
  unit?: string;          // Unit suffix appended to raw value (e.g., "Mbps")
  valueFontSize?: number;
  titleFontSize?: number;
  rawValueFontSize?: number; // Font size for the raw value sub-label
  statIconSize?: number;  // Explicit icon size (px); auto-computed from labelFontSize when absent
  showRawValue?: boolean; // Show raw numeric value below zone label
  // Data source (same as gauge)
  variable?: string;
  sourceMode?: 'variable' | 'device' | 'bandwidth' | 'prometheus';
  deviceId?: string;
  deviceMetric?: string;
  connectionId?: string;
  bandwidthDirection?: 'in' | 'out';
  // Prometheus data source
  prometheusSourceId?: number;
  prometheusQuery?: string;
  // MultiStat mode (Prometheus only) — renders one panel per selected series
  multiStatMode?: boolean;
  multiStatSelectedSeries?: Array<Record<string, string>>; // Each entry is the full label set of a selected series
  multiStatTitleTemplate?: string;  // e.g. "{{process}}" — uses label values as variables
  multiStatGap?: number;            // Pixel gap between stacked panels (default 4)
  multiStatGroupTitle?: string;     // Title shown above the whole stacked group (e.g. "MongoDB")
  multiStatGroupTitleFontSize?: number; // Font size for the group title (default 13)
  // Compact layout — single horizontal row: [icon] [title] [spacer] [label] [value]
  compactMode?: boolean;
  // Appearance
  borderRadius?: number;
  elevation?: boolean;
  padding?: number;
  // Task #27: notification routing
  notifications?: WidgetNotificationConfig;
};

export const mapDrawElements = pgTable("map_draw_elements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mapId: varchar("map_id").notNull().references(() => maps.id, { onDelete: "cascade" }),
  type: text("type").notNull().$type<'text' | 'box' | 'gauge' | 'chart' | 'singlestat'>(),
  x: doublePrecision("x").notNull(),
  y: doublePrecision("y").notNull(),
  zIndex: integer("z_index").default(0).notNull(), // For layering: negative = behind, positive = in front
  positionLocked: boolean("position_locked").default(false).notNull(), // When true, element cannot be dragged and allows map panning through it
  props: jsonb("props").notNull().$type<TextElementProps | BoxElementProps | GaugeElementProps | ChartElementProps | SingleStatElementProps>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_map_draw_elements_map").on(table.mapId),
  index("idx_map_draw_elements_map_type").on(table.mapId, table.type),
]);

export const insertMapDrawElementSchema = createInsertSchema(mapDrawElements).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type MapDrawElement = typeof mapDrawElements.$inferSelect;
export type InsertMapDrawElement = z.infer<typeof insertMapDrawElementSchema>;

// Task #27: Widget threshold alert state — persists severity per (element, series)
// so dedup/transitions survive restarts. seriesKey is '' for single-series widgets,
// or a labelFingerprint string for multi-stat series.
export const widgetAlertStates = pgTable("widget_alert_states", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  elementId: varchar("element_id").notNull().references(() => mapDrawElements.id, { onDelete: "cascade" }),
  seriesKey: text("series_key").notNull().default(''),
  severity: text("severity").$type<'ok' | 'warning' | 'critical'>().notNull().default('ok'),
  pendingSeverity: text("pending_severity").$type<'ok' | 'warning' | 'critical' | null>(),
  consecutive: integer("consecutive").notNull().default(0),
  lastValue: doublePrecision("last_value"),
  lastZoneLabel: text("last_zone_label"),
  lastTransitionAt: timestamp("last_transition_at", { withTimezone: true }),
  lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uniq_widget_alert_states_element_series").on(table.elementId, table.seriesKey),
]);

export const insertWidgetAlertStateSchema = createInsertSchema(widgetAlertStates).omit({
  id: true,
  updatedAt: true,
});

export type WidgetAlertState = typeof widgetAlertStates.$inferSelect;
// Use Drizzle's inferred insert type so literal types like severity
// ('ok'|'warning'|'critical') survive round-trip and storage helpers can
// type-check inserts/updates without `as any` casts.
export type InsertWidgetAlertState = typeof widgetAlertStates.$inferInsert;

// Device interfaces - stores network interfaces discovered from devices
export const deviceInterfaces = pgTable("device_interfaces", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"), // Interface description/comment from device
  type: text("type").$type<'ethernet' | 'vlan' | 'bridge' | 'loopback' | 'wireless' | 'tunnel' | 'bonding' | 'other'>(),
  parentInterfaceId: varchar("parent_interface_id"), // For VLANs - references self
  snmpIndex: integer("snmp_index"),
  macAddress: text("mac_address"),
  isVirtual: boolean("is_virtual").default(false),
  operStatus: text("oper_status").$type<'up' | 'down' | 'unknown'>(), // Operational status
  adminStatus: text("admin_status").$type<'enabled' | 'disabled' | 'unknown'>(), // Administrative status
  speed: text("speed"), // Link speed (e.g. "1G", "10G", "100M")
  duplex: text("duplex").$type<'full' | 'half' | 'unknown'>(), // Duplex mode
  discoverySource: text("discovery_source").$type<'probe' | 'manual' | 'sync'>(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  logLinkChange: boolean("log_link_change").default(false).notNull(),
  notifyLinkChange: boolean("notify_link_change").default(false).notNull(),
  logSpeedChange: boolean("log_speed_change").default(false).notNull(),
  notifySpeedChange: boolean("notify_speed_change").default(false).notNull(),
  notifyGlobal: boolean("notify_global").default(false).notNull(),
  notifyOnDuty: boolean("notify_on_duty").default(false).notNull(),
  isDhcpClient: boolean("is_dhcp_client").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_device_interfaces_device").on(table.deviceId),
  // Note: Unique index on (deviceId, name) is created at runtime by cleanupDuplicateInterfaces()
  // This allows upgrades from older versions that may have duplicate interfaces
]);

export const connections = pgTable("connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mapId: varchar("map_id").notNull().references(() => maps.id, { onDelete: "cascade" }),
  sourceDeviceId: varchar("source_device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  targetDeviceId: varchar("target_device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  sourcePort: text("source_port"),
  targetPort: text("target_port"),
  connectionType: text("connection_type").default("ethernet"),
  linkSpeed: text("link_speed").default("1G"),
  curveMode: text("curve_mode").$type<'straight' | 'curved' | 'spline' | 'auto'>().default("straight"),
  curveOffset: integer("curve_offset").default(0),
  monitorInterface: text("monitor_interface").$type<'source' | 'target' | 'custom' | null>(),
  monitorSnmpIndex: integer("monitor_snmp_index"),
  monitorCustomDeviceId: text("monitor_custom_device_id"), // Device ID when monitorInterface === 'custom'
  monitorCustomPort: text("monitor_custom_port"), // Port name when monitorInterface === 'custom'
  flipTrafficDirection: boolean("flip_traffic_direction").default(false),
  linkStats: jsonb("link_stats").$type<{
    inBytesPerSec?: number;
    outBytesPerSec?: number;
    inBitsPerSec?: number;
    outBitsPerSec?: number;
    utilizationPct?: number;
    lastSampleAt?: string;
    previousInOctets?: number;
    previousOutOctets?: number;
    previousSampleAt?: string;
    isStale?: boolean;
  }>(),
  isDynamic: boolean("is_dynamic").default(false),
  dynamicType: text("dynamic_type").$type<'proxmox_vm_host' | 'proxmox_cluster_interface' | 'mac_discovered' | null>(),
  dynamicMetadata: jsonb("dynamic_metadata").$type<{
    vmDeviceId?: string;
    vmEnd?: 'source' | 'target';
    lastResolvedHostId?: string;
    lastResolvedNodeName?: string;
    state?: 'resolved' | 'unresolved' | 'pending';
    clusterInterfaceId?: string;
    clusterInterfaceEnd?: 'source' | 'target';
    // MAC discovery fields
    sourceMac?: string;
    targetMac?: string;
    macLastSeenAt?: string;
    macDiscoveryState?: 'active' | 'stale' | 'missing';
  }>(),
  macValidated: boolean("mac_validated").default(false), // True if manual connection matches MAC table data
  warningThresholdPct: integer("warning_threshold_pct").default(70),
  criticalThresholdPct: integer("critical_threshold_pct").default(90),
  bandwidthNotificationsEnabled: boolean("bandwidth_notifications_enabled").default(true),
  bandwidthBreachState: text("bandwidth_breach_state").$type<'ok' | 'warning' | 'critical'>().default("ok"),
  bandwidthBreachSince: timestamp("bandwidth_breach_since", { withTimezone: true }),
  bandwidthBreachLastNotifiedAt: timestamp("bandwidth_breach_last_notified_at", { withTimezone: true }),
  bandwidthBreachConsecutive: integer("bandwidth_breach_consecutive").default(0),
  bandwidthBreachPending: text("bandwidth_breach_pending").$type<'ok' | 'warning' | 'critical'>(),
  labelPosition: integer("label_position").default(50),
  customLinkSpeedMbps: integer("custom_link_speed_mbps"),
  customLineColor: text("custom_line_color"),
  customLineWidth: integer("custom_line_width"),
  customLinePattern: text("custom_line_pattern").$type<'solid' | 'dashed' | 'dotted' | 'dash-dot'>(),
  dynamicConfig: jsonb("dynamic_config"),
  showBandwidth: boolean("show_bandwidth").default(false),
  // Cable identification (TIA-606-B cable labeling support)
  cableId: text("cable_id"),               // Cable label/identifier (e.g., "C001", "CAB-A01-MDF-01")
  cableColor: text("cable_color"),         // Cable jacket color (e.g., "blue", "yellow", "red")
  cableType: text("cable_type"),           // Cable type (e.g., "cat6a", "fiber-sm", "fiber-mm")
  cableLength: integer("cable_length"),    // Numeric length
  cableLengthUnit: text("cable_length_unit").$type<'m' | 'ft'>().default("m"),
  cableNotes: text("cable_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const scanProfiles = pgTable("scan_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  ipRange: text("ip_range").notNull(),
  credentialProfileIds: text("credential_profile_ids").array().notNull(),
  probeTypes: text("probe_types").array().notNull().$type<Array<'mikrotik' | 'snmp' | 'server' | 'find_all'>>(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const backups = pgTable("backups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  filename: text("filename").notNull(),
  filePath: text("file_path").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  type: text("type").notNull().$type<'manual' | 'scheduled'>(),
  status: text("status").notNull().default("completed").$type<'pending' | 'completed' | 'failed'>(),
  metadata: jsonb("metadata").$type<{
    deviceCount?: number;
    mapCount?: number;
    connectionCount?: number;
    credentialProfileCount?: number;
    version?: string;
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userRoles = ['admin', 'superuser', 'viewer'] as const;
export type UserRole = typeof userRoles[number];

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("viewer").$type<UserRole>(),
  displayName: text("display_name"),
  email: text("email"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  // 2FA fields
  totpSecret: text("totp_secret"), // Encrypted TOTP secret
  totpEnabled: boolean("totp_enabled").default(false).notNull(), // Admin-controlled 2FA requirement
  totpConfigured: boolean("totp_configured").default(false).notNull(), // User has completed 2FA setup
  totpBackupCodes: text("totp_backup_codes").array(), // Hashed backup codes
  forcePasswordChange: boolean("force_password_change").default(false).notNull(), // Require password change at next login
  // Credential vault — an opaque AES-256-GCM encrypted blob managed by the Electron app.
  // CoreBit stores it without ever being able to read it (zero-knowledge).
  credentialVault: text("credential_vault"),
  credentialVaultUpdatedAt: timestamp("credential_vault_updated_at", { withTimezone: true }),
});

// Trusted devices for "remember this device" functionality
export const trustedDevices = pgTable("trusted_devices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deviceToken: text("device_token").notNull().unique(), // Cryptographically random token
  deviceName: text("device_name"), // Browser/OS info for display
  ipAddress: text("ip_address"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), // 30 days from creation
});

export const portLocks = pgTable("port_locks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  portName: text("port_name").notNull(),
  lockedBy: varchar("locked_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  lockedAt: timestamp("locked_at", { withTimezone: true }).defaultNow().notNull(),
  reason: text("reason"),
});

// MAC address table entries learned from switches via SNMP
export const macAddressEntries = pgTable("mac_address_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  macAddress: text("mac_address").notNull(), // MAC address in standard format (e.g., "AA:BB:CC:DD:EE:FF")
  portName: text("port_name"), // Port/interface name where MAC was learned
  portIndex: integer("port_index"), // SNMP ifIndex of the port
  vlanId: integer("vlan_id"), // VLAN ID (from Q-BRIDGE-MIB, null for BRIDGE-MIB)
  isStatic: boolean("is_static").default(false), // Static vs dynamic MAC entry
  isRemote: boolean("is_remote").default(false), // True if MAC learned from remote switch (fabric/TRILL)
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_mac_entries_device").on(table.deviceId),
  index("idx_mac_entries_mac").on(table.macAddress),
  index("idx_mac_entries_device_mac").on(table.deviceId, table.macAddress),
]);

export const insertMacAddressEntrySchema = createInsertSchema(macAddressEntries).omit({
  id: true,
  createdAt: true,
});

export type MacAddressEntry = typeof macAddressEntries.$inferSelect;
export type InsertMacAddressEntry = z.infer<typeof insertMacAddressEntrySchema>;

// Track suppressed MAC connections (deleted MAC-discovered connections that shouldn't be recreated)
export const suppressedMacConnections = pgTable("suppressed_mac_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mapId: varchar("map_id").notNull().references(() => maps.id, { onDelete: "cascade" }),
  sourceDeviceId: varchar("source_device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  targetDeviceId: varchar("target_device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  suppressedAt: timestamp("suppressed_at", { withTimezone: true }).defaultNow().notNull(),
  suppressedBy: varchar("suppressed_by"), // user who deleted the connection
}, (table) => [
  index("idx_suppressed_mac_map").on(table.mapId),
  index("idx_suppressed_mac_devices").on(table.sourceDeviceId, table.targetDeviceId),
]);

export const insertSuppressedMacConnectionSchema = createInsertSchema(suppressedMacConnections).omit({
  id: true,
  suppressedAt: true,
});

export type SuppressedMacConnection = typeof suppressedMacConnections.$inferSelect;
export type InsertSuppressedMacConnection = z.infer<typeof insertSuppressedMacConnectionSchema>;

export const mapsRelations = relations(maps, ({ many }) => ({
  devicePlacements: many(devicePlacements),
  connections: many(connections),
}));

export const devicesRelations = relations(devices, ({ many }) => ({
  placements: many(devicePlacements),
  sourceConnections: many(connections, { relationName: "sourceDevice" }),
  targetConnections: many(connections, { relationName: "targetDevice" }),
}));

export const devicePlacementsRelations = relations(devicePlacements, ({ one }) => ({
  device: one(devices, {
    fields: [devicePlacements.deviceId],
    references: [devices.id],
  }),
  map: one(maps, {
    fields: [devicePlacements.mapId],
    references: [maps.id],
  }),
}));

export const connectionsRelations = relations(connections, ({ one }) => ({
  map: one(maps, {
    fields: [connections.mapId],
    references: [maps.id],
  }),
  sourceDevice: one(devices, {
    fields: [connections.sourceDeviceId],
    references: [devices.id],
    relationName: "sourceDevice",
  }),
  targetDevice: one(devices, {
    fields: [connections.targetDeviceId],
    references: [devices.id],
    relationName: "targetDevice",
  }),
}));

export const insertMapSchema = createInsertSchema(maps).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  isDefault: z.boolean().optional(),
  backgroundColor: z.string().nullable().optional(),
  gridVisible: z.boolean().optional(),
  isLocked: z.boolean().optional(),
  layoutKind: z.enum(['canvas', 'geo']).optional(),
  mapStyle: z.enum(['auto', 'light', 'dark', 'satellite']).optional(),
  geoMarkerStyle: z.enum(['simple', 'detailed', 'hybrid']).optional(),
  geoMarkerThresholds: z.object({ 
    detailedZoom: z.number().min(1).max(22), 
    simpleZoom: z.number().min(1).max(22) 
  }).nullable().optional(),
  defaultCenter: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
  defaultZoom: z.number().min(1).max(20).nullable().optional(),
  publicShareEnabled: z.boolean().optional(),
  publicShareToken: z.string().nullable().optional(),
});

// Zod schema for PrometheusMetricConfig
const prometheusMetricConfigSchema = z.object({
  id: z.string(),
  metricName: z.string(),
  label: z.string(),
  displayType: z.enum(['bar', 'gauge', 'number', 'text', 'bytes', 'percentage', 'boolean', 'rate']),
  unit: z.string().optional(),
  labelFilter: z.record(z.string()).optional(),
  labelSelector: z.string().optional(),
  transform: z.enum(['toGB', 'toMB', 'toPercent', 'divide1000', 'none']).optional(),
  maxValue: z.number().optional(),
  warningThreshold: z.number().optional(),
  criticalThreshold: z.number().optional(),
});

// Zod schema for SNMPStatusConfig
const snmpStatusConfigSchema = z.object({
  okValues: z.string().optional(),
  warningValues: z.string().optional(),
  errorValues: z.string().optional(),
});

// Zod schema for SNMPMetricConfig
const snmpMetricConfigSchema = z.object({
  id: z.string(),
  oid: z.string(),
  label: z.string(),
  displayType: z.enum(['number', 'bytes', 'percentage', 'bar', 'text', 'boolean', 'rate', 'status']),
  unit: z.string().optional(),
  valueType: z.enum(['counter', 'gauge', 'integer', 'string']).optional(),
  transform: z.enum(['divide100', 'divide1000', 'toSeconds', 'none']).optional(),
  warningThreshold: z.number().optional(),
  criticalThreshold: z.number().optional(),
  displayHint: z.string().optional(),
  mibName: z.string().optional(),
  mibDescription: z.string().optional(),
  statusConfig: snmpStatusConfigSchema.optional(),
});

const credentialsSchema = z.object({
  username: z.string().optional(),
  password: z.string().optional(),
  apiPort: z.number().optional(),
  snmpVersion: z.enum(['1', '2c', '3']).optional(),
  snmpCommunity: z.string().optional(),
  snmpUsername: z.string().optional(),
  snmpAuthProtocol: z.enum(['MD5', 'SHA']).optional(),
  snmpAuthKey: z.string().optional(),
  snmpPrivProtocol: z.enum(['DES', 'AES']).optional(),
  snmpPrivKey: z.string().optional(),
  // Prometheus settings
  usePrometheus: z.boolean().optional(),
  prometheusPort: z.number().optional(),
  prometheusPath: z.string().optional(),
  prometheusScheme: z.enum(['http', 'https']).optional(),
  prometheusMetrics: z.array(prometheusMetricConfigSchema).optional(),
  // Proxmox VE API settings
  proxmoxPort: z.number().optional(),
  proxmoxApiTokenId: z.string().optional(),
  proxmoxApiTokenSecret: z.string().optional(),
  proxmoxVerifySsl: z.boolean().optional(),
  proxmoxRealm: z.string().optional(),
  // Proxmox node_exporter settings
  proxmoxUseNodeExporter: z.boolean().optional(),
  proxmoxNodeExporterPort: z.number().optional(),
  proxmoxNodeExporterPath: z.string().optional(),
  proxmoxNodeExporterScheme: z.enum(['http', 'https']).optional(),
  // SNMP custom metrics
  snmpMetrics: z.array(snmpMetricConfigSchema).optional(),
  // HP iLO Redfish API settings
  iloPort: z.number().optional(),
  iloVerifySsl: z.boolean().optional(),
  iloKeepSession: z.boolean().optional(),
  iloDataInterval: z.number().optional(),
  // VMware vSphere settings
  vmwareHost: z.string().optional(),
  vmwareUsername: z.string().optional(),
  vmwarePassword: z.string().optional(),
  vmwarePort: z.number().optional(),
  vmwareVerifySsl: z.boolean().optional(),
}).catchall(z.any());

export const insertCredentialProfileSchema = createInsertSchema(credentialProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  credentials: credentialsSchema,
});

export const insertDeviceSchema = createInsertSchema(devices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  deviceData: z.object({
    uptime: z.string().optional(),
    model: z.string().optional(),
    version: z.string().optional(),
    systemIdentity: z.string().optional(),
    ports: z.array(z.object({
      name: z.string(),
      status: z.string(),
      speed: z.string().optional(),
      snmpIndex: z.number().optional(),
    })).optional(),
    cpuUsagePct: z.number().optional(),
    memoryUsagePct: z.number().optional(),
    diskUsagePct: z.number().optional(),
    cpuInfo: z.string().optional(),
    memoryTotalGB: z.number().optional(),
    serialNumber: z.string().optional(),
    customMetrics: z.record(z.union([z.number(), z.string()])).optional(),
    availableMetrics: z.array(z.string()).optional(),
    webHttps: z.boolean().optional(),
    webPort: z.number().optional(),
  }).optional(),
  customCredentials: credentialsSchema.nullable().optional(),
  credentialProfileId: z.string().nullable().optional(),
  probeTimeout: z.union([z.number().int().min(1).max(120), z.null()]).optional(),
  probeDisabled: z.boolean().optional(),
  probeIpv6Disabled: z.boolean().optional(),
  probeVlanDisabled: z.boolean().optional(),
  useOnDuty: z.boolean().optional(),
  manufacturer: z.string().nullable().optional(),
  deviceModel: z.string().nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  assetTag: z.string().nullable().optional(),
  site: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  rackName: z.string().nullable().optional(),
  rackUnit: z.number().int().min(1).max(60).nullable().optional(),
  rackSide: z.enum(['front', 'rear']).nullable().optional(),
  rackHeight: z.number().int().min(1).max(60).nullable().optional(),
  rackDepth: z.enum(['full', 'half']).nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  hardwareLibraryId: z.string().nullable().optional(),
  deviceNotes: z.string().nullable().optional(),
  siteId: z.string().nullable().optional(),
  locationId: z.string().nullable().optional(),
  rackId: z.string().nullable().optional(),
});

export const insertDevicePlacementSchema = createInsertSchema(devicePlacements).omit({
  id: true,
  createdAt: true,
}).extend({
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
});

export const insertConnectionSchema = createInsertSchema(connections).omit({
  id: true,
  createdAt: true,
}).extend({
  linkSpeed: z.string().optional(), // Allow any link type ID (built-in or custom)
  customLinkSpeedMbps: z.number().int().min(1).max(1000000).nullable().optional(),
  customLineColor: z.string().nullable().optional(),
  customLineWidth: z.number().int().min(1).max(10).nullable().optional(),
  customLinePattern: z.enum(['solid', 'dashed', 'dotted', 'dash-dot']).nullable().optional(),
  monitorInterface: z.enum(['source', 'target', 'custom']).nullable().optional(),
  monitorCustomDeviceId: z.string().nullable().optional(),
  monitorCustomPort: z.string().nullable().optional(),
  linkStats: z.object({
    inBytesPerSec: z.number().optional(),
    outBytesPerSec: z.number().optional(),
    inBitsPerSec: z.number().optional(),
    outBitsPerSec: z.number().optional(),
    utilizationPct: z.number().optional(),
    lastSampleAt: z.string().optional(),
    previousInOctets: z.number().optional(),
    previousOutOctets: z.number().optional(),
    previousSampleAt: z.string().optional(),
    isStale: z.boolean().optional(),
  }).optional(),
  // Cable identification
  cableId: z.string().nullable().optional(),
  cableColor: z.string().nullable().optional(),
  cableType: z.string().nullable().optional(),
  cableLength: z.number().int().min(0).nullable().optional(),
  cableLengthUnit: z.enum(['m', 'ft']).nullable().optional(),
  cableNotes: z.string().nullable().optional(),
});

// TIA-606-B insert schemas
export const insertTiaSiteSchema = createInsertSchema(tiaSites).omit({ id: true, createdAt: true });
export const insertTiaLocationSchema = createInsertSchema(tiaLocations).omit({ id: true, createdAt: true });
export const insertTiaRackSchema = createInsertSchema(tiaRacks).omit({ id: true, createdAt: true });

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  type: z.enum(['webhook', 'telegram', 'slack', 'pushover', 'email']).optional(),
  url: z.string().optional(), // Legacy field for backward compatibility
  method: z.string().optional(), // Legacy field for backward compatibility
  config: z.object({
    // Webhook config
    url: z.string().optional(),
    method: z.string().optional(),
    // Telegram config
    botToken: z.string().optional(),
    chatId: z.string().optional(),
    // Slack config
    webhookUrl: z.string().optional(),
    channel: z.string().optional(),
    username: z.string().optional(),
    iconEmoji: z.string().optional(),
    // Pushover config
    pushoverUserKey: z.string().optional(),
    pushoverAppToken: z.string().optional(),
    pushoverDevice: z.string().optional(),
    pushoverSound: z.string().optional(),
    pushoverPriority: z.number().min(-2).max(2).optional(),
    // Email config
    emailAddress: z.string().email().optional(),
    emailSubject: z.string().optional(),
  }).optional(),
  enabled: z.boolean().optional(),
});

export const insertDeviceNotificationSchema = createInsertSchema(deviceNotifications).omit({
  id: true,
  createdAt: true,
});

export const insertLogSchema = createInsertSchema(logs).omit({
  id: true,
  timestamp: true,
}).extend({
  severity: z.enum(['info', 'warning', 'error']).optional(),
  metadata: z.record(z.any()).optional(),
});

export const insertScanProfileSchema = createInsertSchema(scanProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  credentialProfileIds: z.array(z.string()),
  probeTypes: z.array(z.enum(['mikrotik', 'snmp', 'server', 'find_all'])),
  isDefault: z.boolean().optional(),
});

export const insertBackupSchema = createInsertSchema(backups).omit({
  id: true,
  createdAt: true,
}).extend({
  type: z.enum(['manual', 'scheduled']),
  status: z.enum(['pending', 'completed', 'failed']).optional(),
  metadata: z.object({
    deviceCount: z.number().optional(),
    mapCount: z.number().optional(),
    connectionCount: z.number().optional(),
    credentialProfileCount: z.number().optional(),
    version: z.string().optional(),
  }).optional(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
  totpSecret: true,
  totpBackupCodes: true,
  totpConfigured: true,
}).extend({
  role: z.enum(['admin', 'superuser', 'viewer']).optional(),
  totpEnabled: z.boolean().optional(),
  forcePasswordChange: z.boolean().optional(),
});

export const insertTrustedDeviceSchema = createInsertSchema(trustedDevices).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
});

export const insertPortLockSchema = createInsertSchema(portLocks).omit({
  id: true,
  lockedAt: true,
});

// User notification channels - allows each user to have their own notification methods
export const userNotificationChannels = pgTable("user_notification_channels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull().$type<'webhook' | 'email' | 'telegram' | 'pushover' | 'slack' | 'sound'>(),
  config: jsonb("config").notNull().$type<{
    // Webhook config
    url?: string;
    method?: string;
    messageTemplate?: string;
    // Email config
    emailAddress?: string;
    emailSubject?: string;
    // Telegram config
    botToken?: string;
    chatId?: string;
    // Slack config
    webhookUrl?: string;
    channel?: string; // Optional channel override
    username?: string; // Optional username override
    iconEmoji?: string; // Optional icon emoji
    // Pushover config
    pushoverUserKey?: string;
    pushoverAppToken?: string;
    pushoverDevice?: string;
    pushoverSound?: string;
    pushoverPriority?: number;
    // Sound notification config
    soundId?: string;       // Built-in sound ID or 'custom'
    soundVolume?: number;   // 0.0 – 1.0 (default 0.8)
    soundCustomUrl?: string; // URL to custom audio file (used when soundId === 'custom')
  }>(),
  enabled: boolean("enabled").default(true).notNull(),
  ignoreStaleToOnline: boolean("ignore_stale_to_online").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Duty user schedules - users assigned directly to day/night shifts
// Simplified model: users are assigned to either Day shift or Night shift (or both)
export const dutyUserSchedules = pgTable("duty_user_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  shift: text("shift").notNull().$type<'day' | 'night'>(), // day = during day hours, night = during night hours
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Shift configuration settings
export const dutyShiftConfig = pgTable("duty_shift_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dayShiftStart: text("day_shift_start").notNull().default("07:00"), // HH:MM format
  dayShiftEnd: text("day_shift_end").notNull().default("19:00"),
  nightShiftStart: text("night_shift_start").notNull().default("19:00"),
  nightShiftEnd: text("night_shift_end").notNull().default("07:00"),
  timezone: text("timezone").notNull().default("UTC"),
  rotationWeeks: integer("rotation_weeks").notNull().default(4), // Number of weeks in rotation cycle
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Alarm mutes - mute notifications for specific users or globally
export const alarmMutes = pgTable("alarm_mutes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }), // null = global mute for all on-duty
  mutedBy: varchar("muted_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  muteUntil: timestamp("mute_until", { withTimezone: true }), // null = forever
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Device status events - tracks every status change for history/analytics
export const deviceStatusEvents = pgTable("device_status_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  previousStatus: text("previous_status"), // null for initial status
  newStatus: text("new_status").notNull(), // online, warning, stale, offline, unknown
  message: text("message"), // Optional description of why status changed
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_device_status_events_device_created").on(table.deviceId, table.createdAt),
]);

// Interface state events - tracks link state, admin state, and speed changes per interface
export const interfaceStateEvents = pgTable("interface_state_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  interfaceId: varchar("interface_id").notNull().references(() => deviceInterfaces.id, { onDelete: "cascade" }),
  interfaceName: text("interface_name").notNull(), // Denormalized for display
  eventType: text("event_type").notNull().$type<'link_state' | 'admin_state' | 'speed_change'>(),
  previousValue: text("previous_value"),
  newValue: text("new_value").notNull(),
  message: text("message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_interface_state_events_interface_created").on(table.interfaceId, table.createdAt),
  index("idx_interface_state_events_device_created").on(table.deviceId, table.createdAt),
]);

// Proxmox VM instances - tracks VMs running on Proxmox hosts
export const proxmoxVms = pgTable("proxmox_vms", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  hostDeviceId: varchar("host_device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  vmid: integer("vmid").notNull(), // Proxmox VM ID (e.g., 100, 101)
  vmType: text("vm_type").notNull().$type<'qemu' | 'lxc'>(), // QEMU VM or LXC container
  name: text("name").notNull(),
  status: text("status").notNull(), // running, stopped, paused, etc.
  node: text("node").notNull(), // Proxmox node name (for cluster tracking)
  cpuUsage: integer("cpu_usage"), // CPU cores assigned
  cpuUsagePct: doublePrecision("cpu_usage_pct"), // CPU usage percentage (0-100)
  memoryBytes: text("memory_bytes"), // Max memory in bytes (allocated)
  memoryUsedBytes: text("memory_used_bytes"), // Current memory used in bytes
  diskBytes: text("disk_bytes"), // Max disk size in bytes (allocated)
  diskUsedBytes: text("disk_used_bytes"), // Current disk used in bytes
  uptime: integer("uptime"), // Uptime in seconds
  ipAddresses: text("ip_addresses").array(), // IP addresses detected
  macAddresses: text("mac_addresses").array(), // MAC addresses from config
  matchedDeviceId: varchar("matched_device_id").references(() => devices.id, { onDelete: "set null" }), // Link to existing device by IP/MAC
  clusterName: text("cluster_name"), // Proxmox cluster name if clustered
  lastSeen: timestamp("last_seen", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_proxmox_vms_host").on(table.hostDeviceId),
  index("idx_proxmox_vms_matched").on(table.matchedDeviceId),
]);

// Proxmox cluster nodes - maps cluster node names to Proxmox host devices
// Used to resolve which host device a VM should connect to after migration
export const proxmoxNodes = pgTable("proxmox_nodes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clusterName: text("cluster_name").notNull(), // Proxmox cluster name
  nodeName: text("node_name").notNull(), // Proxmox node name within cluster
  hostDeviceId: varchar("host_device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  lastSeen: timestamp("last_seen", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_proxmox_nodes_cluster").on(table.clusterName),
  index("idx_proxmox_nodes_host").on(table.hostDeviceId),
]);

export const insertProxmoxNodeSchema = createInsertSchema(proxmoxNodes).omit({
  id: true,
  createdAt: true,
  lastSeen: true,
});

export type InsertProxmoxNode = z.infer<typeof insertProxmoxNodeSchema>;
export type ProxmoxNode = typeof proxmoxNodes.$inferSelect;

// Proxmox cluster interfaces - virtual interfaces shared across all hosts in a cluster
// Used for dynamic connections that automatically resolve to the host running a specific VM
export const proxmoxClusterInterfaces = pgTable("proxmox_cluster_interfaces", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clusterName: text("cluster_name").notNull(), // Proxmox cluster name
  interfaceName: text("interface_name").notNull(), // Display name for the interface (e.g., "VM Network", "Cluster Uplink")
  description: text("description"), // Optional description
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_proxmox_cluster_interfaces_cluster").on(table.clusterName),
]);

export const insertProxmoxClusterInterfaceSchema = createInsertSchema(proxmoxClusterInterfaces).omit({
  id: true,
  createdAt: true,
});

export type InsertProxmoxClusterInterface = z.infer<typeof insertProxmoxClusterInterfaceSchema>;
export type ProxmoxClusterInterface = typeof proxmoxClusterInterfaces.$inferSelect;

// ── Plugin items table ────────────────────────────────────────────────────────
// Generic storage for child items discovered by plugins (e.g. VMware VMs, Nutanix VMs).
// Each row represents one child entity discovered by a plugin during a poll cycle.
export const pluginItems = pgTable("plugin_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  hostDeviceId: varchar("host_device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  pluginType: text("plugin_type").notNull(), // e.g. 'vmware', 'nutanix'
  itemId: text("item_id").notNull(), // Plugin-internal unique ID (e.g. VM UUID)
  name: text("name").notNull(),
  status: text("status").notNull(), // running, stopped, paused, unknown, etc.
  data: jsonb("data").$type<Record<string, any>>(), // Plugin-specific data (JSONB)
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_plugin_items_host").on(table.hostDeviceId),
  uniqueIndex("idx_plugin_items_unique").on(table.hostDeviceId, table.pluginType, table.itemId),
]);

export const insertPluginItemSchema = createInsertSchema(pluginItems).omit({
  id: true,
  updatedAt: true,
});

export type InsertPluginItem = z.infer<typeof insertPluginItemSchema>;
export type PluginItem = typeof pluginItems.$inferSelect;

export const insertUserNotificationChannelSchema = createInsertSchema(userNotificationChannels).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  type: z.enum(['webhook', 'email', 'telegram', 'pushover', 'slack', 'sound']),
  config: z.object({
    url: z.string().optional(),
    method: z.string().optional(),
    messageTemplate: z.string().optional(),
    emailAddress: z.string().optional(),
    emailSubject: z.string().optional(),
    botToken: z.string().optional(),
    chatId: z.string().optional(),
    // Slack config
    webhookUrl: z.string().optional(),
    channel: z.string().optional(),
    username: z.string().optional(),
    iconEmoji: z.string().optional(),
    pushoverUserKey: z.string().optional(),
    pushoverAppToken: z.string().optional(),
    pushoverDevice: z.string().optional(),
    pushoverSound: z.string().optional(),
    pushoverPriority: z.number().min(-2).max(2).optional(),
    // Sound notification config
    soundId: z.string().optional(),
    soundVolume: z.number().min(0).max(1).optional(),
    soundCustomUrl: z.string().optional(),
  }),
  enabled: z.boolean().optional(),
});

export const insertDutyUserScheduleSchema = createInsertSchema(dutyUserSchedules).omit({
  id: true,
  createdAt: true,
}).extend({
  shift: z.enum(['day', 'night']),
});

export const insertDutyShiftConfigSchema = createInsertSchema(dutyShiftConfig).omit({
  id: true,
  updatedAt: true,
}).extend({
  dayShiftStart: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  dayShiftEnd: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  nightShiftStart: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  nightShiftEnd: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  rotationWeeks: z.number().int().min(1).max(52).optional(),
});

export const insertAlarmMuteSchema = createInsertSchema(alarmMutes).omit({
  id: true,
  createdAt: true,
});

export const insertDeviceStatusEventSchema = createInsertSchema(deviceStatusEvents).omit({
  id: true,
  createdAt: true,
});

export const insertInterfaceStateEventSchema = createInsertSchema(interfaceStateEvents).omit({
  id: true,
  createdAt: true,
});

export const insertProxmoxVmSchema = createInsertSchema(proxmoxVms).omit({
  id: true,
  createdAt: true,
  lastSeen: true,
}).extend({
  vmType: z.enum(['qemu', 'lxc']),
  ipAddresses: z.array(z.string()).optional(),
  macAddresses: z.array(z.string()).optional(),
});

// IPAM Pools - defines IP address ranges/blocks to track
export const ipamVrfs = pgTable("ipam_vrfs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  routeTarget: text("route_target"), // e.g. "65000:100"
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const ipamPools = pgTable("ipam_pools", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  entryType: text("entry_type").notNull().$type<'cidr' | 'range' | 'single'>(),
  cidr: text("cidr"), // For CIDR notation (e.g., 192.168.1.0/24)
  rangeStart: text("range_start"), // For range notation start IP
  rangeEnd: text("range_end"), // For range notation end IP
  vlan: integer("vlan"), // Optional VLAN tag
  gateway: text("gateway"), // Optional gateway IP
  vrfId: varchar("vrf_id").references(() => ipamVrfs.id, { onDelete: "restrict" }),
  parentId: varchar("parent_id").references((): AnyPgColumn => ipamPools.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// IPAM Addresses - individual IP addresses tracked within pools
export const ipamAddresses = pgTable("ipam_addresses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ipAddress: text("ip_address").notNull(),
  networkAddress: text("network_address"), // CIDR notation with prefix (e.g., "192.168.1.1/24")
  poolId: varchar("pool_id").references(() => ipamPools.id, { onDelete: "cascade" }),
  vrfId: varchar("vrf_id").references(() => ipamVrfs.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("available").$type<'available' | 'assigned' | 'reserved' | 'offline'>(),
  assignedDeviceId: varchar("assigned_device_id").references(() => devices.id, { onDelete: "set null" }),
  assignedInterfaceId: varchar("assigned_interface_id").references(() => deviceInterfaces.id, { onDelete: "set null" }), // FK to specific interface
  assignedInterfaceIndex: integer("assigned_interface_index"), // Legacy: Index into device's ports array (deprecated)
  role: text("role").$type<'primary' | 'secondary' | 'management' | 'unused'>(), // Role of this IP on the device
  source: text("source").$type<'manual' | 'discovered' | 'sync'>(), // How this address was added
  assignmentSource: text("assignment_source").$type<'manual' | 'auto'>(), // Legacy: How was this assignment made
  hostname: text("hostname"), // Optional hostname for this IP
  notes: text("notes"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_ipam_addresses_pool").on(table.poolId),
  index("idx_ipam_addresses_device").on(table.assignedDeviceId),
  index("idx_ipam_addresses_interface").on(table.assignedInterfaceId),
  index("idx_ipam_addresses_vrf").on(table.vrfId),
  uniqueIndex("idx_ipam_addresses_ip_unique").on(table.ipAddress, table.vrfId),
]);

// IPAM Address Assignments - junction table for many-to-many IP-to-interface relationships
// Allows multiple devices/interfaces to share the same IP address (e.g., VRRP, failover)
export const ipamAddressAssignments = pgTable("ipam_address_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  addressId: varchar("address_id").notNull().references(() => ipamAddresses.id, { onDelete: "cascade" }),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  interfaceId: varchar("interface_id").references(() => deviceInterfaces.id, { onDelete: "set null" }),
  role: text("role").$type<'primary' | 'secondary' | 'management' | 'unused'>(),
  source: text("source").$type<'manual' | 'discovered' | 'sync'>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_ipam_assignments_address").on(table.addressId),
  index("idx_ipam_assignments_device").on(table.deviceId),
  index("idx_ipam_assignments_interface").on(table.interfaceId),
]);

export const insertIpamVrfSchema = createInsertSchema(ipamVrfs).omit({
  id: true,
  createdAt: true,
});

export const insertIpamPoolSchema = createInsertSchema(ipamPools).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  entryType: z.enum(['cidr', 'range', 'single']),
  vlan: z.number().int().min(1).max(4094).optional().nullable(),
  vrfId: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  cidr: z.string().refine(v => !v || isValidIpOrCidr(v), { message: 'Must be a valid IPv4 or IPv6 address/CIDR' }).optional().nullable(),
  rangeStart: z.string().refine(v => !v || isValidIpOrCidr(v), { message: 'Must be a valid IPv4 or IPv6 address' }).optional().nullable(),
  rangeEnd: z.string().refine(v => !v || isValidIpOrCidr(v), { message: 'Must be a valid IPv4 or IPv6 address' }).optional().nullable(),
});

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\/(?:[12]?\d|3[0-2]))?$/;
const IPV6_RE = /^[\da-fA-F:]+(?:\/\d{1,3})?$/;
function isValidIpOrCidr(v: string): boolean {
  const [bare, prefixStr] = v.split('/');
  // IPv4 — regex already validates prefix 0-32
  if (!bare.includes(':')) return IPV4_RE.test(v);
  // IPv6 — validate characters first
  if (!IPV6_RE.test(v)) return false;
  // If a prefix is present, check it is within 0-128
  if (prefixStr !== undefined) {
    const p = parseInt(prefixStr, 10);
    if (isNaN(p) || p < 0 || p > 128) return false;
  }
  return true;
}

export const insertIpamAddressSchema = createInsertSchema(ipamAddresses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  ipAddress: z.string().refine(isValidIpOrCidr, { message: 'Must be a valid IPv4 or IPv6 address' }),
  status: z.enum(['available', 'assigned', 'reserved', 'offline']).optional(),
  role: z.enum(['primary', 'secondary', 'management', 'unused']).optional().nullable(),
  source: z.enum(['manual', 'discovered', 'sync']).optional().nullable(),
  assignmentSource: z.enum(['manual', 'auto']).optional().nullable(),
});

export const insertDeviceInterfaceSchema = createInsertSchema(deviceInterfaces).omit({
  id: true,
  createdAt: true,
}).extend({
  type: z.enum(['ethernet', 'vlan', 'bridge', 'loopback', 'wireless', 'tunnel', 'bonding', 'other']).optional().nullable(),
  discoverySource: z.enum(['probe', 'manual', 'sync']).optional().nullable(),
  operStatus: z.enum(['up', 'down', 'unknown']).optional().nullable(),
  adminStatus: z.enum(['enabled', 'disabled', 'unknown']).optional().nullable(),
  duplex: z.enum(['full', 'half', 'unknown']).optional().nullable(),
});

export const insertIpamAddressAssignmentSchema = createInsertSchema(ipamAddressAssignments).omit({
  id: true,
  createdAt: true,
}).extend({
  role: z.enum(['primary', 'secondary', 'management', 'unused']).optional().nullable(),
  source: z.enum(['manual', 'discovered', 'sync']).optional().nullable(),
});

// VLANs - discovered from Q-BRIDGE-MIB per device
export const vlans = pgTable("vlans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  vlanId: integer("vlan_id").notNull(),
  name: text("name"),
  description: text("description"),
  active: boolean("active").default(true).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_vlans_device").on(table.deviceId),
  uniqueIndex("idx_vlans_device_vlan").on(table.deviceId, table.vlanId),
]);

// VLAN interface memberships - which interfaces belong to which VLANs (tagged/untagged)
export const interfaceVlanMemberships = pgTable("interface_vlan_memberships", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  interfaceId: varchar("interface_id").notNull().references(() => deviceInterfaces.id, { onDelete: "cascade" }),
  vlanRecordId: varchar("vlan_record_id").notNull().references(() => vlans.id, { onDelete: "cascade" }),
  tagged: boolean("tagged").default(true).notNull(),
  isPvid: boolean("is_pvid").default(false).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
}, (table) => [
  index("idx_ivm_interface").on(table.interfaceId),
  index("idx_ivm_vlan").on(table.vlanRecordId),
  uniqueIndex("idx_ivm_interface_vlan").on(table.interfaceId, table.vlanRecordId),
]);

export const insertVlanSchema = createInsertSchema(vlans).omit({
  id: true,
  createdAt: true,
});

export const insertInterfaceVlanMembershipSchema = createInsertSchema(interfaceVlanMemberships).omit({
  id: true,
});

export type Vlan = typeof vlans.$inferSelect;
export type InsertVlan = z.infer<typeof insertVlanSchema>;
export type InterfaceVlanMembership = typeof interfaceVlanMemberships.$inferSelect;
export type InsertInterfaceVlanMembership = z.infer<typeof insertInterfaceVlanMembershipSchema>;

// VLAN Groups — user-defined named groups filtering VLANs by a range expression
// e.g. ranges = "10-100,400,501" (no enforcement of non-overlap)
export const vlanGroups = pgTable("vlan_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  ranges: text("ranges").notNull().default(''),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertVlanGroupSchema = createInsertSchema(vlanGroups).omit({
  id: true,
  createdAt: true,
});
export type VlanGroup = typeof vlanGroups.$inferSelect;
export type InsertVlanGroup = z.infer<typeof insertVlanGroupSchema>;

export type TiaSite = typeof tiaSites.$inferSelect;
export type InsertTiaSite = z.infer<typeof insertTiaSiteSchema>;
export type TiaLocation = typeof tiaLocations.$inferSelect;
export type InsertTiaLocation = z.infer<typeof insertTiaLocationSchema>;
export type TiaRack = typeof tiaRacks.$inferSelect;
export type InsertTiaRack = z.infer<typeof insertTiaRackSchema>;

export type Map = typeof maps.$inferSelect;
export type InsertMap = z.infer<typeof insertMapSchema>;
export type Device = typeof devices.$inferSelect;
export type InsertDevice = z.infer<typeof insertDeviceSchema>;
export type DevicePlacement = typeof devicePlacements.$inferSelect;
export type InsertDevicePlacement = z.infer<typeof insertDevicePlacementSchema>;
export type Connection = typeof connections.$inferSelect;
export type InsertConnection = z.infer<typeof insertConnectionSchema>;
export type CredentialProfile = typeof credentialProfiles.$inferSelect;
export type InsertCredentialProfile = z.infer<typeof insertCredentialProfileSchema>;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type DeviceNotification = typeof deviceNotifications.$inferSelect;
export type InsertDeviceNotification = z.infer<typeof insertDeviceNotificationSchema>;
export type Log = typeof logs.$inferSelect;
export type InsertLog = z.infer<typeof insertLogSchema>;
export type ScanProfile = typeof scanProfiles.$inferSelect;
export type InsertScanProfile = z.infer<typeof insertScanProfileSchema>;
export type Backup = typeof backups.$inferSelect;
export type InsertBackup = z.infer<typeof insertBackupSchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type TrustedDevice = typeof trustedDevices.$inferSelect;
export type InsertTrustedDevice = z.infer<typeof insertTrustedDeviceSchema>;
export type PortLock = typeof portLocks.$inferSelect;
export type InsertPortLock = z.infer<typeof insertPortLockSchema>;
export type UserNotificationChannel = typeof userNotificationChannels.$inferSelect;
export type InsertUserNotificationChannel = z.infer<typeof insertUserNotificationChannelSchema>;
export type DutyUserSchedule = typeof dutyUserSchedules.$inferSelect;
export type InsertDutyUserSchedule = z.infer<typeof insertDutyUserScheduleSchema>;
export type DutyShiftConfig = typeof dutyShiftConfig.$inferSelect;
export type InsertDutyShiftConfig = z.infer<typeof insertDutyShiftConfigSchema>;
export type AlarmMute = typeof alarmMutes.$inferSelect;
export type InsertAlarmMute = z.infer<typeof insertAlarmMuteSchema>;
export type DeviceStatusEvent = typeof deviceStatusEvents.$inferSelect;
export type InsertDeviceStatusEvent = z.infer<typeof insertDeviceStatusEventSchema>;
export type InterfaceStateEvent = typeof interfaceStateEvents.$inferSelect;
export type InsertInterfaceStateEvent = z.infer<typeof insertInterfaceStateEventSchema>;
export type ProxmoxVm = typeof proxmoxVms.$inferSelect;
export type InsertProxmoxVm = z.infer<typeof insertProxmoxVmSchema>;
export type IpamVrf = typeof ipamVrfs.$inferSelect;
export type InsertIpamVrf = z.infer<typeof insertIpamVrfSchema>;
export type IpamPool = typeof ipamPools.$inferSelect;
export type InsertIpamPool = z.infer<typeof insertIpamPoolSchema>;
export type IpamAddress = typeof ipamAddresses.$inferSelect;
export type InsertIpamAddress = z.infer<typeof insertIpamAddressSchema>;
export type DeviceInterface = typeof deviceInterfaces.$inferSelect;
export type InsertDeviceInterface = z.infer<typeof insertDeviceInterfaceSchema>;
export type IpamAddressAssignment = typeof ipamAddressAssignments.$inferSelect;
export type InsertIpamAddressAssignment = z.infer<typeof insertIpamAddressAssignmentSchema>;

// Extended type for IPAM address with assignments
export interface IpamAddressWithAssignments extends IpamAddress {
  assignments: IpamAddressAssignment[];
}

// Device metrics history - time-series storage for device vitals
export const deviceMetricsHistory = pgTable("device_metrics_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  cpuUsagePct: integer("cpu_usage_pct"),
  memoryUsagePct: integer("memory_usage_pct"),
  diskUsagePct: integer("disk_usage_pct"),
  pingRtt: integer("ping_rtt"), // Ping round-trip time in ms
  uptimeSeconds: integer("uptime_seconds"), // Raw uptime in seconds for tracking
  pollDurationMs: integer("poll_duration_ms"), // Time taken to poll this device in ms
}, (table) => [
  index("idx_device_metrics_device_time").on(table.deviceId, table.timestamp),
  index("idx_device_metrics_timestamp").on(table.timestamp),
]);

export const insertDeviceMetricsHistorySchema = createInsertSchema(deviceMetricsHistory).omit({
  id: true,
});

// Connection bandwidth history - time-series storage for link traffic
export const connectionBandwidthHistory = pgTable("connection_bandwidth_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  connectionId: varchar("connection_id").notNull().references(() => connections.id, { onDelete: "cascade" }),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  inBytesPerSec: bigint("in_bytes_per_sec", { mode: "number" }),
  outBytesPerSec: bigint("out_bytes_per_sec", { mode: "number" }),
  utilizationPct: integer("utilization_pct"),
}, (table) => [
  index("idx_bandwidth_connection_time").on(table.connectionId, table.timestamp),
  index("idx_bandwidth_timestamp").on(table.timestamp),
]);

export const insertConnectionBandwidthHistorySchema = createInsertSchema(connectionBandwidthHistory).omit({
  id: true,
});

// Prometheus custom metrics history - time-series storage for selected scan metrics
export const prometheusMetricsHistory = pgTable("prometheus_metrics_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  metricId: text("metric_id").notNull(), // The metric config ID (e.g., 'load1', 'fs_root_avail')
  metricName: text("metric_name").notNull(), // Prometheus metric name for reference
  value: doublePrecision("value").notNull(), // The metric value (already transformed)
  rawValue: doublePrecision("raw_value"), // Original untransformed value (optional, for debugging)
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_prom_metrics_device_metric_time").on(table.deviceId, table.metricId, table.timestamp),
  index("idx_prom_metrics_timestamp").on(table.timestamp),
]);

// Probe cycle history - time-series storage for poller performance tracking
export const probeCycleHistory = pgTable("probe_cycle_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  probeType: text("probe_type").notNull(), // 'device', 'traffic', 'ping'
  durationMs: integer("duration_ms").notNull(),
  deviceCount: integer("device_count"),
  successCount: integer("success_count"),
  errorCount: integer("error_count"),
  timeoutCount: integer("timeout_count"),
}, (table) => [
  index("idx_probe_cycle_type_time").on(table.probeType, table.timestamp),
  index("idx_probe_cycle_timestamp").on(table.timestamp),
]);

export type ProbeCycleHistory = typeof probeCycleHistory.$inferSelect;
export type InsertProbeCycleHistory = typeof probeCycleHistory.$inferInsert;

// License table for software licensing
export const licenses = pgTable("licenses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  licenseKey: text("license_key").notNull().unique(),
  tier: text("tier").notNull().default("free"), // free, pro
  fingerprint: text("fingerprint").notNull(), // Server fingerprint hash
  deviceLimit: integer("device_limit").default(10), // null = unlimited
  purchaseDate: timestamp("purchase_date", { withTimezone: true }),
  updatesValidUntil: timestamp("updates_valid_until", { withTimezone: true }), // Updates entitlement expiry
  stripeSessionId: text("stripe_session_id"), // Stripe checkout session ID
  stripeCustomerId: text("stripe_customer_id"), // Stripe customer ID
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertLicenseSchema = createInsertSchema(licenses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type License = typeof licenses.$inferSelect;
export type InsertLicense = z.infer<typeof insertLicenseSchema>;

export type DeviceMetricsHistory = typeof deviceMetricsHistory.$inferSelect;
export type InsertDeviceMetricsHistory = z.infer<typeof insertDeviceMetricsHistorySchema>;
export type ConnectionBandwidthHistory = typeof connectionBandwidthHistory.$inferSelect;
export type InsertConnectionBandwidthHistory = z.infer<typeof insertConnectionBandwidthHistorySchema>;

export const insertPrometheusMetricsHistorySchema = createInsertSchema(prometheusMetricsHistory).omit({
  id: true,
});
export type PrometheusMetricsHistory = typeof prometheusMetricsHistory.$inferSelect;
export type InsertPrometheusMetricsHistory = z.infer<typeof insertPrometheusMetricsHistorySchema>;

// Ping targets - IP addresses to monitor for latency (smokeping-style)
export const pingTargets = pgTable("ping_targets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  ipAddress: text("ip_address").notNull(), // IP address to ping
  label: text("label"), // Optional friendly label (e.g., "WAN Interface", "LAN Gateway")
  interfaceName: text("interface_name"), // Interface name if IP belongs to an interface (e.g., "bridge", "ether1")
  enabled: boolean("enabled").default(true).notNull(),
  probeCount: integer("probe_count").default(20).notNull(), // Number of pings per cycle (default 20)
  intervalSeconds: integer("interval_seconds").default(30).notNull(), // Probe interval (default 30s)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_ping_targets_device").on(table.deviceId),
  index("idx_ping_targets_enabled").on(table.enabled),
]);

export const insertPingTargetSchema = createInsertSchema(pingTargets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type PingTarget = typeof pingTargets.$inferSelect;
export type InsertPingTarget = z.infer<typeof insertPingTargetSchema>;

// Ping history - aggregated latency/loss data per probe cycle
export const pingHistory = pgTable("ping_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  targetId: varchar("target_id").notNull().references(() => pingTargets.id, { onDelete: "cascade" }),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  // Packet statistics
  sent: integer("sent").notNull(), // Packets sent
  received: integer("received").notNull(), // Packets received
  lossPct: doublePrecision("loss_pct").notNull(), // Loss percentage (0-100)
  // RTT statistics in milliseconds (all as double for precision)
  rttMin: doublePrecision("rtt_min"), // Minimum RTT
  rttMax: doublePrecision("rtt_max"), // Maximum RTT
  rttAvg: doublePrecision("rtt_avg"), // Average RTT
  rttMdev: doublePrecision("rtt_mdev"), // Standard deviation
  // Percentiles for smokeping-style visualization
  rttP10: doublePrecision("rtt_p10"), // 10th percentile
  rttP25: doublePrecision("rtt_p25"), // 25th percentile
  rttP50: doublePrecision("rtt_p50"), // Median (50th percentile)
  rttP75: doublePrecision("rtt_p75"), // 75th percentile
  rttP90: doublePrecision("rtt_p90"), // 90th percentile
  rttP95: doublePrecision("rtt_p95"), // 95th percentile
}, (table) => [
  index("idx_ping_history_target_time").on(table.targetId, table.timestamp),
  index("idx_ping_history_timestamp").on(table.timestamp),
]);

export const insertPingHistorySchema = createInsertSchema(pingHistory).omit({
  id: true,
});

export type PingHistory = typeof pingHistory.$inferSelect;
export type InsertPingHistory = z.infer<typeof insertPingHistorySchema>;

// API Keys - for external API access with 3 access levels
export const apiKeyAccessLevels = ['read', 'readwrite', 'admin'] as const;
export type ApiKeyAccessLevel = typeof apiKeyAccessLevels[number];

export const apiKeys = pgTable("api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  keyHash: varchar("key_hash", { length: 128 }).notNull(),
  keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
  accessLevel: varchar("access_level", { length: 20 }).notNull().default('read'),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  // When set, this is a personal API key owned by a specific user.
  // The key authenticates as that user (with role capped by accessLevel).
  // When null, this is a system-wide API key (admin-managed).
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
});

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;

// Device Appearance Settings - stored in settings table with key 'device_appearance'
export type DeviceAppearanceThemeColors = {
  text: {
    online: string;
    warning: string;
    stale: string;
    offline: string;
    unknown: string;
  };
  textSecondary: {
    online: string;
    warning: string;
    stale: string;
    offline: string;
    unknown: string;
  };
  titleFontSize: number; // Title font size in pixels (12-24)
  background: {
    online: string;
    warning: string;
    stale: string;
    offline: string;
    unknown: string;
  };
  border: {
    color: string;
    colorOnline: string;
    colorOffline: string;
    colorWarning: string;
    width: number; // 0-4 px
    radius: number; // 0-16 px
  };
  shadow: {
    enabled: boolean;
    intensity: 'none' | 'sm' | 'md' | 'lg'; // Shadow size
  };
};

export type DeviceAppearanceSettings = {
  light: DeviceAppearanceThemeColors;
  dark: DeviceAppearanceThemeColors;
};

// Default device appearance settings
export const DEFAULT_DEVICE_APPEARANCE: DeviceAppearanceSettings = {
  light: {
    text: {
      online: '#1e293b', // slate-800
      warning: '#713f12', // yellow-800
      stale: '#78350f', // amber-800
      offline: '#991b1b', // red-800
      unknown: '#1e293b', // slate-800
    },
    textSecondary: {
      online: '#64748b', // slate-500
      warning: '#a16207', // yellow-700
      stale: '#92400e', // amber-700
      offline: '#b91c1c', // red-700
      unknown: '#64748b', // slate-500
    },
    titleFontSize: 18,
    background: {
      online: '#f8fafc', // slate-50
      warning: '#fef9c3', // yellow-100
      stale: '#fef3c7', // amber-100
      offline: '#fee2e2', // red-100
      unknown: '#f1f5f9', // slate-100
    },
    border: {
      color: '#e2e8f0', // slate-200
      colorOnline: '#e2e8f0', // slate-200
      colorOffline: '#ef4444', // red-500
      colorWarning: '#facc15', // yellow-400
      width: 2,
      radius: 8,
    },
    shadow: {
      enabled: true,
      intensity: 'lg',
    },
  },
  dark: {
    text: {
      online: '#f8fafc', // slate-50
      warning: '#fef08a', // yellow-200
      stale: '#fde68a', // amber-200
      offline: '#fecaca', // red-200
      unknown: '#f8fafc', // slate-50
    },
    textSecondary: {
      online: '#94a3b8', // slate-400
      warning: '#fde047', // yellow-300
      stale: '#fcd34d', // amber-300
      offline: '#fca5a5', // red-300
      unknown: '#94a3b8', // slate-400
    },
    titleFontSize: 18,
    background: {
      online: '#1e293b', // slate-800
      warning: '#422006', // yellow-950
      stale: '#451a03', // amber-950
      offline: '#450a0a', // red-950
      unknown: '#1e293b', // slate-800
    },
    border: {
      color: '#475569', // slate-600
      colorOnline: '#475569', // slate-600
      colorOffline: '#ef4444', // red-500
      colorWarning: '#facc15', // yellow-400
      width: 2,
      radius: 8,
    },
    shadow: {
      enabled: true,
      intensity: 'lg',
    },
  },
};

// Zod schema for validation
const statusColorsSchema = z.object({
  online: z.string(),
  warning: z.string(),
  stale: z.string(),
  offline: z.string(),
  unknown: z.string(),
});

export const deviceAppearanceThemeColorsSchema = z.object({
  text: statusColorsSchema,
  textSecondary: statusColorsSchema,
  titleFontSize: z.number().min(12).max(24),
  background: statusColorsSchema,
  border: z.object({
    color: z.string(),
    colorOnline: z.string(),
    colorOffline: z.string(),
    colorWarning: z.string(),
    width: z.number().min(0).max(4),
    radius: z.number().min(0).max(24),
  }),
  shadow: z.object({
    enabled: z.boolean(),
    intensity: z.enum(['none', 'sm', 'md', 'lg']),
  }),
});

export const deviceAppearanceSettingsSchema = z.object({
  light: deviceAppearanceThemeColorsSchema,
  dark: deviceAppearanceThemeColorsSchema,
});

// Link Type Settings - stored in settings table with key 'link_types'
export type LinkType = {
  id: string; // Unique identifier (e.g., '100M', '1G', 'custom-fiber')
  name: string; // Display name (e.g., '100 Mbps', '1 Gigabit', 'Custom Fiber')
  isBuiltIn: boolean; // Whether this is a default/system link type
  speedMbps: number | null; // Speed in Mbps (null for unknown/variable like WiFi)
  light: {
    color: string; // Line color for light mode
    width: number; // Line width (1-8)
    dashArray: string; // SVG dash array ('' for solid, '8,4' for dashed, etc.)
    shadow: {
      enabled: boolean;
      color: string; // Shadow color
      blur: number; // Shadow blur radius (0-20)
      opacity: number; // Shadow opacity (0-1)
    };
  };
  dark: {
    color: string; // Line color for dark mode
    width: number; // Line width (1-8)
    dashArray: string;
    shadow: {
      enabled: boolean;
      color: string;
      blur: number;
      opacity: number;
    };
  };
};

export type LinkTypeSettings = {
  types: LinkType[];
};

// Default link types matching current hardcoded values
export const DEFAULT_LINK_TYPES: LinkTypeSettings = {
  types: [
    {
      id: '100M',
      name: '100 Mbps',
      isBuiltIn: true,
      speedMbps: 100,
      light: { color: '#6b7280', width: 1.5, dashArray: '', shadow: { enabled: false, color: '#000000', blur: 4, opacity: 0.3 } },
      dark: { color: '#9ca3af', width: 1.5, dashArray: '', shadow: { enabled: false, color: '#ffffff', blur: 4, opacity: 0.2 } },
    },
    {
      id: 'WiFi',
      name: 'WiFi',
      isBuiltIn: true,
      speedMbps: null,
      light: { color: '#f59e0b', width: 2, dashArray: '4,4', shadow: { enabled: false, color: '#000000', blur: 4, opacity: 0.3 } },
      dark: { color: '#fbbf24', width: 2, dashArray: '4,4', shadow: { enabled: false, color: '#ffffff', blur: 4, opacity: 0.2 } },
    },
    {
      id: '1G',
      name: '1 Gigabit',
      isBuiltIn: true,
      speedMbps: 1000,
      light: { color: '#71717a', width: 2, dashArray: '', shadow: { enabled: false, color: '#000000', blur: 4, opacity: 0.3 } },
      dark: { color: '#a1a1aa', width: 2, dashArray: '', shadow: { enabled: false, color: '#ffffff', blur: 4, opacity: 0.2 } },
    },
    {
      id: '2.5G',
      name: '2.5 Gigabit',
      isBuiltIn: true,
      speedMbps: 2500,
      light: { color: '#0ea5e9', width: 2.5, dashArray: '', shadow: { enabled: false, color: '#000000', blur: 4, opacity: 0.3 } },
      dark: { color: '#38bdf8', width: 2.5, dashArray: '', shadow: { enabled: false, color: '#ffffff', blur: 4, opacity: 0.2 } },
    },
    {
      id: '10G',
      name: '10 Gigabit',
      isBuiltIn: true,
      speedMbps: 10000,
      light: { color: '#14b8a6', width: 3, dashArray: '', shadow: { enabled: false, color: '#000000', blur: 4, opacity: 0.3 } },
      dark: { color: '#2dd4bf', width: 3, dashArray: '', shadow: { enabled: false, color: '#ffffff', blur: 4, opacity: 0.2 } },
    },
    {
      id: '25G',
      name: '25 Gigabit',
      isBuiltIn: true,
      speedMbps: 25000,
      light: { color: '#3b82f6', width: 4, dashArray: '8,4', shadow: { enabled: false, color: '#000000', blur: 4, opacity: 0.3 } },
      dark: { color: '#60a5fa', width: 4, dashArray: '8,4', shadow: { enabled: false, color: '#ffffff', blur: 4, opacity: 0.2 } },
    },
    {
      id: '40G',
      name: '40 Gigabit',
      isBuiltIn: true,
      speedMbps: 40000,
      light: { color: '#a855f7', width: 5, dashArray: '', shadow: { enabled: false, color: '#000000', blur: 4, opacity: 0.3 } },
      dark: { color: '#c084fc', width: 5, dashArray: '', shadow: { enabled: false, color: '#ffffff', blur: 4, opacity: 0.2 } },
    },
    {
      id: '100G',
      name: '100 Gigabit',
      isBuiltIn: true,
      speedMbps: 100000,
      light: { color: '#6366f1', width: 6, dashArray: '', shadow: { enabled: false, color: '#000000', blur: 4, opacity: 0.3 } },
      dark: { color: '#818cf8', width: 6, dashArray: '', shadow: { enabled: false, color: '#ffffff', blur: 4, opacity: 0.2 } },
    },
    {
      id: 'Custom',
      name: 'Custom',
      isBuiltIn: true,
      speedMbps: null,
      light: { color: '#ec4899', width: 2, dashArray: '6,3', shadow: { enabled: false, color: '#000000', blur: 4, opacity: 0.3 } },
      dark: { color: '#f472b6', width: 2, dashArray: '6,3', shadow: { enabled: false, color: '#ffffff', blur: 4, opacity: 0.2 } },
    },
  ],
};

// Zod schema for LinkType validation
export const linkTypeShadowSchema = z.object({
  enabled: z.boolean(),
  color: z.string(),
  blur: z.number().min(0).max(20),
  opacity: z.number().min(0).max(1),
});

export const linkTypeThemeSchema = z.object({
  color: z.string(),
  width: z.number().min(1).max(8),
  dashArray: z.string(),
  shadow: linkTypeShadowSchema,
});

export const linkTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  isBuiltIn: z.boolean(),
  speedMbps: z.number().nullable(),
  light: linkTypeThemeSchema,
  dark: linkTypeThemeSchema,
});

export const linkTypeSettingsSchema = z.object({
  types: z.array(linkTypeSchema),
});

// ─── Device Groups ───────────────────────────────────────────────────────────
// Group devices for additive notification routing. A device may belong to many
// groups; each group routes alarms to its own channels and (optionally) its
// own on-duty rota with multiple per-day windows.

export const deviceGroups = pgTable("device_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  description: text("description"),
  color: text("color").notNull().default("#6366f1"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const deviceGroupMembers = pgTable("device_group_members", {
  groupId: varchar("group_id").notNull().references(() => deviceGroups.id, { onDelete: "cascade" }),
  deviceId: varchar("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: sql`PRIMARY KEY (${t.groupId}, ${t.deviceId})`,
}));

export const deviceGroupNotifications = pgTable("device_group_notifications", {
  groupId: varchar("group_id").notNull().references(() => deviceGroups.id, { onDelete: "cascade" }),
  notificationId: varchar("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: sql`PRIMARY KEY (${t.groupId}, ${t.notificationId})`,
}));

// One on-duty schedule per group (1:1). Created lazily.
export const dutySchedules = pgTable("duty_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupId: varchar("group_id").notNull().unique().references(() => deviceGroups.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("UTC"),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Named time windows within a schedule. dayOfWeek = null means "every day".
// 0=Sun…6=Sat. A day-specific window overrides the wildcard for that day.
export const dutyScheduleWindows = pgTable("duty_schedule_windows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scheduleId: varchar("schedule_id").notNull().references(() => dutySchedules.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  startTime: text("start_time").notNull(), // "HH:MM" 24h
  endTime: text("end_time").notNull(),     // "HH:MM" 24h; may cross midnight
  dayOfWeek: integer("day_of_week"),       // null = every day
  // Biweekly recurrence within the schedule's timezone:
  //   "all"  → every ISO week (default; backwards compatible)
  //   "odd"  → only ISO weeks where weekNumber % 2 === 1
  //   "even" → only ISO weeks where weekNumber % 2 === 0
  weekParity: text("week_parity").notNull().default("all"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const dutyWindowUsers = pgTable("duty_window_users", {
  windowId: varchar("window_id").notNull().references(() => dutyScheduleWindows.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (t) => ({
  pk: sql`PRIMARY KEY (${t.windowId}, ${t.userId})`,
}));

export const insertDeviceGroupSchema = createInsertSchema(deviceGroups).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDeviceGroupMemberSchema = createInsertSchema(deviceGroupMembers).omit({
  createdAt: true,
});

export const insertDeviceGroupNotificationSchema = createInsertSchema(deviceGroupNotifications).omit({
  createdAt: true,
});

export const insertDutyScheduleSchema = createInsertSchema(dutySchedules).omit({
  id: true,
  updatedAt: true,
});

export const insertDutyScheduleWindowSchema = createInsertSchema(dutyScheduleWindows).omit({
  id: true,
}).extend({
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  weekParity: z.enum(["all", "odd", "even"]).optional(),
});

export const insertDutyWindowUserSchema = createInsertSchema(dutyWindowUsers);

export type DeviceGroup = typeof deviceGroups.$inferSelect;
export type InsertDeviceGroup = z.infer<typeof insertDeviceGroupSchema>;
export type DeviceGroupMember = typeof deviceGroupMembers.$inferSelect;
export type InsertDeviceGroupMember = z.infer<typeof insertDeviceGroupMemberSchema>;
export type DeviceGroupNotification = typeof deviceGroupNotifications.$inferSelect;
export type InsertDeviceGroupNotification = z.infer<typeof insertDeviceGroupNotificationSchema>;
export type DutySchedule = typeof dutySchedules.$inferSelect;
export type InsertDutySchedule = z.infer<typeof insertDutyScheduleSchema>;
export type DutyScheduleWindow = typeof dutyScheduleWindows.$inferSelect;
export type InsertDutyScheduleWindow = z.infer<typeof insertDutyScheduleWindowSchema>;
export type DutyWindowUser = typeof dutyWindowUsers.$inferSelect;
export type InsertDutyWindowUser = z.infer<typeof insertDutyWindowUserSchema>;
