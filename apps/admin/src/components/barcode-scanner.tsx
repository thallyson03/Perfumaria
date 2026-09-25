"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  title?: string;
};

type ScanControls = { stop: () => void };

export function BarcodeScanner({
  open,
  onClose,
  onDetected,
  title = "Ler código de barras",
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let controls: ScanControls | null = null;
    setError(null);
    setReady(false);

    async function start() {
      const video = videoRef.current;
      if (!video) return;
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (stopped) return;
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromVideoDevice(
          undefined,
          video,
          (result) => {
            const code = result?.getText()?.trim();
            if (!code || stopped) return;
            stopped = true;
            controls?.stop();
            onDetectedRef.current(code);
          }
        );
        if (stopped) {
          controls.stop();
          return;
        }
        setReady(true);
      } catch (err) {
        if (stopped) return;
        const name = err instanceof DOMException ? err.name : "";
        setError(
          name === "NotAllowedError"
            ? "Permita o uso da câmera para ler o código."
            : name === "NotFoundError"
              ? "Nenhuma câmera encontrada neste aparelho."
              : "Não foi possível abrir a câmera."
        );
      }
    }

    void start();

    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="cam-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="cam-sheet">
        <div className="cam-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="cam-close" onClick={onClose}>
            Fechar
          </button>
        </div>
        <div className="cam-view">
          <video ref={videoRef} muted playsInline autoPlay />
          <div className="cam-frame" aria-hidden="true" />
          {!ready && !error && <p className="cam-status">Abrindo câmera…</p>}
        </div>
        <p className="cam-hint">
          Aponte para o código. A leitura acontece automaticamente.
        </p>
        {error && <p className="cam-error">{error}</p>}
      </div>
    </div>
  );
}
