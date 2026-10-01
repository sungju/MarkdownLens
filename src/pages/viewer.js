/**
 * Standalone viewer. Useful when "Allow access to file URLs" is off, and as a
 * quick way to read a Markdown file that lives outside the browser.
 */

import { boot, openSource } from '../app/main.js';
import { SAMPLES } from './samples.js';

let booted = false;

const dropzone = document.getElementById('dropzone');
const input = document.getElementById('file');

document.getElementById('choose').addEventListener('click', () => input.click());
document.getElementById('sample').addEventListener('click', () => show(SAMPLES[0].text, 'sample.md'));

input.addEventListener('change', () => {
  const file = input.files?.[0];
  if (file) readFile(file);
});

for (const type of ['dragenter', 'dragover']) {
  window.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone?.classList.add('is-hot');
  });
}

window.addEventListener('dragleave', (event) => {
  if (event.relatedTarget === null) dropzone?.classList.remove('is-hot');
});

window.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone?.classList.remove('is-hot');
  const file = event.dataTransfer?.files?.[0];
  if (file) readFile(file);
});

async function readFile(file) {
  try {
    show(await file.text(), file.name);
  } catch (error) {
    console.error('[Markdown Lens] could not read that file:', error);
  }
}

async function show(text, name) {
  if (booted) {
    await openSource(text, name);
    return;
  }
  booted = true;
  await boot({
    source: text,
    url: location.href,
    name,
    watch: false,
    onRequestOpen: () => input.click(),
  });
  // boot() empties the body, so the picker needs re-attaching.
  document.body.appendChild(input);
  input.hidden = true;
}

if (new URLSearchParams(location.search).get('sample')) {
  show(SAMPLES[0].text, 'sample.md');
}
