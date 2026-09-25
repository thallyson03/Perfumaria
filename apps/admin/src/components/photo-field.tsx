"use client";

type Props = {
  uploading: boolean;
  previewUrl: string | null;
  onFile: (file: File) => void;
  label?: string;
};

export function PhotoField({
  uploading,
  previewUrl,
  onFile,
  label = "Foto do produto",
}: Props) {
  return (
    <div className="cam-photo">
      <span className="cam-photo-label">{label}</span>
      <div className="cam-photo-row">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="cam-photo-preview" />
        ) : (
          <div className="cam-photo-preview cam-photo-empty">Sem foto</div>
        )}
        <div className="cam-photo-actions">
          <label className="cam-photo-btn">
            {uploading ? "Enviando…" : "Tirar foto"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) onFile(file);
              }}
            />
          </label>
          <label className="cam-photo-btn cam-photo-btn--ghost">
            Galeria
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) onFile(file);
              }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
