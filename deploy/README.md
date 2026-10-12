# Putting FarePay on a real server

Right now the FarePay server runs on a laptop and is reached through a temporary tunnel address that
changes. For real passengers and real money it must run on a server that is always on, at a fixed
`https://` address. This guide sets that up, one step at a time. The server runs the API, the PostgreSQL
database and the SACCO office web dashboard (`https://<your-address>/office/`).

## What you need

1. **A Linux server** (Ubuntu 24.04), always on. Either:
   - **Free:** an Oracle Cloud "Always Free" VM (choose the Johannesburg region, the closest to Kenya).
     Oracle asks for a bank card to check who you are but does not charge for Always Free machines.
   - **Paid, simplest:** a small VPS, about USD 5–6 a month (for example DigitalOcean, Hetzner, Contabo, or a
     Kenyan host's VPS). 2 GB of memory is comfortable for one SACCO (API + PostgreSQL); 1 GB works.
2. **A web address**, e.g. `api.yoursacco.co.ke`. Safaricom sends payment confirmations to it.
   - A `.co.ke` domain costs about KES 1,000 a year from any Kenyan registrar. This is recommended for
     real money: Safaricom and passengers trust it more.
   - Free alternative for testing: a DuckDNS subdomain (`yourname.duckdns.org`).
   - Point the address at your server's public IP (an "A record" at your domain registrar, or on DuckDNS).
3. **The FarePay code on GitHub** (a free *private* repository), so the server can download it.
   On your laptop, in the `farepay` folder:
   ```
   git remote add origin https://github.com/<you>/farepay.git
   git push -u origin main postgres
   ```
   `.env`, the databases, backups and other secrets are never uploaded (see `.gitignore`).
   Until the `postgres` branch is merged into `main`, the server uses the `postgres` branch (step 2).

## 1. Prepare the server

Connect with SSH (`ssh ubuntu@<server-ip>`), then:

```bash
# Node.js 24, Git and Yarn 1.22 (FarePay's package manager)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo npm install -g yarn@1.22.22

# PostgreSQL 17 (from PostgreSQL's own package repository, the same version as on the laptop)
sudo apt-get install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt-get install -y postgresql-17

# Caddy (handles https certificates automatically)
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy

# Firewall: only SSH and web traffic (PostgreSQL stays private to the server)
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable
```

On **Oracle Cloud** also open ports 80 and 443 in the VCN's security list (Networking → Virtual Cloud
Networks → your network → Security Lists → Add Ingress Rules, source `0.0.0.0/0`), and run:
`sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -j ACCEPT && sudo netfilter-persistent save`.
Never open port 5432 (PostgreSQL): on Ubuntu it only listens on the server itself, and it should stay that way.

## 2. The database

```bash
openssl rand -hex 24      # the database password: copy it, you need it twice below
sudo -u postgres psql -c "CREATE ROLE farepay LOGIN PASSWORD '<the password>'"
sudo -u postgres createdb --owner=farepay farepay
```

The `farepay` role is not a superuser: it can only use its own database. The tables are created
automatically the first time FarePay starts.

## 3. Install FarePay

```bash
sudo useradd --system --create-home --home-dir /opt/farepay --shell /usr/sbin/nologin farepay
sudo git clone --branch postgres https://github.com/<you>/farepay.git /opt/farepay-src   # "main" once merged
sudo cp -r /opt/farepay-src/. /opt/farepay/ && sudo chown -R farepay:farepay /opt/farepay
cd /opt/farepay/backend
sudo -u farepay yarn install --frozen-lockfile --production
sudo -u farepay mkdir -p data/backups

# The SACCO office web dashboard (served by the backend at https://<your-address>/office/)
cd /opt/farepay/admin-web
sudo -u farepay yarn install --frozen-lockfile
sudo -u farepay yarn build
```

## 4. Settings

```bash
sudo -u farepay cp /opt/farepay/deploy/env.production.example /opt/farepay/backend/.env
openssl rand -hex 32   # run twice: one for JWT_SECRET, one for MPESA_CALLBACK_SECRET
sudo -u farepay nano /opt/farepay/backend/.env
sudo chmod 600 /opt/farepay/backend/.env
```

Fill in the two secrets, the database password inside `DATABASE_URL`, `SACCO_NAME`, your address in
`MPESA_CALLBACK_BASE_URL`, and the Daraja keys. The server refuses to start in production if a secret is
missing or too short, or if the address isn't `https://`. Keep `MPESA_MODE=sandbox` until Safaricom
approves Go Live.

## 5. Bring the data from the laptop (or start empty)

**Either** start with an empty database: skip to step 6 and create the office accounts there.

**Or** move everything from the laptop (accounts, routes, vehicles and their QR stickers, wallets, payments):

1. On the laptop, make sure **no money is in flight**: no M-Pesa top-up waiting, no payout or withdrawal
   "processing" or "manual". Don't do this between 20:45 and 21:30 (the daily payout runs at 21:00).
2. **Stop the laptop server** (Ctrl+C in its window) and **leave it stopped for good**. Two FarePay servers
   with the same data would both pay the owners at 21:00.
