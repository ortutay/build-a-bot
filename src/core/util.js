export const clip = (value, max = 500) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
};
