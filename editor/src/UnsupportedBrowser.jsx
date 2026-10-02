import { MonitorX } from 'lucide-react';

/** Shown when the browser can neither open folders nor write to its private file system (D9). */
export default function UnsupportedBrowser() {
  return <section className="unsupported-browser" aria-labelledby="unsupported-title">
    <MonitorX size={28} />
    <span className="section-kicker">UPDATE YOUR BROWSER</span>
    <h2 id="unsupported-title">Studio can't save projects in this browser</h2>
    <p>Studio keeps every project as files: in a folder on your computer, or in the browser's private storage where folders aren't available. This browser offers neither, or blocks it in private windows.</p>
    <ul>
      <li>Chrome, Edge or another Chromium browser: projects save to folders you choose.</li>
      <li>Safari 26 or later, Firefox 111 or later: projects save in the browser.</li>
      <li>Private or incognito windows may block browser storage. Open Studio in a regular window.</li>
    </ul>
  </section>;
}