3. On the laptop, in `backend/`: `yarn backup`. It saves `data\backups\farepay-YYYY-MM-DD.pgdump`.
4. Copy it to the server: `scp data\backups\farepay-YYYY-MM-DD.pgdump ubuntu@<server-ip>:/tmp/`
5. On the server, before FarePay has ever started:
   ```bash
   cd /opt/farepay/backend
   export DATABASE_URL=$(sudo grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-)   # for this window only
   pg_restore --no-owner --exit-on-error --dbname="$DATABASE_URL" /tmp/farepay-YYYY-MM-DD.pgdump
   rm /tmp/farepay-YYYY-MM-DD.pgdump
   ```
   It must finish without any message. (This was rehearsed on 2026-10-12: every table came across identical,
   and the money check passed on the copy.)

Printed QR stickers keep working. Phones have to sign in again once, because the server has a new `JWT_SECRET`.

## 6. Start it

```bash
sudo cp /opt/farepay/deploy/farepay.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now farepay
sudo journalctl -u farepay -f        # the server's messages (Ctrl+C to stop watching)
```

If you started empty, create the first SACCO office account (and a platform admin for yourself):

```bash
cd /opt/farepay/backend
sudo -u farepay node --env-file=.env scripts/create-admin.js --name "Office Name" --phone 07XXXXXXXX --password "a-strong-password"
sudo -u farepay node --env-file=.env scripts/create-admin.js --platform --name "Your Name" --phone 07XXXXXXXX --password "a-strong-password"
```

## 7. https address

```bash
sudo cp /opt/farepay/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # replace api.example.co.ke with your address
sudo systemctl reload caddy
curl https://<your-address>/health    # should answer {"ok":true}
```

Then open `https://<your-address>/office/` in a browser and sign in with an office account. The Money check
page should show every check passed.

## 8. QR stickers

With the https address set (`MPESA_CALLBACK_BASE_URL`), every sticker is a link to
`https://<your-address>/pay?v=...`: passengers without the app scan it with the phone camera and pay by
M-Pesa PIN; the FarePay app scans the same sticker. **Print the stickers only once the address is final**:
a sticker made while on a temporary tunnel address stops opening when that address changes.

## 9. Point the app at the server

- **Already installed apps:** on the sign-in screen, tap *Server address* and enter `https://<your-address>`.
- **New APK:** in `mobile/eas.json`, set `EXPO_PUBLIC_API_URL` to `https://<your-address>`, then build:
  `cd mobile; $env:EAS_NO_VCS='1'; npx eas build -p android --profile preview`.
  From then on the address never changes, so no more tunnel.

## 10. Backups

- The server saves a full copy of the database every night at 03:00 into `/opt/farepay/backend/data/backups`
  (`farepay-YYYY-MM-DD.pgdump`) and keeps the last 14. Make one any time:
  `cd /opt/farepay/backend && sudo -u farepay node --env-file=.env scripts/backup.js`.
- **Also keep copies off the server**, because a backup on the same disk is lost with the disk.
  Simplest: once a week, download the newest file to your laptop:
  `scp ubuntu@<server-ip>:/opt/farepay/backend/data/backups/farepay-YYYY-MM-DD.pgdump .`
  (Automatic option: `rclone` can copy the backups folder to Google Drive every night.)
- **Restore** (this replaces everything in the database with the backup):
  ```bash
  sudo systemctl stop farepay
  sudo -u postgres dropdb farepay && sudo -u postgres createdb --owner=farepay farepay
  cd /opt/farepay/backend && export DATABASE_URL=$(sudo grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-)
  pg_restore --no-owner --exit-on-error --dbname="$DATABASE_URL" data/backups/farepay-YYYY-MM-DD.pgdump
  sudo systemctl start farepay
  ```
  Anything paid after the backup was taken is not in it: check M-Pesa statements (Statement check page)
  before money moves again.

## 11. Updating FarePay later

```bash
cd /opt/farepay-src && sudo git pull
sudo cp -r /opt/farepay-src/. /opt/farepay/ && sudo chown -R farepay:farepay /opt/farepay
cd /opt/farepay/backend && sudo -u farepay yarn install --frozen-lockfile --production
cd /opt/farepay/admin-web && sudo -u farepay yarn install --frozen-lockfile && sudo -u farepay yarn build
sudo systemctl restart farepay
```

The database upgrades itself when the server starts. A backup is taken every night, but make one
before big updates anyway.

## 12. Before switching on real money

- [ ] Safaricom Go Live approved for your Paybill (C2B/STK) and for B2C (and B2B if owners are paid to banks).
- [ ] Production Daraja keys, passkey, shortcode, initiator name and security credential in `.env`.
- [ ] `MPESA_MODE=production` and `NODE_ENV=production` (the server refuses real money otherwise).
- [ ] `https://<your-address>/health` answers; a KES 10 top-up and a KES 10 withdrawal work end to end.
- [ ] Office passwords are strong and not shared; only the people who need it have office accounts.
- [ ] You can download a backup to your laptop, and you have tried restoring one.
- [ ] The laptop server is stopped for good (only one FarePay server may ever run).
- [ ] The first evening, check the payouts and the 23:00 money check (the office is notified if anything is out).
