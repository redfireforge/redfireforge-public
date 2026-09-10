import {
  GRPC_STREAM_RECONNECT_BACKOFF_MS,
  GRPC_STREAM_RECONNECT_MAX_ATTEMPTS,
  type GrpcRouteEnvelope,
  type GrpcStreamEvent,
} from './contracts';
import { buildGrpcStreamQuery, resolveGrpcExpressProxyUrl } from './grpcExpressProxyJsonTransport';
import { parseGrpcSseStream, parseGrpcStreamEventJson } from './grpcStreamSseParser';

type GrpcStreamEventsState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed';

type OpenGrpcStreamEventsOptionsLike = {
  onEvent: (event: GrpcStreamEvent) => void;
  onStateChange?: (state: GrpcStreamEventsState, attempt?: number) => void;
  onError?: (message: string) => void;
  lastSequence?: number;
  expectedRequestId?: string;
  resolveLastSequence?: () => number;
  signal?: AbortSignal;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function isNonRetryableGrpcStreamEventsStatus(status: number): boolean {
  return status === 404 || status === 409;
}

function isTerminalGrpcStreamEvent(event: GrpcStreamEvent): boolean {
  return event.type === 'grpc-end' || event.type === 'grpc-error';
}

function shouldDeliverGrpcStreamEventToSubscriber(
  event: GrpcStreamEvent,
  streamId: string,
  tabId: string,
  expectedRequestId?: string,
): boolean {
  if (event.tabId !== tabId || event.streamId !== streamId) {
    return false;
  }
  if (expectedRequestId && event.requestId !== expectedRequestId) {
    return false;
  }
  return true;
}

function parseGrpcStreamEventFrame(eventName: string, data: string): GrpcStreamEvent | null {
  try {
    const parsed = parseGrpcStreamEventJson(data);
    if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) {
      return null;
    }
    const event = parsed as GrpcStreamEvent;
    if (event.type !== eventName && eventName !== 'message') {
      // Server sets both SSE event name and JSON type — prefer JSON type.
    }
    return event;
  } catch {
    return null;
  }
}

/**
 * Opens SSE subscription to stream events with reconnect policy (max 3, 1s/2s/4s backoff).
 * Returns dispose function — aborts fetch and stops reconnect loop.
 */
export function openGrpcStreamEventsViaSse(
  streamId: string,
  tabId: string,
  options: OpenGrpcStreamEventsOptionsLike,
): () => void {
  const abortController = new AbortController();
  if (options.signal) {
    options.signal.addEventListener('abort', () => abortController.abort(), { once: true });
  }

  let disposed = false;
  let reconnectAttempt = 0;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    abortController.abort();
    options.onStateChange?.('closed');
  };

  const connectLoop = async () => {
    while (!disposed) {
      const isReconnect = reconnectAttempt > 0;
      options.onStateChange?.(isReconnect ? 'reconnecting' : 'connecting', reconnectAttempt);

      const query = buildGrpcStreamQuery(tabId, {
        lastSequence: options.resolveLastSequence?.() ?? options.lastSequence,
      });
      const url = resolveGrpcExpressProxyUrl(
        `/api/grpc/stream/${encodeURIComponent(streamId)}/events?${query}`,
      );

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'text/event-stream' },
          signal: abortController.signal,
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          let message = `Stream events failed (${response.status})`;
          try {
            const envelope = JSON.parse(errorBody) as GrpcRouteEnvelope<never>;
            if (!envelope.ok) {
              message = envelope.error.message;
            }
          } catch {
            // use default message
          }
          if (isNonRetryableGrpcStreamEventsStatus(response.status)) {
            options.onError?.(message);
            options.onStateChange?.('closed');
            return;
          }
          throw new Error(message);
        }

        if (!response.body) {
          throw new Error('Stream events response has no body');
        }

        reconnectAttempt = 0;
        options.onStateChange?.('connected');

        let sawTerminal = false;
        for await (const frame of parseGrpcSseStream(response.body)) {
          if (disposed) break;
          if (frame.event === 'grpc-heartbeat') {
            continue;
          }
          const event = parseGrpcStreamEventFrame(frame.event, frame.data);
          if (!event) continue;
          if (!shouldDeliverGrpcStreamEventToSubscriber(
            event,
            streamId,
            tabId,
            options.expectedRequestId,
          )) {
            continue;
          }
          options.onEvent(event);
          if (isTerminalGrpcStreamEvent(event)) {
            sawTerminal = true;
            break;
          }
        }

        if (disposed || sawTerminal) {
          return;
        }

        // Stream ended without terminal event — treat as disconnect, try reconnect.
        throw new Error('SSE stream closed unexpectedly');
      } catch (error) {
        if (disposed) return;
        if (error instanceof DOMException && error.name === 'AbortError') {
          options.onStateChange?.('closed');
          return;
        }

        reconnectAttempt += 1;
        if (reconnectAttempt > GRPC_STREAM_RECONNECT_MAX_ATTEMPTS) {
          const message = error instanceof Error ? error.message : String(error);
          options.onError?.(message);
          options.onStateChange?.('closed');
          return;
        }

        const backoff = GRPC_STREAM_RECONNECT_BACKOFF_MS[
          Math.min(reconnectAttempt - 1, GRPC_STREAM_RECONNECT_BACKOFF_MS.length - 1)
        ]!;
        try {
          await sleep(backoff, abortController.signal);
        } catch {
          options.onStateChange?.('closed');
          return;
        }
      }
    }
  };

  void connectLoop();
  return dispose;
}
