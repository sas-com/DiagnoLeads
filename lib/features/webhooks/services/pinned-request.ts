/**
 * Webhook transport pinned to the checked addresses (#330)
 *
 * `checkWebhookDestination` resolves the host name and checks every address. fetch would then
 * resolve the name again when it connects, and a DNS server answering with TTL 0 can return a
 * public address to the check and 127.0.0.1 or 169.254.169.254 to the connection (DNS
 * rebinding). This sends the request with `node:https` (or `node:http`, which the guard allows
 * outside production only) and a `lookup` that answers with the checked addresses only, so the
 * connection goes to exactly what was checked.
 *
 * - The URL's host name is still the TLS server name and the Host header, so the certificate is
 *   checked against the name as before. Certificate checks are never turned off.
 * - Redirects are never followed (node:http does not follow them); the caller sees the 3xx.
 * - No shared agent: a kept-alive socket would be reused by host name, not by checked address.
 * - Only the first `maxResponseBytes` of the body are read; the rest is dropped.
 * - The caller's signal ends the whole request (connect, TLS, response and body).
 */

import { type ClientRequest, type IncomingMessage, request as httpRequest } from 'node:http';
import { type RequestOptions, request as httpsRequest } from 'node:https';
import { type LookupFunction, isIP } from 'node:net';
import type { VettedAddress } from './url-guard';

/** Enough bytes for the 1000 characters stored from a response, even at 4 bytes a character */
export const PINNED_RESPONSE_MAX_BYTES = 4096;

/** Same shape as `https.request(options, onResponse)`; replaced in tests */
export type RequestFunction = (
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void
) => ClientRequest;

export type PinnedRequestOptions = {
  url: URL;
  /** The addresses the destination check accepted, in the order to try them */
  addresses: readonly VettedAddress[];
  method: string;
  headers: Record<string, string>;
  body: string;
  /** Aborting it ends the request with an `AbortError` */
  signal: AbortSignal;
  maxResponseBytes?: number;
  request?: RequestFunction;
};

export type PinnedResponse = {
  status: number;
  statusText: string;
  /** At most `maxResponseBytes` of the body as UTF-8; '' if the body could not be read */
  body: string;
};

/**
 * A `lookup` that never asks DNS: it answers with the given addresses. Node calls it with
 * `all: true` when it tries several addresses in turn (autoSelectFamily, on by default), and
 * without it otherwise; both get only checked addresses.
 */
export function pinnedLookup(addresses: readonly VettedAddress[]): LookupFunction {
  return (hostname, options, callback) => {
    const wanted = options.family === 4 || options.family === 6 ? options.family : undefined;
    const usable = wanted ? addresses.filter(({ family }) => family === wanted) : addresses;
    if (usable.length === 0) {
      const error: NodeJS.ErrnoException = new Error(`No checked address for ${hostname}`);
      error.code = 'ENOTFOUND';
      callback(error, '', 0);
      return;
    }
    if (options.all) {
      callback(
        null,
        usable.map(({ address, family }) => ({ address, family }))
      );
      return;
    }
    callback(null, usable[0].address, usable[0].family);
  };
}

/** The request options: connect to the checked addresses, but speak to the URL's host name */
export function pinnedRequestOptions({
  url,
  addresses,
  method,
  headers,
  body,
}: Pick<
  PinnedRequestOptions,
  'url' | 'addresses' | 'method' | 'headers' | 'body'
>): RequestOptions {
  const secure = url.protocol === 'https:';
  // The URL keeps the brackets of an IPv6 literal; the socket and TLS need the address alone
  const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1');
  return {
    protocol: url.protocol,
    hostname,
    port: url.port === '' ? (secure ? 443 : 80) : Number(url.port),
    path: `${url.pathname}${url.search}`,
    method,
    headers: {
      ...headers,
      // As fetch sent them: the name (and a non-default port) and the length of a string body
      Host: url.host,
      'Content-Length': String(Buffer.byteLength(body)),
    },
    lookup: pinnedLookup(addresses),
    // A fresh connection per request, so it always goes through the lookup above
    agent: false,
    // SNI takes a host name only; for an IP literal the certificate is checked against the IP
    ...(secure && isIP(hostname) === 0 ? { servername: hostname } : {}),
  };
}

function abortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

/** The default sender: node:https for https, node:http otherwise (development only) */
function requestFor(url: URL): RequestFunction {
  return url.protocol === 'https:' ? httpsRequest : httpRequest;
}

/**
 * Send the request to the checked addresses and read the status and the first part of the body.
 * Rejects with the socket or TLS error (its `code` kept, e.g. ECONNREFUSED), or with an
 * `AbortError` once the signal is aborted before the response arrives.
 */
export function sendPinnedRequest(options: PinnedRequestOptions): Promise<PinnedResponse> {
  const { url, body, signal, maxResponseBytes = PINNED_RESPONSE_MAX_BYTES } = options;
  const request = options.request ?? requestFor(url);

  return new Promise<PinnedResponse>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }

    let settled = false;
    let req: ClientRequest | undefined;
    // Set once the status has arrived: from then on a failure only cuts the body short
    let endBody: ((text: string) => void) | undefined;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      outcome();
    };
    const fail = (error: unknown) => {
      if (endBody) endBody('');
      else finish(() => reject(error));
    };
    const onAbort = () => {
      const error = abortError();
      fail(error);
      req?.destroy(error);
    };
    signal.addEventListener('abort', onAbort, { once: true });

    const onResponse = (response: IncomingMessage) => {
      const status = response.statusCode ?? 0;
      const statusText = response.statusMessage ?? '';
      const chunks: Buffer[] = [];
      let size = 0;
      endBody = (text: string) => {
        finish(() => resolve({ status, statusText, body: text }));
        // Nothing more is read: close the connection instead of draining the rest
        req?.destroy();
      };
      const read = () => Buffer.concat(chunks).toString('utf8');

      response.on('data', (chunk: Buffer) => {
        const room = maxResponseBytes - size;
        if (room > 0) {
          chunks.push(chunk.subarray(0, room));
          size += Math.min(room, chunk.length);
        }
        if (size >= maxResponseBytes) endBody?.(read());
      });
      response.on('end', () => endBody?.(read()));
      // As fetch's `text().catch(() => '')`: the status stands even if the body is cut off.
      // 'close' comes after 'end' too, when the outcome is already settled.
      response.on('error', () => endBody?.(''));
      response.on('close', () => endBody?.(''));
    };

    try {
      req = request(pinnedRequestOptions(options), onResponse);
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    req.on('error', fail);
    req.end(body);
  });
}
