// Dynamic import to avoid SSR/module-evaluation issues with DOMMatrix

export async function renderPdfToImages(file: File): Promise<HTMLCanvasElement[]> {
  const canvases: HTMLCanvasElement[] = [];

  try {
    // Dynamically import pdfjs-dist only on the client side
    const pdfjsLib = await import('pdfjs-dist');

    // Configure worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    
    // Load the PDF document
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdfDocument = await loadingTask.promise;

    const numPages = pdfDocument.numPages;

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      try {
        const page = await pdfDocument.getPage(pageNum);
        
        // Render at 2x scale for better OCR accuracy
        const scale = 2.0;
        const viewport = page.getViewport({ scale });

        // Prepare offscreen canvas
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        
        if (!context) {
          console.warn(`[pdfRenderer] Could not get 2D context for page ${pageNum}. Skipping.`);
          continue;
        }

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        // Render PDF page into canvas context
        await page.render(renderContext).promise;
        
        canvases.push(canvas);

      } catch (pageError) {
        console.warn(`[pdfRenderer] Failed to render page ${pageNum}:`, pageError);
        // Skip this page but continue processing
        continue;
      }
    }
  } catch (err) {
    console.error('[pdfRenderer] Failed to load or process the PDF file:', err);
  }

  return canvases;
}
