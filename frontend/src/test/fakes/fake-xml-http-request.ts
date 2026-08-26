/**
 * Controllable XMLHttpRequest stand-in for the uploadFile wire-level specs.
 *
 * Division of labour (documented in handlers.ts too): MSW's node interceptors
 * DO catch jsdom's XHR, so the UploadPage spec exercises the real integration
 * through MSW. But MSW cannot EMIT `upload.onprogress` events nor stage a
 * mid-flight 401-then-refresh on the XHR path deterministically — THIS fake
 * can. Specs install it with `vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)`
 * and drive the recorded instances via `respond()` / `emitProgress()` /
 * `fireError()`; it never touches the network.
 *
 * Only the surface `httpClient.uploadFile` uses is implemented (open /
 * setRequestHeader / send / upload.onprogress / onload / onerror / onabort /
 * abort / withCredentials / status / responseText).
 */
export class FakeXMLHttpRequest {
  /** Every instance whose send() was called, in order — the spec's handle. */
  static sent: FakeXMLHttpRequest[] = [];
  static reset(): void {
    FakeXMLHttpRequest.sent = [];
  }

  upload: {
    onprogress:
      | ((e: { lengthComputable: boolean; loaded: number; total: number }) => void)
      | null;
  } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  withCredentials = false;
  status = 0;
  responseText = '';
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = null;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string): void {
    this.headers[key] = value;
  }

  send(body: unknown): void {
    this.body = body;
    FakeXMLHttpRequest.sent.push(this);
  }

  abort(): void {
    this.onabort?.();
  }

  // --- spec drivers ---------------------------------------------------------

  /** Fire an upload progress event as a fraction of the total (0..1+). */
  emitProgress(fraction: number): void {
    const total = 1000;
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded: Math.round(fraction * total),
      total,
    });
  }

  /** Complete the request with an HTTP status + body (object → JSON). */
  respond(status: number, body: unknown): void {
    this.status = status;
    this.responseText =
      typeof body === 'string' ? body : JSON.stringify(body);
    this.onload?.();
  }

  /** Fail the request at the network level (no status). */
  fireError(): void {
    this.onerror?.();
  }
}
