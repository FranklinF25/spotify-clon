import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { FakeXMLHttpRequest } from '@/test/fakes/fake-xml-http-request';
import { useAuthStore } from '@/store/auth.store';
import { ApiError } from '@/lib/api/http-client';
import { useUploadTrack } from './use-upload-track';

/**
 * F7 — useUploadTrack orchestration spec.
 *
 * Transport is the FakeXMLHttpRequest (MSW cannot emit upload.onprogress);
 * the REAL jsdom-XHR-through-MSW integration is proven by the UploadPage
 * spec. What this file pins down:
 *  - start(file, onProgress) wires ONE transfer: multipart field "file",
 *    Bearer from the store, credentials included.
 *  - XHR progress events map to 0..1 fractions on the callback.
 *  - success resolves the 201 UploadResult AND invalidates the catalog
 *    cache ROOTS (['search'], ['albums'], ['artists']).
 *  - failure propagates the ApiError and invalidates NOTHING.
 */

const FILE = new File([new Uint8Array(2048)], 'nightcall.mp3', {
  type: 'audio/mpeg',
});

const CONTRACT = {
  track: {
    id: 'track-001',
    title: 'Nightcall',
    durationSeconds: 250,
    albumId: 'album-001',
  },
  artist: { id: 'artist-001', name: 'Kavinsky' },
  album: { id: 'album-001', title: 'OutRun' },
};

/**
 * Click-to-start harness. The outcome lands in a span so the spec can waitFor
 * the async pipeline: `ok:<title>` / `err:<code>|<message>|<first issue>`.
 */
function Harness({
  file,
  onProgress,
}: {
  file: File;
  onProgress?: (fraction: number) => void;
}) {
  const upload = useUploadTrack();
  const [out, setOut] = useState('idle');
  return (
    <div>
      <span data-testid="out">{out}</span>
      <button
        data-testid="start"
        onClick={() => {
          setOut('pending');
          upload(file, onProgress).then(
            (r) => setOut(`ok:${r.track.title}`),
            (e: unknown) => {
              const err = e instanceof ApiError ? e : null;
              setOut(
                `err:${
                  err
                    ? `${err.code}|${err.message}|${err.details[0]?.issue ?? ''}`
                    : String(e)
                }`,
              );
            },
          );
        }}
      />
    </div>
  );
}

beforeEach(() => {
  FakeXMLHttpRequest.reset();
  vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
  useAuthStore.setState({ accessToken: 'tok' });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useUploadTrack — transfer wiring (REQ-UPLOAD-002)', () => {
  it('POSTs the multipart body with field "file", Bearer token, and credentials', () => {
    render(<Harness file={FILE} />);
    screen.getByTestId('start').click();
    const xhr = FakeXMLHttpRequest.sent[0]!;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/v1/tracks/upload');
    expect(xhr.headers['Authorization']).toBe('Bearer tok');
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.body).toBeInstanceOf(FormData);
    // FormData.append re-wraps the Blob (HTML spec) — assert name + size.
    const sent = (xhr.body as FormData).get('file') as File;
    expect(sent).toBeInstanceOf(File);
    expect(sent.name).toBe(FILE.name);
    expect(sent.size).toBe(FILE.size);
  });

  it('maps XHR upload.onprogress to 0..1 fractions', () => {
    const onProgress = vi.fn();
    render(<Harness file={FILE} onProgress={onProgress} />);
    screen.getByTestId('start').click();
    const xhr = FakeXMLHttpRequest.sent[0]!;
    xhr.emitProgress(0.25);
    xhr.emitProgress(0.75);
    expect(onProgress).toHaveBeenNthCalledWith(1, 0.25);
    expect(onProgress).toHaveBeenNthCalledWith(2, 0.75);
  });

  it('resolves the 201 contract and invalidates the catalog cache roots', async () => {
    const { queryClient } = render(<Harness file={FILE} />);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    screen.getByTestId('start').click();
    FakeXMLHttpRequest.sent[0]!.respond(201, CONTRACT);
    await waitFor(() =>
      expect(screen.getByTestId('out').textContent).toBe('ok:Nightcall'),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['search'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['albums'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['artists'] });
  });

  it('propagates the 400 VALIDATION_ERROR issue and invalidates NOTHING', async () => {
    const { queryClient } = render(<Harness file={FILE} />);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    screen.getByTestId('start').click();
    FakeXMLHttpRequest.sent[0]!.respond(
      400,
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'File upload was rejected',
          details: [
            { field: 'file', issue: 'unsupported file extension .exe' },
          ],
        },
      },
    );
    await waitFor(() =>
      expect(screen.getByTestId('out').textContent).toBe(
        'err:VALIDATION_ERROR|File upload was rejected|unsupported file extension .exe',
      ),
    );
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
