import type { SampleCustomField } from '../models/sample';
import { t } from '../i18n';

const safe = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const fieldRow = (field: SampleCustomField = { field: '', value: '' }): string => `<div class="custom-field-row"><label><span>${t('sample.customFieldName')}</span><input name="customFieldName" maxlength="80" value="${safe(field.field)}"></label><label><span>${t('sample.customFieldValue')}</span><input name="customFieldValue" maxlength="500" value="${safe(field.value)}"></label><button class="icon-button custom-field-remove" type="button" aria-label="${t('sample.removeCustomField')}">×</button></div>`;

export const renderCustomFieldsEditor = (fields: SampleCustomField[] = []): string => `<fieldset class="custom-fields-editor" data-custom-fields data-max-fields="20"><legend>${t('sample.customFields')} (${t('notebook.max20')})</legend><div class="custom-field-list">${(fields.length ? fields : [{ field: '', value: '' }]).slice(0, 20).map(fieldRow).join('')}</div><button class="action-button custom-field-add" type="button">${t('sample.addCustomField')}</button></fieldset>`;

export const bindCustomFieldsEditor = (root: ParentNode = document): void => root.querySelectorAll<HTMLElement>('[data-custom-fields]').forEach((editor) => {
  if (editor.dataset.bound === 'true') return;
  editor.dataset.bound = 'true';
  const list = editor.querySelector<HTMLElement>('.custom-field-list');
  const add = editor.querySelector<HTMLButtonElement>('.custom-field-add');
  if (!list || !add) return;
  const update = (): void => {
    const rows = list.querySelectorAll('.custom-field-row');
    add.disabled = rows.length >= Number(editor.dataset.maxFields ?? 20);
    rows.forEach((row) => row.querySelector<HTMLButtonElement>('.custom-field-remove')?.toggleAttribute('disabled', rows.length <= 1));
  };
  add.addEventListener('click', () => {
    if (list.querySelectorAll('.custom-field-row').length >= Number(editor.dataset.maxFields ?? 20)) return;
    list.insertAdjacentHTML('beforeend', fieldRow());
    update();
  });
  list.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.custom-field-remove');
    if (!button || list.querySelectorAll('.custom-field-row').length <= 1) return;
    button.closest('.custom-field-row')?.remove();
    update();
  });
  update();
});

export const readCustomFields = (formData: FormData): SampleCustomField[] => {
  const names = formData.getAll('customFieldName').map((value) => value.toString().trim());
  const values = formData.getAll('customFieldValue').map((value) => value.toString().trim());
  return names.map((field, index) => ({ field, value: values[index] ?? '' })).filter((item) => item.field || item.value).slice(0, 20);
};