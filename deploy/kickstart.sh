#!/bin/bash
set -e

#===============================================================================
# CoreBit Network Manager - Kickstart Installer
# 
# One-line install:
#   curl -fsSL https://your-server.com/corebit/install.sh | sudo bash
#
# Or download and run:
#   wget https://your-server.com/corebit/kickstart.sh
#   chmod +x kickstart.sh
#   sudo ./kickstart.sh
#
# Options:
#   --update          Update existing installation
#   --beta            Include pre-releases (get newest version including beta/test releases)
#   --uninstall       Remove the application (preserves database)
#   --purge           Used with --uninstall to also drop database and user
#   --no-db           Skip database setup (use external database)
#   --db-host HOST    PostgreSQL host (default: localhost)
#   --db-port PORT    PostgreSQL port (default: 5432)
#   --db-name NAME    Database name (default: corebit)
#   --db-user USER    Database user (default: corebit)
#   --db-pass PASS    Database password (will prompt if not provided)
#   --port PORT       Application port (default: 3000)
#   --licensing-url   Licensing server URL (default: https://licensing.corebit.ease.dk)
#   --verbose         Show detailed output for debugging
#   --run-as-root     Run service as root (fixes network issues on some systems)
#===============================================================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default configuration
INSTALL_DIR="/opt/corebit"
SERVICE_NAME="corebit"
SERVICE_USER="corebit"
APP_PORT=3000
DB_HOST="localhost"
DB_PORT=5432
DB_NAME="corebit"
DB_USER="corebit"
LICENSING_URL="https://licensing.corebit.ease.dk"
DOWNLOAD_URL="${DOWNLOAD_URL:-${LICENSING_URL}/releases/latest.zip}"

# Parse command line arguments
UPDATE_MODE=false
UNINSTALL_MODE=false
PURGE_MODE=false
SKIP_DB=false
VERBOSE_MODE=false
RUN_AS_ROOT=false
BETA_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --update)
            UPDATE_MODE=true
            shift
            ;;
        --beta)
            BETA_MODE=true
            shift
            ;;
        --uninstall)
            UNINSTALL_MODE=true
            shift
            ;;
        --purge)
            PURGE_MODE=true
            shift
            ;;
        --no-db)
            SKIP_DB=true
            shift
            ;;
        --db-host)
            DB_HOST="$2"
            shift 2
            ;;
        --db-port)
            DB_PORT="$2"
            shift 2
            ;;
        --db-name)
            DB_NAME="$2"
            shift 2
            ;;
        --db-user)
            DB_USER="$2"
            shift 2
            ;;
        --db-pass)
            DB_PASSWORD="$2"
            shift 2
            ;;
        --port)
            APP_PORT="$2"
            shift 2
            ;;
        --url)
            DOWNLOAD_URL="$2"
            shift 2
            ;;
        --licensing-url)
            LICENSING_URL="$2"
            shift 2
            ;;
        --verbose|-v)
            VERBOSE_MODE=true
            shift
            ;;
        --run-as-root)
            RUN_AS_ROOT=true
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Apply beta flag to download URL if set - uses Beta channel instead of Stable
# Only apply to HTTP(S) URLs, not local paths
if [[ "$BETA_MODE" == "true" && "$DOWNLOAD_URL" == http* ]]; then
    # Use beta channel for download
    if [[ "$DOWNLOAD_URL" == *"?"* ]]; then
        DOWNLOAD_URL="${DOWNLOAD_URL}&channel=beta"
    else
        DOWNLOAD_URL="${DOWNLOAD_URL}?channel=beta"
    fi
fi

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_verbose() {
    if [ "$VERBOSE_MODE" = true ]; then
        echo -e "${YELLOW}[VERBOSE]${NC} $1"
    fi
}

# Run command with optional verbose output
run_cmd() {
    if [ "$VERBOSE_MODE" = true ]; then
        "$@"
    else
        "$@" >/dev/null 2>&1
    fi
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        VERSION=$VERSION_ID
    elif [ -f /etc/debian_version ]; then
        OS="debian"
    elif [ -f /etc/redhat-release ]; then
        OS="rhel"
    else
        log_error "Unsupported operating system"
        exit 1
    fi
    log_info "Detected OS: $OS $VERSION"
}

install_dependencies() {
    log_info "Installing system dependencies..."
    
    # Set apt verbosity based on verbose mode
    if [ "$VERBOSE_MODE" = true ]; then
        APT_OPTS="-y"
    else
        APT_OPTS="-y -qq"
    fi
    
    case $OS in
        ubuntu|debian)
            log_info "Updating package lists..."
            if [ "$VERBOSE_MODE" = true ]; then
                apt-get update || log_warning "Some package lists failed to update (non-critical third-party repos). Continuing..."
            else
                apt-get update -qq 2>&1 || log_warning "Some package lists failed to update (non-critical third-party repos). Continuing..."
            fi
            
            # Check for broken packages
            log_info "Checking for broken packages..."
            log_verbose "Running: dpkg --audit"
            if [ "$VERBOSE_MODE" = true ]; then
                dpkg --audit || true
                echo ""
                log_verbose "Running: apt-get check"
                apt-get check || true
                echo ""
            fi
            
            # Fix any broken packages first
            log_verbose "Running: apt-get -f install -y"
            if [ "$VERBOSE_MODE" = true ]; then
                apt-get -f install -y || true
            else
                apt-get -f install -y 2>/dev/null || true
            fi
            
            # Install packages one by one for better error handling
            log_info "Installing: curl wget unzip fping..."
            log_verbose "Running: apt-get install $APT_OPTS curl wget unzip fping"
            if ! apt-get install $APT_OPTS curl wget unzip fping; then
                log_error "Failed to install basic utilities."
                log_info "Try running manually: sudo apt-get -f install"
                if [ "$VERBOSE_MODE" != true ]; then
                    log_info "Run with --verbose to see detailed errors"
                fi
                exit 1
            fi
            
            log_info "Installing: postgresql postgresql-contrib..."
            log_verbose "Running: apt-get install $APT_OPTS postgresql postgresql-contrib"
            if ! apt-get install $APT_OPTS postgresql postgresql-contrib; then
                log_error "Failed to install PostgreSQL."
                log_info "Try running: sudo apt-get update && sudo apt-get -f install"
                if [ "$VERBOSE_MODE" != true ]; then
                    log_info "Run with --verbose to see detailed errors"
                fi
                exit 1
            fi
            
            # Check if nodejs is already installed with sufficient version
            if command -v node &> /dev/null; then
                NODE_VER=$(node -v 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
                if [ "$NODE_VER" -ge 18 ] 2>/dev/null; then
                    log_info "Node.js $NODE_VER already installed, skipping..."
                else
                    log_info "Node.js version too old, will install Node.js 20..."
                    install_nodejs
                fi
            else
                log_info "Installing Node.js..."
                log_verbose "Running: apt-get install $APT_OPTS nodejs npm"
                # Try distro package first, fall back to nodesource if version is old
                if ! apt-get install $APT_OPTS nodejs npm 2>/dev/null; then
                    log_verbose "Distro nodejs failed or too old, trying nodesource..."
                    install_nodejs
                fi
            fi
            ;;
        centos|rhel|fedora|rocky|almalinux)
            if command -v dnf &> /dev/null; then
                dnf install -y curl wget unzip fping postgresql-server postgresql nodejs npm
            else
                yum install -y curl wget unzip fping postgresql-server postgresql nodejs npm
            fi
            ;;
        *)
            log_error "Unsupported OS for automatic dependency installation"
            log_info "Please install manually: curl, wget, unzip, fping, postgresql, nodejs (v18+)"
            exit 1
            ;;
    esac
    
    # Check Node.js version
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        log_warning "Node.js version is too old. Installing Node.js 20..."
        install_nodejs
    fi
    
    log_success "Dependencies installed"
}

install_nodejs() {
    log_info "Installing Node.js 20 LTS from NodeSource..."
    
    case $OS in
        ubuntu|debian)
            log_verbose "Running: curl -fsSL https://deb.nodesource.com/setup_20.x | bash -"
            if [ "$VERBOSE_MODE" = true ]; then
                curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
            else
                curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
            fi
            
            log_verbose "Running: apt-get install -y nodejs"
            if [ "$VERBOSE_MODE" = true ]; then
                apt-get install -y nodejs
            else
                apt-get install -y -qq nodejs
            fi
            ;;
        centos|rhel|fedora|rocky|almalinux)
            log_verbose "Running: curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -"
            if [ "$VERBOSE_MODE" = true ]; then
                curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
            else
                curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
            fi
            
            if command -v dnf &> /dev/null; then
                dnf install -y nodejs
            else
                yum install -y nodejs
            fi
            ;;
    esac
}

prompt_for_password() {
    # Only prompt for password on fresh install (not update mode)
    if [ "$UPDATE_MODE" = true ]; then
        return
    fi
    
    # Skip if password was provided via command line
    if [ -n "$DB_PASSWORD" ]; then
        log_info "Using database password from command line"
        return
    fi
    
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Database Password Setup${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Please choose a database password for CoreBit."
    echo "This password is used internally by the application to connect to PostgreSQL."
    echo ""
    echo "Options:"
    echo "  1) Enter your own password"
    echo "  2) Auto-generate a secure password"
    echo ""
    
    read -p "Your choice [1/2, default: 2]: " PASS_CHOICE
    
    case "$PASS_CHOICE" in
        1)
            while true; do
                read -sp "Enter database password (min 8 characters): " USER_PASSWORD
                echo ""
                if [ ${#USER_PASSWORD} -lt 8 ]; then
                    echo -e "${RED}Password must be at least 8 characters. Try again.${NC}"
                    continue
                fi
                read -sp "Confirm password: " USER_PASSWORD_CONFIRM
                echo ""
                if [ "$USER_PASSWORD" != "$USER_PASSWORD_CONFIRM" ]; then
                    echo -e "${RED}Passwords do not match. Try again.${NC}"
                    continue
                fi
                DB_PASSWORD="$USER_PASSWORD"
                break
            done
            log_success "Using your provided password"
            ;;
        *)
            DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
            log_success "Generated secure password"
            echo ""
            echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo -e "${YELLOW}  IMPORTANT: Save this password! You will need it for database access.${NC}"
            echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo ""
            echo -e "  Database Password: ${GREEN}${DB_PASSWORD}${NC}"
            echo ""
            echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo ""
            read -p "Press Enter to continue once you have saved this password..."
            ;;
    esac
}

setup_postgresql() {
    if [ "$SKIP_DB" = true ]; then
        log_info "Skipping database setup (--no-db specified)"
        return
    fi
    
    log_info "Setting up PostgreSQL..."
    
    # Start PostgreSQL if not running
    case $OS in
        ubuntu|debian)
            systemctl enable postgresql
            systemctl start postgresql
            ;;
        centos|rhel|fedora|rocky|almalinux)
            postgresql-setup --initdb 2>/dev/null || true
            systemctl enable postgresql
            systemctl start postgresql
            ;;
    esac
    
    # Configure PostgreSQL for better concurrency (needed for high-performance probing)
    log_info "Configuring PostgreSQL for optimal performance..."
    
    # Find postgresql.conf location
    PG_CONF=""
    if [ -f /etc/postgresql/*/main/postgresql.conf ]; then
        PG_CONF=$(ls /etc/postgresql/*/main/postgresql.conf 2>/dev/null | head -1)
    elif [ -f /var/lib/pgsql/data/postgresql.conf ]; then
        PG_CONF="/var/lib/pgsql/data/postgresql.conf"
    fi
    
    if [ -n "$PG_CONF" ] && [ -f "$PG_CONF" ]; then
        # Check current max_connections
        CURRENT_MAX=$(grep "^max_connections" "$PG_CONF" | awk -F'=' '{print $2}' | tr -d ' ')
        DESIRED_MAX=200
        
        if [ -z "$CURRENT_MAX" ] || [ "$CURRENT_MAX" -lt "$DESIRED_MAX" ]; then
            log_info "Increasing max_connections from ${CURRENT_MAX:-100} to $DESIRED_MAX..."
            
            # Backup config
            cp "$PG_CONF" "${PG_CONF}.backup.$(date +%Y%m%d%H%M%S)"
            
            # Update or add max_connections
            if grep -q "^max_connections" "$PG_CONF"; then
                sed -i "s/^max_connections.*/max_connections = $DESIRED_MAX/" "$PG_CONF"
            else
                echo "max_connections = $DESIRED_MAX" >> "$PG_CONF"
            fi
            
            # Increase shared_buffers if default (usually 128MB)
            if ! grep -q "^shared_buffers" "$PG_CONF" || grep -q "^shared_buffers = 128MB" "$PG_CONF"; then
                sed -i "s/^shared_buffers.*/shared_buffers = 256MB/" "$PG_CONF" 2>/dev/null || \
                    echo "shared_buffers = 256MB" >> "$PG_CONF"
            fi
            
            # Restart PostgreSQL to apply changes
            log_info "Restarting PostgreSQL to apply configuration..."
            systemctl restart postgresql
            sleep 2
            
            log_success "PostgreSQL configured with max_connections=$DESIRED_MAX"
        else
            log_info "PostgreSQL already configured with max_connections=$CURRENT_MAX"
        fi
    else
        log_warning "Could not find postgresql.conf - manual configuration may be needed"
        log_info "To increase connection limit, edit postgresql.conf and set max_connections = 200"
    fi
    
    # Check if we have existing credentials from backup (for update mode)
    if [ -f "/tmp/corebit.env.backup" ]; then
        # Extract existing password from backup
        EXISTING_PW=$(grep "^PGPASSWORD=" /tmp/corebit.env.backup 2>/dev/null | cut -d'=' -f2)
        if [ -n "$EXISTING_PW" ]; then
            DB_PASSWORD="$EXISTING_PW"
            log_info "Using existing database password from current installation"
        fi
    fi
    
    # If still no password (fresh install), prompt user or generate
    if [ -z "$DB_PASSWORD" ]; then
        prompt_for_password
    fi
    
    # Create database and user
    sudo -u postgres psql <<EOF
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_USER}') THEN
        CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';
    ELSE
        ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
    END IF;
