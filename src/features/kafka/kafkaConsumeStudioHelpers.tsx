import { parseKafkaTimestamp, formatKafkaDateTime, formatTimestampTooltip } from './kafkaTimestamp';

export function renderKafkaTimestampCell(ts: string | undefined) {
  const date = parseKafkaTimestamp(ts);
  if (!date) return <td className="kafka-ts-cell kafka-ts-missing" data-testid="ts-cell-missing">-</td>;
  return (
    <td
      className="kafka-ts-cell"
      title={formatTimestampTooltip(date)}
      data-testid="ts-cell"
    >
      {formatKafkaDateTime(date)}
    </td>
  );
}
