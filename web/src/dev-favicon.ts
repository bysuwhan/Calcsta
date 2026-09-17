/* Keep the development tab on the exact same user-provided mark as production. */
if (import.meta.env.DEV) {
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) icon.href = '/logo.svg';
}