END
\$\$;

SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
EOF

    # Enable pgcrypto extension for gen_random_uuid() function
    log_info "Enabling pgcrypto extension..."
    sudo -u postgres psql -d "${DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;" 2>/dev/null || true

    log_success "PostgreSQL configured"
}

create_user() {
    if [ "$RUN_AS_ROOT" = true ]; then
        log_info "Skipping service user creation (running as root)"
        return
    fi
    
    log_info "Creating service user..."
    
    if ! id "$SERVICE_USER" &>/dev/null; then
        useradd --system --home-dir "$INSTALL_DIR" --shell /bin/false "$SERVICE_USER"
        log_success "Created user: $SERVICE_USER"
    else
        log_info "User $SERVICE_USER already exists"
    fi
}

download_application() {
    log_info "Downloading application..."
    
    # Create temp directory
    TEMP_DIR=$(mktemp -d)
    cd "$TEMP_DIR"
    
    # Download the release
    # Check for .zip or .tar.gz, accounting for query strings like ?channel=beta
    if [[ "$DOWNLOAD_URL" == *.zip* ]]; then
        wget -q "$DOWNLOAD_URL" -O release.zip
        unzip -q release.zip
        rm release.zip
    elif [[ "$DOWNLOAD_URL" == *.tar.gz* ]]; then
        wget -q "$DOWNLOAD_URL" -O release.tar.gz
        tar -xzf release.tar.gz
        rm release.tar.gz
    else
        # Assume it's a directory path (local install)
        cp -r "$DOWNLOAD_URL"/* .
    fi
    
    # Find extracted directory (handle nested directories)
    if [ -d "corebit" ]; then
        cd corebit
    fi
    
    log_success "Application downloaded"
}

# Create vendor MIB folder structure for OID resolution
setup_vendor_mibs() {
    log_info "Setting up vendor MIB structure..."
    
    local MIB_DIR="$INSTALL_DIR/data/mibs"
    local VENDOR_DIR="$MIB_DIR/vendors"
    
    # Create vendor directories
    mkdir -p "$VENDOR_DIR"/{mikrotik,brocade,cisco,hp,juniper,dell,ubiquiti,synology,qnap,apc,netgear,fortinet,common}
    
    # Create vendor-index.json if it doesn't exist
    if [ ! -f "$VENDOR_DIR/vendor-index.json" ]; then
        log_verbose "Creating vendor-index.json..."
        cat > "$VENDOR_DIR/vendor-index.json" << 'VENDOR_INDEX_EOF'
{
  "version": "1.0",
  "description": "Vendor MIB index for SNMP OID resolution. Similar to LibreNMS/Zabbix MIB organization.",
  "vendors": {
    "mikrotik": {
      "name": "MikroTik",
      "description": "MikroTik RouterOS devices",
      "oidPrefixes": ["1.3.6.1.4.1.14988"],
      "sysObjectIdPatterns": ["1.3.6.1.4.1.14988.*"],
      "mibFiles": ["MIKROTIK-MIB.mib"]
    },
    "brocade": {
      "name": "Brocade",
      "description": "Brocade/Broadcom switches and SAN equipment",
      "oidPrefixes": ["1.3.6.1.4.1.1588", "1.3.6.1.4.1.1991"],
      "sysObjectIdPatterns": ["1.3.6.1.4.1.1588.*", "1.3.6.1.4.1.1991.*"],
      "mibFiles": ["BROCADE-PRODUCTS-MIB.txt"]
    },
    "cisco": {
      "name": "Cisco",
      "description": "Cisco networking equipment",
      "oidPrefixes": ["1.3.6.1.4.1.9"],
      "sysObjectIdPatterns": ["1.3.6.1.4.1.9.*"],
      "mibFiles": []
    },
    "hp": {
      "name": "HP/HPE",
      "description": "HP and HPE networking and server equipment (including Aruba, iLO)",
      "oidPrefixes": ["1.3.6.1.4.1.11", "1.3.6.1.4.1.232", "1.3.6.1.4.1.14823"],
      "sysObjectIdPatterns": ["1.3.6.1.4.1.11.*", "1.3.6.1.4.1.232.*", "1.3.6.1.4.1.14823.*"],
      "mibFiles": []
    },
    "juniper": {
      "name": "Juniper",
      "description": "Juniper Networks equipment",
      "oidPrefixes": ["1.3.6.1.4.1.2636"],
      "sysObjectIdPatterns": ["1.3.6.1.4.1.2636.*"],
      "mibFiles": []
    },
    "dell": {
      "name": "Dell",
      "description": "Dell networking and server equipment",
      "oidPrefixes": ["1.3.6.1.4.1.674"],
      "sysObjectIdPatterns": ["1.3.6.1.4.1.674.*"],
      "mibFiles": []
    },
    "ubiquiti": {
      "name": "Ubiquiti",
      "description": "Ubiquiti Networks (UniFi, EdgeMax)",
      "oidPrefixes": ["1.3.6.1.4.1.41112"],
      "sysObjectIdPatterns": ["1.3.6.1.4.1.41112.*"],
      "mibFiles": []
    },
    "synology": {
      "name": "Synology",
      "description": "Synology NAS devices",
      "oidPrefixes": ["1.3.6.1.4.1.6574"],
      "sysObjectIdPatterns": ["1.3.6.1.4.1.6574.*"],
      "mibFiles": []
    },
    "qnap": {
      "name": "QNAP",
      "description": "QNAP NAS devices",
      "oidPrefixes": ["1.3.6.1.4.1.24681"],
      "sysObjectIdPatterns": ["1.3.6.1.4.1.24681.*"],
      "mibFiles": []
    },
    "apc": {
      "name": "APC/Schneider",
      "description": "APC UPS and PDU equipment",
      "oidPrefixes": ["1.3.6.1.4.1.318"],
      "sysObjectIdPatterns": ["1.3.6.1.4.1.318.*"],
      "mibFiles": []
    },
    "netgear": {
      "name": "Netgear",
      "description": "Netgear networking equipment",
      "oidPrefixes": ["1.3.6.1.4.1.4526"],
      "sysObjectIdPatterns": ["1.3.6.1.4.1.4526.*"],
      "mibFiles": []
    },
    "fortinet": {
      "name": "Fortinet",
      "description": "Fortinet FortiGate and FortiSwitch",
      "oidPrefixes": ["1.3.6.1.4.1.12356"],
      "sysObjectIdPatterns": ["1.3.6.1.4.1.12356.*"],
      "mibFiles": []
    },
    "common": {
      "name": "Common/Standard",
      "description": "Standard MIBs (IF-MIB, RFC1213, SNMPv2-MIB, etc.) - always loaded",
      "oidPrefixes": ["1.3.6.1.2.1"],
      "sysObjectIdPatterns": [],
      "mibFiles": [],
      "alwaysLoad": true
    }
  }
}
VENDOR_INDEX_EOF
        log_verbose "Created vendor-index.json"
    fi
    
    # Set ownership
    chown -R corebit:corebit "$VENDOR_DIR" 2>/dev/null || true
    
    log_success "Vendor MIB structure ready"
}

backup_existing() {
    if [ -d "$INSTALL_DIR" ]; then
        log_info "Backing up existing configuration..."
        
        # Backup .env file
        if [ -f "$INSTALL_DIR/.env" ]; then
            cp "$INSTALL_DIR/.env" "/tmp/corebit.env.backup"
            log_verbose "Backed up .env configuration"
        fi
        
        # Backup license.json file (contains activated license keys)
        if [ -f "$INSTALL_DIR/license.json" ]; then
            cp "$INSTALL_DIR/license.json" "/tmp/corebit.license.backup"
            log_verbose "Backed up license.json"
        fi
        
        # Note: We no longer copy the data directory during updates.
        # The data directory contains user backups which can be very large.
        # Since we're doing an in-place update, the data directory is preserved automatically.
        
        log_success "Configuration backed up"
    fi
}

install_application() {
    log_info "Installing application to $INSTALL_DIR..."
    
    # Show target build number from downloaded version.json
    if [ -f "version.json" ]; then
        NEW_BUILD=$(grep -o '"buildNumber":[^,}]*' version.json 2>/dev/null | cut -d: -f2 | tr -d ' ')
        if [ -n "$NEW_BUILD" ]; then
            log_info "Installing build: $NEW_BUILD"
        fi
    fi
    
    # Create install directory
    mkdir -p "$INSTALL_DIR"
    
    # Copy files (exclude node_modules if present in source - we'll run npm install)
    # Using rsync for efficiency: only copy changed files, exclude large dirs
    if command -v rsync &> /dev/null; then
        rsync -a --delete \
            --exclude 'node_modules' \
            --exclude 'data' \
            --exclude '.env' \
            --exclude 'license.json' \
            --exclude 'backups' \
            --exclude 'plugins' \
            . "$INSTALL_DIR/"
        log_verbose "Files synced using rsync"
    else
        # Fallback to cp if rsync not available
        # First remove old files except preserved directories
        find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 \
            ! -name 'node_modules' \
            ! -name 'data' \
            ! -name '.env' \
            ! -name 'license.json' \
            ! -name 'backups' \
            ! -name 'plugins' \
            -exec rm -rf {} + 2>/dev/null || true
        
        # Copy new files
        for item in *; do
            if [ "$item" != "node_modules" ] && [ "$item" != "data" ] && [ "$item" != ".env" ] && [ "$item" != "license.json" ] && [ "$item" != "backups" ] && [ "$item" != "plugins" ]; then
                cp -r "$item" "$INSTALL_DIR/"
            fi
        done
        log_verbose "Files copied using cp"
    fi
    
    # Restore .env if exists (was backed up earlier)
    if [ -f "/tmp/corebit.env.backup" ]; then
        cp "/tmp/corebit.env.backup" "$INSTALL_DIR/.env"
        log_info "Restored existing .env configuration"
    fi
    
    # Restore license.json if backup exists (preserves activated license keys during updates)
    if [ -f "/tmp/corebit.license.backup" ]; then
        cp "/tmp/corebit.license.backup" "$INSTALL_DIR/license.json"
        log_info "Restored license.json"
    fi
    
    # Note: data directory is preserved in place, no need to restore
    
    cd "$INSTALL_DIR"
    
    # Install npm dependencies
    log_info "Installing Node.js dependencies (this may take a few minutes)..."
    log_verbose "Running: npm install --production"
    
    # Set npm to use less memory on constrained systems
    export NODE_OPTIONS="--max-old-space-size=512"
    
    # Use a temp file to capture output and reliably check exit code
    NPM_LOG="/tmp/corebit-npm-install.log"
    
    if [ "$VERBOSE_MODE" = true ]; then
        npm install --legacy-peer-deps --loglevel info 2>&1 | tee "$NPM_LOG"
        NPM_EXIT=${PIPESTATUS[0]}
    else
        # Run npm and capture output (--legacy-peer-deps avoids peer dependency conflicts)
        if npm install --legacy-peer-deps > "$NPM_LOG" 2>&1; then
            NPM_EXIT=0
        else
            NPM_EXIT=$?
        fi
    fi
    
    if [ $NPM_EXIT -ne 0 ]; then
        log_error "npm install failed with exit code $NPM_EXIT"
        log_error "Last 20 lines of npm output:"
        tail -20 "$NPM_LOG" 2>/dev/null || true
        echo ""
        log_info "Full log at: $NPM_LOG"
        log_info "Try running manually: cd $INSTALL_DIR && npm install --production"
        exit 1
    fi
    
    rm -f "$NPM_LOG"
    log_success "Node.js dependencies installed"
    
    # Create plugins directory if it doesn't exist (preserved across upgrades)
    mkdir -p "$INSTALL_DIR/plugins"
    if [ "$RUN_AS_ROOT" != true ]; then
        chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/plugins" 2>/dev/null || true
    fi
    
    # Set ownership (skip if running as root)
    if [ "$RUN_AS_ROOT" != true ]; then
        chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    fi
    
    log_success "Application installed"
}

configure_environment() {
    log_info "Configuring environment..."
    
    ENV_FILE="$INSTALL_DIR/.env"
    
    # Only create .env if it doesn't exist
    if [ ! -f "$ENV_FILE" ]; then
        # Generate session secret
        SESSION_SECRET=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
        ENCODED_DB_PASSWORD=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$DB_PASSWORD" 2>/dev/null || echo "$DB_PASSWORD")
        
        cat > "$ENV_FILE" <<EOF
# CoreBit Network Manager - Configuration
# Generated on $(date)

# Server Configuration
NODE_ENV=production
PORT=${APP_PORT}
HOST=0.0.0.0

# Database Configuration
DATABASE_URL=postgresql://${DB_USER}:${ENCODED_DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}
PGHOST=${DB_HOST}
PGPORT=${DB_PORT}
PGDATABASE=${DB_NAME}
PGUSER=${DB_USER}
PGPASSWORD=${DB_PASSWORD}

# Session Configuration
SESSION_SECRET=${SESSION_SECRET}

# Licensing Configuration
LICENSING_SERVER_URL=${LICENSING_URL}

# Optional: SNMP Configuration
# SNMP_COMMUNITY=public
# SNMP_TIMEOUT=5000

# Optional: Database Pool Configuration (adjust for your PostgreSQL max_connections)
# Default: 50, increase if you have many devices and sufficient PostgreSQL connections
# DB_POOL_MAX=50
# DB_POOL_MIN=5

# Optional: External access (set to your domain/IP)
# BASE_URL=https://your-domain.com

# Plugin directory — plugins dropped here are loaded on startup
PLUGIN_DIR=${INSTALL_DIR}/plugins
EOF
        
        chmod 600 "$ENV_FILE"
        if [ "$RUN_AS_ROOT" != true ]; then
            chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
        fi
        log_success "Environment configured"
    else
        log_info "Existing .env preserved"
    fi
}

run_migrations() {
    log_info "Running database migrations..."
    
    cd "$INSTALL_DIR"
    
    # Apply all schema changes directly via SQL to avoid drizzle-kit's
    # interactive prompts which can abort all changes when there are
    # timestamp type mismatches (cosmetic, not functional).
    
    log_info "Applying schema updates via SQL..."
    
    # Get DATABASE_URL from .env file
    if [ -f "$INSTALL_DIR/.env" ]; then
        DB_URL=$(grep -E "^DATABASE_URL=" "$INSTALL_DIR/.env" | cut -d'=' -f2-)
        if [ -n "$DB_URL" ]; then
            # Apply all critical column additions that must exist for the application to work
            # These are additive changes that are always safe
            psql "$DB_URL" <<'EOSQL' 2>/dev/null || true
-- ============================================================
-- COREBIT DATABASE MIGRATION SCRIPT
-- Last schema sync: January 2025
-- This script adds all columns/tables that may be missing when
-- upgrading from older versions. All statements use IF NOT EXISTS
-- ============================================================

-- Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- or ADD COLUMN IF NOT EXISTS for safe idempotent execution.
-- ============================================================

-- ============================================================
-- BASE TABLES (required for fresh installations)
-- These are the core tables the application needs to run
-- ============================================================

-- User sessions table (for express-session)
CREATE TABLE IF NOT EXISTS user_sessions (
    sid VARCHAR PRIMARY KEY,
    sess JSONB NOT NULL,
    expire TIMESTAMPTZ(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON user_sessions(expire);

-- Maps table
CREATE TABLE IF NOT EXISTS maps (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    description TEXT,
    is_default BOOLEAN DEFAULT false NOT NULL,
    background_color TEXT,
    grid_visible BOOLEAN DEFAULT true NOT NULL,
    is_locked BOOLEAN DEFAULT false NOT NULL,
    layout_kind TEXT DEFAULT 'canvas',
    map_style TEXT DEFAULT 'auto',
    geo_marker_style TEXT DEFAULT 'detailed',
    geo_marker_thresholds JSONB,
    default_center JSONB,
    default_zoom INTEGER,
    public_share_enabled BOOLEAN DEFAULT false NOT NULL,
    public_share_token TEXT,
    auto_create_connections BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Credential profiles table (new schema with type and credentials JSONB)
CREATE TABLE IF NOT EXISTS credential_profiles (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'mikrotik',
    credentials JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT settings_key_unique UNIQUE (key)
);

-- Users table (core authentication)
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'viewer' NOT NULL,
    display_name TEXT,
    email TEXT,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    totp_secret TEXT,
    totp_enabled BOOLEAN DEFAULT false NOT NULL,
    totp_configured BOOLEAN DEFAULT false NOT NULL,
    totp_backup_codes TEXT[],
    force_password_change BOOLEAN DEFAULT false NOT NULL
);

-- Devices table
CREATE TABLE IF NOT EXISTS devices (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    ip_address TEXT,
    status TEXT DEFAULT 'unknown' NOT NULL,
    last_seen TIMESTAMPTZ,
    probe_timeout INTEGER,
    offline_threshold INTEGER,
    failure_count INTEGER DEFAULT 0,
    device_data JSONB,
    credential_profile_id VARCHAR REFERENCES credential_profiles(id) ON DELETE SET NULL,
    linked_map_id VARCHAR REFERENCES maps(id) ON DELETE SET NULL,
    custom_credentials JSONB,
    use_on_duty BOOLEAN DEFAULT false NOT NULL,
    muted_until TIMESTAMPTZ,
    placeholder_kind TEXT,
    placeholder_content TEXT,
    placeholder_date_format TEXT,
    placeholder_date_timezone TEXT,
    at_a_glance_content TEXT,
    submap_shape VARCHAR,
    submap_size VARCHAR,
    submap_bg_color TEXT,
    status_changed_at TIMESTAMPTZ,
    stale_notified_at TIMESTAMPTZ,
    metrics_retention_hours INTEGER,
    last_probe_error TEXT,
    polling_interface_id VARCHAR,
    polling_address_id VARCHAR,
    parent_device_id VARCHAR,
    mac_table_refresh_interval INTEGER,
    mac_table_last_refresh TIMESTAMPTZ,
    manufacturer TEXT,
    device_model TEXT,
    serial_number TEXT,
    asset_tag TEXT,
    site TEXT,
    location TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    rack_name TEXT,
    rack_unit INTEGER,
    rack_side TEXT,
    rack_height INTEGER,
    rack_depth TEXT,
    image_url TEXT,
    image_data TEXT,
    hardware_library_id VARCHAR,
    device_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Hardware Library table (device model images and metadata)
CREATE TABLE IF NOT EXISTS hardware_library (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    manufacturer TEXT NOT NULL,
    model TEXT NOT NULL,
    hardware_version TEXT,
    device_type TEXT,
    image_url TEXT,
    image_data TEXT,
    rack_mountable BOOLEAN NOT NULL DEFAULT true,
    default_rack_height INTEGER,
    default_rack_depth TEXT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hardware_library_manufacturer_model ON hardware_library(manufacturer, model);
ALTER TABLE hardware_library ADD COLUMN IF NOT EXISTS rack_mountable BOOLEAN NOT NULL DEFAULT true;

-- API Keys table (external API access with access level control)
CREATE TABLE IF NOT EXISTS api_keys (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(128) NOT NULL,
    key_prefix VARCHAR(20) NOT NULL,
    access_level VARCHAR(20) NOT NULL DEFAULT 'read',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'webhook' NOT NULL,
    url TEXT,
    method TEXT DEFAULT 'POST',
    config JSONB,
    message_template TEXT NOT NULL,
    enabled BOOLEAN DEFAULT true NOT NULL,
    ignore_stale_to_online BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Device notifications junction table
CREATE TABLE IF NOT EXISTS device_notifications (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    notification_id VARCHAR NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Notification history
CREATE TABLE IF NOT EXISTS notification_history (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    notification_id VARCHAR NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    old_status TEXT,
    new_status TEXT NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Logs table
CREATE TABLE IF NOT EXISTS logs (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    device_id VARCHAR REFERENCES devices(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    severity TEXT DEFAULT 'info' NOT NULL,
    message TEXT NOT NULL,
    old_status TEXT,
    new_status TEXT,
    metadata JSONB
);

-- Device placements (device positions on maps)
CREATE TABLE IF NOT EXISTS device_placements (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    map_id VARCHAR NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    position JSONB NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    linked_map_id VARCHAR REFERENCES maps(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_placements_geo ON device_placements(map_id, latitude, longitude);

-- Connections between devices
CREATE TABLE IF NOT EXISTS connections (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    map_id VARCHAR NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    source_device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    target_device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    source_port TEXT,
    target_port TEXT,
    connection_type TEXT DEFAULT 'ethernet',
    link_speed TEXT DEFAULT '1G',
    curve_mode TEXT DEFAULT 'straight',
    curve_offset INTEGER DEFAULT 0,
    monitor_interface TEXT,
    monitor_snmp_index INTEGER,
    monitor_custom_device_id TEXT,
    monitor_custom_port TEXT,
    flip_traffic_direction BOOLEAN DEFAULT false,
    link_stats JSONB,
    is_dynamic BOOLEAN DEFAULT false,
    dynamic_type TEXT,
    dynamic_metadata JSONB,
    warning_threshold_pct INTEGER DEFAULT 70,
    critical_threshold_pct INTEGER DEFAULT 90,
    label_position INTEGER DEFAULT 50,
    custom_link_speed_mbps INTEGER,
    custom_line_color TEXT,
    custom_line_width INTEGER,
    custom_line_pattern TEXT,
    dynamic_config JSONB,
    show_bandwidth BOOLEAN DEFAULT false,
    mac_validated BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Scan profiles
CREATE TABLE IF NOT EXISTS scan_profiles (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    ip_range TEXT NOT NULL,
    credential_profile_ids TEXT[] NOT NULL,
    probe_types TEXT[] NOT NULL,
    is_default BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Backups table
CREATE TABLE IF NOT EXISTS backups (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'completed' NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- USER AUTHENTICATION & 2FA (added in v1.x)
-- ============================================================
-- Users table 2FA and security columns (for upgrades from older versions)
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_configured BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_backup_codes TEXT[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN DEFAULT false NOT NULL;

-- ============================================================
-- SETTINGS TABLE - Add named unique constraint (for drizzle compatibility)
-- ============================================================
DO $$
BEGIN
    -- Add named constraint if it doesn't exist (fresh installs have it, upgrades need it)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'settings_key_unique'
    ) THEN
        -- First drop the unnamed unique constraint if it exists
        ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_key_key;
        -- Add the named constraint
        ALTER TABLE settings ADD CONSTRAINT settings_key_unique UNIQUE (key);
    END IF;
END $$;

-- Trusted devices table for "remember this device" functionality
CREATE TABLE IF NOT EXISTS trusted_devices (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_token TEXT NOT NULL UNIQUE,
    device_name TEXT,
    ip_address TEXT,
    last_used_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

-- ============================================================
-- PORT LOCKS (added in v1.x)
-- ============================================================
CREATE TABLE IF NOT EXISTS port_locks (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    port_name TEXT NOT NULL,
    locked_by VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    locked_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    reason TEXT
);

-- ============================================================
-- DEVICE STACKING & PLACEHOLDER FEATURES
-- ============================================================
ALTER TABLE devices ADD COLUMN IF NOT EXISTS parent_device_id TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS placeholder_content TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS placeholder_kind TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS placeholder_date_format TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS placeholder_date_timezone TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS at_a_glance_content TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS submap_shape VARCHAR;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS submap_size VARCHAR;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS submap_bg_color TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS linked_map_id VARCHAR REFERENCES maps(id) ON DELETE SET NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS probe_timeout INTEGER;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS offline_threshold INTEGER;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS failure_count INTEGER DEFAULT 0;

-- ============================================================
-- DEVICE MONITORING ENHANCEMENTS
-- ============================================================
ALTER TABLE devices ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS stale_notified_at TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS metrics_retention_hours INTEGER;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_probe_error TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS polling_interface_id TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS polling_address_id TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS use_on_duty BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS mac_table_refresh_interval INTEGER;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS mac_table_last_refresh TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS manufacturer TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_model TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS serial_number TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS asset_tag TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS site TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS rack_name TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS rack_unit INTEGER;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS rack_side TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS rack_height INTEGER;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS rack_depth TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS image_data TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS hardware_library_id VARCHAR;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_notes TEXT;

-- ============================================================
-- CONNECTION APPEARANCE CUSTOMIZATION
-- ============================================================
ALTER TABLE connections ADD COLUMN IF NOT EXISTS custom_line_color TEXT;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS custom_line_width INTEGER;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS custom_line_pattern TEXT;

-- ============================================================
-- DEVICE METRICS HISTORY
-- ============================================================
ALTER TABLE device_metrics_history ADD COLUMN IF NOT EXISTS poll_duration_ms INTEGER;
ALTER TABLE device_metrics_history ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE device_metrics_history ADD COLUMN IF NOT EXISTS cpu_usage_pct INTEGER;
ALTER TABLE device_metrics_history ADD COLUMN IF NOT EXISTS memory_usage_pct INTEGER;
ALTER TABLE device_metrics_history ADD COLUMN IF NOT EXISTS disk_usage_pct INTEGER;
ALTER TABLE device_metrics_history ADD COLUMN IF NOT EXISTS ping_rtt INTEGER;

-- Backfill timestamp from recorded_at if legacy column exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_metrics_history' AND column_name = 'recorded_at') THEN
        UPDATE device_metrics_history SET timestamp = recorded_at WHERE timestamp IS NULL AND recorded_at IS NOT NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_metrics_history' AND column_name = 'cpu_load') THEN
        UPDATE device_metrics_history SET cpu_usage_pct = ROUND(cpu_load) WHERE cpu_usage_pct IS NULL AND cpu_load IS NOT NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_metrics_history' AND column_name = 'memory_usage') THEN
        UPDATE device_metrics_history SET memory_usage_pct = ROUND(memory_usage) WHERE memory_usage_pct IS NULL AND memory_usage IS NOT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_device_metrics_device_time ON device_metrics_history(device_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_device_metrics_timestamp ON device_metrics_history(timestamp);

-- ============================================================
-- ALARM MUTES (added in v1.x)
-- ============================================================
CREATE TABLE IF NOT EXISTS alarm_mutes (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
    muted_by VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mute_until TIMESTAMPTZ,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- DUTY SHIFT CONFIGURATION (added in v1.x)
-- ============================================================
CREATE TABLE IF NOT EXISTS duty_shift_config (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    day_shift_start TEXT DEFAULT '07:00' NOT NULL,
    day_shift_end TEXT DEFAULT '19:00' NOT NULL,
    night_shift_start TEXT DEFAULT '19:00' NOT NULL,
    night_shift_end TEXT DEFAULT '07:00' NOT NULL,
    timezone TEXT DEFAULT 'UTC' NOT NULL,
    rotation_weeks INTEGER DEFAULT 4 NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- DUTY USER SCHEDULES (added in v1.x)
-- ============================================================
CREATE TABLE IF NOT EXISTS duty_user_schedules (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shift TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- DEVICE STATUS EVENTS (added in v1.x)
-- ============================================================
CREATE TABLE IF NOT EXISTS device_status_events (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- USER NOTIFICATION CHANNELS (added in v1.x)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_notification_channels (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}',
    enabled BOOLEAN DEFAULT true NOT NULL,
    ignore_stale_to_online BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- LICENSES TABLE (added in v1.x)
-- ============================================================
CREATE TABLE IF NOT EXISTS licenses (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    license_key TEXT NOT NULL UNIQUE,
    tier TEXT NOT NULL DEFAULT 'free',
    fingerprint TEXT NOT NULL,
    device_limit INTEGER DEFAULT 10,
    purchase_date TIMESTAMPTZ,
    updates_valid_until TIMESTAMPTZ,
    stripe_session_id TEXT,
    stripe_customer_id TEXT,
    activated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- PING TARGETS & HISTORY (added in v1.x)
-- ============================================================
CREATE TABLE IF NOT EXISTS ping_targets (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    ip_address TEXT NOT NULL,
    label TEXT,
    interface_name TEXT,
    enabled BOOLEAN DEFAULT true NOT NULL,
    probe_count INTEGER DEFAULT 20 NOT NULL,
    interval_seconds INTEGER DEFAULT 30 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ping_targets_device ON ping_targets(device_id);
CREATE INDEX IF NOT EXISTS idx_ping_targets_enabled ON ping_targets(enabled);

CREATE TABLE IF NOT EXISTS ping_history (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    target_id VARCHAR NOT NULL REFERENCES ping_targets(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    sent INTEGER NOT NULL,
    received INTEGER NOT NULL,
    loss_pct DOUBLE PRECISION NOT NULL,
    rtt_min DOUBLE PRECISION,
    rtt_max DOUBLE PRECISION,
    rtt_avg DOUBLE PRECISION,
    rtt_mdev DOUBLE PRECISION,
    rtt_p10 DOUBLE PRECISION,
    rtt_p25 DOUBLE PRECISION,
    rtt_p50 DOUBLE PRECISION,
    rtt_p75 DOUBLE PRECISION,
    rtt_p90 DOUBLE PRECISION,
    rtt_p95 DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_ping_history_target_time ON ping_history(target_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_ping_history_timestamp ON ping_history(timestamp);

CREATE TABLE IF NOT EXISTS probe_cycle_history (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    probe_type TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    device_count INTEGER,
    success_count INTEGER,
    error_count INTEGER,
    timeout_count INTEGER
);

CREATE INDEX IF NOT EXISTS idx_probe_cycle_type_time ON probe_cycle_history(probe_type, timestamp);
CREATE INDEX IF NOT EXISTS idx_probe_cycle_timestamp ON probe_cycle_history(timestamp);

-- ============================================================
-- MAPS TABLE ADDITIONS
-- ============================================================
ALTER TABLE maps ADD COLUMN IF NOT EXISTS public_share_token TEXT UNIQUE;
ALTER TABLE maps ADD COLUMN IF NOT EXISTS public_share_enabled BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE maps ADD COLUMN IF NOT EXISTS layout_kind TEXT DEFAULT 'canvas';
ALTER TABLE maps ADD COLUMN IF NOT EXISTS map_style TEXT DEFAULT 'auto';
ALTER TABLE maps ADD COLUMN IF NOT EXISTS geo_marker_style TEXT DEFAULT 'detailed';
ALTER TABLE maps ADD COLUMN IF NOT EXISTS geo_marker_thresholds JSONB;
ALTER TABLE maps ADD COLUMN IF NOT EXISTS default_center JSONB;
ALTER TABLE maps ADD COLUMN IF NOT EXISTS default_zoom INTEGER;

-- ============================================================
-- NOTIFICATIONS TABLE ADDITIONS
-- ============================================================
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'webhook' NOT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS config JSONB;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ignore_stale_to_online BOOLEAN DEFAULT false NOT NULL;

-- ============================================================
-- CREDENTIAL PROFILES SCHEMA MIGRATION (new format)
-- ============================================================
ALTER TABLE credential_profiles ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'mikrotik' NOT NULL;
ALTER TABLE credential_profiles ADD COLUMN IF NOT EXISTS credentials JSONB DEFAULT '{}' NOT NULL;

-- ============================================================
-- DEVICES IP ADDRESS (for older installations)
-- ============================================================
ALTER TABLE devices ADD COLUMN IF NOT EXISTS ip_address TEXT;

-- ============================================================
-- PROXMOX VMS TABLE MIGRATION (new schema)
-- ============================================================
ALTER TABLE proxmox_vms ADD COLUMN IF NOT EXISTS host_device_id VARCHAR REFERENCES devices(id) ON DELETE CASCADE;
ALTER TABLE proxmox_vms ADD COLUMN IF NOT EXISTS vm_type TEXT;
ALTER TABLE proxmox_vms ADD COLUMN IF NOT EXISTS cpu_usage_pct DOUBLE PRECISION;
ALTER TABLE proxmox_vms ADD COLUMN IF NOT EXISTS memory_bytes TEXT;
ALTER TABLE proxmox_vms ADD COLUMN IF NOT EXISTS memory_used_bytes TEXT;
ALTER TABLE proxmox_vms ADD COLUMN IF NOT EXISTS disk_bytes TEXT;
ALTER TABLE proxmox_vms ADD COLUMN IF NOT EXISTS disk_used_bytes TEXT;
ALTER TABLE proxmox_vms ADD COLUMN IF NOT EXISTS uptime INTEGER;
ALTER TABLE proxmox_vms ADD COLUMN IF NOT EXISTS mac_addresses TEXT[];
ALTER TABLE proxmox_vms ADD COLUMN IF NOT EXISTS matched_device_id VARCHAR REFERENCES devices(id) ON DELETE SET NULL;
ALTER TABLE proxmox_vms ADD COLUMN IF NOT EXISTS cluster_name TEXT;
ALTER TABLE proxmox_vms ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;

-- Fix cpu_usage_pct type (some old installs have INTEGER instead of DOUBLE PRECISION)
-- and remove legacy memory_usage_pct column that doesn't exist in schema anymore
DO $$
BEGIN
    -- Fix cpu_usage_pct type if it's INTEGER (should be DOUBLE PRECISION)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'proxmox_vms' AND column_name = 'cpu_usage_pct' AND data_type = 'integer'
    ) THEN
        ALTER TABLE proxmox_vms ALTER COLUMN cpu_usage_pct TYPE DOUBLE PRECISION USING cpu_usage_pct::DOUBLE PRECISION;
    END IF;
    
    -- Drop legacy memory_usage_pct column that doesn't exist in schema (data is in memory_used_bytes)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'proxmox_vms' AND column_name = 'memory_usage_pct'
    ) THEN
        ALTER TABLE proxmox_vms DROP COLUMN memory_usage_pct;
    END IF;
END $$;

-- Backfill proxmox_vms from legacy columns (if they exist)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'proxmox_vms' AND column_name = 'cluster_device_id') THEN
        UPDATE proxmox_vms SET host_device_id = cluster_device_id WHERE host_device_id IS NULL AND cluster_device_id IS NOT NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'proxmox_vms' AND column_name = 'type') THEN
        UPDATE proxmox_vms SET vm_type = type WHERE vm_type IS NULL AND type IS NOT NULL;
    END IF;
END $$;

-- ============================================================
-- PROXMOX NODES TABLE MIGRATION (new schema)
-- ============================================================
ALTER TABLE proxmox_nodes ADD COLUMN IF NOT EXISTS host_device_id VARCHAR REFERENCES devices(id) ON DELETE CASCADE;
ALTER TABLE proxmox_nodes ADD COLUMN IF NOT EXISTS cluster_name TEXT;
ALTER TABLE proxmox_nodes ADD COLUMN IF NOT EXISTS node_name TEXT;

-- Backfill proxmox_nodes from legacy columns (if they exist)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'proxmox_nodes' AND column_name = 'cluster_device_id') THEN
        UPDATE proxmox_nodes SET host_device_id = cluster_device_id WHERE host_device_id IS NULL AND cluster_device_id IS NOT NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'proxmox_nodes' AND column_name = 'node') THEN
        UPDATE proxmox_nodes SET node_name = node WHERE node_name IS NULL AND node IS NOT NULL;
    END IF;
END $$;

-- ============================================================
-- DUTY SHIFT CONFIG TABLE MIGRATION (new schema)
-- ============================================================
ALTER TABLE duty_shift_config ADD COLUMN IF NOT EXISTS day_shift_start TEXT DEFAULT '07:00';
ALTER TABLE duty_shift_config ADD COLUMN IF NOT EXISTS day_shift_end TEXT DEFAULT '19:00';
ALTER TABLE duty_shift_config ADD COLUMN IF NOT EXISTS night_shift_start TEXT DEFAULT '19:00';
ALTER TABLE duty_shift_config ADD COLUMN IF NOT EXISTS night_shift_end TEXT DEFAULT '07:00';
ALTER TABLE duty_shift_config ADD COLUMN IF NOT EXISTS rotation_weeks INTEGER DEFAULT 4;

-- Backfill duty_shift_config from legacy columns (if they exist)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'duty_shift_config' AND column_name = 'day_start_hour') THEN
        UPDATE duty_shift_config 
        SET day_shift_start = LPAD(day_start_hour::text, 2, '0') || ':00',
            day_shift_end = LPAD(day_end_hour::text, 2, '0') || ':00',
            night_shift_start = LPAD(day_end_hour::text, 2, '0') || ':00',
            night_shift_end = LPAD(day_start_hour::text, 2, '0') || ':00'
        WHERE day_shift_start IS NULL OR day_shift_start = '07:00';
    END IF;
END $$;

-- ============================================================
-- CREDENTIAL PROFILES MIGRATION (backfill new format from old columns)
-- ============================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'credential_profiles' AND column_name = 'username') THEN
        UPDATE credential_profiles 
        SET credentials = jsonb_build_object(
            'username', COALESCE(username, ''),
            'password', COALESCE(password, ''),
            'apiPort', COALESCE(api_port, 8728),
            'snmpVersion', COALESCE(snmp_version, '2c'),
            'snmpCommunity', COALESCE(snmp_community, 'public'),
            'snmpUsername', snmp_username,
            'snmpAuthProtocol', snmp_auth_protocol,
            'snmpAuthKey', snmp_auth_key,
            'snmpPrivProtocol', snmp_priv_protocol,
            'snmpPrivKey', snmp_priv_key,
            'usePrometheus', COALESCE(use_prometheus, false),
            'prometheusPort', COALESCE(prometheus_port, 9100),
            'prometheusPath', COALESCE(prometheus_path, '/metrics'),
            'prometheusScheme', COALESCE(prometheus_scheme, 'http'),
            'prometheusMetrics', prometheus_metrics,
            'proxmoxPort', COALESCE(proxmox_port, 8006),
            'proxmoxApiTokenId', proxmox_api_token_id,
            'proxmoxApiTokenSecret', proxmox_api_token_secret,
            'proxmoxVerifySsl', COALESCE(proxmox_verify_ssl, false),
            'proxmoxRealm', COALESCE(proxmox_realm, 'pam'),
            'snmpMetrics', snmp_metrics,
            'iloPort', COALESCE(ilo_port, 443),
            'iloVerifySsl', COALESCE(ilo_verify_ssl, false)
        ),
        type = CASE 
            WHEN use_prometheus = true THEN 'prometheus'
            WHEN snmp_version IS NOT NULL THEN 'snmp'
            WHEN proxmox_api_token_id IS NOT NULL THEN 'proxmox'
            WHEN ilo_port IS NOT NULL AND ilo_port != 443 THEN 'ilo'
            ELSE 'mikrotik'
        END
        WHERE credentials = '{}'::jsonb OR credentials IS NULL;
    END IF;
END $$;

-- ============================================================
-- DEVICE PLACEMENTS TABLE ADDITIONS
-- ============================================================
ALTER TABLE device_placements ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE device_placements ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE device_placements ADD COLUMN IF NOT EXISTS linked_map_id VARCHAR REFERENCES maps(id) ON DELETE SET NULL;

-- ============================================================
-- ALARM MUTES TABLE MIGRATION
-- ============================================================
ALTER TABLE alarm_mutes ADD COLUMN IF NOT EXISTS muted_by VARCHAR REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE alarm_mutes ADD COLUMN IF NOT EXISTS mute_until TIMESTAMPTZ;

-- Backfill muted_by from user_id if not set (for legacy rows, assume self-muted)
UPDATE alarm_mutes SET muted_by = user_id WHERE muted_by IS NULL AND user_id IS NOT NULL;
-- Backfill mute_until from muted_until if legacy column exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alarm_mutes' AND column_name = 'muted_until') THEN
        UPDATE alarm_mutes SET mute_until = muted_until WHERE mute_until IS NULL;
    END IF;
END $$;

-- ============================================================
-- USER NOTIFICATION CHANNELS TABLE MIGRATION
-- ============================================================
ALTER TABLE user_notification_channels ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE user_notification_channels ADD COLUMN IF NOT EXISTS ignore_stale_to_online BOOLEAN DEFAULT false;

-- Backfill name from type if not set
UPDATE user_notification_channels SET name = type WHERE name IS NULL;

-- ============================================================
-- DEVICE STATUS EVENTS TABLE MIGRATION
-- ============================================================
ALTER TABLE device_status_events ADD COLUMN IF NOT EXISTS previous_status TEXT;
ALTER TABLE device_status_events ADD COLUMN IF NOT EXISTS message TEXT;

-- Backfill previous_status from old_status and created_at from changed_at if legacy columns exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_status_events' AND column_name = 'old_status') THEN
        UPDATE device_status_events SET previous_status = old_status WHERE previous_status IS NULL;
    END IF;
END $$;

-- ============================================================
-- PROXMOX NODES TABLE ADDITIONS
-- ============================================================
ALTER TABLE proxmox_nodes ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;

-- ============================================================
-- PROXMOX CLUSTER INTERFACES TABLE MIGRATION
-- ============================================================
ALTER TABLE proxmox_cluster_interfaces ADD COLUMN IF NOT EXISTS cluster_name TEXT;
ALTER TABLE proxmox_cluster_interfaces ADD COLUMN IF NOT EXISTS interface_name TEXT;

-- Backfill interface_name from name if legacy column exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'proxmox_cluster_interfaces' AND column_name = 'name') THEN
        UPDATE proxmox_cluster_interfaces SET interface_name = name WHERE interface_name IS NULL AND name IS NOT NULL;
    END IF;
END $$;

-- ============================================================
-- IPAM VRFS TABLE (added with VRF feature)
-- ============================================================
CREATE TABLE IF NOT EXISTS ipam_vrfs (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL UNIQUE,
    route_target TEXT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

INSERT INTO ipam_vrfs (name, description)
SELECT 'Global', 'Default global routing table'
WHERE NOT EXISTS (SELECT 1 FROM ipam_vrfs WHERE name = 'Global');

-- Ensure Drizzle-named unique constraint exists (PostgreSQL auto-names it
-- "ipam_vrfs_name_key" when created inline; Drizzle expects "ipam_vrfs_name_unique").
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ipam_vrfs_name_unique') THEN
    ALTER TABLE ipam_vrfs ADD CONSTRAINT ipam_vrfs_name_unique UNIQUE (name);
  END IF;
END $$;

-- ============================================================
-- IPAM POOLS TABLE MIGRATION
-- ============================================================
ALTER TABLE ipam_pools ADD COLUMN IF NOT EXISTS entry_type TEXT;
ALTER TABLE ipam_pools ADD COLUMN IF NOT EXISTS cidr TEXT;
ALTER TABLE ipam_pools ADD COLUMN IF NOT EXISTS range_start TEXT;
ALTER TABLE ipam_pools ADD COLUMN IF NOT EXISTS range_end TEXT;
ALTER TABLE ipam_pools ADD COLUMN IF NOT EXISTS vlan INTEGER;
ALTER TABLE ipam_pools ADD COLUMN IF NOT EXISTS vrf_id VARCHAR REFERENCES ipam_vrfs(id) ON DELETE RESTRICT;
ALTER TABLE ipam_pools ADD COLUMN IF NOT EXISTS parent_id VARCHAR REFERENCES ipam_pools(id) ON DELETE SET NULL;

-- Backfill entry_type for existing pools (default to 'cidr' if network exists)
UPDATE ipam_pools SET entry_type = 'cidr' WHERE entry_type IS NULL AND network IS NOT NULL;
UPDATE ipam_pools SET cidr = network || '/' || prefix_length::text WHERE cidr IS NULL AND network IS NOT NULL;

-- ============================================================
-- IPAM ADDRESSES TABLE MIGRATION
-- ============================================================
ALTER TABLE ipam_addresses ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE ipam_addresses ADD COLUMN IF NOT EXISTS network_address TEXT;
ALTER TABLE ipam_addresses ADD COLUMN IF NOT EXISTS assigned_device_id VARCHAR REFERENCES devices(id) ON DELETE SET NULL;
ALTER TABLE ipam_addresses ADD COLUMN IF NOT EXISTS assigned_interface_id VARCHAR REFERENCES device_interfaces(id) ON DELETE SET NULL;
ALTER TABLE ipam_addresses ADD COLUMN IF NOT EXISTS assigned_interface_index INTEGER;
ALTER TABLE ipam_addresses ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE ipam_addresses ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE ipam_addresses ADD COLUMN IF NOT EXISTS assignment_source TEXT;
ALTER TABLE ipam_addresses ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE ipam_addresses ADD COLUMN IF NOT EXISTS vrf_id VARCHAR REFERENCES ipam_vrfs(id) ON DELETE RESTRICT;

-- Backfill ip_address from address column if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ipam_addresses' AND column_name = 'address') THEN
        UPDATE ipam_addresses SET ip_address = address WHERE ip_address IS NULL AND address IS NOT NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ipam_addresses' AND column_name = 'device_id') THEN
        UPDATE ipam_addresses SET assigned_device_id = device_id WHERE assigned_device_id IS NULL AND device_id IS NOT NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ipam_addresses' AND column_name = 'interface_id') THEN
        UPDATE ipam_addresses SET assigned_interface_id = interface_id WHERE assigned_interface_id IS NULL AND interface_id IS NOT NULL;
    END IF;
END $$;

-- Migrate unique constraint on ip_address to composite unique on (ip_address, vrf_id)
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Drop any single-column unique constraint on ipam_addresses(ip_address) by catalog lookup
    FOR r IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
        WHERE t.relname = 'ipam_addresses'
          AND c.contype = 'u'
          AND array_length(c.conkey, 1) = 1
          AND a.attname = 'ip_address'
    LOOP
        EXECUTE format('ALTER TABLE ipam_addresses DROP CONSTRAINT %I', r.conname);
    END LOOP;
    -- Drop any single-column unique index on ipam_addresses(ip_address) by catalog lookup
    FOR r IN
        SELECT i.relname AS indexname
        FROM pg_index ix
        JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
        WHERE t.relname = 'ipam_addresses'
          AND ix.indisunique = TRUE
          AND ix.indisprimary = FALSE
          AND array_length(ix.indkey, 1) = 1
          AND a.attname = 'ip_address'
          AND i.relname NOT IN ('idx_ipam_addresses_ip_vrf_unique')
    LOOP
        EXECUTE format('DROP INDEX %I', r.indexname);
    END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ipam_addresses_ip_vrf_unique ON ipam_addresses(ip_address, vrf_id);

-- ============================================================
-- IPAM ADDRESS ASSIGNMENTS TABLE MIGRATION
-- ============================================================
ALTER TABLE ipam_address_assignments ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE ipam_address_assignments ADD COLUMN IF NOT EXISTS source TEXT;

-- ============================================================
-- PING TARGETS TABLE MIGRATION
-- ============================================================
ALTER TABLE ping_targets ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE ping_targets ADD COLUMN IF NOT EXISTS interface_name TEXT;
ALTER TABLE ping_targets ADD COLUMN IF NOT EXISTS probe_count INTEGER DEFAULT 20;

-- Backfill ip_address from target_address if legacy column exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ping_targets' AND column_name = 'target_address') THEN
        UPDATE ping_targets SET ip_address = target_address WHERE ip_address IS NULL AND target_address IS NOT NULL;
    END IF;
    -- Backfill probe_count from packet_count if legacy column exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ping_targets' AND column_name = 'packet_count') THEN
        UPDATE ping_targets SET probe_count = packet_count WHERE probe_count IS NULL AND packet_count IS NOT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ping_targets_device ON ping_targets(device_id);
CREATE INDEX IF NOT EXISTS idx_ping_targets_enabled ON ping_targets(enabled);

-- ============================================================
-- PING HISTORY TABLE MIGRATION
-- ============================================================
ALTER TABLE ping_history ADD COLUMN IF NOT EXISTS target_id VARCHAR REFERENCES ping_targets(id) ON DELETE CASCADE;
ALTER TABLE ping_history ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE ping_history ADD COLUMN IF NOT EXISTS sent INTEGER DEFAULT 0;
ALTER TABLE ping_history ADD COLUMN IF NOT EXISTS received INTEGER DEFAULT 0;
ALTER TABLE ping_history ADD COLUMN IF NOT EXISTS loss_pct DOUBLE PRECISION DEFAULT 0;
ALTER TABLE ping_history ADD COLUMN IF NOT EXISTS rtt_min DOUBLE PRECISION;
ALTER TABLE ping_history ADD COLUMN IF NOT EXISTS rtt_max DOUBLE PRECISION;
ALTER TABLE ping_history ADD COLUMN IF NOT EXISTS rtt_avg DOUBLE PRECISION;
ALTER TABLE ping_history ADD COLUMN IF NOT EXISTS rtt_mdev DOUBLE PRECISION;
ALTER TABLE ping_history ADD COLUMN IF NOT EXISTS rtt_p10 DOUBLE PRECISION;
ALTER TABLE ping_history ADD COLUMN IF NOT EXISTS rtt_p25 DOUBLE PRECISION;
ALTER TABLE ping_history ADD COLUMN IF NOT EXISTS rtt_p50 DOUBLE PRECISION;
ALTER TABLE ping_history ADD COLUMN IF NOT EXISTS rtt_p75 DOUBLE PRECISION;
ALTER TABLE ping_history ADD COLUMN IF NOT EXISTS rtt_p90 DOUBLE PRECISION;
ALTER TABLE ping_history ADD COLUMN IF NOT EXISTS rtt_p95 DOUBLE PRECISION;

-- Backfill from legacy columns
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ping_history' AND column_name = 'ping_target_id') THEN
        UPDATE ping_history SET target_id = ping_target_id WHERE target_id IS NULL AND ping_target_id IS NOT NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ping_history' AND column_name = 'pinged_at') THEN
        UPDATE ping_history SET timestamp = pinged_at WHERE timestamp IS NULL AND pinged_at IS NOT NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ping_history' AND column_name = 'rtt_min_ms') THEN
        UPDATE ping_history SET rtt_min = rtt_min_ms WHERE rtt_min IS NULL AND rtt_min_ms IS NOT NULL;
        UPDATE ping_history SET rtt_max = rtt_max_ms WHERE rtt_max IS NULL AND rtt_max_ms IS NOT NULL;
        UPDATE ping_history SET rtt_avg = rtt_avg_ms WHERE rtt_avg IS NULL AND rtt_avg_ms IS NOT NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ping_history' AND column_name = 'packet_loss') THEN
        UPDATE ping_history SET loss_pct = packet_loss WHERE loss_pct IS NULL AND packet_loss IS NOT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ping_history_target_time ON ping_history(target_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_ping_history_timestamp ON ping_history(timestamp);

-- ============================================================
-- PROMETHEUS METRICS HISTORY TABLE MIGRATION
-- ============================================================
ALTER TABLE prometheus_metrics_history ADD COLUMN IF NOT EXISTS metric_id TEXT;
ALTER TABLE prometheus_metrics_history ADD COLUMN IF NOT EXISTS value DOUBLE PRECISION;
ALTER TABLE prometheus_metrics_history ADD COLUMN IF NOT EXISTS raw_value DOUBLE PRECISION;
ALTER TABLE prometheus_metrics_history ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT NOW();

-- Backfill from legacy columns
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'prometheus_metrics_history' AND column_name = 'recorded_at') THEN
        UPDATE prometheus_metrics_history SET timestamp = recorded_at WHERE timestamp IS NULL AND recorded_at IS NOT NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'prometheus_metrics_history' AND column_name = 'metric_value') THEN
        UPDATE prometheus_metrics_history SET value = metric_value WHERE value IS NULL AND metric_value IS NOT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_prom_metrics_device_metric_time ON prometheus_metrics_history(device_id, metric_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_prom_metrics_timestamp ON prometheus_metrics_history(timestamp);

-- ============================================================
-- LICENSES TABLE MIGRATION
-- ============================================================
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'free';
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS fingerprint TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS device_limit INTEGER DEFAULT 10;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS purchase_date TIMESTAMPTZ;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS updates_valid_until TIMESTAMPTZ;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

-- Backfill tier from license_type if legacy column exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'licenses' AND column_name = 'license_type') THEN
        UPDATE licenses SET tier = license_type WHERE tier IS NULL OR tier = 'free';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'licenses' AND column_name = 'max_devices') THEN
        UPDATE licenses SET device_limit = max_devices WHERE device_limit IS NULL;
    END IF;
END $$;

-- ============================================================
-- DUTY USER SCHEDULES TABLE MIGRATION
-- ============================================================
ALTER TABLE duty_user_schedules ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- ============================================================
-- CONNECTION BANDWIDTH HISTORY TABLE MIGRATION
-- ============================================================
ALTER TABLE connection_bandwidth_history ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE connection_bandwidth_history ADD COLUMN IF NOT EXISTS in_bytes_per_sec BIGINT;
ALTER TABLE connection_bandwidth_history ADD COLUMN IF NOT EXISTS out_bytes_per_sec BIGINT;
ALTER TABLE connection_bandwidth_history ADD COLUMN IF NOT EXISTS utilization_pct INTEGER;

-- Backfill timestamp from recorded_at if legacy column exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'connection_bandwidth_history' AND column_name = 'recorded_at') THEN
        UPDATE connection_bandwidth_history SET timestamp = recorded_at WHERE timestamp IS NULL AND recorded_at IS NOT NULL;
    END IF;
END $$;

-- Create indexes for connection_bandwidth_history
CREATE INDEX IF NOT EXISTS idx_bandwidth_connection_time ON connection_bandwidth_history(connection_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_bandwidth_timestamp ON connection_bandwidth_history(timestamp);

-- ============================================================
-- MAP DRAW ELEMENTS TABLE (added in v1.x)
-- ============================================================
CREATE TABLE IF NOT EXISTS map_draw_elements (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    map_id VARCHAR NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL,
    z_index INTEGER DEFAULT 0 NOT NULL,
    position_locked BOOLEAN DEFAULT false NOT NULL,
    props JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- DEVICE INTERFACES TABLE (added in v1.x)
-- ============================================================
CREATE TABLE IF NOT EXISTS device_interfaces (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT,
    parent_interface_id VARCHAR,
    snmp_index INTEGER,
    mac_address TEXT,
    is_virtual BOOLEAN DEFAULT false,
    oper_status TEXT,
    admin_status TEXT,
    speed TEXT,
    duplex TEXT,
    discovery_source TEXT,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE device_interfaces ADD COLUMN IF NOT EXISTS admin_status TEXT;
ALTER TABLE device_interfaces ADD COLUMN IF NOT EXISTS log_link_change BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE device_interfaces ADD COLUMN IF NOT EXISTS notify_link_change BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE device_interfaces ADD COLUMN IF NOT EXISTS log_speed_change BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE device_interfaces ADD COLUMN IF NOT EXISTS notify_speed_change BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE device_interfaces ADD COLUMN IF NOT EXISTS notify_global BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE device_interfaces ADD COLUMN IF NOT EXISTS notify_on_duty BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE device_interfaces ADD COLUMN IF NOT EXISTS is_dhcp_client BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- INTERFACE STATE EVENTS TABLE (if missing)
-- ============================================================
CREATE TABLE IF NOT EXISTS interface_state_events (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    interface_id VARCHAR NOT NULL REFERENCES device_interfaces(id) ON DELETE CASCADE,
    interface_name TEXT NOT NULL,
    event_type TEXT NOT NULL,
    previous_value TEXT,
    new_value TEXT NOT NULL,
    message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interface_state_events_interface_created ON interface_state_events (interface_id, created_at);
CREATE INDEX IF NOT EXISTS idx_interface_state_events_device_created ON interface_state_events (device_id, created_at);

-- ============================================================
-- DEVICE METRICS HISTORY TABLE (if missing)
-- ============================================================
CREATE TABLE IF NOT EXISTS device_metrics_history (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    cpu_usage_pct INTEGER,
    memory_usage_pct INTEGER,
    disk_usage_pct INTEGER,
    ping_rtt INTEGER,
    uptime_seconds INTEGER,
    poll_duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_device_metrics_device_time ON device_metrics_history(device_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_device_metrics_timestamp ON device_metrics_history(timestamp);

-- ============================================================
-- CONNECTION BANDWIDTH HISTORY TABLE (if missing)
-- ============================================================
CREATE TABLE IF NOT EXISTS connection_bandwidth_history (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    connection_id VARCHAR NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    in_bytes_per_sec BIGINT,
    out_bytes_per_sec BIGINT,
    utilization_pct INTEGER
);

-- ============================================================
-- PROMETHEUS METRICS HISTORY TABLE (if missing)
-- ============================================================
CREATE TABLE IF NOT EXISTS prometheus_metrics_history (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    metric_id TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    raw_value DOUBLE PRECISION,
    timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prom_metrics_device_metric_time ON prometheus_metrics_history(device_id, metric_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_prom_metrics_timestamp ON prometheus_metrics_history(timestamp);

-- ============================================================
-- PROXMOX VMS TABLE (added in v1.x)
-- ============================================================
CREATE TABLE IF NOT EXISTS proxmox_vms (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    host_device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    vmid INTEGER NOT NULL,
    vm_type TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    node TEXT NOT NULL,
    cpu_usage INTEGER,
    cpu_usage_pct DOUBLE PRECISION,
    memory_bytes TEXT,
    memory_used_bytes TEXT,
    disk_bytes TEXT,
    disk_used_bytes TEXT,
    uptime INTEGER,
    ip_addresses TEXT[],
    mac_addresses TEXT[],
    matched_device_id VARCHAR REFERENCES devices(id) ON DELETE SET NULL,
    cluster_name TEXT,
    last_seen TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- PROXMOX NODES TABLE (added in v1.x)
-- ============================================================
CREATE TABLE IF NOT EXISTS proxmox_nodes (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    host_device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    cluster_name TEXT NOT NULL,
    node_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- PROXMOX CLUSTER INTERFACES TABLE (added in v1.x)
-- ============================================================
CREATE TABLE IF NOT EXISTS proxmox_cluster_interfaces (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    cluster_name TEXT NOT NULL,
    interface_name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- IPAM TABLES (added in v1.x)
-- ============================================================
CREATE TABLE IF NOT EXISTS ipam_vrfs (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL UNIQUE,
    route_target TEXT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

INSERT INTO ipam_vrfs (name, description)
SELECT 'Global', 'Default global routing table'
WHERE NOT EXISTS (SELECT 1 FROM ipam_vrfs WHERE name = 'Global');

CREATE TABLE IF NOT EXISTS ipam_pools (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    description TEXT,
    entry_type TEXT NOT NULL,
    cidr TEXT,
    range_start TEXT,
    range_end TEXT,
    vlan INTEGER,
    gateway TEXT,
    vrf_id VARCHAR REFERENCES ipam_vrfs(id) ON DELETE RESTRICT,
    parent_id VARCHAR REFERENCES ipam_pools(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS ipam_addresses (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    ip_address TEXT NOT NULL,
    network_address TEXT,
    pool_id VARCHAR REFERENCES ipam_pools(id) ON DELETE CASCADE,
    vrf_id VARCHAR REFERENCES ipam_vrfs(id) ON DELETE RESTRICT,
    status TEXT DEFAULT 'available' NOT NULL,
    assigned_device_id VARCHAR REFERENCES devices(id) ON DELETE SET NULL,
    assigned_interface_id VARCHAR REFERENCES device_interfaces(id) ON DELETE SET NULL,
    assigned_interface_index INTEGER,
    role TEXT,
    source TEXT,
    assignment_source TEXT,
    hostname TEXT,
    notes TEXT,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ipam_addresses_ip_vrf_unique ON ipam_addresses(ip_address, vrf_id);

CREATE TABLE IF NOT EXISTS ipam_address_assignments (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    address_id VARCHAR NOT NULL REFERENCES ipam_addresses(id) ON DELETE CASCADE,
    device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    interface_id VARCHAR REFERENCES device_interfaces(id) ON DELETE SET NULL,
    role TEXT,
    source TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- CONNECTIONS TABLE ADDITIONS (dynamic tracking)
-- ============================================================
ALTER TABLE connections ADD COLUMN IF NOT EXISTS dynamic_type TEXT;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS dynamic_config JSONB;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS dynamic_metadata JSONB;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS is_dynamic BOOLEAN DEFAULT false;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS curve_mode TEXT DEFAULT 'straight';
ALTER TABLE connections ADD COLUMN IF NOT EXISTS curve_offset INTEGER DEFAULT 0;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS show_bandwidth BOOLEAN DEFAULT false;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS monitor_interface TEXT;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS monitor_snmp_index INTEGER;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS monitor_custom_device_id TEXT;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS monitor_custom_port TEXT;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS flip_traffic_direction BOOLEAN DEFAULT false;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS link_stats JSONB;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS warning_threshold_pct INTEGER DEFAULT 70;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS critical_threshold_pct INTEGER DEFAULT 90;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS label_position INTEGER DEFAULT 50;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS custom_link_speed_mbps INTEGER;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS mac_validated BOOLEAN DEFAULT false;

-- ============================================================
-- MAPS AUTO-CREATE CONNECTIONS SETTING
-- ============================================================
ALTER TABLE maps ADD COLUMN IF NOT EXISTS auto_create_connections BOOLEAN DEFAULT false NOT NULL;

-- ============================================================
-- NOTIFICATION HISTORY ADDITIONS
-- ============================================================
ALTER TABLE notification_history ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE notification_history ADD COLUMN IF NOT EXISTS success BOOLEAN;
ALTER TABLE notification_history ADD COLUMN IF NOT EXISTS error_message TEXT;

-- ============================================================
-- MAC ADDRESS ENTRIES TABLE (added in v1.x)
-- ============================================================
CREATE TABLE IF NOT EXISTS mac_address_entries (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    mac_address TEXT NOT NULL,
    port_name TEXT,
    port_index INTEGER,
    vlan_id INTEGER,
    is_static BOOLEAN DEFAULT false,
    is_remote BOOLEAN DEFAULT false,
    last_seen_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mac_entries_device ON mac_address_entries(device_id);
CREATE INDEX IF NOT EXISTS idx_mac_entries_mac ON mac_address_entries(mac_address);
CREATE INDEX IF NOT EXISTS idx_mac_entries_device_mac ON mac_address_entries(device_id, mac_address);
ALTER TABLE mac_address_entries ADD COLUMN IF NOT EXISTS is_remote BOOLEAN DEFAULT false;

-- Suppressed MAC connections (track deleted MAC-discovered connections to prevent re-creation)
CREATE TABLE IF NOT EXISTS suppressed_mac_connections (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    map_id VARCHAR NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    source_device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    target_device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    suppressed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    suppressed_by VARCHAR
);
CREATE INDEX IF NOT EXISTS idx_suppressed_mac_map ON suppressed_mac_connections(map_id);
CREATE INDEX IF NOT EXISTS idx_suppressed_mac_devices ON suppressed_mac_connections(source_device_id, target_device_id);

-- TIA-606-B Infrastructure Registry (Last schema sync: March 2026)
CREATE TABLE IF NOT EXISTS tia_sites (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    code VARCHAR(20) NOT NULL,
    name TEXT NOT NULL,
    address TEXT,
    city TEXT,
    country TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE TABLE IF NOT EXISTS tia_locations (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    site_id VARCHAR REFERENCES tia_sites(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name TEXT NOT NULL,
    building TEXT,
    floor TEXT,
    room TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE TABLE IF NOT EXISTS tia_racks (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    location_id VARCHAR REFERENCES tia_locations(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name TEXT NOT NULL,
    total_units INTEGER DEFAULT 42,
    rack_type TEXT DEFAULT 'enclosed',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS site_id VARCHAR REFERENCES tia_sites(id) ON DELETE SET NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS location_id VARCHAR REFERENCES tia_locations(id) ON DELETE SET NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS rack_id VARCHAR REFERENCES tia_racks(id) ON DELETE SET NULL;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS cable_id TEXT;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS cable_color TEXT;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS cable_type TEXT;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS cable_length INTEGER;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS cable_length_unit TEXT DEFAULT 'm';
ALTER TABLE connections ADD COLUMN IF NOT EXISTS cable_notes TEXT;

-- Task #26: Bandwidth threshold notifications
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bandwidth_notifications_enabled BOOLEAN DEFAULT true;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bandwidth_breach_state TEXT DEFAULT 'ok';
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bandwidth_breach_since TIMESTAMPTZ;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bandwidth_breach_last_notified_at TIMESTAMPTZ;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bandwidth_breach_consecutive INTEGER DEFAULT 0;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bandwidth_breach_pending TEXT;

-- Rack Placements (March 2026)
CREATE TABLE IF NOT EXISTS rack_placements (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    map_id VARCHAR NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    rack_id VARCHAR NOT NULL REFERENCES tia_racks(id) ON DELETE CASCADE,
    position JSONB NOT NULL DEFAULT '{"x":0,"y":0}',
    settings JSONB NOT NULL DEFAULT '{"view":"front","size":"compact"}',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS rack_installation_images (
    id SERIAL PRIMARY KEY,
    rack_id VARCHAR NOT NULL REFERENCES tia_racks(id) ON DELETE CASCADE,
    image_data TEXT NOT NULL,
    is_primary BOOLEAN DEFAULT false,
    caption VARCHAR(200),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Rack Passive Items
CREATE TABLE IF NOT EXISTS rack_passive_items (
    id SERIAL PRIMARY KEY,
    rack_id VARCHAR NOT NULL REFERENCES tia_racks(id) ON DELETE CASCADE,
    label VARCHAR(200) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'other',
    rack_unit INTEGER NOT NULL,
    rack_height INTEGER NOT NULL DEFAULT 1,
    rack_side VARCHAR(20) NOT NULL DEFAULT 'front',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS device_installation_images (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    image_data TEXT NOT NULL,
    caption VARCHAR(200),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- VLAN Discovery & Inventory (March 2026)
CREATE TABLE IF NOT EXISTS vlans (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    vlan_id INTEGER NOT NULL,
    name TEXT,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vlans_device ON vlans(device_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vlans_device_vlan ON vlans(device_id, vlan_id);

CREATE TABLE IF NOT EXISTS interface_vlan_memberships (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    interface_id VARCHAR NOT NULL REFERENCES device_interfaces(id) ON DELETE CASCADE,
    vlan_record_id VARCHAR NOT NULL REFERENCES vlans(id) ON DELETE CASCADE,
    tagged BOOLEAN NOT NULL DEFAULT true,
    is_pvid BOOLEAN NOT NULL DEFAULT false,
    last_seen_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ivm_interface ON interface_vlan_memberships(interface_id);
CREATE INDEX IF NOT EXISTS idx_ivm_vlan ON interface_vlan_memberships(vlan_record_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ivm_interface_vlan ON interface_vlan_memberships(interface_id, vlan_record_id);

-- VLAN Groups (March 2026)
CREATE TABLE IF NOT EXISTS vlan_groups (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    description TEXT,
    ranges TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Per-device probe control flags (March 2026)
ALTER TABLE devices ADD COLUMN IF NOT EXISTS probe_disabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS probe_ipv6_disabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS probe_vlan_disabled BOOLEAN NOT NULL DEFAULT false;

-- Unique index for device_interfaces upsert ON CONFLICT support
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_interfaces_unique ON device_interfaces (device_id, name);

-- ============================================================
-- GLOBAL TIMESTAMP → TIMESTAMPTZ CONVERSION (idempotent)
-- Converts every "timestamp without time zone" column to
-- "timestamp with time zone" across all CoreBit tables.
-- Safe when the PG server is in UTC: values don't change.
-- ============================================================
DO $$
DECLARE
  r RECORD;
  stored_tz TEXT;
  affected_tables TEXT[] := ARRAY[
    'user_sessions',
    'credential_profiles',
    'settings',
    'notifications',
    'device_notifications',
    'notification_history',
    'logs',
    'tia_sites',
    'tia_locations',
    'tia_racks',
    'rack_placements',
    'rack_installation_images',
    'rack_passive_items',
    'devices',
    'device_installation_images',
    'hardware_library',
    'device_placements',
    'map_draw_elements',
    'device_interfaces',
    'connections',
    'scan_profiles',
    'backups',
    'users',
    'trusted_devices',
    'port_locks',
    'mac_address_entries',
    'suppressed_mac_connections',
    'maps',
    'user_notification_channels',
    'duty_user_schedules',
    'duty_shift_config',
    'alarm_mutes',
    'device_status_events',
    'interface_state_events',
    'proxmox_vms',
    'proxmox_nodes',
    'proxmox_cluster_interfaces',
    'ipam_vrfs',
    'ipam_pools',
    'ipam_addresses',
    'ipam_address_assignments',
    'vlans',
    'interface_vlan_memberships',
    'vlan_groups',
    'device_metrics_history',
    'connection_bandwidth_history',
    'prometheus_metrics_history',
    'probe_cycle_history',
    'licenses',
    'ping_targets',
    'ping_history',
    'api_keys'
  ];
BEGIN
  -- Capture the PostgreSQL session timezone BEFORE any SET commands so that
  -- existing plain-timestamp values (which were stored in that local time) are
  -- correctly reinterpreted when converted to TIMESTAMPTZ.
  -- e.g. if DB timezone is Europe/Copenhagen, stored "10:05:28" → UTC "09:05:28".
  SELECT current_setting('timezone') INTO stored_tz;
  RAISE NOTICE 'Migrating timestamp columns using stored_tz=%', stored_tz;

  FOR r IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type = 'timestamp without time zone'
      AND table_name = ANY(affected_tables)
    ORDER BY table_name, column_name
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE %L',
      r.table_name, r.column_name, r.column_name, stored_tz
    );
    RAISE NOTICE 'Converted %.% to TIMESTAMPTZ (was stored in %)', r.table_name, r.column_name, stored_tz;
  END LOOP;
END $$;

-- Fix user_sessions.expire precision: the main loop converts to TIMESTAMPTZ
-- (atttypmod = -1), but Drizzle schema defines { precision: 6 } = TIMESTAMP(6)
-- WITH TIME ZONE (atttypmod = 6). Without this fix drizzle-kit push prompts every deploy.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'user_sessions' AND a.attname = 'expire'
      AND n.nspname = 'public'
      AND a.atttypid = 'timestamptz'::regtype
      AND a.atttypmod = -1
  ) THEN
    ALTER TABLE user_sessions ALTER COLUMN expire TYPE TIMESTAMP(6) WITH TIME ZONE;
    RAISE NOTICE 'Fixed user_sessions.expire to TIMESTAMP(6) WITH TIME ZONE';
  END IF;
END $$;

-- Convert session.expire timestamp(6) → timestamptz
DO $$
DECLARE
  stored_tz TEXT;
BEGIN
  SELECT current_setting('timezone') INTO stored_tz;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'session' AND column_name = 'expire'
      AND data_type = 'timestamp without time zone'
  ) THEN
    EXECUTE format(
      'ALTER TABLE session ALTER COLUMN expire TYPE TIMESTAMP(6) WITH TIME ZONE USING expire AT TIME ZONE %L',
      stored_tz
    );
    RAISE NOTICE 'Converted session.expire to TIMESTAMP(6) WITH TIME ZONE (was stored in %)', stored_tz;
  END IF;
END $$;

-- connection_bandwidth_history: integer → bigint for byte rate columns
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'connection_bandwidth_history'
      AND column_name = 'in_bytes_per_sec'
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE connection_bandwidth_history
      ALTER COLUMN in_bytes_per_sec TYPE BIGINT,
      ALTER COLUMN out_bytes_per_sec TYPE BIGINT;
  END IF;
END $$;

-- devices.parent_device_id: text → varchar (storage-compatible, no data rewrite)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'devices' AND column_name = 'parent_device_id'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE devices ALTER COLUMN parent_device_id TYPE VARCHAR;
  END IF;
END $$;

-- ============================================================
-- device_management_connections (April 2026)
-- Per-device management connection shortcuts: SSH, Winbox, Web, RDP.
-- Seeding of default connections per device type is handled by
-- server/db.ts::runStartupMigrations() at first server start.
-- ============================================================
CREATE TABLE IF NOT EXISTS device_management_connections (
    id               SERIAL PRIMARY KEY,
    device_id        VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    label            VARCHAR(100) NOT NULL,
    type             TEXT NOT NULL,
    address_override VARCHAR(255),
    port             INTEGER,
    username         VARCHAR(100),
    web_https        BOOLEAN DEFAULT FALSE,
    use_tunnel       BOOLEAN DEFAULT FALSE,
    sort_order       INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_device_mgmt_conn_device_id
    ON device_management_connections(device_id);
ALTER TABLE device_management_connections
    ADD COLUMN IF NOT EXISTS route_mode TEXT NOT NULL DEFAULT 'direct';
UPDATE device_management_connections
   SET route_mode = 'tunnel'
 WHERE use_tunnel = TRUE AND route_mode = 'direct';

-- per-user personal API keys (April 2026)
ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE;

-- zero-knowledge credential vault per user (April 2026)
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS credential_vault TEXT;
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS credential_vault_updated_at TIMESTAMPTZ;

-- PLUGIN SYSTEM - plugin_items table (April 2026)
CREATE TABLE IF NOT EXISTS plugin_items (
    id           VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    host_device_id VARCHAR NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    plugin_type  TEXT NOT NULL,
    item_id      TEXT NOT NULL,
    name         TEXT NOT NULL,
    status       TEXT NOT NULL,
    data         JSONB,
    updated_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plugin_items_host
    ON plugin_items(host_device_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plugin_items_unique
    ON plugin_items(host_device_id, plugin_type, item_id);

-- ============================================================
-- PROMETHEUS DATA SOURCES - data_sources table (April 2026)
-- ============================================================
CREATE TABLE IF NOT EXISTS data_sources (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'prometheus',
    url        TEXT NOT NULL,
    config     JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- DEVICE GROUPS + DUTY SCHEDULES (Task #25, May 2026)
-- ============================================================
CREATE TABLE IF NOT EXISTS device_groups (
    id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    color       TEXT NOT NULL DEFAULT '#6366f1',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_group_members (
    group_id   VARCHAR NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
    device_id  VARCHAR NOT NULL REFERENCES devices(id)       ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, device_id)
);

CREATE TABLE IF NOT EXISTS device_group_notifications (
    group_id        VARCHAR NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
    notification_id VARCHAR NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, notification_id)
);

CREATE TABLE IF NOT EXISTS duty_schedules (
    id         VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id   VARCHAR NOT NULL UNIQUE REFERENCES device_groups(id) ON DELETE CASCADE,
    timezone   TEXT NOT NULL DEFAULT 'UTC',
    enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS duty_schedule_windows (
    id           VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id  VARCHAR NOT NULL REFERENCES duty_schedules(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    start_time   TEXT NOT NULL,
    end_time     TEXT NOT NULL,
    day_of_week  INTEGER,
    week_parity  TEXT NOT NULL DEFAULT 'all',
    sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS duty_window_users (
    window_id VARCHAR NOT NULL REFERENCES duty_schedule_windows(id) ON DELETE CASCADE,
    user_id   VARCHAR NOT NULL REFERENCES users(id)                 ON DELETE CASCADE,
    PRIMARY KEY (window_id, user_id)
);

-- ============================================================
-- WIDGET ALERT STATES (Task #27, May 2026)
-- ============================================================
CREATE TABLE IF NOT EXISTS widget_alert_states (
    id                 VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    element_id         VARCHAR NOT NULL REFERENCES map_draw_elements(id) ON DELETE CASCADE,
    series_key         TEXT    NOT NULL DEFAULT '',
    severity           TEXT    NOT NULL DEFAULT 'ok',
    pending_severity   TEXT,
    consecutive        INTEGER NOT NULL DEFAULT 0,
    last_value         DOUBLE PRECISION,
    last_zone_label    TEXT,
    last_transition_at TIMESTAMPTZ,
    last_notified_at   TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_widget_alert_states_element_series
    ON widget_alert_states(element_id, series_key);

-- ============================================================
-- BANDWIDTH BREACH STATE on connections (Task #26, May 2026)
-- ============================================================
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bandwidth_breach_state            TEXT NOT NULL DEFAULT 'ok';
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bandwidth_breach_pending          TEXT;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bandwidth_breach_consecutive      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bandwidth_breach_since            TIMESTAMPTZ;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bandwidth_breach_last_notified_at TIMESTAMPTZ;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bandwidth_notifications_enabled   BOOLEAN NOT NULL DEFAULT TRUE;

EOSQL
            log_success "SQL schema updates applied"
        else
            log_warning "Could not find DATABASE_URL in .env"
        fi
    else
        log_warning ".env file not found, skipping direct SQL updates"
    fi
    
    # NOTE: drizzle-kit push --force is intentionally NOT run here.
    # In drizzle-kit 0.31+, --force bypasses ALL confirmation prompts including
    # destructive DROP TABLE / RECREATE TABLE operations, which silently wipes data.
    # All required schema changes are handled safely and explicitly by the idempotent
    # ALTER TABLE IF NOT EXISTS blocks in the EOSQL section above.
    # Adding a new column? Add it to the EOSQL block — do NOT rely on drizzle-kit push.
    log_success "Database migrations complete"
}

setup_systemd() {
    log_info "Setting up systemd service..."
    
    if [ "$RUN_AS_ROOT" = true ]; then
        log_warning "Running service as root (--run-as-root specified)"
        
        cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=CoreBit Network Manager
Documentation=https://github.com/your-org/corebit
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
# Running as root for full network access (use with caution)
User=root
Group=root
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=/usr/bin/node ${INSTALL_DIR}/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

# Maintain some security hardening even when running as root
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${INSTALL_DIR}/data ${INSTALL_DIR}/backups ${INSTALL_DIR}/plugins ${INSTALL_DIR}
PrivateTmp=true

# Resource limits
LimitNOFILE=65535
MemoryMax=1G

[Install]
WantedBy=multi-user.target
EOF
    else
        cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=CoreBit Network Manager
Documentation=https://github.com/your-org/corebit
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=/usr/bin/node ${INSTALL_DIR}/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

# Network capabilities for device probing (ICMP ping, SNMP)
# Required on Ubuntu 24.04+ where setuid ping was removed
CapabilityBoundingSet=CAP_NET_RAW CAP_NET_ADMIN
AmbientCapabilities=CAP_NET_RAW CAP_NET_ADMIN

# Security hardening
NoNewPrivileges=false
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${INSTALL_DIR}/data ${INSTALL_DIR}/backups ${INSTALL_DIR}/plugins ${INSTALL_DIR}
PrivateTmp=true

# Resource limits
LimitNOFILE=65535
MemoryMax=1G

[Install]
WantedBy=multi-user.target
EOF
    fi

    # Reload systemd
    systemctl daemon-reload
    
    # Enable service
    systemctl enable "$SERVICE_NAME"
    
    log_success "Systemd service configured"
}

start_service() {
    log_info "Starting service..."
    
    systemctl restart "$SERVICE_NAME"
    
    # Wait for service to start
    sleep 3
    
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log_success "Service started successfully"
    else
        log_error "Service failed to start. Check logs with: journalctl -u $SERVICE_NAME -f"
        exit 1
    fi
}

uninstall() {
    log_info "Uninstalling CoreBit Network Manager..."
    
    # Stop and disable service
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload
    
    # Backup data before removal
    if [ -d "$INSTALL_DIR" ]; then
        BACKUP_DIR="/tmp/corebit-uninstall-backup-$(date +%Y%m%d%H%M%S)"
        mkdir -p "$BACKUP_DIR"
        cp -r "$INSTALL_DIR/.env" "$BACKUP_DIR/" 2>/dev/null || true
        cp -r "$INSTALL_DIR/data" "$BACKUP_DIR/" 2>/dev/null || true
        log_info "Configuration backed up to: $BACKUP_DIR"
    fi
    
    # Remove installation directory
    rm -rf "$INSTALL_DIR"
    
    # Remove user (optional, keeping for safety)
    # userdel "$SERVICE_USER" 2>/dev/null || true
    
    # Drop database if purge mode
    if [ "$PURGE_MODE" = true ]; then
        log_info "Purge mode: Dropping database and user..."
        if command -v sudo &>/dev/null && id -u postgres &>/dev/null; then
            sudo -u postgres psql -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>/dev/null || true
            sudo -u postgres psql -c "DROP USER IF EXISTS $DB_USER;" 2>/dev/null || true
            log_success "Database and user dropped"
        else
            log_warn "Could not drop database automatically. Run manually:"
            log_warn "  sudo -u postgres psql -c \"DROP DATABASE IF EXISTS $DB_NAME;\""
            log_warn "  sudo -u postgres psql -c \"DROP USER IF EXISTS $DB_USER;\""
        fi
    else
        log_info "Note: Database and user were preserved. Use --purge to remove them."
    fi
    
    log_success "Uninstallation complete"
}

show_completion() {
    LOCAL_IP=$(hostname -I | awk '{print $1}')
    
    echo ""
    echo -e "${GREEN}======================================================${NC}"
    if [ "$UPDATE_MODE" = true ]; then
        echo -e "${GREEN}  CoreBit Network Manager - Update Complete!${NC}"
    else
        echo -e "${GREEN}  CoreBit Network Manager - Installation Complete!${NC}"
    fi
    echo -e "${GREEN}======================================================${NC}"
    echo ""
    echo -e "  ${BLUE}Access URL:${NC}      http://${LOCAL_IP}:${APP_PORT}"
    if [ "$UPDATE_MODE" = false ]; then
        echo -e "  ${BLUE}Default Login:${NC}   admin / admin"
    fi
    echo ""
    echo -e "  ${BLUE}Service Commands:${NC}"
    echo "    Start:    sudo systemctl start $SERVICE_NAME"
    echo "    Stop:     sudo systemctl stop $SERVICE_NAME"
    echo "    Restart:  sudo systemctl restart $SERVICE_NAME"
    echo "    Status:   sudo systemctl status $SERVICE_NAME"
    echo "    Logs:     sudo journalctl -u $SERVICE_NAME -f"
    echo ""
    echo -e "  ${BLUE}Configuration:${NC}   $INSTALL_DIR/.env"
    echo -e "  ${BLUE}Installation:${NC}    $INSTALL_DIR"
    echo ""
    if [ "$UPDATE_MODE" = false ]; then
        echo -e "  ${YELLOW}Important:${NC} Change the default admin password after first login!"
    else
        echo -e "  ${GREEN}Your existing data and configuration have been preserved.${NC}"
    fi
    echo ""
    echo -e "${GREEN}======================================================${NC}"
}

# Main installation flow
main() {
    echo ""
    echo -e "${BLUE}======================================================${NC}"
    echo -e "${BLUE}  CoreBit Network Manager - Installer${NC}"
    echo -e "${BLUE}======================================================${NC}"
    echo ""
    
    check_root
    detect_os
    
    if [ "$UNINSTALL_MODE" = true ]; then
        uninstall
        exit 0
    fi
    
    if [ "$UPDATE_MODE" = true ]; then
        log_info "Running in update mode..."
        # Backup existing installation FIRST to preserve credentials
        backup_existing
        
        # Show current version before update
        if [ -f "$INSTALL_DIR/version.json" ]; then
            OLD_BUILD=$(grep -o '"buildNumber":[^,}]*' "$INSTALL_DIR/version.json" 2>/dev/null | cut -d: -f2 | tr -d ' ')
            if [ -n "$OLD_BUILD" ]; then
                log_info "Current installed build: $OLD_BUILD"
            fi
        fi
    fi
    
    if [ "$BETA_MODE" = true ]; then
        log_warning "Beta mode enabled - using Beta channel"
    fi
    
    install_dependencies
    setup_postgresql
    create_user
    
    # Only backup on fresh install (update already backed up above)
    if [ "$UPDATE_MODE" = false ]; then
        backup_existing
    fi
    download_application
    install_application
    setup_vendor_mibs
    configure_environment
    run_migrations
    setup_systemd
    start_service
    
    # Cleanup
    rm -rf "$TEMP_DIR"
    rm -f /tmp/corebit.env.backup
    rm -f /tmp/corebit.license.backup
    
    show_completion
}

main "$@"
