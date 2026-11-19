/**
 * Minimal one-page PDF containing a JPEG image (used to export the whiteboard).
 * The JPEG is embedded as-is (DCTDecode), so no PDF library is needed.
 */
export async function jpegToPdf(jpeg: Blob, widthPx: number, heightPx: number): Promise<Blob> {
  const img = new Uint8Array(await jpeg.arrayBuffer());
  // Page size in points (A4 landscape width, height from the image's aspect ratio).
  const pageW = 842;
  const pageH = Math.round((pageW * heightPx) / widthPx);
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === "string" ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const obj = (n: number, body: string | (() => void)) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    if (typeof body === "string") push(body);
    else body();
    push("\nendobj\n");
  };
  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`);
    push(img);
    push("\nendstream");
  });
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n`);
  for (let i = 1; i <= 5; i++) push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}
