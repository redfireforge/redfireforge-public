/**
 * Seed the Confluent Schema Registry demo subject used by kafka-live E2E
 * and the Kafka Schema Registry lesson. A fresh `docker compose up` leaves
 * GET /subjects empty — the UI then shows "no subjects are registered yet."
 */

const SR_URL = 'http://localhost:8085';
const SUBJECT = 'orders-value';

const ORDER_CREATED_V1 = {
  type: 'record',
  name: 'OrderCreated',
  namespace: 'redfireforge.demo',
  fields: [
    { name: 'orderId', type: 'string' },
    { name: 'customerId', type: 'string' },
    { name: 'totalAmount', type: 'double' },
    { name: 'status', type: 'string', default: 'NEW' },
    { name: 'createdAt', type: 'string' },
  ],
};

const ORDER_CREATED_V2 = {
  type: 'record',
  name: 'OrderCreated',
  namespace: 'redfireforge.demo',
  fields: [
    { name: 'orderId', type: 'string' },
    { name: 'customerId', type: 'string' },
    { name: 'totalAmount', type: 'double' },
    { name: 'currency', type: 'string', default: 'USD' },
    { name: 'status', type: 'string', default: 'NEW' },
    { name: 'createdAt', type: 'string' },
  ],
};

async function listSubjects(): Promise<string[]> {
  const resp = await fetch(`${SR_URL}/subjects`, { signal: AbortSignal.timeout(5_000) });
  if (!resp.ok) {
    throw new Error(`Schema Registry GET /subjects failed: ${resp.status}`);
  }
  const body = (await resp.json()) as unknown;
  return Array.isArray(body) ? body.filter((s): s is string => typeof s === 'string') : [];
}

async function registerAvro(schema: object): Promise<void> {
  const resp = await fetch(`${SR_URL}/subjects/${encodeURIComponent(SUBJECT)}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/vnd.schemaregistry.v1+json' },
    body: JSON.stringify({ schemaType: 'AVRO', schema: JSON.stringify(schema) }),
    signal: AbortSignal.timeout(8_000),
  });
  // 409 = identical schema already registered
  if (!resp.ok && resp.status !== 409) {
    throw new Error(`Schema Registry seed ${SUBJECT} failed: ${resp.status} ${await resp.text()}`);
  }
}

/** Idempotent: registers orders-value v1 then v2 when the subject is missing. */
export async function seedSchemaRegistryOrdersValue(): Promise<void> {
  const subjects = await listSubjects();
  if (subjects.includes(SUBJECT)) return;
  await registerAvro(ORDER_CREATED_V1);
  await registerAvro(ORDER_CREATED_V2);
}
