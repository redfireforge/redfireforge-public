# Shared helpers for demo TLS cert date parsing.
# Sourced by renew-demo-tls-certs.sh and check-cert-expiry.sh.
# notAfter is GMT. Always emit the UTC calendar date — local TZ would shift
# early-UTC expiries (e.g. Jul 1 02:06 GMT → Jun 30 in US/Eastern).

iso_from_cert() {
  local cert=$1
  local raw iso
  raw=$(openssl x509 -noout -enddate -in "$cert" | cut -d= -f2)
  # Same UTC calendar date as src/__tests__/certExpiry.test.ts (Date#toISOString).
  # Do not use GNU/BSD `date` here — day padding and leftover clock fields differ.
  iso=$(node -e '
    const raw = process.argv[1];
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) process.exit(1);
    process.stdout.write(d.toISOString().slice(0, 10));
  ' "$raw") || {
    echo "Failed to parse expiry from $cert (raw: $raw)" >&2
    return 1
  }
  if [[ -z "$iso" ]]; then
    echo "Failed to parse expiry from $cert (raw: $raw)" >&2
    return 1
  fi
  printf '%s\n' "$iso"
}

# stack.json must match the shortest UTC date among the stack's certs
# (same rule as src/__tests__/certExpiry.test.ts).
shortest_iso() {
  local shortest="" iso
  for cert in "$@"; do
    if [[ ! -f "$cert" ]]; then
      echo "Missing cert: $cert" >&2
      return 1
    fi
    iso=$(iso_from_cert "$cert")
    if [[ -z "$shortest" || "$iso" < "$shortest" ]]; then
      shortest=$iso
    fi
  done
  printf '%s\n' "$shortest"
}

# Calendar days from today (UTC) to an ISO date. Matches Rust cert_days_remaining
# and src/__tests__/certExpiry.test.ts. Do not use BSD `date -j` with a date-only
# format — unspecified clock fields carry over and can shift the day count.
calendar_days_remaining() {
  local iso=$1
  node -e '
    const expiry = Date.parse(process.argv[1] + "T00:00:00Z");
    const today = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    if (Number.isNaN(expiry) || Number.isNaN(today)) process.exit(1);
    process.stdout.write(String(Math.floor((expiry - today) / 86400000)));
  ' "$iso"
}
