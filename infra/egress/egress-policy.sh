#!/usr/bin/env bash
# T-01 / ADR-0015: network egress policy for the verification-egress worker (documented + reference implementation, iptables).
# Usage (host, as root): EGRESS_SUBNET=172.28.0.0/24 REDIS_IP=172.28.0.2 DNS_SERVERS="1.1.1.1 8.8.8.8" ./egress-policy.sh
# Rules go in DOCKER-USER (evaluated before Docker's own forwarding). Kubernetes equivalent: a NetworkPolicy/Cilium policy with the same
# CIDR exceptions. Print-only by default; set APPLY=1 to execute.
set -euo pipefail
: "${EGRESS_SUBNET:?}" "${REDIS_IP:?}" "${DNS_SERVERS:?}"
run() { if [ "${APPLY:-0}" = 1 ]; then "$@"; else echo "$*"; fi; }
C=DOCKER-USER
# never reach: RFC1918, CGNAT, loopback, link-local (incl. cloud metadata 169.254.169.254), multicast/reserved
DENY="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 0.0.0.0/8 224.0.0.0/4 240.0.0.0/4"
run iptables -I $C -s "$EGRESS_SUBNET" -j DROP                                             # default deny (evaluated last)
run iptables -I $C -s "$EGRESS_SUBNET" -p tcp -m multiport --dports 80,443 -j ACCEPT       # web fetches
for d in $DNS_SERVERS; do
  run iptables -I $C -s "$EGRESS_SUBNET" -d "$d" -p udp --dport 53 -j ACCEPT               # DNS only to VERIFY_DNS_SERVERS
  run iptables -I $C -s "$EGRESS_SUBNET" -d "$d" -p tcp --dport 53 -j ACCEPT
done
run iptables -I $C -s "$EGRESS_SUBNET" -d "$REDIS_IP" -p tcp --dport 6379 -j ACCEPT        # the queue
for n in $DENY; do run iptables -I $C -s "$EGRESS_SUBNET" -d "$n" -p tcp -m multiport --dports 80,443 -j DROP; done
# NB: the Redis/DNS ACCEPTs are inserted after the DROPs, so they sit above them; the 80/443 DROPs outrank the 80/443 ACCEPT.
