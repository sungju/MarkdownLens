/**
 * Declarative two-way binding between form controls and stored settings.
 *
 * Any element carrying `data-setting="<key>"` is wired automatically; the
 * value type is inferred from the control. Elements carrying
 * `data-output="<key>"` display the current value of that key.
 */

import { DEFAULTS, getSettings, setSettings, onSettingsChanged } from '../common/settings.js';

function readControl(element) {
  if (element.type === 'checkbox') return element.checked;
  if (element.type === 'number' || element.type === 'range') return Number(element.value);
  return element.value;
}

function writeControl(element, value) {
  if (element.type === 'checkbox') element.checked = Boolean(value);
  else if (document.activeElement !== element) element.value = String(value);
}

/**
 * @param {ParentNode} root
 * @param {(settings: object, patch: object) => void} [onChange] extra reaction
 */
export async function bindControls(root, onChange) {
  const controls = [...root.querySelectorAll('[data-setting]')];
  const outputs = [...root.querySelectorAll('[data-output]')];
  let settings = await getSettings();

  const paint = (values) => {
    for (const control of controls) {
      const key = control.dataset.setting;
      if (key in values) writeControl(control, values[key]);
    }
    for (const output of outputs) {
      const key = output.dataset.output;
      if (!(key in values)) continue;
      const suffix = output.dataset.suffix || '';
      output.textContent = `${values[key]}${suffix}`;
    }
  };

  paint(settings);

  for (const control of controls) {
    const key = control.dataset.setting;
    if (!(key in DEFAULTS)) {
      console.warn(`[Markdown Lens] unknown setting bound in the UI: ${key}`);
      continue;
    }
    const event = control.tagName === 'SELECT' || control.type === 'checkbox' ? 'change' : 'input';
    control.addEventListener(event, () => {
      const patch = { [key]: readControl(control) };
      settings = { ...settings, ...patch };
      paint(settings);
      setSettings(patch);
      onChange?.(settings, patch);
    });
  }

  onSettingsChanged((next, patch) => {
    settings = next;
    paint(next);
    onChange?.(next, patch);
  });

  return () => settings;
}
