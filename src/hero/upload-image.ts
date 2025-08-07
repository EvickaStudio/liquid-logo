import { toast } from 'sonner';

export async function uploadImage(pngBlob: Blob): Promise<string> {
  try {
    // Pure client-side: generate an ID and stash the blob in memory (URL) for session usage
    const imageId = Math.random().toString(36).slice(2);
    const url = URL.createObjectURL(pngBlob);
    sessionStorage.setItem(`logo:${imageId}`, url);
    window.history.pushState({}, '', `/${imageId}`);
    return imageId;
  } catch (error) {
    console.error('Error uploading image:', error);
    toast.error('Error uploading image, please try again.');
    throw error;
  }
}
