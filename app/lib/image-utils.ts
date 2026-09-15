const MAX_FILE_SIZE = 12 * 1024 * 1024;
const MAX_IMAGE_EDGE = 900;
const MAX_UPLOAD_SIZE = 500_000;
const MIN_IMAGE_EDGE = 240;

export interface PreparedImage {
  previewDataUrl: string;
  uploadBlob: Blob;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("画像を処理できませんでした。"));
      },
      "image/jpeg",
      quality,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("画像を表示できませんでした。"));
    image.src = src;
  });
}

export async function prepareImageFile(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("画像ファイルを選択してください。");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("画像は12MB以下にしてください。");
  }

  const source = await readAsDataUrl(file);
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  let targetEdge = Math.min(
    MAX_IMAGE_EDGE,
    Math.max(image.width, image.height),
  );

  while (targetEdge >= MIN_IMAGE_EDGE) {
    const scale = Math.min(
      1,
      targetEdge / Math.max(image.width, image.height),
    );
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("画像を処理できませんでした。");

    context.fillStyle = "#fffaf1";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (let quality = 0.82; quality >= 0.42; quality -= 0.1) {
      const blob = await canvasToBlob(canvas, quality);
      if (blob.size < MAX_UPLOAD_SIZE) {
        return {
          previewDataUrl: await readAsDataUrl(blob),
          uploadBlob: blob,
        };
      }
    }

    targetEdge = Math.floor(targetEdge * 0.8);
  }

  throw new Error("画像を500KB未満に圧縮できませんでした。");
}
