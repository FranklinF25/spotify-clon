import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import { useAuthStore } from '@/store/auth.store';
import { buildUploadResult } from '@/test/fakes';
import { UploadPage } from './UploadPage';

/**
 * F7 — UploadPage integration spec (REQ-UPLOAD-002).
 *
 * This is the REAL-transport path: the page's uploadFile goes through jsdom's
 * actual XMLHttpRequest, which MSW's node interceptors catch (verified — see
 * handlers.ts). The 201 handler is the shared default from test/msw/handlers;
 * error envelopes are per-spec `server.use` overrides. Wire-level determinism
 * (progress math, 401-refresh retry) lives in the use-upload-track +
 * http-client specs with the FakeXMLHttpRequest; here we assert what the USER
 * sees: drop zone, per-file rows, progress semantics, honest error copy,
 * client-side rejects with zero network traffic, and the batch summary.
 */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function authed() {
  useAuthStore.setState({
    status: 'authenticated' as const,
    user: { id: 'u', email: 'a@b.co', displayName: 'A' },
    accessToken: 'tok',
    bootRefreshStarted: false,
  });
}

function mp3(name: string, bytes = 1024 * 1024): File {
  return new File([new Uint8Array(bytes)], name, { type: 'audio/mpeg' });
}

function selectFiles(files: File[]): void {
  fireEvent.change(screen.getByLabelText('Add audio files'), {
    target: { files },
  });
}

describe('UploadPage — REQ-UPLOAD-002', () => {
  it('renders the drop zone (browse button, accepted formats, size limit)', () => {
    authed();
    render(<UploadPage />);
    expect(
      screen.getByRole('button', { name: /browse files/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/drop audio files here/i)).toBeInTheDocument();
    expect(screen.getByText(/150 mb/i)).toBeInTheDocument();
  });

  it('selecting two files starts parallel uploads: progressbars render, then success rows + summary', async () => {
    authed();
    render(<UploadPage />);
    selectFiles([mp3('a.mp3'), mp3('b.mp3')]);

    // Both transfers are in flight synchronously after the change event —
    // two progressbar rows with the full min/now/max semantics.
    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(bar).toHaveAttribute('aria-valuemin', '0');
      expect(bar).toHaveAttribute('aria-valuemax', '100');
      expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(0);
    }
    expect(screen.getAllByText(/uploading…/i)).toHaveLength(2);
    // Size renders in MB (1 MiB fixture → "1.0 MB").
    expect(screen.getAllByText('1.0 MB')).toHaveLength(2);

    // Success rows: the derived title/artist/album from the 201 contract.
    const rows = await screen.findAllByText(
      /added as Track \d+ by Artist \d+ \(album Album \d+\)/i,
    );
    expect(rows).toHaveLength(2);
    // Terminal state: bars replaced by green checks; summary settles.
    await waitFor(() =>
      expect(screen.queryAllByRole('progressbar')).toHaveLength(0),
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('2 uploaded'),
    );
  });

  it('dropping files on the zone feeds the same pipeline', async () => {
    authed();
    render(<UploadPage />);
    fireEvent.drop(screen.getByTestId('dropzone'), {
      dataTransfer: { files: [mp3('dropped.mp3')] },
    });
    expect(
      await screen.findAllByText(
        /added as Track \d+ by Artist \d+ \(album Album \d+\)/i,
      ),
    ).toHaveLength(1);
  });

  it('a 400 envelope renders the honest issue from details[0] and the summary counts the failure', async () => {
    authed();
    // The override rejects ANY upload (e.g. a multer mid-stream rejection):
    // the file itself passes client validation, so the row's fate is decided
    // by the SERVER — the honest-copy path under test.
    server.use(
      http.post(
        endpoints.tracks.upload,
        () =>
          HttpResponse.json(
            {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'File upload was rejected',
                details: [
                  { field: 'file', issue: 'unsupported file extension .exe' },
                ],
              },
            },
            { status: 400 },
          ),
      ),
    );
    render(<UploadPage />);
    selectFiles([mp3('rejected.mp3')]);
    expect(
      await screen.findByText('unsupported file extension .exe'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('0 uploaded, 1 failed'),
    );
  });

  it('client-side rejects a .txt pick with NO network call', async () => {
    authed();
    const uploadSpy = vi.fn(() =>
      HttpResponse.json(buildUploadResult(), { status: 201 }),
    );
    server.use(http.post(endpoints.tracks.upload, uploadSpy));
    render(<UploadPage />);
    selectFiles([new File([new Uint8Array(8)], 'notes.txt', { type: 'text/plain' })]);
    expect(
      await screen.findByText(/unsupported file type — allowed: mp3, flac, ogg, m4a, wav, opus/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('0 uploaded, 1 failed'),
    );
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('client-side rejects an oversized file (>150MB) without a request', async () => {
    authed();
    const uploadSpy = vi.fn(() =>
      HttpResponse.json(buildUploadResult(), { status: 201 }),
    );
    server.use(http.post(endpoints.tracks.upload, uploadSpy));
    render(<UploadPage />);
    selectFiles([mp3('huge.mp3', 151 * 1024 * 1024)]);
    expect(
      await screen.findByText('File exceeds the 150 MB upload limit'),
    ).toBeInTheDocument();
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('mixed batch: 3 uploaded, 1 failed (the .txt never leaves the browser)', async () => {
    authed();
    const uploadSpy = vi.fn(() =>
      HttpResponse.json(buildUploadResult(), { status: 201 }),
    );
    server.use(http.post(endpoints.tracks.upload, uploadSpy));
    render(<UploadPage />);
    selectFiles([
      mp3('one.mp3'),
      mp3('two.mp3'),
      mp3('three.mp3'),
      new File([new Uint8Array(8)], 'liner-notes.txt', { type: 'text/plain' }),
    ]);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('3 uploaded, 1 failed'),
    );
    expect(uploadSpy).toHaveBeenCalledTimes(3); // the .txt cost zero requests
    expect(screen.getAllByText(/added as Track \d+/i)).toHaveLength(3);
  });
});
