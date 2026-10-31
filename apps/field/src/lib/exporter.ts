import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

/**
 * Hand an export to the user. Native: write to the app's Documents folder
 * (visible in the Files app) and open the share sheet if the WebView supports it.
 * Web: share sheet with a file when available, else a normal download.
 */
export async function shareFile(name: string, mime: string, text: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const r = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Documents, encoding: Encoding.UTF8 });
    try {
      const file = new File([text], name, { type: mime });
      if ((navigator as any).canShare?.({ files: [file] })) await navigator.share({ files: [file], title: name });
    } catch {
      /* user cancelled */
    }
    return `Saved to Files › Timber Tally › ${name} (${r.uri})`;
  }
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return `Downloaded ${name}`;
}
