/**
 * API Mock Studio — TLS helpers (Phase 10).
 * Self-signed pairs are generated with the system `openssl` so the studio does
 * not take a certificate library dependency.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface SelfSignedPair {
  certPem: string;
  keyPem: string;
}

export interface ClientCredentials {
  /** CA certificate the listener trusts. Stored in settings. */
  caCertPem: string;
  /** Issued client certificate. Public — handed to the client. */
  clientCertPem: string;
  /** Issued client private key. Secret. */
  clientKeyPem: string;
  commonName: string;
}

export interface TlsMaterialCheck {
  ok: boolean;
  error?: string;
}

/** Cheap shape check so a bad paste fails in the UI rather than at listen time. */
export function validateTlsMaterial(certPem: string, keyPem: string): TlsMaterialCheck {
  if (!certPem.trim() || !keyPem.trim()) {
    return { ok: false, error: 'Both a certificate and a private key are required.' };
  }
  if (!/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(certPem)) {
    return { ok: false, error: 'Certificate must be PEM text containing a CERTIFICATE block.' };
  }
  if (!/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]+-----END (?:RSA |EC )?PRIVATE KEY-----/.test(keyPem)) {
    return { ok: false, error: 'Private key must be PEM text containing a PRIVATE KEY block.' };
  }
  return { ok: true };
}

/**
 * Generate a localhost certificate valid for the given hosts. Includes a SAN
 * list because browsers reject certificates that only carry a common name.
 */
export async function generateSelfSigned(hosts: string[] = ['localhost', '127.0.0.1']): Promise<SelfSignedPair> {
  const dnsNames = hosts.filter(h => !/^[\d.:]+$/.test(h));
  const ipNames = hosts.filter(h => /^[\d.:]+$/.test(h));
  const san = [
    ...dnsNames.map(h => `DNS:${h}`),
    ...ipNames.map(h => `IP:${h}`),
  ].join(',') || 'DNS:localhost,IP:127.0.0.1';

  const dir = await mkdtemp(join(tmpdir(), 'rf-apimock-tls-'));
  const certPath = join(dir, 'cert.pem');
  const keyPath = join(dir, 'key.pem');
  try {
    await run('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certPath,
      '-days', '365', '-subj', '/CN=localhost/O=RedfireForge API Mock',
      '-addext', `subjectAltName=${san}`,
    ]);
    const [certPem, keyPem] = await Promise.all([
      readFile(certPath, 'utf8'),
      readFile(keyPath, 'utf8'),
    ]);
    return { certPem, keyPem };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error('openssl was not found on PATH. Install it, or paste an existing certificate and key.', { cause: err });
    }
    throw new Error(`Could not generate a self-signed certificate: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Issue a client certificate for mutual TLS, along with the CA that signed it.
 *
 * The studio acts as the CA so the client never has to produce a key and CSR —
 * it receives a ready-to-use certificate and key. The private key therefore
 * leaves this machine, which is acceptable for mocks but not for production
 * credentials.
 */
export async function generateClientCredentials(commonName = 'api-mock-client'): Promise<ClientCredentials> {
  const cn = commonName.trim() || 'api-mock-client';
  const dir = await mkdtemp(join(tmpdir(), 'rf-apimock-mtls-'));
  const p = (f: string) => join(dir, f);
  try {
    await run('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', p('ca.key'), '-out', p('ca.crt'),
      '-days', '365', '-subj', '/CN=RedfireForge API Mock Client CA/O=RedfireForge API Mock',
      '-addext', 'basicConstraints=critical,CA:TRUE',
      '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
    ]);

    await run('openssl', [
      'req', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', p('client.key'), '-out', p('client.csr'),
      '-subj', `/CN=${cn.replace(/[/\n\r]/g, '-')}/O=RedfireForge API Mock`,
    ]);

    // clientAuth EKU is what makes the certificate usable as a client identity.
    await writeFile(p('client.ext'), [
      'basicConstraints=CA:FALSE',
      'keyUsage=critical,digitalSignature,keyEncipherment',
      'extendedKeyUsage=clientAuth',
    ].join('\n'), 'utf8');

    await run('openssl', [
      'x509', '-req', '-in', p('client.csr'),
      '-CA', p('ca.crt'), '-CAkey', p('ca.key'), '-CAcreateserial',
      '-out', p('client.crt'), '-days', '365',
      '-extfile', p('client.ext'),
    ]);

    const [caCertPem, clientCertPem, clientKeyPem] = await Promise.all([
      readFile(p('ca.crt'), 'utf8'),
      readFile(p('client.crt'), 'utf8'),
      readFile(p('client.key'), 'utf8'),
    ]);
    return { caCertPem, clientCertPem, clientKeyPem, commonName: cn };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error('openssl was not found on PATH. Install it, or paste an existing client CA certificate.', { cause: err });
    }
    throw new Error(`Could not issue a client certificate: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

interface PeerCertLike {
  subject?: { CN?: string | string[] };
  subjectaltname?: string;
  fingerprint256?: string;
}

function firstCn(cn: string | string[] | undefined): string {
  if (typeof cn === 'string') return cn.trim();
  if (Array.isArray(cn)) {
    for (const part of cn) {
      if (typeof part === 'string' && part.trim()) return part.trim();
    }
  }
  return '';
}

function peerCertSubject(cert: PeerCertLike): string {
  const cn = firstCn(cert.subject?.CN);
  if (cn) return `CN=${cn}`;
  const san = typeof cert.subjectaltname === 'string' ? cert.subjectaltname : '';
  for (const part of san.split(',')) {
    const dns = part.trim().match(/^DNS:(.+)$/i);
    if (dns?.[1]?.trim()) return `CN=${dns[1].trim()}`;
  }
  return '';
}

/**
 * Safe mTLS attributes for matching and traces. Never returns PEM or raw DER.
 */
export function peerCertificateAttrs(
  socket: { getPeerCertificate?: (detailed?: boolean) => PeerCertLike } | null | undefined,
): { clientCertSubject?: string; clientCertFingerprint?: string } {
  if (!socket || typeof socket.getPeerCertificate !== 'function') return {};
  let cert: PeerCertLike;
  try {
    cert = socket.getPeerCertificate();
  } catch {
    return {};
  }
  if (!cert || typeof cert !== 'object') return {};
  const subject = peerCertSubject(cert);
  const fpRaw = typeof cert.fingerprint256 === 'string' ? cert.fingerprint256 : '';
  const fingerprint = fpRaw.replace(/:/g, '').toLowerCase();
  return {
    ...(subject ? { clientCertSubject: subject } : {}),
    ...(fingerprint ? { clientCertFingerprint: fingerprint } : {}),
  };
}
