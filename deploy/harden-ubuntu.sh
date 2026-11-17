#!/usr/bin/env bash
# One-time hardening for a fresh Ubuntu 24.04 VPS. Run as root: bash harden-ubuntu.sh <your-username>
# Read it before running. It disables password SSH login, so make sure your SSH key works first.
set -euo pipefail
USER_NAME="${1:?usage: harden-ubuntu.sh <username>}"

apt-get update && apt-get -y upgrade
apt-get -y install ufw fail2ban unattended-upgrades ca-certificates curl git sqlite3 chrony

# Non-root user with sudo, reuse root's authorized SSH key
id "$USER_NAME" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$USER_NAME"
usermod -aG sudo "$USER_NAME"
mkdir -p /home/$USER_NAME/.ssh && cp /root/.ssh/authorized_keys /home/$USER_NAME/.ssh/ 2>/dev/null || true
chown -R $USER_NAME:$USER_NAME /home/$USER_NAME/.ssh && chmod 700 /home/$USER_NAME/.ssh && chmod 600 /home/$USER_NAME/.ssh/authorized_keys || true

# SSH: keys only, no root login
cat >/etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
X11Forwarding no
MaxAuthTries 3
AllowAgentForwarding no
EOF
systemctl restart ssh || systemctl restart sshd

# Firewall: only SSH in. The dashboard is reached through an SSH tunnel, never opened publicly.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

# Automatic security updates, time sync (deadlines depend on a correct clock)
dpkg-reconfigure -f noninteractive unattended-upgrades
systemctl enable --now chrony fail2ban

# Docker (official repo)
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" >/etc/apt/sources.list.d/docker.list
apt-get update && apt-get -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
usermod -aG docker "$USER_NAME"
# Docker publishes ports past ufw; our compose file binds 127.0.0.1 only, which keeps it private.

# 2 GB swap for small instances
if ! swapon --show | grep -q swap; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

echo "Done. Log in again as $USER_NAME (ssh $USER_NAME@<ip>) and follow docs/SETUP.md step 4."
