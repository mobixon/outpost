// Prepares textures for drawing: the first frame of animated textures (vertical strips) and the
// tint the game multiplies some textures with (leaves, grass, potions).

const frames = new Map<string, Promise<string>>();

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The texture cannot be loaded'));
    image.src = url;
  });
}

async function render(url: string, tint: number | null): Promise<string> {
  const image = await load(url);
  const size = image.naturalWidth;
  if (tint === null && image.naturalHeight === size) return url;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context === null) return url;
  context.drawImage(image, 0, 0, size, size, 0, 0, size, size);
  if (tint !== null) {
    context.globalCompositeOperation = 'multiply';
    context.fillStyle = `#${tint.toString(16).padStart(6, '0')}`;
    context.fillRect(0, 0, size, size);
    // Keep the transparency of the texture.
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(image, 0, 0, size, size, 0, 0, size, size);
  }
  return canvas.toDataURL();
}

/** A data URL of the texture as the game shows it in the inventory. */
export function frameOf(url: string, tint: number | null): Promise<string> {
  const key = `${tint ?? ''}|${url}`;
  let frame = frames.get(key);
  if (frame === undefined) {
    frame = render(url, tint);
    frames.set(key, frame);
  }
  return frame;
}
