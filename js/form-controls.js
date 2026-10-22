// Keep native form semantics while making website-owned controls Spanish.
(function () {
  let nextFileId = 0;

  function enhanceFileInputs() {
    document.querySelectorAll('main input[type="file"]:not([hidden])').forEach((input) => {
      if (input.closest('.file-picker, .upload-button, .admin-upload-label')) return;
      const label = input.closest('label');
      const picker = document.createElement('span');
      picker.className = 'file-picker';
      const action = document.createElement('span');
      action.className = 'file-picker-action';
      action.textContent = input.multiple ? 'Seleccionar archivos' : 'Seleccionar archivo';
      action.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'file-picker-name';
      name.id = `selected-file-${++nextFileId}`;
      name.setAttribute('role', 'status');
      name.setAttribute('aria-live', 'polite');
      if (!input.getAttribute('aria-label') && !input.getAttribute('aria-labelledby')) {
        input.setAttribute('aria-label', label?.textContent.trim() || action.textContent);
      }
      input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), name.id].filter(Boolean).join(' '));
      input.classList.add('file-picker-input');
      input.before(picker);
      picker.append(action, name, input);
      const update = () => {
        // textContent keeps untrusted filenames as text, never HTML.
        name.textContent = Array.from(input.files || [], file => file.name).join(', ') || 'Ningún archivo seleccionado';
      };
      input.addEventListener('change', update);
      input.form?.addEventListener('reset', () => setTimeout(update, 0));
      update();
    });
  }

  function validationMessage(input) {
    if (input.validity.valueMissing) {
      if (input.type === 'file') return 'Selecciona un archivo.';
      if (input.type === 'checkbox') return 'Marca esta casilla para continuar.';
      if (input.tagName === 'SELECT') return 'Selecciona una opción.';
      return 'Completa este campo.';
    }
    if (input.validity.typeMismatch && input.type === 'email') return 'Escribe un correo electrónico válido.';
    if (input.validity.rangeUnderflow) return `El valor mínimo es ${input.min}.`;
    if (input.validity.rangeOverflow) return `El valor máximo es ${input.max}.`;
    return 'Revisa el valor de este campo.';
  }

  function start() {
    enhanceFileInputs();
    new MutationObserver(enhanceFileInputs).observe(document.querySelector('main') || document.body, { childList: true, subtree: true });
    document.addEventListener('invalid', (event) => {
      const input = event.target;
      if (!input.matches('main input, main select, main textarea')) return;
      // Retain more specific application validation (for example receipt size/type).
      if (!input.validity.customError) input.setCustomValidity(validationMessage(input));
      input.setAttribute('aria-invalid', 'true');
    }, true);
    for (const name of ['input', 'change']) document.addEventListener(name, (event) => {
      const input = event.target;
      if (!input.matches('main input, main select, main textarea')) return;
      input.setCustomValidity('');
      input.removeAttribute('aria-invalid');
    }, true);
    document.addEventListener('reset', (event) => {
      event.target.querySelectorAll('input, select, textarea').forEach(input => {
        input.setCustomValidity('');
        input.removeAttribute('aria-invalid');
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
