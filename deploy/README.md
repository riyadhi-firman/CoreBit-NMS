# CoreBit Docker Installation

Deploy CoreBit Network Manager with Docker in under 5 minutes.

## Requirements

- Docker Engine 20.10+ and Docker Compose
- Linux host (recommended for network monitoring)
- Port 3000 available

## Quick Start

### Step 1: Download the configuration

```bash
mkdir corebit && cd corebit

curl -O https://raw.githubusercontent.com/clausdk/corebit/main/deploy/docker-compose.yml
curl -O https://raw.githubusercontent.com/clausdk/corebit/main/deploy/.env.example
```

### Step 2: Configure

```bash
cp .env.example .env
nano .env
```

**Important:** Change `SESSION_SECRET` to a random value:
```bash
openssl rand -base64 32
```

### Step 3: Start CoreBit

```bash
docker compose up -d
```

### Step 4: Access

Open `http://your-server-ip:3000`

**Default login:**
- Username: `admin`
- Password: `admin`

---

## Updating

```bash
docker compose pull
docker compose up -d
```

Your data is preserved in Docker volumes.

---

## Configuration

### Environment Variables (.env)

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_PORT` | 3000 | Application port |
| `DB_PORT` | 5433 | Internal database port |
| `POSTGRES_USER` | corebit | Database username |
| `POSTGRES_PASSWORD` | corebit123 | Database password |
| `SESSION_SECRET` | (change this) | Session encryption key |

### Change Application Port

Edit `.env`:
```
APP_PORT=8080
```

Then restart:
```bash
docker compose down
docker compose up -d
```

---

## Network Access

CoreBit uses **host network mode** to directly access your network for device monitoring (SNMP, ping, Mikrotik API). This means:

- The app runs directly on your host's network stack
- Can ping and monitor any device your host can reach
- No port mapping needed (app listens directly on port 3000)

---

## Commands

```bash
# Start
docker compose up -d

# Stop
docker compose down

# View logs
docker compose logs -f

# View app logs only
docker compose logs -f corebit-app

# Restart
docker compose restart corebit-app

# Status
docker compose ps
```

---

## Troubleshooting

### Check logs
```bash
docker compose logs corebit-app
```

### Database issues
```bash
docker compose logs corebit-db
```

### Reset admin password

Add to `.env`:
```
ADMIN_RECOVERY_SECRET=your-secret
ADMIN_RECOVERY_PASSWORD=newpassword
```

Restart, then remove these lines after logging in.

### Complete reset (deletes all data)
```bash
docker compose down -v
docker compose up -d
```

---

## Data Persistence

| Volume | Content |
|--------|---------|
| `corebit_db` | Database |
| `corebit_backups` | Backups |
| `corebit_data` | App data |

---

## Support

Issues: https://github.com/clausdk/corebit/issues
