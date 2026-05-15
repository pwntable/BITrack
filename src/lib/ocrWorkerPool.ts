import { createWorker, Worker } from 'tesseract.js';

export async function runOcrBatch(images: HTMLCanvasElement[], onProgress?: (completed: number, total: number) => void): Promise<string[]> {
  if (!images || images.length === 0) {
    return [];
  }

  const numWorkers = Math.min(images.length, 4);
  const workers: Worker[] = [];

  try {
    // 1. Spin up workers in parallel
    const workerPromises = Array.from({ length: numWorkers }).map(() =>
      createWorker('eng')
    );
    
    // Wait for all workers to initialize
    workers.push(...(await Promise.all(workerPromises)));

    const results: string[] = new Array(images.length);

    let completedCount = 0;

    // 2. Distribute images across workers using a round-robin strategy
    // Worker `w` processes image indices `w`, `w + numWorkers`, `w + 2*numWorkers`...
    const workerTasks = workers.map(async (worker, workerIndex) => {
      for (let i = workerIndex; i < images.length; i += numWorkers) {
        const image = images[i];
        // Tesseract.js supports HTMLCanvasElement, HTMLImageElement, File, Blob, and ImageData directly
        const { data: { text } } = await worker.recognize(image);
        results[i] = text;
        completedCount++;
        if (onProgress) {
          onProgress(completedCount, images.length);
        }
      }
    });

    // Wait for all processing to complete
    await Promise.all(workerTasks);

    return results;
  } finally {
    // 3. Terminate all workers to free up memory
    const terminationPromises = workers.map(worker => worker.terminate());
    await Promise.all(terminationPromises);
  }
}
