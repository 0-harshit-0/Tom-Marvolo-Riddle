export function randomId(type = 'default') {
  if (type == 'default') return (Date.now() + Math.random()).toString();
  // add the crypto type and use that
  // add the uuid type and use that
}
