# Putting FarePay on a real server

Right now the FarePay server runs on a laptop and is reached through a temporary tunnel address that
changes. For real passengers and real money it must run on a server that is always on, at a fixed
`https://` address. This guide sets that up, one step at a time.

## What you need

1. **A Linux server** (Ubuntu 24.04), always on. Either:
   - **Free:** an Oracle Cloud "Always Free" VM (choose the Johannesburg region, the closest to Kenya).
     Oracle asks for a bank card to check who you are but does not charge for Always Free machines.
   - **Paid, simplest:** a small VPS, about USD 5–6 a month (for example DigitalOcean, Hetzner, Contabo, or a
     Kenyan host's VPS). 1 GB of memory is enough for one SACCO.
2. **A web address**, e.g. `api.yoursacco.co.ke`. Safaricom sends payment confirmations to it.
   - A `.co.ke` domain costs about KES 1,000 a year from any Kenyan registrar. This is recommended for
     real money: Safaricom and passengers trust it more.
   - Free alternative for testing: a DuckDNS subdomain (`yourname.duckdns.org`).
   - Point the address at your server's public IP (an "A record" at your domain registrar, or on DuckDNS).
3. **The FarePay code on GitHub** (a free *private* repository), so the server can download it.
   On your laptop, in the `farepay` folder:
   ```
   git remote add origin https://github.com/<you>/farepay.git
   git push -u origin master
   ```
   `.env`, the database and other secrets are never uploaded (see `.gitignore`).

## 1. Prepare the server

Connect with SSH (`ssh ubuntu@<server-ip>`), then:

```bash
# Node.js 24 and Git
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Caddy (handles https certificates automatically)
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy

# Firewall: only SSH and web traffic
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable
```

On **Oracle Cloud** also open ports 80 and 443 in the VCN's security list (Networking → Virtual Cloud
Networks → your network → Security Lists → Add Ingress Rules, source `0.0.0.0/0`), and run:
`sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -j ACCEPT && sudo netfilter-persistent save`.

## 2. Install FarePay

```bash
sudo useradd --system --create-home --home-dir /opt/farepay --shell /usr/sbin/nologin farepay
sudo git clone https://github.com/<you>/farepay.git /opt/farepay-src
sudo cp -r /opt/farepay-src/. /opt/farepay/ && sudo chown -R farepay:farepay /opt/farepay
cd /opt/farepay/backend
sudo -u farepay npm ci --omit=dev
sudo -u farepay mkdir -p data
```

## 3. Settings

```bash
sudo -u farepay cp /opt/farepay/deploy/env.production.example /opt/farepay/backend/.env
openssl rand -hex 32   # run twice: one for JWT_SECRET, one for MPESA_CALLBACK_SECRET
sudo -u farepay nano /opt/farepay/backend/.env
sudo chmod 600 /opt/farepay/backend/.env
```

Fill in the two secrets, `SACCO_NAME`, your address in `MPESA_CALLBACK_BASE_URL`, and the Daraja keys.
The server refuses to start in production if a secret is missing or too short, or if the address isn't
`https://`. Keep `MPESA_MODE=sandbox` until Safaricom approves Go Live.

## 4. Start it

```bash
sudo cp /opt/farepay/deploy/farepay.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now farepay
sudo journalctl -u farepay -f        # the server's messages (Ctrl+C to stop watching)

# The first SACCO office account (and a platform admin for yourself):
cd /opt/farepay/backend
sudo -u farepay node --env-file=.env scripts/create-admin.js --name "Office Name" --phone 07XXXXXXXX --password "a-strong-password"
sudo -u farepay node --env-file=.env scripts/create-admin.js --platform --name "Your Name" --phone 07XXXXXXXX --password "a-strong-password"
```

## 5. https address

```bash
sudo cp /opt/farepay/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # replace api.example.co.ke with your address
sudo systemctl reload caddy
curl https://<your-address>/health    # should answer {"ok":true}
```

## 6. Point the app at the server

- **Already installed apps:** on the sign-in screen, tap *Server address* and enter `https://<your-address>`.
- **New APK:** in `mobile/eas.json`, set `EXPO_PUBLIC_API_URL` to `https://<your-address>`, then build:
  `cd mobile; $env:EAS_NO_VCS='1'; npx eas build -p android --profile preview`.
  From then on the address never changes, so no more tunnel.

## 7. Backups

- The server saves a full copy of the database every night at 03:00 into `/opt/farepay/backend/data/backups`
  and keeps the last 14. Make one any time with `sudo -u farepay node --env-file=.env scripts/backup.js`.
- **Also keep copies off the server**, because a backup on the same disk is lost with the disk.
  Simplest: once a week, download the newest file to your laptop:
  `scp ubuntu@<server-ip>:/opt/farepay/backend/data/backups/farepay-YYYY-MM-DD.db .`
  (Automatic option: `rclone` can copy the backups folder to Google Drive every night.)
- **Restore:** stop the server (`sudo systemctl stop farepay`), copy the backup over
  `data/farepay.db` (delete `farepay.db-wal` and `farepay.db-shm` next to it), start it again.

## 8. Updating FarePay later

```bash
cd /opt/farepay-src && sudo git pull
sudo cp -r /opt/farepay-src/. /opt/farepay/ && sudo chown -R farepay:farepay /opt/farepay
cd /opt/farepay/backend && sudo -u farepay npm ci --omit=dev
sudo systemctl restart farepay
```

The database upgrades itself when the server starts. A backup is taken every night, but make one
before big updates anyway.

## 9. Before switching on real money

- [ ] Safaricom Go Live approved for your Paybill (C2B/STK) and for B2C (and B2B if owners are paid to banks).
- [ ] Production Daraja keys, passkey, shortcode, initiator name and security credential in `.env`.
- [ ] `MPESA_MODE=production` and `NODE_ENV=production` (the server refuses real money otherwise).
- [ ] `https://<your-address>/health` answers; a KES 10 top-up and a KES 10 withdrawal work end to end.
- [ ] Office passwords are strong and not shared; only the people who need it have office accounts.
- [ ] You can download a backup to your laptop.
- [ ] The first evening, check the payouts and the 23:00 money check (the office is notified if anything is out).
